import 'server-only'
import type { SynqedClient } from '@synqed-kk/client'
import {
  DeepgramHttpError,
  transcribeUrlWithDeepgram,
  transcribeWithDeepgram,
  type DeepgramTranscribeResult,
} from '@/lib/deepgram'
import { sttKeyterms } from '@/lib/stt-keyterms'
import { createServiceClient } from '@/lib/supabase/service'
import { identifyStaffSegments } from '@/lib/speaker-id/openai'
import { mapStaffSpeaker } from '@/lib/speaker-id/align'
import {
  enforceAiRateLimitWithClient,
  estimateTranscriptionCostCents,
  releaseTranscriptionReserveWithClient,
  reportTranscriptionUsageWithClient,
} from '@/lib/ai-rate-limit'
import { AppApiError } from '@/lib/app-api/errors'
import { audit } from '@/lib/audit'
import type { OrgSettings } from '@/actions/org-settings'

/**
 * The Deepgram transcription + speaker-id body — previously inlined in
 * `POST /api/ai/transcribe`, moved VERBATIM (packet 08 §Build 1(ii)) so the
 * legacy cookie route AND the facade Bearer twin (Decision 2) share ONE
 * implementation. Identity-agnostic: the diarize toggle + the staff voiceprint
 * REFERENCE are resolved by the CALLER (cookie `getCurrentUserStaffId` on the web
 * route, Bearer `selfStaffId` on the facade — the voice-isolation rule binds the
 * reference to the caller's OWN enrollment clip on both paths) and injected here.
 * NO rate-limit / feature-gate / usage report: those stay with the caller so the
 * accounting path is shared, not duplicated.
 *
 * ⚖ AND THE SPEND WALL IS ONE DOOR ABOVE IT: runMeteredTranscription at the
 * bottom of this file is what every caller actually calls — it asks the ceiling
 * BEFORE this function and debits the minutes AFTER it. runTranscription itself
 * stays the pure provider body so the meter has exactly one thing to wrap.
 */

// ── Speaker-id pass (Stage 1, docs/diarization-stack.md) ────────────────────
// The logged-in staff's enrollment clip rides to the voice-match engine; the
// aligner maps the result onto Deepgram's speaker ints. SPEAKER_ID_MODE:
// 'off' | 'shadow' (compute + log, don't act — the default while ja accuracy
// is unproven) | 'enforce' (the pipeline's role attribution uses it).
// HARD RULE: any failure here returns null — transcription never blocks.

export type SpeakerIdMode = 'off' | 'shadow' | 'enforce'

export function speakerIdMode(): SpeakerIdMode {
  const m = process.env.SPEAKER_ID_MODE
  return m === 'off' || m === 'enforce' ? m : 'shadow'
}

const MAX_IDENTIFY_BYTES = 25 * 1024 * 1024

/**
 * Download a SPECIFIC staff member's enrollment clip (voice-isolation rule
 * #401: only that staff's OWN reference — never the roster). Web resolves
 * `staffId` from the cookie session; the facade from the Bearer `selfStaffId`.
 * Any failure → null (transcription never blocks).
 */
