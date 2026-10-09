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
/** S115 test hooks: fail the next lease UPSERT; land the next claim but answer an error;
 *  hold the next release write; serve the next lease read from before a gate. */
const hooks: { failUpsert: number; claimLandsButErrs: number; releaseGate: Promise<void> | null; staleReadGate: Promise<void> | null } = {
  failUpsert: 0,
  claimLandsButErrs: 0,
  releaseGate: null,
  staleReadGate: null,
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (key: string, body: string, opts: { upsert: boolean }) => {
          await tick()
          if (!opts.upsert && mockObjects.has(key)) return { error: { statusCode: '409', message: 'The resource already exists' } }
          if (opts.upsert && key.endsWith('.lease.json') && hooks.failUpsert > 0 && !body.includes('"expires_at":0')) {
            hooks.failUpsert--
            return { error: { statusCode: '500', message: 'Internal' } }
          }
          if (opts.upsert && body.includes('"expires_at":0') && hooks.releaseGate) {
            const gate = hooks.releaseGate
            hooks.releaseGate = null
            await gate
          }
          mockObjects.set(key, body)
          if (key.endsWith('.claim.json') && hooks.claimLandsButErrs > 0) {
            hooks.claimLandsButErrs--
            return { error: { statusCode: '500', message: 'Internal' } }
          }
          return { error: null }
        },
        download: async (key: string) => {
          await tick()
          const body = mockObjects.get(key)
          if (key.endsWith('.lease.json') && hooks.staleReadGate) {
            const gate = hooks.staleReadGate
            hooks.staleReadGate = null
            await gate
          }
          return body === undefined
            ? { data: null, error: { statusCode: '404', message: 'Object not found' } }
            : { data: { text: async () => body }, error: null }
        },
      }),
    },
  }),
}))

import { releaseTranscriptLease, takeTranscriptLease, transcriptLeaseClaimKey, transcriptLeaseKey } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS } from '@/lib/recording/transcript-lease-ttl'

const MEMO = 'trc/biz-1_take-1.ja.json'
const T0 = 1_800_000_000_000
const expired = T0 + TRANSCRIPT_LEASE_TTL_MS + 1

beforeEach(() => {
  mockObjects.clear()
  Object.assign(hooks, { failUpsert: 0, claimLandsButErrs: 0, releaseGate: null, staleReadGate: null })
})
const states = async (n: number, at: number) => (await Promise.all(Array.from({ length: n }, () => takeTranscriptLease(MEMO, at)))).map((r) => r.state)
const count = (xs: string[], s: string) => xs.filter((x) => x === s).length
const MIN = 60_000
const HOUR = 60 * MIN

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

  // ⚖ S115 (B1, Sonnet's scratch case made a committed test): a takeover WON its claim but its lease
  // write failed. Before S115 that caller paid holding nothing ('unknown') and every later take, for
  // ever, was busy. Now the claim itself holds for one TTL, then falls open to exactly one next payer.
  it('B1 (a) forced lease-upsert failure behind a won claim → +10 s busy, +1 h one payer, +24 h one payer, never unknown', async () => {
    expect((await takeTranscriptLease(MEMO, T0)).state).toBe('held')
    hooks.failUpsert = 1
    const winner = await takeTranscriptLease(MEMO, expired)
    if (winner.state === 'held') await releaseTranscriptLease(winner.lease, expired + 5_000) // its provider call failed
    expect(await states(3, expired + 10_000)).toEqual(['busy', 'busy', 'busy'])
    const hour = await states(3, expired + HOUR)
    expect([count(hour, 'held'), count(hour, 'unknown')]).toEqual([1, 0])
    // The +1 h payer dies without a release; a day later exactly one caller pays again.
    const day = await states(3, expired + 24 * HOUR)
    expect([count(day, 'held'), count(day, 'unknown')]).toEqual([1, 0])
    expect(winner.state).toBe('held')
  })

  it('B1 (b) a release that straddles the expiry (no clock skew) never strands the audio', async () => {
    const h1 = await takeTranscriptLease(MEMO, T0)
    if (h1.state !== 'held') throw new Error('expected held')
    let open!: () => void
    hooks.releaseGate = new Promise<void>((resolve) => (open = resolve))
    // H1 reads its own lease live 1 ms before the expiry; its write lands after H2 took over.
    const release = releaseTranscriptLease(h1.lease, T0 + TRANSCRIPT_LEASE_TTL_MS - 1)
    for (let i = 0; i < 5; i++) await tick()
    const h2 = await takeTranscriptLease(MEMO, expired)
    expect(h2.state).toBe('held')
    open()
    await release
    expect(JSON.parse(mockObjects.get(transcriptLeaseKey(MEMO))!)).toMatchObject({ expires_at: 0, nonce: h1.lease.nonce })
    if (h2.state === 'held') await releaseTranscriptLease(h2.lease, expired + 3_000) // its provider failed; a no-op
    expect(await states(2, expired + 10_000)).toEqual(['busy', 'busy'])
    const after = await states(3, expired + TRANSCRIPT_LEASE_TTL_MS + 1)
    expect([count(after, 'held'), count(after, 'unknown')]).toEqual([1, 0])
  })

  it('B1 (c) two waiting callers after a dead claim → exactly one wins the next link', async () => {
    expect((await takeTranscriptLease(MEMO, T0)).state).toBe('held')
    const lease = JSON.parse(mockObjects.get(transcriptLeaseKey(MEMO))!) as { expires_at: number; nonce: string }
    // A winner claimed this generation at `expired` and died before writing its lease.
    const dead = 'dead0000-0000-4000-8000-000000000000'
    mockObjects.set(transcriptLeaseClaimKey(MEMO, { until: lease.expires_at, nonce: lease.nonce }), JSON.stringify({ v: 1, at: expired, nonce: dead }))
    expect(await states(2, expired + MIN)).toEqual(['busy', 'busy'])
    const waiting = await states(2, expired + TRANSCRIPT_LEASE_TTL_MS)
    expect(waiting.sort()).toEqual(['busy', 'held'])
    expect(mockObjects.has(transcriptLeaseClaimKey(MEMO, { until: 0, nonce: dead }))).toBe(true)
  })

  it('B1 a claim that LANDS but answers an error is read back: that caller holds, a second is busy', async () => {
    expect((await takeTranscriptLease(MEMO, T0)).state).toBe('held')
    hooks.claimLandsButErrs = 1
    const [a, b] = await Promise.all([takeTranscriptLease(MEMO, expired), takeTranscriptLease(MEMO, expired)])
    expect([a.state, b.state].sort()).toEqual(['busy', 'held'])
  })

  // Sonnet S2: the claim alone is load-bearing — B reads the expired lease, stalls, A takes over
  // completely, B resumes on its stale read. Without the create-only claim both would hold.
  it('a stale reader of an expired lease is busy after another caller took over (the claim, not the read-back)', async () => {
    expect((await takeTranscriptLease(MEMO, T0)).state).toBe('held')
    let open!: () => void
    hooks.staleReadGate = new Promise<void>((resolve) => (open = resolve))
    const b = takeTranscriptLease(MEMO, expired)
    for (let i = 0; i < 5; i++) await tick()
    const a = await takeTranscriptLease(MEMO, expired)
    expect(a.state).toBe('held')
    open()
    expect((await b).state).toBe('busy')
  })
})
