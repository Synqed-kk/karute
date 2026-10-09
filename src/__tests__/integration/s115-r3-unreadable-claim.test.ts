/**
 * ⚖ S115 round 3 (S2) — AN UNREADABLE FOREIGN CLAIM FALLS OPEN AFTER ONE TTL. Its age comes from
 * the storage object's own created_at (storage-js info(): createdAt), never from its body; past
 * one TTL the caller pays unleased (unknown), and no next link is ever named from the key.
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

/** A first holder whose lease has expired; returns the claim key a takeover would create. */
const expiredHolder = async () => {
  expect((await take(T0)).state).toBe('held')
  const lease = leaseNow()
  return transcriptLeaseClaimKey(MEMO, { until: lease.expires_at, nonce: lease.nonce })
}
const BORN = T0 + TTL + 1
const claimBody = (nonce: string) => JSON.stringify({ v: 1, at: BORN, nonce })

describe('S2 — an unreadable claim is aged by storage, then falls open', () => {
  const cases: Array<[string, (key: string) => void]> = [
    ['a garbage body', (key) => plant(key, '{not json', BORN)],
    ['a body this code never writes (v: 2)', (key) => plant(key, JSON.stringify({ v: 2, at: BORN, nonce: OTHER }), BORN)],
    ['a nonce that fails the generation grammar', (key) => plant(key, claimBody('not a nonce!'), BORN)],
    ['a claim whose every read fails (500)', (key) => {
      plant(key, claimBody(OTHER), BORN)
      mockRules.push({ op: 'download', key: /\.claim\.json$/, kind: '500', times: -1 })
    }],
  ]
  it.each(cases)('%s: busy while young; one TTL after storage created it the take pays (unknown) — no next link named from the key', async (_name, arrange) => {
    const claimKey = await expiredHolder()
    arrange(claimKey)
    expect((await take(BORN + 10_000)).state).toBe('busy')
    const links = claimKeys().length
    expect((await take(BORN + TTL + 1)).state).toBe('unknown')
    expect(warns).toContain('transcript-lease.claim-unreadable')
    expect((await take(BORN + 365 * DAY)).state).toBe('unknown')
    expect(claimKeys()).toHaveLength(links)
  })

  it('storage will not give the age either (info 500): busy — no age, no pay (the stated residual)', async () => {
    const claimKey = await expiredHolder()
    plant(claimKey, '{not json', BORN)
    mockRules.push({ op: 'info', key: /\.claim\.json$/, kind: '500', times: -1 })
    expect((await take(BORN + TTL + 1)).state).toBe('busy')
  })

  it('a READABLE dead claim still chains (one payer), it does not fall open', async () => {
    const claimKey = await expiredHolder()
    plant(claimKey, claimBody(OTHER), BORN)
    const rs = await Promise.all([1, 2, 3].map(() => take(BORN + TTL + 1)))
    expect(rs.map((r) => r.state).sort()).toEqual(['busy', 'busy', 'held'])
  })
})
