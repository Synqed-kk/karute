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
// The staged PUT's deadline, from the module that holds the whole-take one
// (slice five fix round 3, F7). It imports nothing app-side, so a port may
// reach it without a cycle.
import { putDeadlineMs } from '@/lib/recording/storage-put'

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
 *
 * EXTRACTED ARM BY ARM, NEVER BY `path` (fix round 2). The core's success side
 * is two arms — the signed one and the "already there, here is its size" one —
 * and BOTH reach this door since the 2026-09-05 hotfix: the take mint answers
 * the second when the object is already at this take's own reserved key.
 * Naming `url` and `existingSize` says which is which in the type; extracting
 * by `path` would match both and `Omit` over a union collapses to their shared
 * keys, quietly deleting `url` from this contract. `token` is dropped from the
 * signed arm only — the other never carried one.
 */
export type MintTakeUrlPortResult =
  | Omit<Extract<MintTakeUrlResult, { url: string }>, 'token'>
  | Extract<MintTakeUrlResult, { existingSize: number | null }>
  | { error: string }

/**
 * What a port answers the SEGMENT mint with (slice five packet C, D6/D7).
 *
 * Same two success arms the core answers with, per seq — the signed one and
 * the "an object is already here, and this is its length" one — because the
 * pump has to tell them apart before it decides whether to PUT anything at all.
 * `token` is DROPPED exactly as `mintTakeUrl` drops it: it already rides inside
 * `url`, and a caller that reached for it would be assembling a signed request
 * the doors exist to assemble.
 *
 * The error arm is a plain string for the same reason MintTakeUrlPortResult's
 * is: the thin arm also answers `mint_<status>` for a non-2xx whose body named
 * no code. TERMINAL_SECURE_ERRORS (take-store) is the one place that says which
 * of them can never turn into a yes.
 */
export type MintSegmentUrlsPortResult =
  | {
      segments: (
        | { seq: number; path: string; url: string; contentType: string }
        | { seq: number; path: string; contentType: string; existingSize: number | null }
      )[]
    }
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
   * own copy.
   *
   * ⚖ …AND A KEY THAT IS COMPOSABLE IN ADVANCE MAKES "SOMETHING IS THERE" WORTH
   * NOTHING (fix round 2). The door answers existence BEFORE it signs anything,
   * with the object's SIZE, and this leg adopts that object only when the size
   * is its own blob's — the one fact a caller who never held the recording
   * cannot produce. Any other answer throws and the take stays unstaged, which
   * is what keeps ⚖ 9/3 true: no staffer action can erase a recording.
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
   * PR4 delete the second, server-named staging upload entirely. The mint does
   * NOT sign for upsert (PR2 fix round 3), so a retry does not overwrite — and
   * since the 2026-09-05 hotfix it does not SIGN at all when the object is
   * already at this take's own reserved key: it answers the other arm below,
   * with no `url`, and secure-take skips the PUT and finalizes. (A 409 at a
   * freshly signed PUT is still the race this probe did not see, and
   * secure-take still reads it as "the object landed, finish the leg".)
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
   * Mint signed upload URLs for a BATCH of this take's SEGMENTS — the bytes
   * that reach the server WHILE the recording is still running (slice five
   * packet C, D6; design v1 §3 R1).
   *
   * THE SAME DOOR the take mint knocks on, with the same fences — and it
   * RESERVES NOTHING: a segment hangs under a take whose key the row has
   * already reserved, so there is nothing left to bind, nothing written and
   * nothing audited (the finalize at the end of the take is the audited act).
   * What stands in for the reservation is the row's own pointer: it must equal
   * THIS take's key or the door answers `not_reserved`, which is TERMINAL here
   * — an unbound row is the whole-take mint's job at stop, and a row bound to
   * another take is not this take's.
   *
   * ⚖ AND "ALREADY THERE" IS NEVER ADOPTED ON ITS OWN. A segment key is
   * composable in advance, so the door probes each seq BEFORE it signs and
   * answers the object's SIZE instead of a URL when one exists. The pump adopts
   * such a seq only when that length is its own blob's — the one fact a caller
   * who never held the recording cannot forge — and a 409 on a freshly signed
   * PUT is NOT a landing (the same rule the staged path took in packet B's fix
   * round 2, and for the sharper reason: the assembler will one day build a
   * take out of these objects).
   *
   * NEVER THROWS ON A REFUSAL, exactly like `mintTakeUrl`: the pump has to
   * branch on WHICH refusal it got, and a throw flattens them into one
   * unusable failure.
   */
  mintSegmentUrls(
    takeId: string,
    mimeType: string,
    recordingSessionId: string,
    seqs: number[],
  ): Promise<MintSegmentUrlsPortResult>
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
 *  ⚖ AND EVERY REFUSAL IS A FAILURE HERE, THE 409 INCLUDED (fix round 2). On
 *  the WHOLE-TAKE path "already there" is a success, because finalize then
 *  re-proves the object's size and its row's ownership before anything acts on
 *  it. This path has no finalize: a staged copy is row-less, and its key is
 *  composable in advance — so an object meeting our PUT is not evidence it is
 *  ours. The mint answers existence BEFORE signing now, with the object's
 *  size, and only a size match adopts it (see prepareTranscription). A 409
 *  reaching here is a race the mint did not see a moment earlier; it throws,
 *  the take stays unstaged, and the next sweep's mint answers it with a size.
 *
 *  ⚖ AND IT CARRIES A DEADLINE (slice five fix round 3, F7). This is a real
 *  network call, not a server action, so it takes a signal — and the law is
 *  that every one of them has a deadline. A stalled staged PUT holds its take
 *  inside runDiscardTranscript's module-level `inFlight` set, and the sweep is
 *  sequential, so one of them withheld the discard words of every take behind
 *  it. Same number as the whole-take PUT: the blob's own size at ~10 KB/s
 *  (storage-put.ts). AbortController plus a clearable timer rather than
 *  AbortSignal.timeout, the same reason the thin arm's doors give. */
