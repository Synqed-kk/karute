/**
 * ⚖ S116 round 4 (#1088, Opus attack N1 + N4) — storage's created_at for an unreadable claim.
 * N1: a created_at with no offset is UTC, not this server's LOCAL time — proved under
 * TZ=Asia/Tokyo set here (jest pins UTC, which hid it). N4: an info() 404 is warned.
 */
jest.mock('server-only', () => ({}))

/** An in-memory `recordings` bucket: the storage's own create-only refusal, each
 *  object's server-side created_at (the storage clock, `mockClock`), and fault rules
 *  per operation (500 not landed · throw · lands then 500 · garbage read · overwrite). */
type MockObj = { body: string; createdAt: number }
type MockRule = {
  op: 'create' | 'upsert' | 'download' | 'info'
  key: RegExp
  kind: '500' | 'throw' | 'lands500' | 'garbage' | 'overwrite'
  times: number
  skip?: number
  body?: string
  err?: boolean
}
const mockObjects = new Map<string, MockObj>()
const mockRules: MockRule[] = []
const mockClock = { now: 0 }
const mockInfo: { fn: null | ((had: MockObj) => unknown) } = { fn: null }
const mockCalls = { info: 0, download: 0 }
function mockRuleFor(op: MockRule['op'], key: string): MockRule | null {
  for (const r of mockRules) {
    if (r.op !== op || r.times === 0 || !r.key.test(key)) continue
    if (r.skip) {
      r.skip--
      continue
    }
    if (r.times > 0) r.times--
    return r
  }
  return null
}
const mockErr = (statusCode: string, message: string) => ({ statusCode, message })
const mockTick = () => new Promise<void>((resolve) => setImmediate(resolve))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (key: string, body: string, opts: { upsert: boolean }) => {
          await mockTick()
          const rule = mockRuleFor(opts.upsert ? 'upsert' : 'create', key)
          if (rule?.kind === 'throw') throw new Error('storage threw')
          if (rule?.kind === '500') return { error: mockErr('500', 'Internal') }
          const had = mockObjects.get(key)
          if (!opts.upsert && had) return { error: mockErr('409', 'The resource already exists') }
          const createdAt = had?.createdAt ?? mockClock.now
          mockObjects.set(key, { body, createdAt })
          if (rule?.kind === 'overwrite') {
            mockObjects.set(key, { body: rule.body!, createdAt })
            if (rule.err) return { error: mockErr('500', 'Internal') }
          }
          if (rule?.kind === 'lands500') return { error: mockErr('500', 'Internal') }
          return { error: null }
        },
        download: async (key: string) => {
          await mockTick()
          const rule = mockRuleFor('download', key)
          if (rule?.kind === 'throw') throw new Error('storage threw')
          if (rule?.kind === '500') return { data: null, error: mockErr('500', 'Internal') }
          const had = mockObjects.get(key)
          if (!had) return { data: null, error: mockErr('404', 'Object not found') }
          const text = rule?.kind === 'garbage' ? '{not json' : had.body
          return { data: { text: async () => text }, error: null }
        },
        info: async (key: string) => {
          await mockTick()
          const rule = mockRuleFor('info', key)
          if (rule?.kind === 'throw') throw new Error('storage threw')
          if (rule?.kind === '500') return { data: null, error: mockErr('500', 'Internal') }
          const had = mockObjects.get(key)
          if (!had) return { data: null, error: mockErr('404', 'Object not found') }
          mockCalls.info++
          if (mockInfo.fn) return mockInfo.fn(had)
          return { data: { name: key, createdAt: new Date(had.createdAt).toISOString() }, error: null }
        },
      }),
    },
  }),
}))

