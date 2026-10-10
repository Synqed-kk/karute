/**
 * ⚖ S120 (READ-A attack A3, R-S120-10 item 2) — the create's stall is timed on the monotonic
 * clock. A wall-clock step DURING a second caller's lease create (an NTP correction: back by
 * more than the skew bound, or forward past the lease) used to move its `now` with it, so a
 * live holder's lease read too far ahead (unusable) or expired, and the second caller took it
 * over and paid beside the holder: 2 payers. The holder's lease is live, so the answer is busy.
 * Harness as s120-u1-lease-pins: the bucket is helpers/r5-bucket; `Date.now` is the wall clock,
 * `performance.now` the monotonic one (it does not move during the step).
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)

import { bucket, resetBucket } from './helpers/r5-bucket'
import { takeTranscriptLease, transcriptLeaseKey } from '@/lib/recording/transcript-memo'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const S = 1000
const wall = { now: T0 }
type Take = Awaited<ReturnType<typeof takeTranscriptLease>>
const pays = (t: Take) => t.state !== 'busy'

beforeEach(() => {
  resetBucket()
  wall.now = T0
  bucket.clock.now = T0
  jest.spyOn(Date, 'now').mockImplementation(() => wall.now)
  jest.spyOn(performance, 'now').mockReturnValue(5_000) // monotonic: no time passes in the create
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('a wall-clock step during the create never takes a live holder\'s lease', () => {
  it.each([-120, 400])('the wall clock steps %i s inside B\'s create: A held, B busy, 1 payer', async (step) => {
    const A = await takeTranscriptLease(MEMO, T0)
    expect(A.state).toBe('held')
    wall.now = T0 + 10 * S
    bucket.clock.now = T0 + 10 * S
    bucket.onCall = async (op, key, n) => {
      if (op === 'create' && key === LEASE && n === 2) wall.now += step * S // the step lands mid-create
      return null
    }
    const B = await takeTranscriptLease(MEMO, Date.now())
    expect(B.state).toBe('busy')
    expect([A, B].filter(pays)).toHaveLength(1)
  })
})
