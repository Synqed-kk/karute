/** ⚖ S120 (G6, Greptile thread 4131459898: "Old marker masks new debt") — the true-up marker
 *  proves ONLY the true-up of the memo generation it was written for. Start: the S119 R4 harness
 *  (build-s119/charge/srccheck-R4/zz-r4-g5-g6.test.ts.txt, G6 case). A pays d1 = 99 and its marker
 *  lands; the memo is then proven corrupt; B repairs it with d2 = 199 and B's debit fails (core
 *  refused). Before S120 every later replay read A's marker as "recorded" and the 199 was never
 *  recorded (core's rolling 24 h cap under-counts). Counts: provider payers (dg.paid) and ledger
 *  calls (led.calls) — numbers, never transcript words. */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
jest.mock('@/lib/speaker-id/openai', () => ({ identifyStaffSegments: jest.fn(async () => null) }))
jest.mock('@/lib/deepgram', () => {
  class DeepgramHttpError extends Error {}
  const st = { paid: 0, dur: 100 }
  const pay = async () => {
    st.paid++
    return { transcript: 'x', durationSec: st.dur, confidence: 1, words: [], paragraphs: [] }
  }
  return { st, DeepgramHttpError, transcribeUrlWithDeepgram: jest.fn(pay), transcribeWithDeepgram: jest.fn(pay) }
})
jest.mock('@/lib/ai-rate-limit', () => {
  const led = { calls: [] as Array<{ cents: number; ok: boolean }>, failCents: new Set<number>() }
  return {
    led,
    enforceAiRateLimitWithClient: jest.fn(async () => undefined),
    estimateTranscriptionCostCents: jest.fn((sec: number) => Math.max(1, Math.ceil(sec))),
    reportTranscriptionUsageWithClient: jest.fn(async (_c: unknown, cents: number) => {
      const ok = !led.failCents.has(cents)
      led.calls.push({ cents, ok })
      return ok
    }),
    releaseTranscriptionReserveWithClient: jest.fn(async () => undefined),
  }
})
jest.mock('@/lib/recording/key-grammar', () => ({
  ...jest.requireActual('@/lib/recording/key-grammar'),
  composeTranscriptKey: () => ({ key: 'trc/biz-1_take-1.ja.json' }),
}))

import { bucket, resetBucket } from './helpers/r5-bucket'
import { WEBM_HEAD } from './helpers/container-head-fetch'
import { runMeteredTranscription, type TranscriptionMeter } from '@/lib/ai/transcribe'

const MEMO = 'trc/biz-1_take-1.ja.json'
/** The pre-S120 marker key (one per audio) — preview runs may have written some. */
const LEGACY_MARK = 'trc/biz-1_take-1.ja.trueup.json'
const dg = (jest.requireMock('@/lib/deepgram') as { st: { paid: number; dur: number } }).st
const led = (jest.requireMock('@/lib/ai-rate-limit') as { led: { calls: Array<{ cents: number; ok: boolean }>; failCents: Set<number> } }).led
const meter = (): TranscriptionMeter =>
  ({ synqed: {} as TranscriptionMeter['synqed'], businessId: 'biz-1', door: 'job', recordingSessionId: 'rs-1', audioKey: 'biz-1/take-1.webm' }) as TranscriptionMeter
const params = { audio: { buffer: Buffer.from(WEBM_HEAD), mimeType: 'audio/webm' }, locale: 'ja', diarize: false, reference: null, mode: 'off' as const, businessType: null }
const call = async () => {
  const r = await runMeteredTranscription(meter(), params)
  expect(r.result).toBeTruthy() // the karute gets its answer on every call: nothing left untranscribed
  return r.receipt
}
/** A real millisecond apart: A's and B's memos are two generations, as a paid provider call makes them. */
const later = () => new Promise((resolve) => setTimeout(resolve, 2))
/** The ledger's true-up rows. The reserve rides the same writer at 1 ¢ (a tiny audio head), once per payer. */
const deltas = () => led.calls.filter((c) => c.cents > 1)
const reserves = () => led.calls.filter((c) => c.cents === 1).length
const markers = () => [...bucket.objects.keys()].filter((k) => k.endsWith('.trueup.json')).sort()

