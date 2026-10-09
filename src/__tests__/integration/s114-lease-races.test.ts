/**
 * ⚖ S114 (F-CT-5, Greptile #1 and #2) — the "transcribing now" lease under races,
 * on an in-memory bucket with the storage's own create-only refusal and a fake
 * clock (every call is handed its `now`).
 *   (a) two pollers meeting ONE expired lease → exactly one holds (one pays);
 *   (b) an old holder releasing after a takeover leaves the new lease intact,
 *       so a third caller is told busy and does not pay.
 */
jest.mock('server-only', () => ({}))

const mockObjects = new Map<string, string>()
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (key: string, body: string, opts: { upsert: boolean }) => {
          await tick()
          if (!opts.upsert && mockObjects.has(key)) return { error: { statusCode: '409', message: 'The resource already exists' } }
          mockObjects.set(key, body)
          return { error: null }
        },
        download: async (key: string) => {
          await tick()
          const body = mockObjects.get(key)
          return body === undefined
            ? { data: null, error: { statusCode: '404', message: 'Object not found' } }
            : { data: { text: async () => body }, error: null }
        },
      }),
    },
  }),
}))

import { releaseTranscriptLease, takeTranscriptLease, transcriptLeaseKey } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS } from '@/lib/recording/transcript-lease-ttl'

const MEMO = 'trc/biz-1_take-1.ja.json'
const T0 = 1_800_000_000_000
const expired = T0 + TRANSCRIPT_LEASE_TTL_MS + 1

beforeEach(() => mockObjects.clear())

describe('the lease under races (S114 F-CT-5)', () => {
  it('(a) two pollers on one expired lease → exactly one holds; the other is busy', async () => {
    const first = await takeTranscriptLease(MEMO, T0)
    expect(first.state).toBe('held')
    const [a, b] = await Promise.all([takeTranscriptLease(MEMO, expired), takeTranscriptLease(MEMO, expired)])
    const states = [a.state, b.state].sort()
    expect(states).toEqual(['busy', 'held'])
    const winner = (a.state === 'held' ? a : b) as Extract<typeof a, { state: 'held' }>
    expect(JSON.parse(mockObjects.get(transcriptLeaseKey(MEMO))!).nonce).toBe(winner.lease.nonce)
  })

  it('(a) two pollers on one RELEASED lease → exactly one holds', async () => {
    const first = await takeTranscriptLease(MEMO, T0)
    if (first.state !== 'held') throw new Error('expected held')
    await releaseTranscriptLease(first.lease, T0 + 1_000)
    const results = await Promise.all([1, 2, 3].map(() => takeTranscriptLease(MEMO, T0 + 2_000)))
    expect(results.filter((r) => r.state === 'held')).toHaveLength(1)
  })

  it('(b) an old holder releasing after a takeover leaves the new lease intact; a third caller does not pay', async () => {
    const old = await takeTranscriptLease(MEMO, T0)
    if (old.state !== 'held') throw new Error('expected held')
    const fresh = await takeTranscriptLease(MEMO, expired)
    expect(fresh.state).toBe('held')
    const before = mockObjects.get(transcriptLeaseKey(MEMO))
    // The old holder's clock runs 40 s behind (it still believes its lease is live).
    await releaseTranscriptLease(old.lease, expired - 40_000)
    await releaseTranscriptLease(old.lease, expired + 1)
    expect(mockObjects.get(transcriptLeaseKey(MEMO))).toBe(before)
    const third = await takeTranscriptLease(MEMO, expired + 2)
    expect(third.state).toBe('busy')
  })

  it('a holder releases its own live lease, and the next caller holds', async () => {
    const mine = await takeTranscriptLease(MEMO, T0)
    if (mine.state !== 'held') throw new Error('expected held')
    await releaseTranscriptLease(mine.lease, T0 + 500)
    expect(JSON.parse(mockObjects.get(transcriptLeaseKey(MEMO))!)).toMatchObject({ expires_at: 0, nonce: mine.lease.nonce })
    expect((await takeTranscriptLease(MEMO, T0 + 600)).state).toBe('held')
  })

  it('a pre-S114 lease with no nonce is still taken over once', async () => {
    mockObjects.set(transcriptLeaseKey(MEMO), JSON.stringify({ v: 1, expires_at: 0 }))
    const results = await Promise.all([takeTranscriptLease(MEMO, T0), takeTranscriptLease(MEMO, T0)])
    expect(results.filter((r) => r.state === 'held')).toHaveLength(1)
  })
})
