import { Entry } from '@/types/ai'
import { getDataPort } from '@/lib/ports/data-port'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'
import {
  adoptTakeSession,
  ensureFinalizedPath,
  readTakeSecureMeta,
  readTakeTranscript,
  stampTakeTranscript,
} from '@/lib/karute/take-store'
import { ensureAudioOnServer } from '@/lib/recording/secure-take'
import type { AttachOutcome } from '@/lib/app-api/record-schemas'
import { buildDiarizedTranscript, toSpeakerText } from './diarized'

/**
 * Represents each step of the AI processing pipeline.
 */
export type PipelineStep = 'transcribing' | 'extracting' | 'summarizing' | 'complete' | 'error'

/**
 * The full result returned when the pipeline completes successfully.
 */
export type PipelineResult = {
  transcript: string
  entries: Entry[]
  summary: string
}

/** Transcription succeeded but recognized no speech (silence / too quiet) —
 *  the one failure anyone can hit on purpose by recording silence. Typed so
 *  the UI can show the specific 音声が認識できませんでした message instead of
 *  raw exception text (which must never reach the screen). */
export class EmptyTranscriptError extends Error {
  constructor() {
    super('Transcription returned an empty transcript.')
    this.name = 'EmptyTranscriptError'
  }
}

/**
 * Retries a fetch call once on failure.
 * - First failure: waits 1.5 seconds, then retries.
 * - Second failure: throws.
 */
