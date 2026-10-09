/**
 * ⚖ S120 (#1088, U1, G5) — the unusable-lease takeover seen through runMeteredTranscription
 * (start: the S119 R4 source-check harness). Payers = provider calls; the ledger = core's
 * true-up calls (ai_request_log transcribe:usage); the marker = the true-up's recorded fact.
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
jest.mock('@/lib/speaker-id/openai', () => ({ identifyStaffSegments: jest.fn(async () => null) }))
jest.mock('@/lib/deepgram', () => {
  class DeepgramHttpError extends Error {}
  const st = { paid: 0, dur: 100, ticks: 0 }
  const pay = async () => {
    st.paid++
    for (let i = 0; i < st.ticks; i++) await new Promise<void>((r) => setImmediate(r))
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
import { transcriptLeaseKey, transcriptTrueUpKey } from '@/lib/recording/transcript-memo'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const WRITTEN_AT = 'w' // the planted memo's generation (G6: the marker key names it)
const MARK = transcriptTrueUpKey(MEMO, WRITTEN_AT)
const dg = (jest.requireMock('@/lib/deepgram') as { st: { paid: number; dur: number; ticks: number } }).st
const led = (jest.requireMock('@/lib/ai-rate-limit') as { led: { calls: Array<{ cents: number; ok: boolean }>; failCents: Set<number> } }).led
const meter = (door: 'web' | 'job'): TranscriptionMeter => ({ synqed: {} as TranscriptionMeter['synqed'], businessId: 'biz-1', door, recordingSessionId: 'rs-1', audioKey: 'biz-1/take-1.webm' } as TranscriptionMeter)
const params = { audio: { buffer: Buffer.from(WEBM_HEAD), mimeType: 'audio/webm' }, locale: 'ja', diarize: false, reference: null, mode: 'off' as const, businessType: null }
const call = async (door: 'web' | 'job') => {
  try {
    const r = await runMeteredTranscription(meter(door), params)
    return { ok: true, receipt: r.receipt }
  } catch (e) {
    return { ok: false, err: String((e as { code?: string }).code ?? e) }
  }
}
const plant = (k: string, body: string) => bucket.objects.set(k, { body, createdAt: Date.now() })
const body = (k: string) => bucket.objects.get(k)?.body ?? null
beforeEach(() => {
  resetBucket(); bucket.clock.now = Date.now()
  dg.paid = 0; dg.dur = 100; dg.ticks = 0; led.calls.length = 0; led.failCents.clear()
  jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const BAD: Record<string, string> = { notJson: '{not json', v2: JSON.stringify({ v: 2, expires_at: 1, nonce: 'aaaaaaaa' }) }

describe('G5 metered: an unusable lease no longer lets every call pay, and an owed true-up closes', () => {
  it.each(['clean', 'notJson', 'v2'])('two overlapping web calls, no memo, lease=%s: 1 payer, the other answers conflict', async (name) => {
    if (name !== 'clean') plant(LEASE, BAD[name])
    dg.ticks = 40
    const rs = await Promise.all([call('web'), call('web')])
    expect(dg.paid).toBe(1)
    expect(rs.map((r) => (r.ok ? 'ok' : r.err))).toEqual(['ok', 'conflict'])
  })

  it.each(['clean', 'notJson'])('memo owes a true-up (99c), no marker, lease=%s: three replays record it once, marker written, no payer', async (name) => {
    if (name !== 'clean') plant(LEASE, BAD[name])
    plant(MEMO, JSON.stringify({ v: 1, result: { transcript: 'x', durationSec: 100 }, duration_seconds: 100, written_at: WRITTEN_AT, trueUp: { reserveCents: 1, costCents: 100, deltaCents: 99 } }))
    const rec = []
    for (let i = 0; i < 3; i++) {
      const r = await call('job')
      rec.push(r.ok ? r.receipt!.debit_recorded : r.err)
    }
    expect(dg.paid).toBe(0)
    expect(led.calls).toEqual([{ cents: 99, ok: true }])
    expect(body(MARK)).not.toBeNull()
    expect(rec).toEqual([true, true, true])
  })
})