import { takeTranscriptLease, transcriptLeaseClaimKey, transcriptLeaseKey } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS as TTL } from '@/lib/recording/transcript-lease-ttl'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const S = 1_000
const DAY = 86_400_000
const nn = (i: number) => i.toString(16).padStart(8, '0') + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ck = (nonce: string) => transcriptLeaseClaimKey(MEMO, { until: 0, nonce })
/** One server's take on its own clock `own`; storage's clock reads `store`. */
const takeAt = (own: number, store = own) => {
  mockClock.now = store
  return takeTranscriptLease(MEMO, own)
}
const plant = (key: string, body: unknown, createdAt: number) => mockObjects.set(key, { body: typeof body === 'string' ? body : JSON.stringify(body), createdAt })
const lease = (exp: number, nonce: string) => plant(LEASE, { v: 1, expires_at: exp, nonce }, T0)
/** A call that answers anything but busy pays (held under the lease, unknown unleased). */
const payers = (xs: Array<{ state: string }>) => xs.filter((x) => x.state !== 'busy').length
let warns: string[] = []
beforeEach(() => {
  mockObjects.clear()
  mockRules.length = 0
  mockInfo.fn = null
  warns = []
  jest.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    try {
      warns.push((JSON.parse(String(line)) as { where: string }).where)
    } catch {
      warns.push(String(line))
    }
  })
})
afterEach(() => jest.restoreAllMocks())

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const P = T0 + 2 * DAY
/** An expired lease whose claim body is garbage, created by storage at `born`. */
const unreadableClaim = (born: number) => {
  lease(T0 + TTL, nn(0))
  plant(ck(nn(0)), '{garbage', born)
}
const naive = (ms: number) => new Date(ms).toISOString().replace('Z', '')

/** Runs storage-time.ts in a child node whose zone is `tz`; returns [offset, Date.parse(s), parseStorageTime(s)] per input. */
const inZone = (tz: string, inputs: string[]) => {
  const src = readFileSync(join(process.cwd(), 'src/lib/recording/storage-time.ts'), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const run = `const exports = {}; ${js}; process.stdout.write(JSON.stringify([new Date(Date.UTC(2027, 0, 15)).getTimezoneOffset(), ...${JSON.stringify(inputs)}.map((s) => [Date.parse(s), exports.parseStorageTime(s)])]))`
  return JSON.parse(execFileSync(process.execPath, ['-e', run], { env: { PATH: process.env.PATH ?? '', TZ: tz } as NodeJS.ProcessEnv, encoding: 'utf8' })) as [number, ...Array<[number, number | null]>]
}

describe('N1 — a created_at with no offset is UTC under a non-UTC server zone', () => {
  it('under TZ=Asia/Tokyo (a child process: jest pins UTC): the trap is live, and parseStorageTime reads UTC', () => {
    const UTC_MS = Date.UTC(2027, 0, 15, 8, 0, 0)
    const [offset, iso, pg, z, plus9, junk] = inZone('Asia/Tokyo', [
      '2027-01-15T08:00:00.000',
      '2027-01-15 08:00:00.123456',
      '2027-01-15T08:00:00.000Z',
      '2027-01-15T17:00:00+09:00',
      'yesterday',
    ])
    expect(offset).toBe(-540)
    expect(iso[0]).toBe(UTC_MS - 9 * 3_600_000) // bare Date.parse: 9 h off
    expect(iso[1]).toBe(UTC_MS)
    expect(pg[1]).toBe(UTC_MS + 123)
    expect(z[1]).toBe(UTC_MS)
    expect(plus9[1]).toBe(UTC_MS)
    expect(junk[1]).toBeNull()
  })

  it.each([
    ['ISO with no offset', (ms: number) => naive(ms)],
    ['Postgres with a space and no offset', (ms: number) => naive(ms).replace('T', ' ')],
  ])('%s: a claim 10 s old is young (busy); 600 s past one TTL it falls open', async (_n, shape) => {
    mockInfo.fn = (had) => ({ data: { createdAt: shape(had.createdAt) }, error: null })
    unreadableClaim(P - 10 * S)
    expect((await takeAt(P)).state).toBe('busy')
    mockObjects.clear()
    unreadableClaim(P - TTL - 600 * S)
    expect((await takeAt(P)).state).not.toBe('busy')
  })

  it('an offset still wins: +09:00 and Z read the same instant', async () => {
    mockInfo.fn = (had) => ({ data: { createdAt: new Date(had.createdAt + 9 * 3_600 * S).toISOString().replace('Z', '+09:00') }, error: null })
    unreadableClaim(P - 10 * S)
    expect((await takeAt(P)).state).toBe('busy')
  })
})

describe('N4 — storage that 404s the info of a claim that 409ed is warned', () => {
  it('info 404 → busy, warned transcript-lease.claim-info', async () => {
    mockInfo.fn = () => ({ data: null, error: { statusCode: '404', message: 'Object not found' } })
    unreadableClaim(P - 10 * S)
    expect((await takeAt(P)).state).toBe('busy')
    expect(warns).toContain('transcript-lease.claim-info')
  })
})
