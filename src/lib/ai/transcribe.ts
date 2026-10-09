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
import { AUDIO_UNREADABLE, TRANSCRIPTION_LEDGER_UNAVAILABLE } from '@/lib/recording/job-errors'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { JOB_ROUTE_FUNCTION_LIMIT_MS } from '@/lib/jobs/job-route-limit'
import {
  transcriptionReceiptSeverity,
  type TranscriptionDebitDeferred,
  type TranscriptionReceipt,
} from '@/lib/ai/transcription-receipt'

/** S53 A2 — the phone door's own words for the same state (v1 route, the
 *  `holder === 'unreadable'` refusal), so both doors answer one sentence. */
export const TRANSCRIPTION_OWNER_UNREADABLE = 'could not read the recording'
/** S53 A5 — another call is transcribing this audio right now (409, retryable). */
export const TRANSCRIPTION_IN_PROGRESS = 'this recording is being transcribed — try again shortly'
import { audit } from '@/lib/audit'
import { composeTranscriptKey } from '@/lib/recording/key-grammar'
import {
  readTranscriptMemo,
  readTranscriptTrueUp,
  recordTranscriptTrueUp,
  releaseTranscriptLease,
  takeTranscriptLease,
  writeTranscriptMemo,
  type HeldTranscriptLease,
  type TranscriptLeaseTake,
  type TranscriptMemo,
  type TranscriptMemoWrite,
  type TranscriptTrueUpOwed,
} from '@/lib/recording/transcript-memo'
import {
  PROBE_HEAD_BYTES,
  PROBE_MIN_HEAD_BYTES,
  probeObjectHead,
  sniffContainer,
} from '@/lib/recording/container-sniff'
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
//   0. (PR-5, charge once) when the door holds the audio's storage key, reads the
//      durable memo of a PAID answer for that audio in that language FIRST —
//      a hit answers from it with no ceiling asked, no reserve, no provider and
//      no ledger row; a miss falls through to 1–5 below, and a paid answer is
//      written back after 3 (src/lib/recording/transcript-memo.ts);
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
 *  answering costs the wall ten seconds, not the caller's whole timeout.
 *  Same value as PROBE_HEAD_TIMEOUT_MS (container-sniff.ts, the S60 head
 *  probe): one storage class, one patience. Two named constants,
 *  cross-referenced, because that module is client-safe and must not import
 *  this server-only one — change one, change both. */
const RESERVE_HEAD_TIMEOUT_MS = 10_000

/** The word an unreadable audio is refused with — declared once in the
 *  thin-safe job-errors.ts (the audit page's reason table reads it too) and
 *  re-exported here for this module's existing readers. */
export { AUDIO_UNREADABLE }

/** The meter's refusal of an audio whose head opens with NO container the
 *  recorders make (S60 A3). The facade's own error class, so the facade
 *  normaliser passes it through as 422 `audio_unreadable` (never `internal`),
 *  and its message is EXACTLY `audio_unreadable` — the job's sentinel matches
 *  the message. The head facts ride as numbers on the error for server-side
 *  logs only; they are NOT `detail`, so they never reach a response body. */
export class AudioUnreadableError extends AppApiError {
  readonly firstByte: number
  readonly bytesRead: number
  constructor(head: { firstByte: number; bytesRead: number }) {
    super('audio_unreadable', AUDIO_UNREADABLE)
    this.firstByte = head.firstByte
    this.bytesRead = head.bytesRead
  }
}

/** The head facts when the audio is UNREADABLE, else null (readable or
 *  unknown — unknown is never a refusal). URL arm: the byte-bounded ranged
 *  probe. Buffer arm: the same sniff over the same first PROBE_HEAD_BYTES,
 *  with the same floor — fewer than PROBE_MIN_HEAD_BYTES is unknown. Never
 *  keyed on a file extension or a MIME type; never writes anything. */