beforeEach(() => {
  resetBucket()
  bucket.clock.now = Date.now()
  dg.paid = 0
  dg.dur = 100
  led.calls.length = 0
  led.failCents.clear()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

/** A pays d1 = 99 (its marker lands); the memo is proven corrupt; B repairs it, paying d2 = 199,
 *  whose debit succeeds only when `bLedger`. */
async function aThenRepairB(bLedger: boolean) {
  const a = await call()
  expect(a).toMatchObject({ replayed: false, debit_recorded: true })
  expect(markers()).toHaveLength(1)
  bucket.objects.set(MEMO, { body: '{corrupt', createdAt: Date.now() })
  await later()
  dg.dur = 200
  if (!bLedger) led.failCents.add(199)
  const b = await call()
  led.failCents.clear()
  expect(b).toMatchObject({ replayed: false, debit_recorded: bLedger })
  expect(JSON.parse(bucket.objects.get(MEMO)!.body).trueUp).toMatchObject({ deltaCents: 199 })
}

describe('s120 G6 — a true-up marker answers only for its own memo generation', () => {
  it('g6a keepOldMarker: A’s old marker stands, B’s repaired memo owes 199 whose debit FAILED → the next replay records 199 ONCE; the one after records nothing; 2 payers, never 3', async () => {
    await aThenRepairB(false)
    const c = await call()
    const d = await call()
    expect(c).toMatchObject({ replayed: true, debit_recorded: true })
    expect(d).toMatchObject({ replayed: true, debit_recorded: true })
    expect(deltas()).toEqual([{ cents: 99, ok: true }, { cents: 199, ok: false }, { cents: 199, ok: true }])
    expect(markers()).toHaveLength(2) // A's stands untouched; B's generation has its own
    expect(dg.paid).toBe(2)
    expect(reserves()).toBe(2)
  })

  it('g6b clean control: A pays 99 and marks it → two replays record nothing more (no double debit when marker and memo match); 1 payer', async () => {
    await call()
    const c = await call()
    const d = await call()
    expect(c).toMatchObject({ replayed: true, debit_recorded: true })
    expect(d).toMatchObject({ replayed: true, debit_recorded: true })
    expect(deltas()).toEqual([{ cents: 99, ok: true }])
    expect(markers()).toHaveLength(1)
    expect(dg.paid).toBe(1)
    expect(reserves()).toBe(1)
  })

  it('g6c B’s repaired true-up LANDED → replays record nothing more: exactly 99 and 199, once each', async () => {
    await aThenRepairB(true)
    await call()
    await call()
    expect(deltas()).toEqual([{ cents: 99, ok: true }, { cents: 199, ok: true }])
    expect(markers()).toHaveLength(2)
    expect(dg.paid).toBe(2)
    expect(reserves()).toBe(2)
  })

  it('g6d a pre-S120 marker (audio key, no generation) is never read: the owed delta is recorded ONCE more (the safe direction), then nothing; the old object is left in place', async () => {
    const a = await call()
    expect(a.debit_recorded).toBe(true)
    // Plant what a pre-S120 deploy would have left: the memo's debt plus the audio-keyed marker only.
    for (const k of markers()) bucket.objects.delete(k)
    const legacy = JSON.stringify({ v: 1, deltaCents: 99, recorded_at: '2026-10-01T00:00:00.000Z' })
    bucket.objects.set(LEGACY_MARK, { body: legacy, createdAt: Date.now() })
    led.calls.length = 0
    await call()
    await call()
    expect(deltas()).toEqual([{ cents: 99, ok: true }])
    expect(bucket.objects.get(LEGACY_MARK)?.body).toBe(legacy)
    expect(markers()).toHaveLength(2)
    expect(dg.paid).toBe(1)
    expect(reserves()).toBe(0) // the two replays reserve nothing (counted after A)
  })
})
