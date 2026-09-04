// RecordingPipelinePort — the seam Decision 2 (packet 08) draws so the capture
// pipeline's upload + AI-route legs differ per world WITHOUT forking the
// GlobalRecorder / globalPipeline / draft singletons (packet-10's durability
// layer lands on ONE implementation). Both arms now upload through a
// service-minted signed upload URL (the web arm's browser-direct supabase-js
// upload was killed by the `recordings` bucket's RLS — hotfix 2026-08-25); they
// still differ on the AI route base: web = same-origin /api/ai, thin = the
// /api/app/v1/ai facade twins (no supabase-js in the bundle).

import type {
  EnqueueRecordingJobInput,
  RecordingJobStatusView,
} from '@/actions/recording-jobs'
import type {
  FinalizeTakeInput,
  FinalizeTakeResult,
} from '@/lib/recording/finalize-take'
import type { MintTakeUrlResult } from '@/lib/recording/mint-take-url'
import { putSaysAlreadyThere } from '@/lib/recording/storage-put'

/**
 * What a port answers a mint with. The SUCCESS arm is the shared core's own
 * (src/lib/recording/mint-take-url.ts), so `recordingSessionId` — the row the
 * mint just reserved this key on — can never drift between the two doors.
 *
 * The ERROR arm is deliberately WIDER than the core's closed union: the thin
 * arm also answers `mint_<status>` for a non-2xx whose body named no code at
 * all (a proxy page, an auth blip). Every code here reaches the take meta
 * verbatim, and TERMINAL_SECURE_ERRORS (take-store) is the one place that says
 * which of them can never turn into a yes.
 *
 * `token` is dropped on the way through, as it always was: it already rides
 * inside `url`, and a port caller that reached for it would be assembling a
 * signed request the doors are there to assemble.
 */
export type MintTakeUrlPortResult =
  | Omit<Extract<MintTakeUrlResult, { path: string }>, 'token'>
  | { error: string }