async function putTake(url: string, blob: Blob, contentType: string): Promise<void> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), putDeadlineMs(blob.size))
  let put: Response
  try {
    put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
      signal: deadline.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
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
      // ⚖ ADOPT ONLY WHAT IS OUR OWN BYTE LENGTH (fix round 2). The door signed
      // nothing because the object is already there; the ONLY reading of that
      // which is safe is "this is the copy we PUT, whose markTakeStaged was
      // lost" — and the one thing a caller who never held the recording cannot
      // forge is its size. Anything else (a different length, or a storage
      // answer carrying no length at all) throws: the take stays unstaged, its
      // discard stamp stands, and the next sweep asks the mint again — one
      // small JSON call per mount, no upload, and nothing released.
      if ('existingSize' in minted) {
        if (minted.existingSize !== blob.size) throw new Error('staged copy mismatch')
        path = minted.path
      } else {
        // The MINT's contentType — the server's own answer for the key it just
        // composed, and for the unbound fallback that answer is the
        // 'audio/webm' this line used to hardcode.
        await putTake(minted.url, blob, minted.contentType)
        path = minted.path
      }
    }
    // ⚖ A DISCARD'S STAGED COPY NEEDS NO READ URL (slice five fix round 3, F9;
    // the defect predates this slice — PR4 fix round 7). `mintRecordingReadUrl`
    // is fenced at `kind === 'take'` (key-grammar's grammar, read by
    // requireOwnPath), so a `stg/` key is refused there by construction: this
    // line THREW on every web discard staging, after the copy had been PUT, so
    // the words were never collected on that arm at all. Nothing needs the URL
    // anyway — the only caller with `stagedFor` is runDiscardTranscript, which
    // reads `path` and lets the discard action sign its own URL from it. So the
    // body is empty here, deliberately: there is no audio URL a staged copy can
    // honestly carry through this door.
    if (opts?.stagedFor) return { body: {}, path }
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
    // BOTH success arms pass THROUGH (hotfix 2026-09-05): the take mint answers
    // "the object is already there" when this take's own row reserved the key
    // and storage holds it, and secureTake reads that as "nothing to send, go
    // and finalize". Converted into `upstream` it left the web arm re-asking
    // for ever, exactly as the phone did.
    //
    // `token` is DROPPED here, not merely dropped from the type: it already
    // rides inside `url`, and handing a caller a credential the contract says
    // it never gets is how a second signed-request assembler is born. Rebuilt
    // field by field rather than spread, so nothing new rides through either.
    if ('url' in minted) {
      const { path, url, contentType, recordingSessionId: bound } = minted
      return { path, url, contentType, recordingSessionId: bound }
    }
    const { path, contentType, recordingSessionId: bound, existingSize } = minted
    return { path, contentType, recordingSessionId: bound, existingSize }
  },
  async mintSegmentUrls(takeId, mimeType, recordingSessionId, seqs) {
    const { mintRecordingSegmentUrls } = await uploadActions()
    // 'upstream' on the deadline, for the same reason mintTakeUrl answers it:
    // the one code in this door's closed union that means "the far side did not
    // answer", and the only one the pump does not judge terminal — a stall is a
    // moment in time, so it has to leave these seqs askable again.
    const minted = await withDeadline(
      mintRecordingSegmentUrls({ takeId, mimeType, recordingSessionId, seqs }),
      WEB_DOOR_DEADLINE_MS,
      { error: 'upstream' as const },
    )
    if ('error' in minted) return minted
    // `token` is DROPPED here, not merely absent from the type — the same rule,
    // for the same reason, as the take mint one function up. The two arms are
    // rebuilt field by field rather than spread, so a `token` on the signed one
    // cannot ride through on a future field addition either.
    return {
      segments: minted.segments.map((s) =>
        'url' in s
          ? { seq: s.seq, path: s.path, url: s.url, contentType: s.contentType }
          : {
              seq: s.seq,
              path: s.path,
              contentType: s.contentType,
              existingSize: s.existingSize,
            },
      ),
    }
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
