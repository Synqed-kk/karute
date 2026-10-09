/**
 * ⚖ S116 round 4 (#1088, Opus attack SF4) — A FALL-OPEN RE-ROOTS THE CHAIN. Past the 32-link cap
 * and on an old unreadable claim no lease was ever written, so EVERY arrival paid while the state
 * lasted. The fall-open now writes a fresh lease (upsert, read back): later arrivals see it live
 * and are held off; when it ends, the next generation is a fresh claim — never a new stuck path.
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

const P = T0 + 400 * DAY
/** `L` dead links one TTL apart behind the expired generation nn(0). */
const capChain = (L: number) => {
  lease(T0 + TTL, nn(0))
  for (let i = 0; i < L; i++) plant(ck(nn(i)), { v: 1, at: T0 + TTL + i * TTL, nonce: nn(i + 1) }, T0 + TTL + i * TTL)
}
const oldUnreadable = () => {
  lease(T0 + TTL, nn(0))
  plant(ck(nn(0)), '{garbage', P - 600 * S)
}
const arrivals = async () => {
  const out: Array<{ state: string }> = []
  for (const t of [30, 60, 120, 240, 299]) out.push(await takeAt(P + t * S))
  return out
}

describe.each([
  ['the 32-link cap', () => capChain(32)],
  ['an old unreadable claim', oldUnreadable],
])('SF4 — %s', (_n, arrange) => {
  it('a burst of 10 → exactly one payer; arrivals over the next 299 s → all busy', async () => {
    arrange()
    mockClock.now = P
    const burst = await Promise.all(Array.from({ length: 10 }, () => takeTranscriptLease(MEMO, P)))
    expect(payers(burst)).toBe(1)
    expect(payers(await arrivals())).toBe(0)
  })

  it('payer A, a reopen B at +45 s, the job cron C at +60 s → one payer', async () => {
    arrange()
    const xs = [await takeAt(P), await takeAt(P + 45 * S), await takeAt(P + 60 * S)]
    expect(xs.map((x) => x.state)).toEqual(['held', 'busy', 'busy'])
  })

  it('no new stuck path: the re-rooted holder never releases → one TTL later the next take holds a FRESH generation', async () => {
    arrange()
    expect((await takeAt(P)).state).toBe('held')
    expect((await takeAt(P + TTL + S)).state).toBe('held')
    expect((await takeAt(P + TTL + 2 * S)).state).toBe('busy')
  })

  it('the re-root write fails → unknown (pays, as before), warned', async () => {
    arrange()
    mockRules.push({ op: 'upsert', key: /\.lease\.json$/, kind: '500', times: 1 })
    expect((await takeAt(P)).state).toBe('unknown')
    expect(warns).toContain('transcript-lease.reroot')
  })
})