export interface RecordingPipelinePort {
  /** AI route base — web '/api/ai', thin '/api/app/v1/ai'. */
  aiBase: string
  /**
   * Whether this world may route the autosave cohort to the SERVER pipeline
   * (packet 22 Stage 1). The key-shape question that used to gate it is gone
   * (PR4): the job's audio_path is now the take's own finalized key, minted by
   * the same fenced door on both arms. The web arm stays FALSE pending its own
   * decision + acceptance round, not because the path is unsafe.
   */
  supportsServerJob: boolean
  /**
   * Whether this world can persist the WORDS of a reasoned discard (A2-2).
   * Web: yes — the record page calls the server actions directly. Thin: yes
   * since PHONEWIRE-2C — the phone reaches the same shared bodies through the
   * …/recordings/discards/transcript POST facade. Read BEFORE any take is kept
   * back, so a world that ever answers FALSE again never holds audio for a
   * collection that cannot happen.
   */
  supportsDiscardTranscript: boolean
  /**
   * The transcribe leg's request body for this take.
   *
   * ⚖ THE FINALIZED OBJECT IS THE OBJECT (capture pipeline PR4). `finalizedPath`
   * is the key secureTake already PUT this whole take to at stop, so the happy
   * path uploads NOTHING here and deletes nothing: web mints a signed READ url
   * over that key (`{ audioUrl }` — what /api/ai/transcribe's SSRF guard
   * accepts), thin hands the facade the path itself (`{ path }`). There is no
   * cleanup fn any more, because there is no second copy to clean up — and the
   * finalized object is evidence, never a temporary.
   *
   * THE FALLBACK, and it is temporary: a take the store never held (IndexedDB
   * unavailable, or a uid that would not resolve at create time) has no
   * finalized object and nothing that can secure one, so `finalizedPath` is
   * null and this leg stages THAT take's blob the way every take was staged
   * before — one upload, server-named key, and NO delete. PR5's launch drain
   * is what makes an un-finalized take rare enough to remove it.
   *
   * `path` is the key the transcription will actually be read from — the
   * finalized one, or the staged one this just wrote (capture pipeline PR4 fix
   * round 2). Answered rather than kept private because ONE other caller needs
   * the same staging and must not grow a second spelling of it: the discard's
   * word-collection, for a take that can never be sealed under a finalized key
   * (lib/recording/discard-transcript.ts). Still NO delete on either arm — the
   * staged object is evidence too.
   *
   * ⚖ AND A STAGED COPY IS NAMED FOR ITS SESSION (PR4 fix round 7). `stagedFor`
   * is the recording session the staged copy's words are owed to, and the door
   * puts it IN THE KEY (stg/<biz>_<session>_<uuid>) so the transcribe action can
   * verify the claim instead of accepting any same-tenant key as that discard's
   * audio. Passed by the discard's word-collection alone; the in-tab fallback
   * above stays unbound, because nothing ever claims ITS path to a discard.
   *
   * ⚖ …AND IT NAMES ITS TAKE (slice five packet B, D10). `stagedTake` is the
   * take whose bytes these are, and it fills the key's uuid slot — which is what
   * turns a row-less object into one the CORE ROW can find: session = the row's
   * id, take + ext = the row's own reserved pointer. Two consequences both arms
   * carry: the container travels with it (`blob.type` is the take's own, so an
   * iOS copy is `.mp4` at last instead of the `.webm` every staged copy wore),
   * and the key is DETERMINISTIC, so a second staging of the same take meets its
   * own copy. Storage refuses that PUT and the refusal is a SUCCESS — the copy
   * is there, which is all this leg wanted (⚖ V2.1, storage-put.ts).
   */
  prepareTranscription(
    blob: Blob,
    finalizedPath: string | null,
    opts?: { stagedFor?: string | null; stagedTake?: string | null },
  ): Promise<{ body: Record<string, unknown>; path: string }>
  /**
   * The finalized KEY this take's audio was sealed under — composed, never
   * looked up (capture pipeline PR4 fix round 7).
   *
   * WHY IT EXISTS. Slice three's markTakeFinalized wrote `finalizedAt` alone,
   * and slice four's readers gate on `finalizedPath`: a WEB take finalized
   * between those two deploys and still unprocessed reads as UNSECURED, so the
   * in-tab leg stages a row-less duplicate of audio the server already holds and
   * the discard sweep dead-ends on a take it can never find an object for. The
   * key is DETERMINISTIC — the mint composed it from this take id and container
   * and reserved exactly that on the row — so the server can answer it again
   * from the same two inputs, with no DB read at all.
   *
   * `null` means "this world cannot say" and is a settled answer, never a
   * failure: the caller keeps the un-finalized behaviour it already has.
   */
  finalizedKey(takeId: string, mimeType: string): Promise<string | null>
  /**
   * Mint the recording_sessions ROW for a take that has none (capture pipeline
   * PR3 fix round 6). The SAME door the recorder's own start-mint knocks on —
   * web: the startRecordingSession action; thin: POST …/recordings/session —
   * so row minting has exactly one home. The mint below no longer creates a row
   * for a client-named take (PR2 fix round 7: a lost RESPONSE to a create left
   * an orphan row and a retry that could not name it), which is why the drain
   * needs this door of its own.
   *
   * FAIL-OPEN, exactly like the recorder's: `null` on an unresolvable staff, a
   * dead socket or a core 5xx — all moments in time, so secure-take records a
   * RETRYABLE 'session' and the next drain asks again. Never throws.
   *
   * `takeId` is here for ONE reason (fix round 7): it is the take this row will
   * belong to, so it is the natural idempotency anchor. Every retryable failure
   * above is a moment that may have passed AFTER core already created the row —
   * a dead socket on the way back is indistinguishable from one on the way out.
   * A fresh key per attempt therefore mints a new orphan row every time the
   * reply is lost. Keyed off the take, the retries collapse onto one row.
   * (Thin only: the web arm is a server action, which carries no key — noted at
   * its implementation.)
   *
   * ⚖ EVERY SESSION IS BORN RESERVED (fix round 8, the client half of PR2 fix
   * round 10). `mimeType` is the container the recorder negotiated, and naming
   * it TOGETHER WITH the take is what lets the door compose this take's
   * finalized key server-side and create the row already pointing at it. One
   * atomic create, so there is no unbound window for two client-named mints to
   * race in, and the mint that follows only ever answers "already ours".
   *
   * BOTH OR NEITHER, by the door's schema: half the pair is a validation 400.
   * Omitted → today's create, byte for byte (that is what a take with no uuid
   * to name, or no negotiated container, still gets).
   */
  startSession(input: {
    customerId: string | null
    appointmentId: string | null
    takeId: string
    mimeType?: string
  }): Promise<{ id: string } | null>
  /**
   * Mint the signed upload URL for THIS take's finalized key (capture pipeline
   * PR3 — secure-take.ts). The key is CLIENT-NAMED: the device already owns the
   * take id and the recorder already negotiated the container, so the same take
   * always lands on the same object instead of duplicating — which is what let
   * PR4 delete the second, server-named staging upload entirely. The mint does NOT sign for upsert (PR2 fix round 3), so a
   * retry does not overwrite: storage refuses a second PUT (409 = already
   * there), which secure-take reads as "the object landed, finish the leg".
   *
   * `contentType` is the SERVER's, composed from the closed MIME map beside the
   * key's extension — the PUT sends it back verbatim, so the object's label and
   * its name can never disagree.
   *
   * `recordingSessionId` is the row the mint must RESERVE this key on (PR2 fix
   * round 4 — the mint binds, finalize verifies). secure-take ALWAYS names one
   * now (fix round 6: startSession above runs first when the take carries
   * none), and the reply names the row the take is bound to.
   *
   * NEVER THROWS ON A REFUSAL — the same contract finalizeTake below carries,
   * and for the same reason: `exists` and `reserved_elsewhere` are answers the
   * caller must branch on ("this take is spoken for, start a new one"), and a
   * throw flattens them into one unusable failure. Both arms name their refusal
   * in the result, so the take meta records a reason instead of a blanket
   * 'network'.
   */
  mintTakeUrl(
    takeId: string,
    mimeType: string,
    recordingSessionId: string | null,
  ): Promise<MintTakeUrlPortResult>
  /**
   * "This take is complete" — the finalize door (web action / facade twin),
   * which writes audio_storage_path + duration onto the core row.
   *
   * NEVER throws on a REFUSAL: `object_missing`, `failed` and friends are
   * settled answers the caller records and a later drain retries. Both arms
   * reach the one shared body (lib/recording/finalize-take.ts), so the phone
   * and the web page cannot drift into different finalize semantics.
   */
  finalizeTake(input: FinalizeTakeInput): Promise<FinalizeTakeResult>
  /**
   * Enqueue the recording job. Web calls the server action directly
   * (attribution + store scope resolved from the cookie session); thin POSTs
   * the facade twin (same resolution, Bearer path). Same result shape both
   * arms so global-pipeline can treat them uniformly.
   */
  enqueueJob(
    input: EnqueueRecordingJobInput,
  ): Promise<{ ok: true; jobId: string; status: string } | { error: string }>
  /** Poll job status by recording-session id. `notFound: true` on the error
   *  arm means the server DEFINITIVELY answered "no job for this session"
   *  (HTTP 404) — the ambiguous-enqueue resolution may fall back in-tab on
   *  it. Any other error (5xx/429/auth blips) is transient server trouble
   *  and must NOT be read as job absence. */
  jobStatus(
    recordingSessionId: string,
  ): Promise<RecordingJobStatusView | { error: string; notFound?: boolean }>
}

