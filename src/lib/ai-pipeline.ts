import { Entry } from '@/types/ai'
import { getDataPort } from '@/lib/ports/data-port'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'
import {
  adoptTakeSession,
  ensureFinalizedPath,
  pinTakeFallback,
  readTakeSecureMeta,
  readTakeTranscript,
  retireTakeFallback,
  stampTakeTranscript,
  type TakeAudioFingerprint,
} from '@/lib/karute/take-store'
import { ensureAudioOnServer } from '@/lib/recording/secure-take'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
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
  /** ⚖ C3: the fallback answer this run CHAIN already paid for (global-pipeline
   *  keeps it across retry(), clears it in start()/reset()) — the only memory a
   *  take-less run has, and a take the store could not stamp. */
  paidFallback?: PaidFallback | null
  /** Told the fallback answer the moment it is paid for, so the chain keeps it. */
  onFallbackPaid?: (answer: PaidFallback) => void
  /** ⚖ S53 A4: the key this run CHAIN's fallback PUT and was about to pay for
   *  (global-pipeline keeps it across retry(), clears it in start()/reset()) —
   *  a take-less run's only memory of it. */
  fallbackPin?: FallbackPin | null
  /** Told the key the moment it is pinned, before the POST. */
  onFallbackPinned?: (pin: FallbackPin) => void
  /** ⚖ S54 F10: told the pin, marked retired, when the server refused its key. */
  onFallbackRetired?: (pin: FallbackPin) => void
}

/** ⚖ S53 A4: a key the fallback PUT and was about to pay for — whose take
 *  (null = none), which row the mint named (null = none), which locale, and the
 *  audio it carries. Re-presented only onto a run about to send the same. */
export type FallbackPin = {
  takeId: string | null
  path: string
  recordingSessionId: string | null
  locale: string
  audio: TakeAudioFingerprint
  /** ⚖ S54 F10: set when the server refused this key outright — never re-presented. */
  retiredAt?: number
  retiredReason?: string
}

/** One fallback transcription the chain paid for: whose take (null = none),
 *  asked in which locale, the door's whole JSON body, and the audio it sent
 *  (C3 fold — replayed only onto a run about to send the same). */
export type PaidFallback = {
  takeId: string | null
  locale: string
  response: unknown
  audio: TakeAudioFingerprint
}

/** ⚖ C3 fold (Greptile P1): a fallback answer replays only onto the SAME audio
 *  — same byte size, same type, and the same length when both sides know one.
 *  No fingerprint (a stamp written without one) is never a match. */
