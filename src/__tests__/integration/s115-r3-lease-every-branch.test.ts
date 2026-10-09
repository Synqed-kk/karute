/**
 * ⚖ S115 round 3 (Sonnet SF1 + the attack's untested cases) — every busy / held / unknown branch of
 * takeTranscriptLease that a revert would otherwise leave green, on a fault-injecting bucket with a
 * clock per call: claim error not ours, read-back unreadable, read-back names someone else, the
 * second release-straddle ordering, 2/3/10 waiters after a dead claim, and the two older paths
 * that still pay unleased (named residuals).
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
  jest.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    try {
      warns.push((JSON.parse(String(line)) as { where: string }).where)
    } catch {
      warns.push(String(line))
    }
  })
})
afterEach(() => jest.restoreAllMocks())

const EXPIRED = T0 + TTL + 1
/** A first holder whose lease has expired by EXPIRED. */
const expiredHolder = async () => {
  const first = await take(T0)
  expect(first.state).toBe('held')
  return leaseNow().nonce
}

describe('claim errors that are not ours → busy (never unknown: a claim error never pays unclaimed)', () => {
  it('the claim create fails without landing → busy for one poll hint, warned', async () => {
    await expiredHolder()
    mockRules.push({ op: 'create', key: /\.claim\.json$/, kind: '500', times: 1 })
    const r = await take(EXPIRED)
    expect(r).toEqual({ state: 'busy', until: EXPIRED + 5_000 })
    expect(warns).toContain('transcript-lease.claim')
  })

  it('the claim create throws → busy', async () => {
    await expiredHolder()
    mockRules.push({ op: 'create', key: /\.claim\.json$/, kind: 'throw', times: 1 })
    expect((await take(EXPIRED)).state).toBe('busy')
  })

  it('the claim answers an error while ANOTHER nonce stands → busy; one TTL later exactly one of three pays', async () => {
    await expiredHolder()
    mockRules.push({ op: 'create', key: /\.claim\.json$/, kind: 'overwrite', times: 1, err: true, body: JSON.stringify({ v: 1, at: EXPIRED, nonce: OTHER }) })
    expect((await take(EXPIRED)).state).toBe('busy')
    const rs = await Promise.all([1, 2, 3].map(() => take(EXPIRED + TTL + 1)))
    expect(payers(rs)).toBe(1)
  })
})

describe('after a won claim', () => {
  it('the lease read-back is unreadable → held (the claim holds the audio); the next caller is busy', async () => {
    await expiredHolder()
    mockRules.push({ op: 'download', key: /\.lease\.json$/, kind: '500', skip: 1, times: 1 })
    expect((await take(EXPIRED)).state).toBe('held')
    expect((await take(EXPIRED + 1_000)).state).toBe('busy')
  })

  it('the lease read-back names someone else → busy until THEIR lease ends', async () => {
    await expiredHolder()
    mockRules.push({ op: 'upsert', key: /\.lease\.json$/, kind: 'overwrite', times: 1, body: JSON.stringify({ v: 1, expires_at: EXPIRED + TTL, nonce: OTHER }) })
    expect(await take(EXPIRED)).toEqual({ state: 'busy', until: EXPIRED + TTL })
  })

  it('the lease upsert throws → held', async () => {
    await expiredHolder()
    mockRules.push({ op: 'upsert', key: /\.lease\.json$/, kind: 'throw', times: 1 })
    expect((await take(EXPIRED)).state).toBe('held')
  })

  it('release straddle, second ordering (the old holder\'s release lands between our upsert and read-back) → busy, then one TTL later one payer, nothing lost', async () => {
    const old = await expiredHolder()
    mockRules.push({ op: 'upsert', key: /\.lease\.json$/, kind: 'overwrite', times: 1, body: JSON.stringify({ v: 1, expires_at: 0, nonce: old }) })
    expect(await take(EXPIRED)).toEqual({ state: 'busy', until: EXPIRED + 5_000 })
    expect((await take(EXPIRED + 10_000)).state).toBe('busy')
    const rs = await Promise.all([1, 2, 3].map(() => take(EXPIRED + TTL + 1)))
    expect(payers(rs)).toBe(1)
  })
})

describe('waiters after a dead claim', () => {
  it.each([2, 3, 10])('%i waiters at one instant → exactly one pays', async (n) => {
    await expiredHolder()
    mockRules.push({ op: 'upsert', key: /\.lease\.json$/, kind: '500', times: 1 })
    expect((await take(EXPIRED)).state).toBe('held')
    const rs = await Promise.all(Array.from({ length: n }, () => take(EXPIRED + TTL + 1)))
    expect(payers(rs)).toBe(1)
  })
})

describe('named residuals (N3): two older storage paths still pay unleased', () => {
  it('the first create fails without landing → unknown (the caller pays)', async () => {
    mockRules.push({ op: 'create', key: /\.lease\.json$/, kind: '500', times: 1 })
    expect((await take(T0)).state).toBe('unknown')
  })

  it('a lease read error after the create was refused → unknown (pays even if a live lease stands)', async () => {
    expect((await take(T0)).state).toBe('held')
    mockRules.push({ op: 'download', key: /\.lease\.json$/, kind: '500', times: 1 })
    expect((await take(T0 + 1_000)).state).toBe('unknown')
  })
})