async function unreadableHead(
  audio: TranscriptionAudio,
): Promise<{ firstByte: number; bytesRead: number } | null> {
  if ('buffer' in audio) {
    const head = audio.buffer.subarray(0, PROBE_HEAD_BYTES)
    if (head.length < PROBE_MIN_HEAD_BYTES) return null
    const sniff = sniffContainer(head)
    return sniff.kind === 'unknown' ? { firstByte: sniff.firstByte, bytesRead: sniff.bytesRead } : null
  }
  const probe = await probeObjectHead(audio.url)
  return probe.state === 'unreadable' ? { firstByte: probe.firstByte, bytesRead: probe.bytesRead } : null
}

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
  customerId?: string | null
  /** §v2 (2026-09-10 widen) — the staffer this receipt is attributable to,
   *  when the door already has one in scope (never a second lookup). */
  staffId?: string | null
  takeId?: string | null
  /** The job's attempt number, so a repeating spend is visible in the log. */
  attempt?: number | null
  rescued?: boolean
  requestId?: string
  /** The storage key of the audio this call transcribes, when the caller holds
   *  one; null/absent = no memo, pay as today (PR-5, charge once). The grammar
   *  is the fence: a key that is not this business's take or rescue composes
   *  no memo key, and the call pays exactly as it did before. */
  audioKey?: string | null
  /** S46: false = WRITE the paid answer under `audioKey`, never REPLAY one —
   *  the web JSON arm replays only a take the caller proved is theirs. */
  replayMemo?: boolean
  /** S53 A2: with `replayMemo` false, the caller could not READ whose take this
   *  is (a core blip — takeKeyHolder's 'unreadable'). The memo is then read but
   *  never replayed: a remembered answer means this audio was already paid for,
   *  so the call answers the retryable `upstream_unavailable` (502 on both
   *  routes — the phone door's own answer for the same state) and pays nothing;
   *  a miss pays exactly as before. */
  memoHitRefuses?: boolean
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
  const severity = transcriptionReceiptSeverity(receipt)
  audit({
    category: 'recording',
    action: 'recording.transcribe',
    ...(severity ? { severity } : {}),
    actorId: null,
    actorType: 'system',
    businessId: meter.businessId,
    targetType: 'recording',
    targetId: meter.recordingSessionId ?? undefined,
    detail: {
      door: meter.door,
      ...receipt,
      ...(meter.recordingSessionId ? { recording_session_id: meter.recordingSessionId } : {}),
      ...(meter.customerId ? { customer_id: meter.customerId } : {}),
      ...(meter.staffId ? { staff_id: meter.staffId } : {}),
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
      ...(meter.customerId ? { customer_id: meter.customerId } : {}),
      ...(meter.staffId ? { staff_id: meter.staffId } : {}),
    },
    requestId: meter.requestId,
    source: 'system',
  })
}

/** What a replay's owed true-up came to (see finishOwedTrueUp). `markFailed`
 *  = the ledger recorded it but its true-up marker would not land (S58). */
type TrueUpSettled = { recorded: boolean; deferred?: TranscriptionDebitDeferred; markFailed?: true }

/** ⚖ S58 — WRITE THE TRUE-UP MARKER AND READ ITS ANSWER: the one helper both
 *  recorders use (recordOwedTrueUp and the paying call). A 'failed' write is
 *  retried exactly once, at once — no sleep, no loop; 'taken' (another call
 *  marked it) counts as marked. The final answer goes back so the caller can
 *  put a marker that still failed on the receipt (`debit_mark: 'failed'`,
 *  filed at warning) instead of leaving it to the writer's console line. */
async function markTrueUpRecorded(key: string, deltaCents: number): Promise<TranscriptMemoWrite> {
  const first = await recordTranscriptTrueUp(key, deltaCents)
  if (first !== 'failed') return first
  return recordTranscriptTrueUp(key, deltaCents)
}

/** The delta a memo says its answer owes: null = nothing owed (no numbers —
 *  no delta was owed, or a memo written after its true-up had run); a real,
 *  positive number of cents; or 'unreadable'.
 *  ⚖ S58 — a bad object never bricks an audio, and never erases a debt: ONLY
 *  a missing `trueUp` (undefined) means nothing owed. A `trueUp` of null or
 *  any other non-object (a string, a number; an array reaches the delta
 *  check and lands there too) is 'unreadable' — it used to throw a TypeError
 *  on every call for that audio; now it charges nothing, files a warning and
 *  stays owed. Only a positive SAFE INTEGER of cents is a delta — a fraction
 *  is 'unreadable' the same way. No upper cap: only integrality is enforced. */