export async function loadStaffReferenceForStaff(
  orgSettings: OrgSettings | null,
  staffId: string | null,
): Promise<Buffer | null> {
  try {
    if (!staffId) return null
    const e = orgSettings?.voice_enrollments?.[staffId]
    if (!e || e.status !== 'saved' || !e.ref_path) return null
    const supabase = createServiceClient()
    const { data, error } = await supabase.storage
      .from('recordings')
      .download(e.ref_path)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

interface SpeakerIdPayload {
  staffSpeakerIndex: number
  confidence: number
  ambiguous: boolean
  provider: 'openai'
  mode: SpeakerIdMode
}

function alignAndLog(
  result: DeepgramTranscribeResult,
  segments: Awaited<ReturnType<typeof identifyStaffSegments>>,
  mode: SpeakerIdMode,
): SpeakerIdPayload | null {
  if (!segments) return null
  const match = mapStaffSpeaker(result.words, segments)
  if (!match) return null
  const heuristicStaff = result.paragraphs[0]?.speaker ?? null
  // The shadow log IS the bake-off benchmark harness — keep it structured.
  console.log(
    '[speaker-id]',
    JSON.stringify({
      mode,
      heuristicStaff,
      voiceprintStaff: match.staffSpeakerIndex,
      confidence: Number(match.confidence.toFixed(3)),
      ambiguous: match.ambiguous,
      agree: heuristicStaff === match.staffSpeakerIndex,
      durationSec: Math.round(result.durationSec),
    }),
  )
  return {
    staffSpeakerIndex: match.staffSpeakerIndex,
    confidence: match.confidence,
    ambiguous: match.ambiguous,
    provider: 'openai',
    mode,
  }
}

// Strip empty arrays so the response stays small when Deepgram doesn't
// return word-level data (which can happen on very short clips).
function serialize(result: DeepgramTranscribeResult) {
  return {
    transcript: result.transcript,
    durationSec: result.durationSec,
    confidence: result.confidence,
    ...(result.words.length ? { words: result.words } : {}),
    ...(result.paragraphs.length ? { paragraphs: result.paragraphs } : {}),
  }
}

/** Audio source: a URL Deepgram fetches directly (large uploads), or the raw
 *  bytes (small direct uploads). */
export type TranscriptionAudio = { url: string } | { buffer: Buffer; mimeType: string }

/**
 * Run transcription + the optional voiceprint speaker-id pass and return the
 * serialized response shape the legacy route always emitted (`serialize(result)`
 * + optional `speakerId`) — the client-side diarization assembly consumes it
 * unchanged.
 *
 * ⚖ MODULE-PRIVATE (fix round 2, Greptile P2). While this was exported, the
 * spend wall was a door anyone could walk PAST: one import and a new caller
 * reaches Deepgram with no ceiling asked and no debit filed, and nothing in the
 * build would say so. runMeteredTranscription below is the only caller, and the
 * only way out of this module — pinned in transcription-spend-wall.test.ts,
 * which also walks src/ for a direct call to this or to deepgram.ts's own two.
 */
async function runTranscription(params: {
  audio: TranscriptionAudio
  locale: string
  diarize: boolean
  /** The caller's OWN enrollment clip (voice-isolation), or null when speaker-id
   *  is off / not enrolled. */
  reference: Buffer | null
  mode: SpeakerIdMode
  /** Org business type → Deepgram keyterm prompting (a85b6bf6 fold); null = none. */
  businessType: string | null
}): Promise<Record<string, unknown>> {
  const { audio, locale, diarize, reference, mode, businessType } = params
  const lang = locale === 'en' ? 'en' : 'ja'

  // Identify needs the bytes; for a URL, only fetch when the file is within the
  // engine's 25MB cap (oversize → heuristic-only, logged via absence).
  let identifyBuf: Buffer | null = null
  if (reference) {
    if ('buffer' in audio) {
      identifyBuf = audio.buffer
    } else {
      try {
        const head = await fetch(audio.url, { method: 'HEAD' })
        const len = Number(head.headers.get('content-length') ?? '0')
        if (len > 0 && len <= MAX_IDENTIFY_BYTES) {
          const r = await fetch(audio.url)
          identifyBuf = Buffer.from(await r.arrayBuffer())
        }
      } catch {
        identifyBuf = null
      }
    }
  }

  const segsPromise =
    reference && identifyBuf
      ? identifyStaffSegments({
          audio: identifyBuf,
          audioMimeType: 'buffer' in audio ? audio.mimeType : 'audio/webm',
          referenceClip: reference,
          language: lang,
        })
      : Promise.resolve(null)

  const result =
    'url' in audio
      ? await transcribeUrlWithDeepgram(audio.url, {
          language: lang,
          diarize,
          keyterms: sttKeyterms(businessType, lang),
        })
      : await transcribeWithDeepgram(audio.buffer, {
          language: lang,
          mimeType: audio.mimeType,
          diarize,
          keyterms: sttKeyterms(businessType, lang),
        })

  const speakerId = alignAndLog(result, await segsPromise, mode)
  return {
    ...serialize(result),
    ...(speakerId ? { speakerId } : {}),
  }
}

// ── ⚖ THE TRANSCRIPTION SPEND WALL (2026-09-08) ─────────────────────────────
//
// Every door that spends a yen at the provider goes through the ONE wrapper
// below, which does five things in this order:
//
//   1. asks core's per-business AI ledger (`consume('transcribe')`) BEFORE the
//      call — hourly request count + the ROLLING 24 h cost cap;
//   2. RESERVES an estimate of this recording's cost in that same ledger, and
//      REFUSES when the ledger will not take it — no money moves through a
//      ledger that did not answer;
//   3. runs the provider;
//   4. TRUES UP the difference on the PROVIDER'S ANSWER — never on the job's
//      success, because every throw after this point (EMPTY_TRANSCRIPT, the
//      extract/summarize leg, the write) is re-run by core's requeue and would
//      re-spend the whole recording. The LENGTH it bills is the provider's own
//      measurement, or the named floor when it has none: a client-supplied
//      duration never reaches the ledger (fix round 2);
//   5. files the receipt (or, on a refusal, the refusal row).
//
// ⚖ WHY THE RESERVE COMES FIRST (fix round 4, Greptile round 2 on PR #863).
// While the debit came only AFTER the provider, a debit that failed all three
// attempts was permanently absent from the ledger the cap is computed from:
// the money was spent, and every later limit check admitted more spend on top
// of it. Retrying harder cannot close that — ordering can. Every yen the
// provider bills is now preceded by a ledger row of at least the estimate, so
// the only way to reach the provider is THROUGH a ledger that answered.
//
// ⚖ AND THE RESERVE IS NEVER REFUNDED. Core has no refund call, and an
// over-reservation errs toward stopping early — the same ruling the unknown
// floor and the gpt-4o fallback already follow. A provider that answers
// shorter than the estimate leaves the ledger holding MORE than the truth.
// On purpose.
//
// ⚖ BUT IT IS RELEASED WHEN THE PROVIDER ANSWERS NON-2xx (fix round 5, narrowed
// in fix round 6). The two cases are not the same act, and the word for each
// says which: a SUCCESSFUL provider answer is never REFUNDED, whatever it cost;
// a provider answer that says NO — an HTTP status outside 2xx, the one failure
// we know was not billed — is RELEASED. It is the retry that makes the
// difference matter: the worker re-runs a failed job, and each attempt reserves
// again, so a reserve left standing after a Deepgram outage would put
// max_attempts × the estimate on the ledger for a recording nobody ever
// transcribed, and the cap would then refuse honest work for the rest of the
// rolling day. The release is a negative row of exactly the reserve, once,
// best-effort, and never on a successful call
// (ai-rate-limit.ts#releaseTranscriptionReserveWithClient).
//
// ⚖ AND EVERYTHING AMBIGUOUS KEEPS ITS RESERVE (fix round 6, Greptile round 3).
// A transport error, a timeout, a 2xx whose body could not be read or parsed:
// each of those can happen AFTER Deepgram accepted and billed the request, so
// treating them as proof of no spend would let a requeueing worker spend
// repeatedly while every reserve was handed back — billed money erased from the
// very number the cap is computed from. They keep the reserve, which over-counts
// in the same direction the unknown-duration floor and the no-refund rule
// already do.
//
// NO NEW COUNTER, NO NEW TABLE: the ledger core already keeps for the token
// routes is the same ledger, and the unit is money. The cap VALUE is an env on
// core's deployment (AI_DAILY_COST_CAP_CENTS) — never settable from here.
//
// NO `.catch` ON THE CONSUME, ever: an unreadable ledger REFUSES. That is the
// worker's own law for the reads beside it — "could not check" is never "under
// the ceiling" (process-recording.ts's assertNotDiscardedByStaff).

/** Which door spent the money. 'job' = the phone's normal save through the
 *  worker, 'from_session' = the same worker on a take the nightly assembler
 *  rescued, 'web'/'app' = the two interactive transcribe routes, 'discard' =
 *  the words behind a reasoned discard. */
export type TranscriptionDoor = 'job' | 'from_session' | 'web' | 'app' | 'discard'

/** A provider answer whose metadata carried no duration (deepgram.ts's `?? 0`)
 *  still cost real money: a real spend is never debited as zero. One hour is
 *  the recorder's own 2 h auto-stop halved — deliberately expensive, so the
 *  unknown case errs toward stopping early.
 *
 *  ⚖ AND IT IS THE ONLY FALLBACK (fix round 2, Greptile P1). The billed length
 *  used to fall back to a caller-supplied duration hint before reaching here —
 *  on two of the five doors that number is CLIENT-SUPPLIED (the job payload a
 *  phone wrote, the discard action's own argument), so a caller could name any
 *  small number and be billed for it while Deepgram billed us for the truth.
 *  A client's claim never reaches the ledger now; an unmeasured minute costs
 *  the floor. */
const UNKNOWN_DURATION_FLOOR_SECONDS = 3600

/** The recorder's own bitrate — `global-recorder.ts:737 audioBitsPerSecond:
 *  48_000` — as bytes per second. The audio's SIZE is therefore a measurement
 *  of its LENGTH, and it is a server-side one: the buffer this process already
 *  holds, or the storage server's own `content-length` for OUR object. Neither
 *  is a client's claim about how long the recording was (fix round 2's rule,
 *  kept: the reserve is a number nobody outside this server chose).
 *
 *  A file recorded LOWER than 48 kbps is longer than its bytes say, so the
 *  estimate under-shoots and the true-up after the provider answers covers the
 *  difference. Over-shooting is harmless — the reserve is never refunded. */
const RECORDER_BYTES_PER_SECOND = 48_000 / 8

function estimateSecondsFromBytes(bytes: number): number {
  return bytes / RECORDER_BYTES_PER_SECOND
}

/** The reserve's HEAD is its own request, so a storage server that has stopped
 *  answering costs the wall ten seconds, not the caller's whole timeout. */
const RESERVE_HEAD_TIMEOUT_MS = 10_000

/** The audio's size in bytes for the reserve: the buffer's own length, or a
 *  HEAD on the signed URL. Unreadable — no content-length, zero, a throw, the
 *  timeout — is null, and the caller reserves the floor instead.
 *
 *  runTranscription HEADs this same URL on the speaker-id path, but only when
 *  a reference clip exists (transcribe.ts, `if (reference)`); the reserve must
 *  happen on EVERY call, so this one is its own unconditional request. */
async function audioBytes(audio: TranscriptionAudio): Promise<number | null> {
  if ('buffer' in audio) return audio.buffer.length > 0 ? audio.buffer.length : null
  try {
    const head = await fetch(audio.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(RESERVE_HEAD_TIMEOUT_MS),
    })
    const len = Number(head.headers.get('content-length') ?? '0')
    return Number.isFinite(len) && len > 0 ? len : null
  } catch {
    return null
  }
}

export interface TranscriptionMeter {
  /** The BUSINESS-scoped core client. The ledger is per business. */
  synqed: Pick<SynqedClient, 'aiRateLimit'>
  businessId: string
  door: TranscriptionDoor
  recordingSessionId?: string | null
  takeId?: string | null
  /** The job's attempt number, so a repeating spend is visible in the log. */
  attempt?: number | null
  rescued?: boolean
  requestId?: string
}

/** A duration is usable only when it is a real, positive number of seconds. */
function positiveSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function detailNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** THE BILLED LENGTH, decided in ONE place, out of exactly TWO numbers: the
 *  PROVIDER'S own measurement — the only one that is not a client's claim —
 *  and, when it has none, the floor. No hint, ever (see the floor's note). */
function billedSeconds(result: Record<string, unknown>): number {
  return positiveSeconds(result.durationSec) ?? UNKNOWN_DURATION_FLOOR_SECONDS
}

/** WHAT THE METER DID, for the doors that file their OWN receipt row (the two
 *  interactive routes) — handed back from the call itself rather than
 *  recomputed, because `debit_recorded` is an OUTCOME: no second pass over the
 *  provider's body could ever know it (fix round 2, Greptile P1). */
export interface TranscriptionReceipt {
  duration_seconds: number
  cost_cents: number
  /** What the ledger was told BEFORE the provider ran. `cost_cents` is the
   *  truth; the ledger holds the GREATER of the two, because the reserve is
   *  never refunded (fix round 4). */
  cents_reserved: number
  /** false = the money was spent and the ledger is short by the true-up. */
  debit_recorded: boolean
}

/** THE RECEIPT — ids and numbers only, never a word of the transcript. Private
 *  and unconditional so the emission walker can prove it (CP7); the CALLER
 *  decides whether this door files one (see runMeteredTranscription).
 *
 *  ⚖ A LOST DEBIT IS COUNTABLE (fix round 2). When the ledger never took the
 *  cents, this row is severity 'warning' — the same severity the refusal row
 *  uses, so the ONE audit.list query that answers "is the wall firing?" by
 *  severity now also returns the spends that were never counted. Both are the
 *  same sentence: the wall is not holding. The two interactive routes that
 *  file their OWN row apply this same severity themselves (route.ts's spread,
 *  the facade's ctx.auditSeverity — fix round 3), so all five doors answer the
 *  one query. */
function auditTranscriptionReceipt(
  meter: TranscriptionMeter,
  receipt: TranscriptionReceipt,
): void {
  audit({
    category: 'recording',
    action: 'recording.transcribe',
    ...(receipt.debit_recorded ? {} : { severity: 'warning' as const }),
    actorId: null,
    actorType: 'system',
    businessId: meter.businessId,
    targetType: 'recording',
    targetId: meter.recordingSessionId ?? undefined,
    detail: {
      door: meter.door,
      ...receipt,
      ...(meter.recordingSessionId ? { recording_session_id: meter.recordingSessionId } : {}),
      ...(meter.takeId ? { take_id: meter.takeId } : {}),
      ...(meter.attempt != null ? { attempt: meter.attempt } : {}),
      ...(meter.rescued != null ? { rescued: meter.rescued } : {}),
    },
    requestId: meter.requestId,
    source: 'system',
  })
}

/** THE REFUSAL — severity 'warning' (→ core 'critical'), which no other
 *  recording.* row uses, so "is the wall firing?" is ONE audit.list request
 *  with no core change. */
function auditTranscriptionRefused(meter: TranscriptionMeter, err: AppApiError): void {
  audit({
    category: 'recording',
    action: 'recording.transcribe_refused',
    severity: 'warning',
    actorId: null,
    actorType: 'system',
    businessId: meter.businessId,
    targetType: 'recording',
    targetId: meter.recordingSessionId ?? undefined,
    detail: {
      door: meter.door,
      reason: typeof err.detail?.reason === 'string' ? err.detail.reason : null,
      cost_used_cents: detailNumber(err.detail?.cost_used_cents),
      cost_cap_cents: detailNumber(err.detail?.cost_cap_cents),
      ...(meter.recordingSessionId ? { recording_session_id: meter.recordingSessionId } : {}),
    },
    requestId: meter.requestId,
    source: 'system',
  })
}

/**
 * runTranscription, metered. The ONLY way this app may reach the provider.
 *
 * Throws the classified `rate_limited` AppApiError unchanged on a refusal (the
 * facade maps it to 429; the web route rewraps it; the worker renames it to its
 * own named reason word) — and the refusal row is filed before it leaves.
 *
 * Throws `upstream_unavailable` when the LEDGER itself would not take the
 * reserve (→ 502 on both routes; the worker lets it through unchanged, so the
 * job requeues with nothing spent). That refusal files its own row too, with
 * reason `ledger_unavailable`.
 *
 * Returns the provider body under `result` (unchanged shape — it is what the
 * clients already receive) plus the meter's own `receipt`, which never leaves
 * the server: it is the audit row's detail on the two doors that file their own.
 */
export async function runMeteredTranscription(
  meter: TranscriptionMeter,
  params: Parameters<typeof runTranscription>[0],
): Promise<{ result: Record<string, unknown>; receipt: TranscriptionReceipt }> {
  try {
    await enforceAiRateLimitWithClient(meter.synqed, 'transcribe')
  } catch (err) {
    if (err instanceof AppApiError && err.code === 'rate_limited') {
      auditTranscriptionRefused(meter, err)
    }
    throw err
  }

  // ── THE RESERVE, BEFORE ANY MONEY MOVES ───────────────────────────────────
  // The estimate is the audio's own size at the recorder's bitrate; a size we
  // could not read reserves the floor, which is deliberately expensive for the
  // same reason billedSeconds' floor is.
  const bytes = await audioBytes(params.audio)
  const reserveCents = estimateTranscriptionCostCents(
    bytes == null ? UNKNOWN_DURATION_FLOOR_SECONDS : estimateSecondsFromBytes(bytes),
  )
  if (!(await reportTranscriptionUsageWithClient(meter.synqed, reserveCents))) {
    // Three attempts failed: core cannot tell us the spend has been counted, so
    // we do not spend. This is the consume's own law one line further down the
    // path — "could not write it down" is never "go ahead".
    const err = new AppApiError('upstream_unavailable', 'transcription ledger unavailable', {
      reason: 'ledger_unavailable',
    })
    auditTranscriptionRefused(meter, err)
    throw err
  }

  // ⚖ RELEASED ONLY WHEN THE PROVIDER SAID NO (fix round 6): a non-2xx answer
  // is a request Deepgram refused or failed and did not bill. Every other
  // throw — the socket dropping, a timeout, a 2xx whose body could not be read
  // or parsed — may be a request the provider accepted and billed, so the
  // reserve STAYS (an over-count, the safe direction; a worker retry then
  // reserves again, and the ledger holds attempts × the estimate for that
  // recording — bounded, rare, and visible in the receipt rows). The old catch
  // released on every throw and so could erase billed spend across retries
  // (Greptile round 3).
  //
  // Only the provider call is inside this try, and the release stays
  // best-effort: it never throws, and a release that cannot land leaves the
  // reserve — again the safe direction. The provider's error leaves unchanged
  // either way.
  let result: Record<string, unknown>
  try {
    result = await runTranscription(params)
  } catch (err) {
    if (err instanceof DeepgramHttpError) {
      await releaseTranscriptionReserveWithClient(meter.synqed, reserveCents)
    }
    throw err
  }

  // ── THE TRUE-UP ───────────────────────────────────────────────────────────
  // The ledger already holds the reserve. Only a provider answer LONGER than
  // the estimate needs a second row; a shorter one leaves the over-reservation
  // standing (no refund call exists, and erring toward stopping early is the
  // ruling), so the debit is already recorded by definition.
  const durationSec = billedSeconds(result)
  const costCents = estimateTranscriptionCostCents(durationSec)
  const delta = costCents - reserveCents
  const receipt: TranscriptionReceipt = {
    duration_seconds: Math.round(durationSec),
    cost_cents: costCents,
    cents_reserved: reserveCents,
    debit_recorded:
      delta > 0 ? await reportTranscriptionUsageWithClient(meter.synqed, delta) : true,
  }

  // ONE receipt per call. The two interactive routes already emit their own
  // recording.transcribe row (web: auditWeb; facade: the hook map) and carry
  // the same numbers on it, so the wrapper stays silent for them — a door
  // added later must declare itself HERE or it files nothing.
  if (meter.door === 'job' || meter.door === 'from_session' || meter.door === 'discard') {
    auditTranscriptionReceipt(meter, receipt)
  }
  return { result, receipt }
}
