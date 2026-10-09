/**
 * ⚖ S118 round 6 (#1088) — the guards the round-5 Reader A read reverted with no test failing.
 *  SF-1 (a) LEASE_LAST_ATTEMPT_PAY_BY_MS: a last attempt claimed 100 s into its invocation, facing
 *      a LIVE holder the whole time, starts its unleased pay no earlier than invocation + 135 s and
 *      no later than + 135 s + one poll (3 s) + a tick margin.
 *  SF-1 (b) the `busyUntil > 0` guard (one busy look before any fall-open): a last attempt claimed
 *      200 s in (already past pay-by) with a FREE lease takes the lease and pays LEASED.
 *  NIT-2 isLastAttempt's unreadable-count branches, exactly as the code answers today.
 * The REAL wait loop (runMeteredTranscription) and the REAL transcript-memo.ts over the r5 bucket;
 * the paid call is a stub that records Date.now() and throws (nothing past the pay matters here).
 * No wall clock: fake timers and Date, stepped 1 ms per storage tick (as s117-r5-pins-1088).
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
// process-recording (isLastAttempt) loads the ESM core client; never called here.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
jest.mock('@/lib/speaker-id/openai', () => ({ identifyStaffSegments: jest.fn(async () => null) }))
jest.mock('@/lib/deepgram', () => {
  class DeepgramHttpError extends Error {}
  const paidAt: number[] = []
  const pay = async () => {
    paidAt.push(Date.now())
    throw new Error('PAID (stub)')
  }
  return { paidAt, DeepgramHttpError, transcribeUrlWithDeepgram: jest.fn(pay), transcribeWithDeepgram: jest.fn(pay) }
})
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimitWithClient: jest.fn(async () => undefined),
  estimateTranscriptionCostCents: jest.fn(() => 1),
  reportTranscriptionUsageWithClient: jest.fn(async () => true),
  releaseTranscriptionReserveWithClient: jest.fn(async () => undefined),
}))
jest.mock('@/lib/recording/key-grammar', () => ({
  ...jest.requireActual('@/lib/recording/key-grammar'),
  composeTranscriptKey: () => ({ key: 'trc/biz-1_take-1.ja.json' }),
}))

import { bucket, bucketTick, resetBucket } from './helpers/r5-bucket'
import { WEBM_HEAD } from './helpers/container-head-fetch'
import { runMeteredTranscription, type TranscriptionMeter } from '@/lib/ai/transcribe'
import { transcriptLeaseKey } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS as TTL } from '@/lib/recording/transcript-lease-ttl'
import { isLastAttempt } from '@/lib/jobs/process-recording'

const MEMO = 'trc/biz-1_take-1.ja.json'
const paidAt = (jest.requireMock('@/lib/deepgram') as { paidAt: number[] }).paidAt
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const HOLDER = '00000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PAY_BY = 135_000
const POLL = 3_000
const TICK_MARGIN = 500

const fallOpenWarns = () =>
  (console.warn as unknown as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('transcript-lease.last-attempt-fall-open')).length
const leaseBody = () => {
  const o = bucket.objects.get(LEASE)
  return o ? (JSON.parse(o.body) as { expires_at: number; nonce: string }) : null
}

/** Runs one last-attempt metered call claimed `claimAtMs` into an invocation that began at T0. */
async function lastAttempt(claimAtMs: number, onPay?: () => void) {
  jest.setSystemTime(T0 + claimAtMs)
  bucket.clock.now = T0 + claimAtMs
  const meter: TranscriptionMeter = {
    synqed: {} as TranscriptionMeter['synqed'],
    businessId: 'biz-1',
    door: 'job',
    recordingSessionId: 'rs-1',
    attempt: 3,
    lastAttempt: true,
    invocationStartedAt: T0,
    audioKey: 'biz-1/take-1.webm',
  }
  const params = {
    audio: { buffer: Buffer.from(WEBM_HEAD), mimeType: 'audio/webm' },
    locale: 'ja',
    diarize: false,
    reference: null,
    mode: 'off' as const,
    businessType: null,
  }
  let settled = false
  let error: unknown = null
  void runMeteredTranscription(meter, params).then(
    () => (settled = true),
    (e) => ((error = e), (settled = true)),
  )
  let seenPays = 0
  for (let step = 0; step < 400_000 && !settled; step++) {
    await bucketTick()
    if (paidAt.length > seenPays) {
      seenPays = paidAt.length
      onPay?.()
    }
    jest.advanceTimersByTime(1)
  }
  expect(settled).toBe(true)
  expect(String(error)).toContain('PAID (stub)')
}

beforeEach(() => {
  resetBucket()
  paidAt.length = 0
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('SF-1 (a) — LEASE_LAST_ATTEMPT_PAY_BY_MS bounds the last attempt by its INVOCATION', () => {
  it('claimed 100 s in, a LIVE holder throughout: the unleased pay starts in [T0 + 135 s, T0 + 135 s + one poll + margin]', async () => {
    // The holder's lease stays live past the whole run (TTL 330 s from the claim).
    bucket.objects.set(LEASE, { body: JSON.stringify({ v: 1, expires_at: T0 + 100_000 + TTL, nonce: HOLDER }), createdAt: T0 })
    await lastAttempt(100_000)
    expect(paidAt).toHaveLength(1)
    expect(paidAt[0] - T0).toBeGreaterThanOrEqual(PAY_BY)
    expect(paidAt[0] - T0).toBeLessThanOrEqual(PAY_BY + POLL + TICK_MARGIN)
    expect(fallOpenWarns()).toBe(1)
    expect(leaseBody()?.nonce).toBe(HOLDER) // unleased: the holder's lease is untouched
  })
})

describe('SF-1 (b) — the `busyUntil > 0` guard: no fall-open before one busy look', () => {
  it('claimed 200 s in (past pay-by), the lease FREE: takes the lease and pays LEASED — no fall-open warn, the lease written then released', async () => {
    let atPay: { expires_at: number; nonce: string } | null = null
    await lastAttempt(200_000, () => (atPay = leaseBody()))
    expect(paidAt).toHaveLength(1)
    expect(fallOpenWarns()).toBe(0)
    expect(atPay).not.toBeNull()
    expect(atPay!.expires_at).toBeGreaterThan(paidAt[0])
    expect(leaseBody()).toEqual({ v: 1, expires_at: 0, nonce: atPay!.nonce })
  })
})

describe('NIT-2 — isLastAttempt: an unreadable count is the last attempt (as the code answers today)', () => {
  // Not pinned (no revert changes the answer): attempts +Infinity (≥ is true anyway) and
  // max_attempts null (≥ null reads null as 0, so true anyway).
  it.each([
    ['readable, attempts 2 of 3 → not last', 2, 3, false],
    ['readable, attempts 3 of 3 → last', 3, 3, true],
    ['attempts missing → last', undefined, 3, true],
    ['attempts null → last', null, 3, true],
    ['attempts a string → last', '2', 3, true],
    ['attempts NaN → last', Number.NaN, 3, true],
    ['max_attempts missing → last', 1, undefined, true],
    ['max_attempts a string → last', 1, '9', true],
    ['max_attempts NaN → last', 1, Number.NaN, true],
    ['max_attempts Infinity → last', 1, Number.POSITIVE_INFINITY, true],
  ] as const)('%s', (_n, attempts, max_attempts, last) => {
    expect(isLastAttempt({ attempts, max_attempts } as never)).toBe(last)
  })
})