function owedDeltaCents(memo: TranscriptMemo): number | null | 'unreadable' {
  const owed: unknown = memo.trueUp
  if (owed === undefined) return null
  if (owed === null || typeof owed !== 'object') return 'unreadable'
  const d = (owed as { deltaCents?: unknown }).deltaCents
  return Number.isSafeInteger(d) && (d as number) > 0 ? (d as number) : 'unreadable'
}

function unreadableTrueUp(): TrueUpSettled {
  console.error('[ai-usage] transcription true-up unreadable; the debt cannot be proven recorded')
  return { recorded: false }
}

/**
 * ⚖ THE REPLAY'S debit_recorded IS THE TRUTH (S56, PR 1 Greptile Finding 1).
 * It used to be a hardcoded `true`, so a memo whose true-up never ran (the
 * process died between the memo and the ledger) replayed forever while the
 * difference stayed unrecorded.
 *
 * - No debt in the memo, or its true-up object exists → true, and that is now
 *   the truth: the RESERVE was recorded before the provider ran (a refused
 *   reserve never pays, never writes a memo), and either no delta was owed (the
 *   memo carries a debt only when one is) or it is recorded — ⚖ S57, that
 *   fact has ONE home, the create-only true-up object (transcript-memo.ts,
 *   recordTranscriptTrueUp), never the memo (Greptile round 2 on #1086,
 *   finding 2). No debt also covers every memo written before this change:
 *   `origin/main`'s meter (the only merged one) writes the memo AFTER the
 *   true-up has run to its end — landed, or written down as `debit_recorded:
 *   false` on that call's own receipt — so such a memo never has a true-up left
 *   for a replay to finish.
 * - Owed (the memo names a debt, no true-up object answers for it) →
 *   ⚖ S57, THE LEASE BEFORE THE LEDGER (Greptile round 2 on #1086,
 *   finding 1, thread PRRT_kwDOSCB5RM6mzfjr: "Concurrent retries double-charge
 *   true-ups"). The usage writer has no dedupe key, so a replay that recorded
 *   the delta while the paying call was still recording it charged it twice.
 *   A replay now records an owed delta ONLY while it holds this audio's lease
 *   (recordOwedTrueUp takes the held-lease proof as a parameter). It takes the
 *   lease once — never waits: it already has the answer to give back — and:
 *   held → recordOwedTrueUp; busy → it never records, and says so
 *   (`lease_busy`: the holder records it); storage would not say → it never
 *   records (`storage_unknown`) — the same when the true-up object itself
 *   cannot be read. The answer is returned either way, and the debt stays owed
 *   — the memo remains the retry trigger. This is the rule whatever the switch:
 *   an owed debt an ON deploy left is recorded under the lease on an OFF deploy
 *   too (the only way OFF ever touches the lease — no memo written before S56
 *   carries a debt).
 * - A debt this code cannot read (no positive delta) → false: the debt cannot
 *   be proven paid, and no number is invented to charge. One line, numbers
 *   never.
 */
async function finishOwedTrueUp(
  meter: TranscriptionMeter,
  key: string,
  memo: TranscriptMemo,
  takeLease: () => Promise<TranscriptLeaseTake>,
): Promise<TrueUpSettled> {
  const delta = owedDeltaCents(memo)
  if (delta === null) return { recorded: true }
  if (delta === 'unreadable') return unreadableTrueUp()
  // A free read of the recorded fact first: a recorded debt needs no lease.
  const seen = await readTranscriptTrueUp(key)
  if (seen === 'recorded') return { recorded: true }
  if (seen === 'unknown') return { recorded: false, deferred: 'storage_unknown' }
  const taken = await takeLease()
  if (taken.state === 'busy') return { recorded: false, deferred: 'lease_busy' }
  if (taken.state === 'unknown') return { recorded: false, deferred: 'storage_unknown' }
  return recordOwedTrueUp(meter, key, delta, taken.lease)
}

