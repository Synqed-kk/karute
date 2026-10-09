/**
 * ⚖ S116 round 5 (#1088, R-S116-7 SF-A) — on the re-root path a lease READ ERROR (a download
 * error that is not a 404, a throw, a body that is not JSON) answers BUSY, never 「no lease」:
 * one transient 500 beside a live holder used to overwrite its lease (2 payers). A LASTING
 * failure still pays — at the first lease read (transcript-memo.ts, the `seen === null` →
 * unknown answer), so this is never a stuck path.
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)

import { bucket, resetBucket } from './helpers/r5-bucket'
import { takeTranscriptLease, transcriptLeaseClaimKey, transcriptLeaseKey } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS as TTL } from '@/lib/recording/transcript-lease-ttl'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const P = T0 + 400 * 86_400_000
const nn = (i: number) => i.toString(16).padStart(8, '0') + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const H = 'ffffffff-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const plant = (key: string, body: unknown, createdAt: number) => bucket.objects.set(key, { body: JSON.stringify(body), createdAt })
const capChain = () => {
  plant(LEASE, { v: 1, expires_at: T0 + TTL, nonce: nn(0) }, T0)
  for (let i = 0; i < 32; i++) plant(transcriptLeaseClaimKey(MEMO, { until: 0, nonce: nn(i) }), { v: 1, at: T0 + TTL + i * TTL, nonce: nn(i + 1) }, T0 + TTL + i * TTL)
}
const leaseNonce = () => (JSON.parse(bucket.objects.get(LEASE)!.body) as { nonce: string }).nonce
beforeEach(() => {
  resetBucket()
  bucket.clock.now = P
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('SF-A — the re-root re-read of the lease (3rd lease read: :279, the lost link, the re-root)', () => {
  it.each(['500', 'throw'] as const)('a live holder lands, then ONE %s on that read → busy, the holder keeps its lease: 1 payer (was 2)', async (kind) => {
    capChain()
    bucket.onCall = (op, key, n) => {
      if (op !== 'download' || key !== LEASE || n !== 3) return null
      plant(LEASE, { v: 1, expires_at: P + TTL, nonce: H }, P) // H re-rooted meanwhile: live
      return kind
    }
    const r = await takeTranscriptLease(MEMO, P)
    const payers = 1 + (r.state === 'busy' ? 0 : 1) // H holds and pays
    expect(payers).toBe(1)
    expect(r.state).toBe('busy')
    expect(leaseNonce()).toBe(H)
  })

  it('a body that is not JSON on that read is an error too → busy', async () => {
    capChain()
    bucket.onCall = (op, key, n) => {
      if (op === 'download' && key === LEASE && n === 3) bucket.objects.set(LEASE, { body: '{trunc', createdAt: P })
      return null
    }
    expect((await takeTranscriptLease(MEMO, P)).state).toBe('busy')
  })

  it('a 404 on that read is still 「no lease」 → the re-root holds (no new stuck path)', async () => {
    capChain()
    bucket.onCall = (op, key, n) => {
      if (op === 'download' && key === LEASE && n === 3) bucket.objects.delete(LEASE)
      return null
    }
    expect((await takeTranscriptLease(MEMO, P)).state).toBe('held')
  })

  it('a LASTING lease-read failure still PAYS (unknown at the first read), never busy for ever', async () => {
    capChain()
    bucket.onCall = (op, key) => (op === 'download' && key === LEASE ? '500' : null)
    for (const t of [0, 60_000, TTL + 1_000]) expect((await takeTranscriptLease(MEMO, P + t)).state).toBe('unknown')
  })
})
