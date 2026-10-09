/**
 * ⚖ S116 round 4 (#1088, Opus attack SF1 + SF2) — the claim read. SF1: a readable claim whose `at`
 * lies past now + the reader bound is invalid (the created_at path), never busy for ever. SF2: one
 * TRANSIENT read fault (500, throw, truncated body) on a healthy dead chain is re-read, never an
 * unleased second payer. A fault-injecting bucket with a clock per server and one for storage.
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

/** An expired lease (generation nn(0)) whose claim a dead winner holds: `at` as given. */
const deadClaim = (at: number, born: number) => {
  lease(T0 + TTL, nn(0))
  plant(ck(nn(0)), { v: 1, at, nonce: nn(1) }, born)
}

describe('SF1 — a claim `at` from the far future is not believed', () => {
  it.each([
    ['+600 s', 600 * S],
    ['+1 h', 3_600 * S],
    ['+1 year', 365 * DAY],
  ])('claim at %s: busy while storage says it is young; one TTL after storage created it the take pays — never busy for ever', async (_n, ahead) => {
    const P = T0 + DAY
    deadClaim(P + ahead, P)
    expect((await takeAt(P + 10 * S)).state).toBe('busy')
    const late = await takeAt(P + TTL + S)
    expect(late.state).not.toBe('busy')
    expect(warns).toContain('transcript-lease.claim-unreadable')
  })

  it('a claim `at` exactly at now + the reader bound (60 s) is still believed: a live winner, busy', async () => {
    const P = T0 + DAY
    deadClaim(P + 60 * S, P - 10 * DAY)
    expect((await takeAt(P)).state).toBe('busy')
  })
})

describe('SF2 — a transient claim-read fault never makes a second payer', () => {
  it.each([
    ['one 500', '500'],
    ['one throw', 'throw'],
    ['one truncated body', 'garbage'],
  ] as const)('%s on a dead chain, two callers at once → exactly one payer', async (_n, kind) => {
    deadClaim(T0 + TTL, T0 + TTL)
    mockRules.push({ op: 'download', key: /claim\.json$/, kind, times: 1 })
    const P = T0 + DAY
    mockClock.now = P
    const xs = await Promise.all([takeTranscriptLease(MEMO, P), takeTranscriptLease(MEMO, P)])
    expect(xs.map((x) => x.state).sort()).toEqual(['busy', 'held'])
    expect(payers(xs)).toBe(1)
  })

  it('one 500, the caller alone, then a second caller 60 s later → one payer', async () => {
    deadClaim(T0 + TTL, T0 + TTL)
    mockRules.push({ op: 'download', key: /claim\.json$/, kind: '500', times: 1 })
    const P = T0 + DAY
    const a = await takeAt(P)
    const b = await takeAt(P + 60 * S)
    expect([a.state, b.state]).toEqual(['held', 'busy'])
  })

  it('two faults in a row are still re-read (bounded: three reads) → one payer', async () => {
    deadClaim(T0 + TTL, T0 + TTL)
    mockRules.push({ op: 'download', key: /claim\.json$/, kind: '500', times: 2 })
    const P = T0 + DAY
    expect((await takeAt(P)).state).toBe('held')
  })

  it('a fault on every read of a YOUNG claim → busy (the caller comes back), never a pay', async () => {
    const P = T0 + DAY
    deadClaim(P, P)
    mockRules.push({ op: 'download', key: /claim\.json$/, kind: '500', times: -1 })
    expect((await takeAt(P + 10 * S)).state).toBe('busy')
  })
})
