/**
 * ⚖ S115 round 3 (S1) — PAST THE 32-LINK CAP A DEAD CHAIN FALLS OPEN. transcribe.ts: "A stuck
 * lease never blocks paying: it expires and falls open to paying." 32 takeovers whose lease writes
 * all fail leave 32 dead claim links; the next take used to answer busy for ever.
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
const DAY = 24 * 3_600_000
const OTHER = '00000000-0000-4000-8000-000000000001'
/** One server's take at its own clock `at` (the storage clock reads the same). */
const take = (at: number) => {
  mockClock.now = at
  return takeTranscriptLease(MEMO, at)
}
const leaseNow = () => JSON.parse(mockObjects.get(LEASE)!.body) as { expires_at: number; nonce: string }
const claimKeys = () => [...mockObjects.keys()].filter((k) => k.endsWith('.claim.json'))
const plant = (key: string, body: string, createdAt: number) => mockObjects.set(key, { body, createdAt })
/** A call that answers anything but busy pays (held under the lease, unknown unleased). */
const payers = (xs: Array<{ state: string }>) => xs.filter((x) => x.state !== 'busy').length
let warns: string[] = []
beforeEach(() => {
  mockObjects.clear()
  mockRules.length = 0
  warns = []
  // The take adds its create's monotonic time to `now` (S120): drive it from the test clock, or a
  // create that takes real ms stamps the claim late and the next take, one TTL + 1 ms on, reads busy.
  jest.spyOn(performance, 'now').mockImplementation(() => mockClock.now)
  jest.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    try {
      warns.push((JSON.parse(String(line)) as { where: string }).where)
    } catch {
      warns.push(String(line))
    }
  })
})
afterEach(() => jest.restoreAllMocks())

/** The first take, then `n` takeovers one TTL apart whose lease writes all fail. */
const deadChain = async (n: number) => {
  expect((await take(T0)).state).toBe('held')
  const states: string[] = []
  for (let k = 1; k <= n; k++) {
    mockRules.push({ op: 'upsert', key: /\.lease\.json$/, kind: '500', times: 1 })
    states.push((await take(T0 + k * (TTL + 1))).state)
  }
  return states
}

describe('S1 — the 32-link cap never answers busy for ever', () => {
  it('33 dead links: the 33rd take pays (unknown, warned), and so does one a day and a year later — one payer per call, never busy', async () => {
    const states = await deadChain(33)
    expect(states.slice(0, 32)).toEqual(Array(32).fill('held'))
    expect(claimKeys()).toHaveLength(32)
    expect(states[32]).toBe('unknown')
    expect(warns).toContain('transcript-lease.links')
    const last = T0 + 33 * (TTL + 1)
    // ⚖ S116 round 4 (SF4): a day later the fall-open RE-ROOTS (its own lease, held);
    // a year later that lease has expired and the next take holds a fresh generation.
    for (const at of [last + DAY, last + 365 * DAY]) {
      const r = await take(at)
      expect(r.state).toBe('held')
      expect(payers([r])).toBe(1)
    }
    expect(claimKeys()).toHaveLength(33)
  })

  it('at the cap a LIVE last winner is still busy (the fall-open is for a dead chain only)', async () => {
    await deadChain(32)
    expect((await take(T0 + 32 * (TTL + 1) + 10_000)).state).toBe('busy')
  })
})