/** Lazy import of the upload actions — same reason as enqueueJob's below: the
 *  action module's import graph reaches server-only + ESM-only code jest can't
 *  parse, so a static import would drag it into every test that merely loads
 *  global-pipeline/recording-port. */
function uploadActions() {
  return import('@/actions/recording-upload')
}

/** PUT the take at a service-minted signed upload URL — the token rides in the
 *  URL. Identical request shape to the thin arm's (thin/ports/recording.vite.ts).
 *
 *  `contentType` is the MINT's answer, never a guess of ours: the key's
 *  extension and this header are composed from the same closed map server-side
 *  (key-grammar.ts), so sending anything else labels the object as something the
 *  key says it is not. Until this round it was a hardcoded 'audio/webm' — the
 *  live mislabelling bug, on iOS mp4 bytes.
 *
 *  ⚖ AND "ALREADY THERE" IS A SUCCESS (slice five packet B, V2.1). A staged key
 *  is deterministic now, so the second staging of one take meets its own,
 *  immutable copy; storage's refusal means the object this leg wanted exists.
 *  The shared reader in storage-put.ts knows both shapes that refusal arrives
 *  in — the plain 409 and Supabase's 400-with-409-in-the-body. */
async function putTake(url: string, blob: Blob, contentType: string): Promise<void> {
  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: blob,
  })
  if (!put.ok && !(await putSaysAlreadyThere(put))) {
    throw new Error(`Upload failed (${put.status})`)
  }
}