/** ⚖ S57 — THE ONE PLACE A REPLAY RECORDS AN OWED TRUE-UP, and it cannot be
 *  called without the lease: `held` is the proof only takeTranscriptLease
 *  makes, checked again at run time against the memo's own key. Under the
 *  lease the recorded fact is read again first — the call that held the lease
 *  before this one may have recorded it — and only a debt still owed is asked
 *  for. Recorded → the true-up object is created (create-only, never
 *  upserted); a `false` from the writer leaves the debt owed for the next
 *  replay (the writer's own line says so). A true-up object that would not
 *  land (S58) is retried once, then filed at warning (`debit_mark: 'failed'`):
 *  the debt still reads as owed, and a later replay under the lease records
 *  it AGAIN — once per replay, until the marker can be written. Closable only
 *  by an idempotency key on the usage writer (the queued core ask). The memo
 *  itself is never written here. */
async function recordOwedTrueUp(
  meter: TranscriptionMeter,
  key: string,
  deltaCents: number,
  held: HeldTranscriptLease,
): Promise<TrueUpSettled> {
  if (held.memoKey !== key) throw new Error('an owed true-up is recorded only under its own audio\'s lease')
  const now = await readTranscriptTrueUp(key)
  if (now === 'recorded') return { recorded: true }
  if (now === 'unknown') return { recorded: false, deferred: 'storage_unknown' }
  const recorded = await reportTranscriptionUsageWithClient(meter.synqed, deltaCents)
  if (!recorded) return { recorded }
  const mark = await markTrueUpRecorded(key, deltaCents)
  return mark === 'failed' ? { recorded, markFailed: true } : { recorded }
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
  // ⚖ S53 A5: a lease this call took is released on EVERY way out — paid,
  // refused, or the provider failing — so only a holder that DIED leaves one
  // standing, and that one expires (TRANSCRIPT_LEASE_TTL_MS).
  const lease: { key: string | null } = { key: null }
  try {
    return await meteredTranscription(meter, params, lease)
  } finally {
    if (lease.key !== null) await releaseTranscriptLease(lease.key)
  }
}

/** ⚖ S56 — THE WORKER DOOR NEVER PAYS AGAINST A LIVE LEASE. How long a door
 *  that waits (the job worker; the discard door rides the same branch) waits on
 *  another call's live lease for that call's answer. The interactive doors
 *  never wait. Derived from the worker's function, never a bare number:
 *   - the function limit is 300 s: `export const maxDuration = 300` on the job
 *     route (src/app/api/jobs/process/route.ts), the one route that runs the
 *     worker — read from src/lib/jobs/job-route-limit.ts, pinned to that export
 *     by a test, and fed another limit by a second test so the two numbers
 *     below must follow it (S57: a bare 135 s would pass the first alone);
 *   - a TAKEOVER (the lease expired or was released mid-wait, so this call
 *     now pays) must still finish its OWN paid call, write the memo, and leave
 *     the route time to file complete/fail. The route already keeps 30 s for
 *     that report (it stops claiming at 270 s of 300). No provider timeout
 *     exists to size the paid call by: the Deepgram requests carry no abort
 *     signal (src/lib/deepgram.ts), and the speaker-id pass that runs beside
 *     them stops at 60 s (src/lib/speaker-id/openai.ts, TIMEOUT_MS). The paid
 *     call is bounded only by the function itself;
 *   - so what is left after the report headroom is split EVENLY between the
 *     wait and a takeover's paid call: 135 s each. The even split is the one
 *     judgement here, because nothing in this repo says how long a
 *     transcription takes.
 *  The budget runs from the wait's own start. A job the route claimed late in
 *  its 270 s has less than the limit left: the platform then ends the WAIT (no
 *  lease held, nothing paid) or, rarely, a takeover's call (the crash window
 *  the memo-first write already names).
 *
 *  AT THE END OF THE WAIT WITH NO ANSWER, THE DOOR THROWS the same retryable
 *  `conflict` word the interactive doors answer, and pays nothing — the lease
 *  was live at its last look, and past the budget it never takes one over.
 *  (Until S56 it waited 90 s and then paid, so a holder slower than 90 s — well
 *  inside its own 300 s function and the 330 s lease — was paid for twice.)
 *  The worker wraps the throw as `transcription_failed` (process-recording.ts,
 *  asStageFailure) and calls recordingJobs.fail(id, error), whose SDK contract
 *  is "requeues while attempts remain, else FAILED". The SDK has no "retry
 *  later" verb and no delay: RecordingJobClient is enqueue / claim / complete /
 *  fail, and fail() carries only the message. Core's attempt count and requeue
 *  delay are not known here. So each requeued attempt spends ITS OWN wait
 *  budget, never seconds; and a job that ends FAILED while the holder finishes
 *  has lost nothing: the holder writes the memo, and any later attempt (a
 *  requeue, or the 再試行 that re-arms a FAILED job through enqueue) replays it
 *  free. The discard door catches the throw as its own retryable `failed`
 *  (discard-transcript.core.ts). `retry_after_seconds` rides the error for
 *  parity with the interactive doors; neither of these two callers reads it. */