function sameAudio(paid: TakeAudioFingerprint | undefined, now: TakeAudioFingerprint): boolean {
  if (!paid || paid.size !== now.size || paid.type !== now.type) return false
  return paid.durationSeconds === undefined || now.durationSeconds === undefined
    ? true
    : paid.durationSeconds === now.durationSeconds
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
 *
 * Answers whether the take was ADOPTED — true only when the store reported the
 * write (or there was no take to write to). false is every other outcome: the
 * run's context already names a session (no store call at all), the store's
 * first-stamp-wins brace refused it, or the write was lost after the store's
 * own retries. The caller treats all three alike (S53-B fold 1): not handed
 * over yet, so it asks again from the answer — where the first two answer
 * false again and write nothing, and the third gets its second chance, exactly
 * as before the hand-over existed.
 */
async function adoptMintedSession(
  takeId: string | null,
  recordingSessionId: string,
  path: string,
  ctx: PipelineContext,
): Promise<boolean> {
  const adopted =
    !ctx.recordingSessionId &&
    (takeId ? await adoptTakeSession(takeId, recordingSessionId, path) : true)
  if (adopted) ctx.onSessionAdopted?.(recordingSessionId)
  // Ids and a flag only — never a customer, never a key.
  console.info('[ai-pipeline] adopted minted session', { takeId, adopted })
  return adopted
}

/** The take's stored pin in the chain's shape (S53 A4). */
function toChainPin(
  takeId: string,
  pin: { finalizedPath: string; recordingSessionId: string | null; locale: string; audio: TakeAudioFingerprint; retiredAt?: number } | undefined,
): FallbackPin | null {
  return pin
    ? { takeId, path: pin.finalizedPath, recordingSessionId: pin.recordingSessionId, locale: pin.locale, audio: pin.audio, ...(pin.retiredAt ? { retiredAt: pin.retiredAt } : {}) }
    : null
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
  // S46: the row that reserved the finalized key rides beside it (re-read: the
  // attach may have just stamped it). None → the door keeps today's answer.
  const takeRow =
    takeId && finalizedPath ? ((await readTakeSecureMeta(takeId))?.recordingSessionId ?? null) : null
  // S49: the attach may have minted THIS take's row (secureTake stamps it on
  // the take's meta). The run's context is the only party that does not know
  // yet — hand it the row so the save links it and the 「この端末にのみ残ります」
  // notice stands down. adoptMintedSession is not used: its take-store write
  // already happened inside secureTake and would be refused (first stamp wins).
  // adoptRecordingSession's own guards (same run, never overwrites) still apply.
  if (takeRow && !ctx.recordingSessionId) ctx.onSessionAdopted?.(takeRow)
  // ⚖ THE SAME OBJECT IS NEVER PAID FOR TWICE (recording hole PR-2). The
  // transcribe door cannot tell a repeat (a take key carries no session id, and
  // core has no by-path read), so the device that holds the take remembers: a
  // stored answer for THIS finalized object, asked in THIS locale, is replayed
  // and the door is not asked — no spend on a 再試行 tap or a reload.
  // ⚖ …AND THE FALLBACK IS PAID FOR ONCE PER RUN CHAIN (C3). With no finalized
  // key the unbound door mints a NEW key every time, so neither memo could see
  // a repeat and each 再試行 minted, PUT and paid again. Its answer is kept too —
  // on the take (marked `fallback`), else on the chain's slot — and a run that
  // STILL has no finalized key replays it: no mint, no PUT, no POST. A run that
  // has one replays only an answer paid for that very key — the fallback sent
  // the in-memory blob, the attach sends the stored bytes, and they can differ.
  // ⚖ A FALLBACK ANSWER IS REPLAYED OR WRITTEN ONLY WHILE THE TAKE STILL HAS NO
  // FINALIZED KEY — or has exactly the key that answer was paid for (S34's
  // adoption secures the take at the fallback's own minted key). Another tab or
  // the drain can finalize the take after this run read no key, from stored
  // bytes the fallback never sent, so the key is RE-READ here, never taken from
  // this run's start: with one, only an answer paid for it replays; with none,
  // the fallback's. The write half lives in stampTakeTranscript (take-store),
  // where the check and the write share one transaction.
  // ⚖ …AND ONLY ONTO THE SAME AUDIO (C3 fold, Greptile P1). A recovery run
  // assembles the take from its saved segments, which can be shorter than the
  // in-memory recording the first fallback sent (a tail never saved) — same
  // take, same locale, different words. So a run with no finalized key replays
  // a fallback answer (the take's stamp or the chain's slot) only when the
  // audio it is about to send matches what that answer was paid for: this
  // blob's size and type, and its length when both sides know one. A stamp
  // with no fingerprint never replays. The finalized-key replay is unchanged —
  // that key names the exact bytes.
  const audio: TakeAudioFingerprint = {
    size: audioBlob.size,
    type: audioBlob.type,
    ...(typeof ctx.durationSeconds === 'number' && Number.isFinite(ctx.durationSeconds)
      ? { durationSeconds: ctx.durationSeconds }
      : {}),
  }
  const transcribeOnce = async (): Promise<Awaited<ReturnType<Response['json']>>> => {
    const stored = takeId ? await readTakeTranscript(takeId) : null
    const currentPath =
      finalizedPath ?? (takeId ? ((await readTakeSecureMeta(takeId))?.finalizedPath ?? null) : null)
    if (
      stored &&
      stored.locale === locale &&
      (currentPath
        ? stored.finalizedPath === currentPath
        : stored.fallback === true && sameAudio(stored.audio, audio))
    ) {
      return stored.response
    }
    const slot = ctx.paidFallback
    if (
      !currentPath &&
      slot &&
      slot.takeId === takeId &&
      slot.locale === locale &&
      sameAudio(slot.audio, audio)
    ) {
      return slot.response
    }
    // ⚖ THE MINTED ROW IS ADOPTED THE MOMENT ITS AUDIO LANDS (S53-B, structural
    // review Finding 10). The port calls `onUploaded` after its PUT and before
    // anything else it does can fail (the web arm's read-URL mint), so a failure
    // there leaves this take on its row and the run retryable — never real audio
    // on a row nothing names. A port that answers without calling it (the phone:
    // nothing between its PUT and its answer) is adopted from the answer, as
    // before. One adoption per mint either way.
    //
    // ⚖ …AND THE HAND-OVER COUNTS ONLY WHEN THE WRITE LANDED (fold 1, Greptile
    // P1). The store answers false without throwing when the write is lost, so
    // `upload.adopted` is the store's own answer — never "the callback ran". A
    // hand-over that did not land falls through to the attempt after the answer,
    // exactly as before this round. A false that is the first-stamp-wins brace
    // is asked once more there and refused again in its own transaction:
    // nothing is written twice.
    //
    // S54 — composed with S53 A4 (below). The hand-over rides the MINT arm only:
    // a re-presented pin names a key already PUT, so its port call mints and
    // uploads nothing and the hook never fires there. S54 F9: its row is asked for again from the PIN
    // below (a lost first adoption is linked there; first stamp wins, so a linked take is a no-op). For a minted key the order is: pin
    // read (none matched) → mint + PUT → hand-over (adoption) → read URL → pin
    // written → the paid POST.
    const upload = { adopted: false }
    // ⚖ S53 A4 — A KEY ALREADY PUT FOR THIS AUDIO IS RE-PRESENTED, NEVER
    // RE-MINTED. The unbound door draws a new key on every mint, so an answer
    // this device never RECEIVED (the response lost, the app killed mid-POST)
    // used to be bought again under a fresh key the server could not link to
    // the first. The fallback now pins its key before it pays (below); a run
    // with still no finalized key, the same locale and the same audio sends
    // THAT key again, through a fresh read, and the server's memo for it
    // replays. Never once the take is finalized at ANY key (`currentPath`, the
    // C3 rule above): a finalized key names its own bytes and is asked as such.
    // OFF (RECORDING_SWITCHES.transcribePaidOnce) = no pin is read or written.
    const pinning = RECORDING_SWITCHES.transcribePaidOnce
    const pinned =
      currentPath || !pinning
        ? null
        : ([
            takeId ? toChainPin(takeId, (await readTakeSecureMeta(takeId))?.fallbackPin) : null,
            ctx.fallbackPin ?? null,
          ].find(
            (pin): pin is FallbackPin =>
              !!pin && !pin.retiredAt && pin.takeId === takeId && pin.locale === locale && sameAudio(pin.audio, audio),
          ) ?? null)
    // ⚖ S54 F10 — A KEY THE SERVER REFUSES OUTRIGHT IS RETIRED, NEVER DELETED: only the web read-URL door's
    // 'forbidden' or the phone door's 404 (never a blip, 'unreadable' 502, a 403 gate, 429, 409 or 5xx). The
    // mark (take + chain slot) makes the matcher above skip it, so the next 再試行 mints fresh — today's run.
    const retire = async (retiredReason: string) => {
      if (!pinned) return
      const retiredAt = Date.now()
      if (takeId) await retireTakeFallback(takeId, pinned.path, retiredAt, retiredReason)
      ctx.onFallbackRetired?.({ ...pinned, retiredAt, retiredReason })
    }
    const prepared = pinned
      ? await recordingPort
          .prepareTranscription(audioBlob, pinned.path, pinned.recordingSessionId ? { takeRow: pinned.recordingSessionId } : undefined)
          .catch(async (err: unknown) => {
            if ((err as { refusal?: unknown } | null)?.refusal === 'forbidden') await retire('read_url_forbidden')
            throw err
          })
      : await recordingPort.prepareTranscription(
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
              : takeRow
                ? { takeRow }
                : undefined,
          async (row, at) => {
            upload.adopted = await adoptMintedSession(takeId, row, at, ctx)
          },
        )
    const { body: transcribeBody, path: mintedPath } = prepared
    // S54 F9: a re-presented key's row comes from the pin (the port names none).
    const minted = pinned ? pinned.recordingSessionId : prepared.recordingSessionId
    if (minted && !upload.adopted) await adoptMintedSession(takeId, minted, mintedPath, ctx)
    // The fallback's PUT has landed (prepareTranscription throws before this
    // otherwise): pin the key BEFORE the POST can pay for it — on the take (the
    // store's C3 guard: never onto a take finalized at another key) and on the
    // chain's slot for a take-less run.
    if (pinning && !finalizedPath && !pinned) {
      const pin: FallbackPin = { takeId, path: mintedPath, recordingSessionId: minted ?? null, locale, audio }
      if (takeId)
        await pinTakeFallback(takeId, {
          finalizedPath: mintedPath,
          recordingSessionId: pin.recordingSessionId,
          locale,
          audio,
        })
      ctx.onFallbackPinned?.(pin)
    }

    let status = 0 // the LAST answer's status (0 = none: a network error)
    const transcribeRes = await fetchWithRetry(async () => {
      status = 0
      const res = await getDataPort().apiFetch(`${recordingPort.aiBase}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...transcribeBody, locale }),
      })
      status = res.status
      return res
    }).catch(async (err) => {
      if (status === 404) await retire('transcribe_404')
      throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`)
    })

    // ⚖ NOTHING IS CLEANED UP (capture pipeline PR4): the object this just read is
    // the take's finalized audio, and audio is never deleted.

    const fresh = await transcribeRes.json()
    // Stamped BEFORE the empty check: an empty answer was paid for too, and
    // replays below as the same EmptyTranscriptError with no second spend.
    if (finalizedPath) {
      if (takeId) await stampTakeTranscript(takeId, finalizedPath, locale, fresh)
    } else {
      // The fallback's answer names the key it was paid for (with the switch ON
      // and no row, S34 just secured the take at that very key). A take
      // finalized at ANOTHER key meanwhile keeps its own stamp — the store
      // refuses this write (see the rule above transcribeOnce); the chain's
      // slot is still told, run-guarded as ever.
      if (takeId) await stampTakeTranscript(takeId, mintedPath, locale, fresh, true, audio)
      ctx.onFallbackPaid?.({ takeId, locale, response: fresh, audio })
    }
    return fresh
  }
  // The door's JSON body, used exactly as before — replayed or fresh. Two tabs
  // on the same object take turns, so the second one reads the first's stamp;
  // a take with no finalized key yet takes turns on the take itself (C3).
  const lockKey = finalizedPath ?? (takeId ? `take:${takeId}` : null)
  const transcribeData = lockKey
    ? await withTranscribeLock(lockKey, transcribeOnce)
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