async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    const detail = typeof json.detail === 'string' ? json.detail : null
    const error = typeof json.error === 'string' ? json.error : null
    return [error, detail].filter(Boolean).join(' — ') || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}: ${text.slice(0, 200)}`
  }
}

async function fetchWithRetry(fn: () => Promise<Response>): Promise<Response> {
  // A REFUSAL IS NOT A BLIP: a 429 (the AI spend/rate ceiling) or a 403 (the
  // plan gate) answers the same 1.5 s later, and the retry arm below throws the
  // raw `HTTP ${status}` — the English-mid-app leak PipelineErrorCard exists to
  // prevent. Refusals leave on the FIRST answer, with the localized message.
  let refused = false
  try {
    const res = await fn()
    if (!res.ok) {
      refused = res.status === 429 || res.status === 403
      throw new Error(await readErrorMessage(res))
    }
    return res
  } catch (firstError) {
    if (refused) throw firstError
    // Wait 1.5 seconds before retrying
    await new Promise((resolve) => setTimeout(resolve, 1500))
    try {
      const res = await fn()
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }
      return res
    } catch (secondError) {
      throw secondError
    }
  }
}

// ⚖ One tab at a time per finalized object: the browser's own cross-tab lock
// (released by the browser if the tab dies). Where the API is absent the run
// proceeds unlocked, as today.
async function withTranscribeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request(`karute:transcribe:${key}`, fn) : fn()
}

/**
 * Orchestrates the full AI processing pipeline:
 *   1. Transcribe audio blob via Deepgram nova-3 (/api/ai/transcribe)
 *   2. Run extraction and summary in parallel via Promise.all (/api/ai/extract + /api/ai/summarize)
 *
 * Calls onProgress at each stage so UI can show step-by-step progress.
 * Auto-retries each API call once on failure; throws on second failure.
 */
/** Optional prompt context — anchors the AI to THIS customer (rejects other
 *  customers' names from phone calls etc.) and to the session date (converts
 *  「来週」-style relative dates to absolute). Both degrade gracefully. */
export type PipelineContext = {
  customerName?: string | null
  sessionDate?: string | null
  /** The recorder's session for this take (global-pipeline's context), for a
   *  take the store no longer holds — the store's own stamp wins when present. */
  recordingSessionId?: string | null
  /** The recorder's measured length, so the fallback attach can finalize. */
  durationSeconds?: number
  /** The visit (global-pipeline's appointmentCustomerId / appointmentId), sent
   *  on the 'no_session' fallback only — what a row the mint creates carries. */
  customerId?: string | null
  appointmentId?: string | null
  /** Told the row this run ADOPTED (S34), so the run's own context — what the
   *  save, the 破棄 and the status surfaces read — names it too. */
  onSessionAdopted?: (recordingSessionId: string) => void
}

/**
 * ⚖ THE ROW THE SERVER MAKES IS BORN WITH ITS LENGTH (S35 C1). That row is
 * never finalized, so it carries what finalize writes on a row that had one
 * from the start: the take's stop stamp in whole seconds, floored as
 * finalize-take.ts floors it. No honest length (no take, no stamp, under a
 * second) → undefined and the field is not sent: never a made-up 0.
 */
export function takeLengthSeconds(durationMs: number | undefined): number | undefined {
  const seconds = Math.floor((durationMs ?? NaN) / 1000)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

/**
 * ⚖ THE ROW THE SERVER MADE FOR THIS TAKE IS THIS TAKE'S ROW (S34, piece 3).
 * With RECORDING_SWITCHES.bindUnboundUploads ON, the unbound door creates a
 * row for a take that had none and answers its id. Adopted ONLY where nothing
 * names a session yet — not the run's context, and not the take (adoptTakeSession
 * refuses a take that already carries one): the first stamp wins, so a row the
 * recording already has is never swapped for this one. The adopted take is
 * SECURED at `path` in the same write — its audio is on that row now, so no
 * drain retries it under its own key (Greptile #1039). Switch OFF → the server
 * answers null and this is never called.
 */
async function adoptMintedSession(
  takeId: string | null,
  recordingSessionId: string,
  path: string,
  ctx: PipelineContext,
): Promise<void> {
  const adopted =
    !ctx.recordingSessionId &&
    (takeId ? await adoptTakeSession(takeId, recordingSessionId, path) : true)
  if (adopted) ctx.onSessionAdopted?.(recordingSessionId)
  // Ids and a flag only — never a customer, never a key.
  console.info('[ai-pipeline] adopted minted session', { takeId, adopted })
}

export async function runAIPipeline(
  audioBlob: Blob,
  /** The persisted take this audio belongs to (lib/karute/take-store), or null
   *  when the store never held it. ⚖ capture pipeline PR4: the take carries the
   *  finalized key its whole self was PUT to at stop, and THAT object is what
   *  this transcribes — read here rather than passed in, so every caller gets
   *  the same answer and none of them has to remember to ask. */
  takeId: string | null,
  locale: string,
  onProgress: (step: PipelineStep) => void,
  ctx: PipelineContext = {},
): Promise<PipelineResult> {
  // Step 1: Transcription
  onProgress('transcribing')

  // Upload + transcribe legs go through the recording pipeline PORT (Decision 2):
  // web = a service-minted signed upload URL + /api/ai; thin = a service-minted signed upload URL
  // + /api/app/v1/ai (no supabase-js in the bundle). The GlobalRecorder /
  // globalPipeline / draft singletons are unchanged — the seam is HERE only.
  const recordingPort = getRecordingPipelinePort()
  // …AND THE STOP GETS TO FINISH FIRST (capture pipeline PR4 fix round 2). The
  // 自動 arm reaches this line at the stop instant, with that take's own whole
  // upload still in flight — so the read below answered null on an ORDINARY
  // recording and prepareTranscription's fallback staged a second copy of the
  // same audio to a key no row points at. Free when this runtime has no stop
  // leg for the take (the recovery/inbox saves, another tab), bounded at two
  // minutes when it does.
  // Lazy, and for this file's oldest reason (see recording-port's own): the
  // recorder's import graph reaches @/actions/recordings → next/cache, which
  // jest cannot load in a node-environment suite — a static import here breaks
  // every consumer of this module, inbox-store's page included.
  if (takeId) await (await import('@/lib/global-recorder')).globalRecorder.awaitTakeSecured(takeId)
  // ⚖ …AND A TAKE FINALIZED BY SLICE THREE HAS A KEY TOO (fix round 7). That
  // deploy stamped `finalizedAt` alone and this line gates on `finalizedPath`,
  // so a web take finalized in between read as UNSECURED and the fallback below
  // staged a row-less duplicate of audio the server already holds.
  // ensureFinalizedPath recomposes the deterministic key once through the port
  // and remembers it; null (the phone, whose cohort is empty by construction)
  // leaves this exactly as it was.
  const meta = takeId ? await readTakeSecureMeta(takeId) : null
  let finalizedPath =
    takeId && meta ? await ensureFinalizedPath(takeId, meta, recordingPort) : null
  // ⚖ THE FALLBACK, IN ORDER (S33 option D). No finalized key yet:
  //   1. ATTACH — the take's audio onto its OWN row under its OWN key
  //      (ensureAudioOnServer: the stored bytes via secureTake, else this blob);
  //   2. that failed but the recording HAS a row → today's unbound door,
  //      marked 'attach_failed', which never creates a row (either switch);
  //   3. no session known at all → today's unbound door, marked 'no_session'.
  // The STAGED door is not a fallback: no transcribe door reads a `stg/` key
  // (S33 R1 — ports/recording-port.ts:507, v1/ai/transcribe/route.ts:50).
  let attachOutcome: AttachOutcome | null = null
  if (!finalizedPath) {
    if (takeId)
      finalizedPath = await ensureAudioOnServer(
        recordingPort,
        takeId,
        audioBlob,
        meta?.recordingSessionId ?? ctx.recordingSessionId ?? null,
        ctx.durationSeconds,
      )
    // Re-read: the attach may have minted the take's row itself (secureTake).
    const known =
      (takeId ? (await readTakeSecureMeta(takeId))?.recordingSessionId : null) ??
      ctx.recordingSessionId
    if (!finalizedPath) attachOutcome = known ? 'attach_failed' : 'no_session'
  }
  // ⚖ THE SAME OBJECT IS NEVER PAID FOR TWICE (recording hole PR-2). The
  // transcribe door cannot tell a repeat (a take key carries no session id, and
  // core has no by-path read), so the device that holds the take remembers: a
  // stored answer for THIS finalized object, asked in THIS locale, is replayed
  // and the door is not asked — no spend on a 再試行 tap or a reload. Blob-only runs (no take, or
  // no finalized key) have nothing to key on and ask every time, as before.
  const transcribeOnce = async (): Promise<Awaited<ReturnType<Response['json']>>> => {
    const stored = takeId && finalizedPath ? await readTakeTranscript(takeId) : null
    if (stored && stored.finalizedPath === finalizedPath && stored.locale === locale) {
      return stored.response
    }
    const { body: transcribeBody, path: mintedPath, recordingSessionId: minted } =
      await recordingPort.prepareTranscription(
        audioBlob,
        finalizedPath,
        attachOutcome === 'no_session'
          ? {
              attachOutcome,
              customerId: ctx.customerId,
              appointmentId: ctx.appointmentId,
              durationSeconds: takeLengthSeconds(meta?.durationMs),
            }
          : attachOutcome
            ? { attachOutcome }
            : undefined,
      )
    if (minted) await adoptMintedSession(takeId, minted, mintedPath, ctx)

    const transcribeRes = await fetchWithRetry(() =>
      getDataPort().apiFetch(`${recordingPort.aiBase}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...transcribeBody, locale }),
      }),
    ).catch((err) => {
      throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`)
    })

    // ⚖ NOTHING IS CLEANED UP (capture pipeline PR4): the object this just read is
    // the take's finalized audio, and audio is never deleted.

    const fresh = await transcribeRes.json()
    // Stamped BEFORE the empty check: an empty answer was paid for too, and
    // replays below as the same EmptyTranscriptError with no second spend.
    if (takeId && finalizedPath) await stampTakeTranscript(takeId, finalizedPath, locale, fresh)
    return fresh
  }
  // The door's JSON body, used exactly as before — replayed or fresh. Two tabs
  // on the same object take turns, so the second one reads the first's stamp.
  const transcribeData =
    takeId && finalizedPath
      ? await withTranscribeLock(finalizedPath, transcribeOnce)
      : await transcribeOnce()
  const transcript: string = transcribeData.transcript

  if (!transcript) {
    throw new EmptyTranscriptError()
  }

  // Stage 0 (docs/diarization-stack.md): use the speaker labels we already
  // pay Deepgram for. When attribution succeeds, BOTH the prompts and the
  // stored transcript get the labeled text (施術者:/お客様:/周囲) — what the
  // AI read is exactly what staff can audit. Any failure → flat transcript,
  // exactly yesterday's behavior (graceful degradation).
  // Voiceprint staff hint (speaker-id pass) — acted on only in enforce mode;
  // shadow mode logs server-side without changing behavior.
  const sid = transcribeData.speakerId
  const staffHint =
    sid && sid.mode === 'enforce'
      ? { speaker: sid.staffSpeakerIndex as number, confidence: sid.confidence as number }
      : null
  const diarized = buildDiarizedTranscript(
    transcribeData.paragraphs ?? [],
    transcribeData.words ?? [],
    transcribeData.confidence ?? 0,
    staffHint,
  )
  const aiTranscript = diarized ? toSpeakerText(diarized) : transcript

  // Step 2: Parallel extraction and summary
  onProgress('extracting')

  const [extractRes, summarizeRes] = await Promise.all([
    fetchWithRetry(() =>
      getDataPort().apiFetch(`${recordingPort.aiBase}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: aiTranscript,
          locale,
          customerName: ctx.customerName ?? null,
          sessionDate: ctx.sessionDate ?? null,
        }),
      }),
    ).catch((err) => {
      throw new Error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    }),
    fetchWithRetry(() =>
      getDataPort().apiFetch(`${recordingPort.aiBase}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: aiTranscript,
          locale,
          customerName: ctx.customerName ?? null,
          sessionDate: ctx.sessionDate ?? null,
        }),
      }),
    ).catch((err) => {
      throw new Error(`Summary generation failed: ${err instanceof Error ? err.message : String(err)}`)
    }),
  ])

  const extractData = await extractRes.json()
  const summarizeData = await summarizeRes.json()

  const entries: Entry[] = extractData.entries
  const summary: string = summarizeData.summary

  // Step 3: Complete
  onProgress('complete')

  return { transcript: aiTranscript, entries, summary }
}