/** ⚖ NO WEB DOOR WAITS FOREVER EITHER (fix round 12, P3). The phone's three
 *  doors have carried a deadline since fix round 7 — this arm's are server
 *  ACTIONS, which take no AbortSignal, and the answer here was "the platform's
 *  function timeout bounds them". It does not bound US: a hung action leaves
 *  secureTake's take in `inFlight` for the whole page life, so the stop path is
 *  gone, every mount/re-drain attempt hits the guard and returns, and no other
 *  owed take is ever reached. One stall starves the drain.
 *
 *  Same numbers as the arms that already have them: 10 s for the session mint
 *  (thin/ports/actions.vite.ts's START_SESSION_TIMEOUT_MS, and the recorder's
 *  own SECURE_MINT_AWAIT_MS), 30 s for the two small-JSON doors
 *  (thin/ports/recording.vite.ts's DOOR_TIMEOUT_MS). The whole-take PUT is not
 *  here: it carries its own size-derived deadline in secure-take.ts.
 *
 *  ponytail: known ceiling — this stops US waiting, it cannot cancel the
 *  action, so the work may still land server-side. That is exactly the
 *  lost-reply case every one of these doors is already built for (the take
 *  keeps its audio, the failure is retryable, the next attempt reads what
 *  landed). Upgrade path if actions ever take a signal: pass one instead. */
const WEB_SESSION_DEADLINE_MS = 10_000
const WEB_DOOR_DEADLINE_MS = 30_000

