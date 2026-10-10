/**
 * ⚖ S120 (READ-A attack A4, R-S120-10 item 3) — the generation fence counts only a readable
 * claim. claimExists used to count ANY 200 on our generation's claim key as a newer link's
 * claim: a proxy page (or any non-claim body) there made a NORMAL takeover (dead holder, one
 * taker) answer busy, and nobody paid. A body that does not parse as a claim (readClaim's
 * parser) is "storage will not say" → held, the fence's fail-open rule; a real claim is busy.
 * Harness as s120-u1-lease-pins (helpers/r5-bucket, `Date.now` is this file's clock).
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)

import { bucket, resetBucket } from './helpers/r5-bucket'
import { takeTranscriptLease, transcriptLeaseKey } from '@/lib/recording/transcript-memo'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const S = 1000
const clock = { now: T0 }
const take = (at: number) => { clock.now = at; bucket.clock.now = at; return takeTranscriptLease(MEMO, at) }
/** Plants `body` on the fence's key — the claim named by the taker's own nonce — just before its GET. */
const fenceReads = (body: string) => {
  const seen: string[] = []
  bucket.onCall = async (op, key) => {
    const nonce = (JSON.parse(bucket.objects.get(LEASE)?.body ?? '{}') as { nonce?: string }).nonce
    if (op === 'download' && nonce && key.endsWith(`.lease.${nonce}.claim.json`)) {
      seen.push(key)
      bucket.objects.set(key, { body, createdAt: clock.now })
    }
    return null
  }
  return seen
}

beforeEach(() => {
  resetBucket()
  jest.spyOn(Date, 'now').mockImplementation(() => clock.now)
  jest.spyOn(performance, 'now').mockImplementation(() => clock.now)
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('the fence counts only a readable claim', () => {
  it.each([
    ['a proxy page', '<html>gateway</html>'],
    ['JSON that is no claim', '{"ok":true}'],
    ['a claim of another version', '{"v":2,"at":1800000000000,"nonce":"0123456789abcdef"}'],
  ])('a normal takeover whose fence GET answers 200 with %s → held, 1 payer', async (_name, body) => {
    await take(T0 - 400 * S) // the holder, dead by T0
    const seen = fenceReads(body)
    const A = await take(T0)
    expect(seen).toHaveLength(1) // the fence did read our generation's claim key
    expect(A.state).toBe('held')
  })

  it('a real claim on our generation still fences → busy', async () => {
    await take(T0 - 400 * S)
    const seen = fenceReads(JSON.stringify({ v: 1, at: T0 + 330 * S, nonce: '0123456789abcdef' }))
    const A = await take(T0)
    expect(seen).toHaveLength(1)
    expect(A.state).toBe('busy')
  })
})
