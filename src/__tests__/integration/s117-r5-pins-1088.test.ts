/**
 * ⚖ S117 round 5 (#1088, item 2) — the three round-4 hunks the Sonnet R4 read reverted with no
 * test failing (SF-A / SF-B / SF-C). Each pin below fails when its one hunk is reverted.
 *  (a) CLAIM_READ_ATTEMPTS (transcript-memo.ts readClaim): a staggered second caller beside one
 *      whose claim read failed F times (F = 1, 2) — 1 payer at every offset (attempts 1 or 2: 2).
 *  (b) the re-root's live-lease re-read (`if (rerooting) { readLeaseOutcome … }`): two callers on a
 *      claim that always 500s, the second offset 0–12 ticks — 1 payer at every offset.
 *  (c) the created_at CALL SITE (claimCreatedAt → parseStorageTime): the real transcript-memo.ts,
 *      transpiled, in a child node under TZ=Asia/Tokyo (jest pins UTC) — a young unreadable claim
 *      is busy, not paid (a bare Date.parse reads it 9 h older and re-roots: held).
 * No wall clock: the backoff timers are jest fake timers, the storage round trips are setImmediate
 * ticks, and the driver below advances fake time by 1 ms per tick — every run is the same
 * interleaving.
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { bucket, bucketTick, resetBucket } from './helpers/r5-bucket'
import { takeTranscriptLease, transcriptLeaseClaimKey, transcriptLeaseKey, type TranscriptLeaseTake } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS as TTL } from '@/lib/recording/transcript-lease-ttl'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const P = T0 + 2 * 86_400_000
const nn = (i: number) => i.toString(16).padStart(8, '0') + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLAIM0 = transcriptLeaseClaimKey(MEMO, { until: 0, nonce: nn(0) })
const plant = (key: string, body: unknown, createdAt: number) => bucket.objects.set(key, { body: JSON.stringify(body), createdAt })
/** A dead chain: the lease (nonce 0) expired long ago; its claim's winner (nonce 1) never wrote a lease. */
const deadChain = () => {
  plant(LEASE, { v: 1, expires_at: T0 + TTL, nonce: nn(0) }, T0)
  plant(CLAIM0, { v: 1, at: T0 + TTL, nonce: nn(1) }, T0 + TTL)
}
const payers = (rs: TranscriptLeaseTake[]) => rs.filter((r) => r.state !== 'busy').length

/** Runs caller A, plus a caller B that `startB` launches from a storage hook; returns once both settle. */
async function race(startB: (launch: () => void) => void): Promise<TranscriptLeaseTake[]> {
  const callers: Promise<TranscriptLeaseTake>[] = []
  const done: boolean[] = []
  const track = (p: Promise<TranscriptLeaseTake>) => {
    const i = callers.push(p) - 1
    done[i] = false
    void p.then(() => (done[i] = true))
  }
  startB(() => track(takeTranscriptLease(MEMO, P)))
  track(takeTranscriptLease(MEMO, P))
  const settled = () => callers.length === 2 && done.every(Boolean)
  // One storage tick = one fake ms: a backoff timer fires at the tick it falls due, so two
  // callers' sleeps keep their start offset (advancing to the next timer would re-align them).
  for (let step = 0; step < 5_000 && !settled(); step++) {
    await bucketTick()
    jest.advanceTimersByTime(1)
  }
  expect(settled()).toBe(true)
  return Promise.all(callers)
}
const after = (ticks: number, fn: () => void) => void (async () => {
  for (let i = 0; i < ticks; i++) await bucketTick()
  fn()
})()

const OFFSETS = Array.from({ length: 13 }, (_, i) => i)

