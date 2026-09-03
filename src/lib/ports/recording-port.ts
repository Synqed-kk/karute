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
   * (packet 22 Stage 1). TRUE only where stageForJob writes a TENANT-SCOPED
   * key the worker can prove ownership of — the thin arm (the upload-url facade
   * mints `app_${businessId}_*`). The web arm is FALSE, but no longer for a
   * key-shape reason: since the 2026-08-25 upload hotfix its stageForJob mints
   * the SAME `app_${businessId}_*` key through mintRecordingUploadUrl, so the
   * flip is now possible — it stays off pending its own decision + acceptance
   * round, not because the path is unsafe.
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
   * Upload the take and return the transcribe-leg request body + a cleanup fn.
   * Both arms PUT the blob to a service-minted signed upload URL; they differ in
   * what the transcribe leg is handed. Web mints a signed READ url server-side
   * and passes it (`{ audioUrl }` — what /api/ai/transcribe's SSRF guard
   * accepts) plus a cleanup that deletes the object through the server; thin
   * passes the tenant-prefixed storage path (`{ path }`) and the facade deletes
   * server-side, so its cleanup is a no-op.
   */
  prepareTranscription(
    blob: Blob,
  ): Promise<{ body: Record<string, unknown>; cleanup: () => void }>
  /**
   * Stage a take for the SERVER pipeline (packet 22 Stage 1): upload only —
   * no signed URL, no cleanup fn. The worker deletes the object on success
   * (process-recording.ts); on a failed/abandoned job it survives until the
   * daily sweep. Returns the bucket path the job payload carries.
   */
  stageForJob(blob: Blob): Promise<{ path: string }>
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
   */
  startSession(input: {
    customerId: string | null
    appointmentId: string | null
    takeId: string
  }): Promise<{ id: string } | null>
  /**
   * Mint the signed upload URL for THIS take's finalized key (capture pipeline
   * PR3 — secure-take.ts). Unlike stageForJob's mint the key is CLIENT-NAMED:
   * the device already owns the take id and the recorder already negotiated the
   * container, so the same take always lands on the same object instead of
   * duplicating. The mint does NOT sign for upsert (PR2 fix round 3), so a
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
 *  URL. Identical request shape to the thin arm's (thin/ports/recording.vite.ts). */
async function putTake(url: string, blob: Blob): Promise<void> {
  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'audio/webm' },
    body: blob,
  })
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
}

/** Web default — same-origin /api/ai + server-minted signed upload/read URLs
 *  (the browser-direct supabase-js upload is dead: bucket RLS 403s it). */
export const webRecordingPort: RecordingPipelinePort = {
  aiBase: '/api/ai',
  // Web stays on the in-tab pipeline for Stage 1. The key shape is no longer
  // the blocker — stageForJob now mints `app_${businessId}_*` like thin, so the
  // flip to true is a separate decision, not a safety fix. See the flag doc.
  supportsServerJob: false,
  supportsDiscardTranscript: true,
  async prepareTranscription(blob) {
    const { mintRecordingUploadUrl, mintRecordingReadUrl, removeRecordingObject } =
      await uploadActions()
    // The mint answers with a result union now (capture pipeline PR2 fix round
    // 4). This leg still speaks in throws, so the refusals collapse into one
    // here; PR3 is where the client learns to branch on them (a named take's
    // `exists` / `reserved_elsewhere` are TERMINAL, never a retry).
    const minted = await mintRecordingUploadUrl()
    if ('error' in minted) throw new Error('could not mint an upload URL')
    const { path, url } = minted
    await putTake(url, blob)
    // The transcribe leg takes a URL on this project's Supabase host (its SSRF
    // guard); mint it server-side from the path we just proved we own.
    const { url: audioUrl } = await mintRecordingReadUrl(path)
    return {
      body: { audioUrl },
      cleanup: () => {
        void removeRecordingObject(path).catch(() => {})
      },
    }
  },
  async stageForJob(blob) {
    const { mintRecordingUploadUrl } = await uploadActions()
    const minted = await mintRecordingUploadUrl()
    if ('error' in minted) throw new Error('could not mint an upload URL')
    const { path, url } = minted
    await putTake(url, blob)
    // NO cleanup — the worker deletes the object on success.
    return { path }
  },
  async startSession({ customerId, appointmentId }) {
    // The recorder's own start-mint door, reached exactly as it reaches it
    // (global-recorder.ts imports this action directly). Lazy for the same
    // reason finalizeTake below is: @/actions/recordings reaches
    // @synqed-kk/client, which jest cannot parse.
    //
    // `takeId` is DROPPED here, not forwarded: a server action has no
    // Idempotency-Key header to carry it (the action's own signature has no
    // such field either), so the retry-collapses-onto-one-row property is the
    // phone's. The web arm keeps the orphan-row degradation core already
    // accepts for this door (packet-10 fact 3).
    const { startRecordingSession } = await import('@/actions/recordings')
    return startRecordingSession({ customerId, appointmentId })
  },
  async mintTakeUrl(takeId, mimeType, recordingSessionId) {
    const { mintRecordingUploadUrl } = await uploadActions()
    // The action already answers with the shared core's result UNION (PR2 fix
    // round 4), which IS this port's shape — so the refusals reach secureTake
    // named, with nothing in between to flatten them.
    const minted = await mintRecordingUploadUrl({ takeId, mimeType, recordingSessionId })
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
    return finalizeTake(input)
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