function withDeadline<T>(work: Promise<T>, ms: number, onDeadline: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(onDeadline), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Web default — same-origin /api/ai + server-minted signed upload/read URLs
 *  (the browser-direct supabase-js upload is dead: bucket RLS 403s it). */
export const webRecordingPort: RecordingPipelinePort = {
  aiBase: '/api/ai',
  // Web stays on the in-tab pipeline for Stage 1. The key shape is no longer
  // the blocker — since PR4 the job's audio_path is the take's own finalized
  // key on BOTH arms, so the flip to true is a separate decision, not a safety
  // fix. See the flag doc.
  supportsServerJob: false,
  supportsDiscardTranscript: true,
  async prepareTranscription(blob, finalizedPath, opts) {
    const { mintRecordingUploadUrl, mintRecordingReadUrl } = await uploadActions()
    // THE HAPPY PATH UPLOADS NOTHING (PR4): the whole take is already at its
    // finalized key. The read url is minted server-side over that key through
    // the unchanged tenant fence (mintRecordingReadUrl → requireOwnPath), and
    // the object stays exactly where it is — nothing deletes recording audio.
    let path = finalizedPath
    if (!path) {
      // The fallback, for a take the store never held (see the port's doc).
      // Byte-for-byte the staging this arm always did, minus its delete —
      // except that a copy staged FOR A DISCARD names its session, so the
      // transcribe door can tell this session's own staged audio from any other
      // key the caller could have typed.
      // ⚖ …and a copy staged FOR a discard names its take and its container too
      // (slice five packet B). `blob.type` IS the take's own: loadTakeBlob sets
      // it from the stored meta, and an empty one is simply omitted so the mint
      // applies its own default, exactly as the un-named fallback does.
      const minted = await mintRecordingUploadUrl(
        opts?.stagedFor
          ? {
              stagedFor: opts.stagedFor,
              stagedTake: opts.stagedTake ?? null,
              mimeType: blob.type || undefined,
            }
          : undefined,
      )
      if ('error' in minted) throw new Error('could not mint an upload URL')
      // The MINT's contentType on both arms — it is the server's own answer for
      // the key it just composed, and for the unbound fallback that answer is
      // the 'audio/webm' this line used to hardcode.
      await putTake(minted.url, blob, minted.contentType)
      path = minted.path
    }
    // The transcribe leg takes a URL on this project's Supabase host (its SSRF
    // guard); mint it server-side from the path we just proved we own.
    const { url: audioUrl } = await mintRecordingReadUrl(path)
    return { body: { audioUrl }, path }
  },
  async finalizedKey(takeId, mimeType) {
    const { recordingFinalizedKey } = await uploadActions()
    // A deadline like every other door on this arm (see withDeadline's note):
    // null is this one's own settled "cannot say", so a stall degrades to the
    // un-finalized behaviour instead of holding the caller for the page's life.
    return withDeadline(
      recordingFinalizedKey({ takeId, mimeType }),
      WEB_DOOR_DEADLINE_MS,
      null,
    )
  },
  async startSession({ customerId, appointmentId, takeId, mimeType }) {
    // The recorder's own start-mint door, reached exactly as it reaches it
    // (global-recorder.ts imports this action directly). Lazy for the same
    // reason finalizeTake below is: @/actions/recordings reaches
    // @synqed-kk/client, which jest cannot parse.
    //
    // `takeId` alone is still DROPPED: as an IDEMPOTENCY anchor it is the
    // phone's, because a server action has no Idempotency-Key header to carry
    // it. The web arm keeps the orphan-row degradation core already accepts for
    // this door (packet-10 fact 3).
    //
    // With a container beside it, though, the pair is not an anchor — it is
    // what the door composes this take's key from (fix round 8), so both go,
    // and this arm is born reserved exactly like the phone's.
    const { startRecordingSession } = await import('@/actions/recordings')
    // Assembled as a value, not an object literal at the call site: the action
    // learns the optional pair in PR2 fix round 10, and until that lands a
    // literal would be an excess-property error against its current signature
    // (the action ignores what it does not know, which is the transitional
    // shape this whole round is built around).
    const args = { customerId, appointmentId, ...(mimeType ? { takeId, mimeType } : {}) }
    // A deadline lands as this door's own fail-open null, which secureTake
    // already reads as the retryable 'session'.
    return withDeadline(startRecordingSession(args), WEB_SESSION_DEADLINE_MS, null)
  },
  async mintTakeUrl(takeId, mimeType, recordingSessionId) {
    const { mintRecordingUploadUrl } = await uploadActions()
    // The action already answers with the shared core's result UNION (PR2 fix
    // round 4), which IS this port's shape — so the refusals reach secureTake
    // named, with nothing in between to flatten them.
    // 'upstream' on the deadline — the one code in this door's closed union
    // that means "the far side did not answer", and the only one of them the
    // take store does NOT judge terminal. A stall is a moment in time, so it
    // has to leave the take retryable.
    const minted = await withDeadline(
      mintRecordingUploadUrl({ takeId, mimeType, recordingSessionId }),
      WEB_DOOR_DEADLINE_MS,
      { error: 'upstream' as const },
    )
    if ('error' in minted) return minted
    // `token` is DROPPED here, not merely dropped from the type: it already
    // rides inside `url`, and handing a caller a credential the contract says
    // it never gets is how a second signed-request assembler is born.
    const { path, url, contentType, recordingSessionId: bound } = minted
    return { path, url, contentType, recordingSessionId: bound }
  },
  async finalizeTake(input) {
    // Lazy, same reason as enqueueJob below — this module's import graph
    // reaches @synqed-kk/client, which jest cannot parse.
    const { finalizeTake } = await import('@/actions/recordings')
    // 'failed' on the deadline — this door's own retryable refusal, the one the
    // thin twin already answers for transport trouble.
    return withDeadline(finalizeTake(input), WEB_DOOR_DEADLINE_MS, {
      error: 'failed' as const,
    })
  },
  async enqueueJob(input) {
    // Lazy import (same reason as customer-facade.ts's provePackForCustomer):
    // this action file's import graph reaches @synqed-kk/client, an ESM-only
    // package jest can't parse — a static import here would drag it into
    // every test that merely loads global-pipeline/recording-port, even ones
    // that never touch the server path.
    const { enqueueRecordingJob } = await import('@/actions/recording-jobs')
    return enqueueRecordingJob(input)
  },
  async jobStatus(recordingSessionId) {
    const { getRecordingJobStatus } = await import('@/actions/recording-jobs')
    return getRecordingJobStatus(recordingSessionId)
  },
}

let current: RecordingPipelinePort = webRecordingPort
export function getRecordingPipelinePort(): RecordingPipelinePort {
  return current
}
export function setRecordingPipelinePort(port: RecordingPipelinePort): void {
  current = port
}