beforeEach(() => {
  resetBucket()
  bucket.clock.now = P
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('SF-A pin — CLAIM_READ_ATTEMPTS (3): a transient claim-read fault never makes a second payer', () => {
  it.each([1, 2])('claim read fails %i time(s), the 2nd caller starts from a hook on that read at offsets 0–12 ticks: 1 payer at every offset', async (F) => {
    const byOffset: number[] = []
    for (const offset of OFFSETS) {
      resetBucket()
      deadChain()
      let startB: (() => void) | null = null
      const rs = await race((launch) => {
        startB = launch
        bucket.onCall = async (op, key, n) => {
          if (op !== 'download' || key !== CLAIM0 || n > F) return null
          if (n === F) after(offset, startB!)
          for (let i = 0; i < 6; i++) await bucketTick() // a slow 500
          return '500'
        }
      })
      byOffset.push(payers(rs))
    }
    expect(byOffset).toEqual(OFFSETS.map(() => 1))
  })
})

describe('SF-B pin — the re-root re-reads the live lease before it writes', () => {
  it('a claim that always 500s (storage dates it old), the 2nd caller offset 0–12 ticks: 1 payer at every offset', async () => {
    const byOffset: number[] = []
    for (const offset of OFFSETS) {
      resetBucket()
      deadChain()
      bucket.onCall = (op, key) => (op === 'download' && key === CLAIM0 ? '500' : null)
      const rs = await race((launch) => after(offset, launch))
      byOffset.push(payers(rs))
    }
    expect(byOffset).toEqual(OFFSETS.map(() => 1))
  })
})

/** Runs the REAL transcript-memo.ts (transpiled, with its real storage-time / storage-duplicate /
 *  transcript-lease-ttl, and stubs for server-only, take-binding and the storage client) in a child
 *  node under `tz`: a dead lease whose claim body is garbage, storage's created_at for that claim
 *  given with no offset (UTC wall time) `ageMs` before now. Prints the take's state. */
function takeInZone(tz: string, ageMs: number): string {
  const tx = (rel: string) =>
    ts.transpileModule(readFileSync(join(process.cwd(), 'src/lib', rel), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
  const sources = {
    '@/lib/recording/storage-time': tx('recording/storage-time.ts'),
    '@/lib/recording/storage-duplicate': tx('recording/storage-duplicate.ts'),
    '@/lib/recording/transcript-lease-ttl': tx('recording/transcript-lease-ttl.ts'),
    memo: tx('recording/transcript-memo.ts'),
  }
  const child = `
const sources = ${JSON.stringify(sources)}
const MEMO = ${JSON.stringify(MEMO)}, LEASE = ${JSON.stringify(LEASE)}, CLAIM0 = ${JSON.stringify(CLAIM0)}
const NOW = ${P}, TTL = ${TTL}, AGE = ${ageMs}
const objects = new Map([
  [LEASE, { body: JSON.stringify({ v: 1, expires_at: ${T0 + TTL}, nonce: ${JSON.stringify(nn(0))} }), createdAt: ${T0} }],
  [CLAIM0, { body: '{garbage', createdAt: NOW - AGE }],
])
const naive = (ms) => new Date(ms).toISOString().replace('Z', '')
const bucket = {
  upload: async (key, body, opts) => {
    const had = objects.get(key)
    if (!opts.upsert && had) return { error: { statusCode: '409', message: 'The resource already exists' } }
    objects.set(key, { body, createdAt: had ? had.createdAt : NOW })
    return { error: null }
  },
  download: async (key) => {
    const had = objects.get(key)
    if (!had) return { data: null, error: { statusCode: '404', message: 'Object not found' } }
    return { data: { text: async () => had.body }, error: null }
  },
  info: async (key) => {
    const had = objects.get(key)
    if (!had) return { data: null, error: { statusCode: '404', message: 'Object not found' } }
    return { data: { name: key, createdAt: naive(had.createdAt) }, error: null }
  },
}
const stubs = {
  'server-only': {},
  'node:crypto': require('node:crypto'),
  '@/lib/supabase/service': { createServiceClient: () => ({ storage: { from: () => bucket } }) },
  '@/lib/recording/take-binding': {
    isStorageNotFound: (e) => !!e && (e.statusCode === '404' || e.status === 404) && e.message === 'Object not found',
    warnStorageUnknown: () => {},
  },
}
const loaded = {}
const load = (name) => {
  if (stubs[name]) return stubs[name]
  if (loaded[name]) return loaded[name].exports
  const module = { exports: {} }
  loaded[name] = module
  new Function('exports', 'require', 'module', sources[name])(module.exports, load, module)
  return module.exports
}
load('memo').takeTranscriptLease(MEMO, NOW).then((r) => process.stdout.write(JSON.stringify([new Date(NOW).getTimezoneOffset(), r.state])))
`
  const [offset, state] = JSON.parse(
    execFileSync(process.execPath, ['-e', child], { env: { PATH: process.env.PATH ?? '', TZ: tz } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' }),
  ) as [number, string]
  expect(offset).toBe(tz === 'Asia/Tokyo' ? -540 : 0)
  return state
}

describe('SF-C pin — claimCreatedAt reads storage created_at as UTC at the call site (real memo, child node)', () => {
  it('under TZ=Asia/Tokyo: an unreadable claim storage made 10 s ago is BUSY (a bare Date.parse reads it 9 h old → re-root → held, a 2nd payer)', () => {
    jest.useRealTimers()
    expect(takeInZone('Asia/Tokyo', 10_000)).toBe('busy')
    expect(takeInZone('UTC', 10_000)).toBe('busy')
  })

  it('under TZ=Asia/Tokyo: one made a TTL + 10 s ago still falls open (re-root → held) — the pin is not 「always busy」', () => {
    jest.useRealTimers()
    expect(takeInZone('Asia/Tokyo', TTL + 10_000)).toBe('held')
  })
})
