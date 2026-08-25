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
  async prepareTranscription(blob) {
    const { mintRecordingUploadUrl, mintRecordingReadUrl, removeRecordingObject } =
      await uploadActions()
    const { path, url } = await mintRecordingUploadUrl()
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
    const { path, url } = await mintRecordingUploadUrl()
    await putTake(url, blob)
    // NO cleanup — the worker deletes the object on success.
    return { path }
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