export const LEASE_WORKER_FUNCTION_LIMIT_MS = JOB_ROUTE_FUNCTION_LIMIT_MS
/** The job route's own headroom for its final complete/fail report. */
const LEASE_WORKER_REPORT_HEADROOM_MS = 30_000
/** Headroom + an even half of the rest (see above): 165 s. */
export const LEASE_TAKEOVER_RESERVE_MS =
  LEASE_WORKER_REPORT_HEADROOM_MS + (LEASE_WORKER_FUNCTION_LIMIT_MS - LEASE_WORKER_REPORT_HEADROOM_MS) / 2
/** The limit less the reserve: 135 s. */
export const LEASE_WORKER_WAIT_MS = LEASE_WORKER_FUNCTION_LIMIT_MS - LEASE_TAKEOVER_RESERVE_MS
const LEASE_POLL_MS = 3_000

async function meteredTranscription(
  meter: TranscriptionMeter,
  params: Parameters<typeof runTranscription>[0],
  lease: { key: string | null },
): Promise<{ result: Record<string, unknown>; receipt: TranscriptionReceipt }> {
  // ── THE MEMO, BEFORE ANYTHING THAT COSTS (PR-5, charge once) ──────────────
  // Read ahead of the ceiling too: a replay spends nothing, so it must not
  // spend the hourly count either. Keyed by (business, audio, language) and
  // NOTHING else — not the voice reference, the diarization toggle, the
  // keyterms or the caller — so a replay returns the first paid answer even
  // after those change. One audio = one charge; that is the ruling, not a bug.
  //
  // ⚖ AND TWO CALLERS AT ONCE CAN BOTH PAY (Greptile, ruled a bounded ceiling).
  // Two callers that both miss before either provider answers each pay once —
  // exactly what every call did before PR-5; the loser's write meets the
  // duplicate refusal and the first copy stands. The doors that matter (an
  // in-tab save then the job door; a reload) are sequential, so the live
  // exposure is a double-submit. The upgrade path — a create-only lease object
  // with a TTL — IS built here (S53 A5, the lease below, switch ON), on Liam's
  // word, given 2026-09-28 19:5x JST: 「I think both. Yes to both.」 A stuck
  // lease never blocks paying: it expires and falls open to paying.
  const memoKey = composeTranscriptKey(meter.businessId, meter.audioKey, params.locale)?.key ?? null
  const memoRead =
    memoKey === null || (meter.replayMemo === false && meter.memoHitRefuses !== true)
      ? null
      : await readTranscriptMemo(memoKey)
  // ⚖ S53 A2 — A PAID ANSWER WHOSE OWNER COULD NOT BE READ IS NOT PAID AGAIN.
  // The web door used to turn a core read blip into "no replay" and pay a
  // second time for audio it had already paid for. It is neither replayed (the
  // S46 fence never answered) nor re-bought: the caller retries, and the retry
  // that can read the row replays. First-time audio (a miss) still pays — no
  // availability is lost to a blip.
  // A take of the lease by a REPLAY (finishOwedTrueUp asks for one only when
  // the memo still owes a true-up): once, never a wait; a held lease is
  // released in runMeteredTranscription's finally like any other.
  const takeOnce = async (key: string): Promise<TranscriptLeaseTake> => {
    const taken = await takeTranscriptLease(key)
    if (taken.state === 'held') lease.key = key
    return taken
  }
  const answerFromMemo = async (
    key: string,
    memo: TranscriptMemo,
    takeLease: () => Promise<TranscriptLeaseTake>,
  ) => {
    if (meter.replayMemo === false) {
      throw new AppApiError('upstream_unavailable', TRANSCRIPTION_OWNER_UNREADABLE)
    }
    // ⚖ A REPLAY FINISHES AN OWED TRUE-UP BEFORE IT ANSWERS (S56, Finding 1)
    // — awaited, so the receipt is the ledger's answer or the true-up's own
    // state, never a hope — and ONLY UNDER THE LEASE (S57, finishOwedTrueUp).
    // Every replay site below (the first read, and the lease loop's re-reads)
    // answers through here, so none of them hardcodes the outcome.
    const settled = await finishOwedTrueUp(meter, key, memo, takeLease)
    const receipt: TranscriptionReceipt = {
      duration_seconds: memo.duration_seconds,
      cost_cents: 0,
      cents_reserved: 0,
      debit_recorded: settled.recorded,
      replayed: true,
      ...(settled.deferred ? { debit_deferred_reason: settled.deferred } : {}),
      ...(settled.markFailed ? { debit_mark: 'failed' as const } : {}),
    }
    // The same three-door rule as the paid path below: the row shows the door
    // ran and paid nothing.
    if (meter.door === 'job' || meter.door === 'from_session' || meter.door === 'discard') {
      auditTranscriptionReceipt(meter, receipt)
    }
    return { result: memo.result, receipt }
  }
  if (memoRead?.state === 'hit' && memoKey !== null) {
    return await answerFromMemo(memoKey, memoRead.memo, () => takeOnce(memoKey))
  }

  // ── THE HEAD, BEFORE ANYTHING THAT COSTS (S60 A3, one choke point) ────────
  // After the memo (a hit was already paid for, so it is answered as before)
  // and BEFORE the lease (S114, F-CT-3: a refusal writes nothing, not even a
  // lease — s60-a3-meter-refusal), the ceiling, the reserve and the provider: an audio that opens
  // with no container the recorders make is refused here, at every door, for
  // one 64-byte probe and nothing else — no rate-limit consume, no ledger row,
  // no Deepgram call. The meter writes NO mark (M2: the web JSON arm is not
  // take-owner gated); marks are finalize's alone. `unknown` proceeds exactly
  // as today. Behind the same switch as the finalize probe: OFF = no probe.
  if (RECORDING_SWITCHES.finalizeProbe) {
    const unreadable = await unreadableHead(params.audio)
    if (unreadable) throw new AudioUnreadableError(unreadable)
  }

  // ── THE LEASE, BEFORE THE CEILING AND THE RESERVE (S53 A5) ────────────────
  // Only a caller that could be ANSWERED from a memo takes part: one that pays
  // regardless (a colleague's key, a key with no memo) gains nothing by waiting
  // and pays exactly as before. `busy` = another call is inside the provider
  // for this audio right now: the memo is re-read (it may have just landed);
  // the two interactive doors then answer a retryable 409 and pay nothing,
  // and a worker door waits for the answer inside its own budget
  // (LEASE_WORKER_WAIT_MS); a lease still live at the end of it gets the same
  // retryable conflict, never a payment (S56). `unknown` (storage would not
  // say) pays, as the memo read's own fail-open rule does.
  if (
    memoKey !== null &&
    RECORDING_SWITCHES.transcribePaidOnce &&
    (meter.replayMemo !== false || meter.memoHitRefuses === true)
  ) {
    const waitUntil = Date.now() + LEASE_WORKER_WAIT_MS
    let busyUntil = 0
    for (;;) {
      // ⚖ S56: THE BUDGET IS ASKED BEFORE THE TAKE. Past it, a waiting door
      // never takes the lease over — a takeover pays, and it would start with
      // less than LEASE_TAKEOVER_RESERVE_MS left — so it reads the memo one last
      // time (free) and throws. Never true on the first pass, and never reached
      // again by the two interactive doors, which answer on their first busy
      // look below.
      if (Date.now() >= waitUntil) {
        const last = await readTranscriptMemo(memoKey)
        if (last.state === 'hit') return await answerFromMemo(memoKey, last.memo, () => takeOnce(memoKey))
        throw new AppApiError('conflict', TRANSCRIPTION_IN_PROGRESS, {
          reason: 'transcribing',
          retry_after_seconds: Math.max(1, Math.ceil((busyUntil - Date.now()) / 1000)),
        })
      }
      const taken = await takeTranscriptLease(memoKey)
      if (taken.state === 'held') {
        lease.key = memoKey
        // ⚖ S57: HELD IS NOT "NOBODY ANSWERED" — THE MEMO IS RE-READ UNDER THE LEASE
        // BEFORE ANY MONEY MOVES. A holder that finished NORMALLY wrote its memo and
        // then released its lease (the finally above), so the next take finds the
        // lease released and holds it — and the answer is already saved. Paying here
        // was a second provider call for that same answer (a waiting door's next
        // look; an interactive door whose first read missed just before the holder
        // finished). The re-read is free; a miss or a corrupt memo pays as before.
        const mine = await readTranscriptMemo(memoKey)
        if (mine.state === 'hit') return await answerFromMemo(memoKey, mine.memo, async () => taken)
        break
      }
      if (taken.state === 'unknown') break
      const landed = await readTranscriptMemo(memoKey)
      if (landed.state === 'hit') return await answerFromMemo(memoKey, landed.memo, () => takeOnce(memoKey))
      if (meter.door === 'web' || meter.door === 'app') {
        throw new AppApiError('conflict', TRANSCRIPTION_IN_PROGRESS, {
          reason: 'transcribing',
          retry_after_seconds: Math.max(1, Math.ceil((taken.until - Date.now()) / 1000)),
        })
      }
      busyUntil = taken.until
      await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS))
    }
  }

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
    const err = new AppApiError('upstream_unavailable', TRANSCRIPTION_LEDGER_UNAVAILABLE, {
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

  const durationSec = billedSeconds(result)
  const durationSeconds = Math.round(durationSec)
  // ── THE TRUE-UP'S NUMBERS, BEFORE THE MEMO (S56, Finding 1) ───────────────
  // The ledger already holds the reserve. Only a provider answer LONGER than
  // the estimate needs a second row; a shorter one leaves the over-reservation
  // standing (no refund call exists, and erring toward stopping early is the
  // ruling), so the debit is already recorded by definition. Computed HERE,
  // from the provider's own length, so the memo below can carry the debt.
  const costCents = estimateTranscriptionCostCents(durationSec)
  const delta = costCents - reserveCents
  // OFF (RECORDING_SWITCHES.transcribePaidOnce) = the pre-S53 order: the memo
  // after the true-up, below, and with no debt (it would have nothing to do:
  // the true-up has already run to its end when that memo is written).
  const memoFirst = RECORDING_SWITCHES.transcribePaidOnce
  let writtenAt = ''
  const memoOf = (trueUp?: TranscriptTrueUpOwed): TranscriptMemo => ({
    v: 1,
    result,
    duration_seconds: durationSeconds,
    written_at: writtenAt,
    ...(trueUp ? { trueUp } : {}),
  })
  /** true only when THIS call's write created (or repaired) the object —
   *  then, and only then, the debt the memo names is this call's own, and this
   *  call may write down that it was recorded. A yield to another caller's
   *  repair, a duplicate refusal (another caller's copy stands, with ITS debt)
   *  or a storage error is not ours to answer for. */
  const remember = async (trueUp?: TranscriptTrueUpOwed): Promise<boolean> => {
    if (memoKey === null) return false
    const again = memoRead?.state === 'corrupt' ? await readTranscriptMemo(memoKey) : null
    if (again?.state === 'hit') return false
    writtenAt = new Date().toISOString()
    const landed = await writeTranscriptMemo(memoKey, memoOf(trueUp), {
      repair: memoRead?.state === 'corrupt',
    })
    return landed === 'written'
  }
  // The debt, when a true-up is owed: written WITH the memo, before the ledger
  // is asked, so no moment exists in which the memo replays and the debt is not
  // written down beside it. Written once — the memo is never rewritten for it
  // (S57): whether it is recorded is the true-up object's to say.
  const owed: TranscriptTrueUpOwed | undefined =
    delta > 0 ? { reserveCents, costCents, deltaCents: delta } : undefined

  // The provider answered, so the money is spent whether or not the true-up
  // lands — remember the answer so this audio is never paid for again.
  // Best-effort: writeTranscriptMemo never throws.
  // ⚖ AND IT IS WRITTEN BEFORE THE TRUE-UP (S53 A3). The memo does not depend
  // on the ledger, and the true-up is up to three core calls with a second of
  // waits between them (ai-rate-limit.ts, DEBIT_RETRY_WAITS_MS). Behind it, a
  // process that died in that second (the 300 s function limit, a crash) lost
  // a PAID answer with no memo, and the next attempt paid again. The window
  // between the provider's answer and the memo is now the memo write alone —
  // narrowed, never closed: a death inside the write itself still pays twice.
  // A PROVEN-corrupt memo is replaced by this answer; any other state writes
  // create-only, so a readable memo is never overwritten by the normal path.
  //
  // ⚖ AND A REPAIR YIELDS TO ANOTHER CALLER'S (Greptile rounds 2–3). The first
  // read proved garbage; the re-check only asks whether someone else has
  // already replaced it while we paid — a hit yields (ours is for the same
  // audio in the same language, and the caller still gets it), anything else
  // repairs; an upsert onto nothing simply creates. Whatever lands between the
  // re-check and the upsert is another PAID answer, never garbage.
  const ownsDebt = memoFirst ? await remember(owed) : false

  // ── THE TRUE-UP ───────────────────────────────────────────────────────────
  // ⚖ AND "RECORDED" IS WRITTEN DOWN ONLY ON THE LEDGER'S ANSWER (S56, Finding
  // 1; its home since S57 — Greptile round 2 on #1086, finding 2 — is the
  // create-only true-up object, never the memo). The usage writer has NO dedupe
  // (ai-rate-limit.ts: every recordUsage call is a fresh row; the SDK takes no
  // idempotency key), so "charged once" comes from that object alone: created
  // only after the ledger took the delta, by the call whose memo names the
  // debt; a `false` creates nothing, the debt stays owed, and the next replay
  // (under the lease) asks again.
  // TWO RESIDUALS, NAMED — allowed by the code, never hidden:
  //  (a) a process that dies AFTER the ledger took the delta and BEFORE the
  //      true-up object is created leaves the debt owed, and the next replay
  //      records the delta ONE extra time (an over-count, the safe direction).
  //      Narrow; closable only by an idempotency key on the usage writer — a
  //      core ask. A memo write whose outcome storage would not tell us
  //      ('failed'), and a true-up object that would not land, are the same
  //      class: if the memo did land, its debt is never answered for here.
  //      Except (S58): a true-up object that would not land is retried once,
  //      then filed at warning (`debit_mark: 'failed'`) — and while the marker
  //      keeps failing, EVERY later lease-winning replay records the delta
  //      AGAIN, once per replay (each filed at warning, countable), until the
  //      marker can be written. Same core ask closes it.
  //  (b) a replay that finds the debt owed while THIS call is still recording its
  //      delta used to record it too (Greptile round 2 on #1086, finding 1).
  //      Closed by the lease since S57: a replay records an owed delta only
  //      while it holds the lease (finishOwedTrueUp), and this call holds it
  //      until its finally — unless it pays WITHOUT the lease (storage would
  //      not answer about it, or a caller that pays regardless, or two callers
  //      taking one expired lease over at once): then a replay that does win
  //      the lease can still record this call's delta alongside it. Stated,
  //      never hidden: an over-count of one delta, the safe direction.
  let debitRecorded = true
  // S58: the marker's answer is read (one retry, then `debit_mark: 'failed'`
  // on the receipt, filed at warning) — see markTrueUpRecorded.
  let markFailed = false
  if (delta > 0) {
    debitRecorded = await reportTranscriptionUsageWithClient(meter.synqed, delta)
    if (debitRecorded && ownsDebt && memoKey !== null) {
      markFailed = (await markTrueUpRecorded(memoKey, delta)) === 'failed'
    }
  }
  const receipt: TranscriptionReceipt = {
    duration_seconds: durationSeconds,
    cost_cents: costCents,
    cents_reserved: reserveCents,
    debit_recorded: debitRecorded,
    replayed: false,
    ...(markFailed ? { debit_mark: 'failed' as const } : {}),
  }
  if (!memoFirst) await remember()

  // ONE receipt per call. The two interactive routes already emit their own
  // recording.transcribe row (web: auditWeb; facade: the hook map) and carry
  // the same numbers on it, so the wrapper stays silent for them — a door
  // added later must declare itself HERE or it files nothing.
  if (meter.door === 'job' || meter.door === 'from_session' || meter.door === 'discard') {
    auditTranscriptionReceipt(meter, receipt)
  }
  return { result, receipt }
}
