/**
 * ⚖ S115 round 3 (S3) — THE CLOCK TOLERANCE IS DERIVED FROM THE TTL'S MARGIN. The lease outlives the
 * 300 s door limit by TTL − 300 s; a tolerance wider than that margin claimed a safety the margin
 * does not deliver. Boundaries at margin − 1 s and margin + 1 s, a clock per server.
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
import * as leaseTtl from '@/lib/recording/transcript-lease-ttl'

const MARGIN = TTL - 300_000
const TOLERANCE = (leaseTtl as Record<string, unknown>).TRANSCRIPT_LEASE_CLOCK_SKEW_MS

describe('S3 — clock skew against the TTL margin', () => {
  it('one definition: the door limit and the tolerance live beside the TTL, tolerance < TTL − door limit', () => {
    expect((leaseTtl as Record<string, unknown>).TRANSCRIPT_PAYING_DOOR_MAX_DURATION_MS).toBe(300_000)
    expect(typeof TOLERANCE).toBe('number')
    expect(TOLERANCE as number).toBeLessThan(MARGIN)
  })

  it('a writer ahead by margin − 1 s: its lease reads live (busy)', async () => {
    const now = T0 + DAY
    plant(LEASE, JSON.stringify({ v: 1, expires_at: now + TTL + MARGIN - 1_000, nonce: OTHER }), now)
    expect((await take(now)).state).toBe('busy')
  })

  it('a writer ahead by margin + 1 s: its lease is unreadable (warned) and falls open', async () => {
    const now = T0 + DAY
    plant(LEASE, JSON.stringify({ v: 1, expires_at: now + TTL + MARGIN + 1_000, nonce: OTHER }), now)
    expect((await take(now)).state).toBe('unknown')
    expect(warns).toContain('transcript-lease.expiry')
  })

  it('a taker ahead by margin − 1 s, at the last instant of a live holder (300 s), is busy', async () => {
    expect((await take(T0)).state).toBe('held')
    expect((await take(T0 + 300_000 + MARGIN - 1_000)).state).toBe('busy')
  })

  it('a taker ahead by margin + 1 s takes over a live holder — the stated limit of a time lease', async () => {
    expect((await take(T0)).state).toBe('held')
    expect((await take(T0 + 300_000 + MARGIN + 1_000)).state).toBe('held')
  })
})
