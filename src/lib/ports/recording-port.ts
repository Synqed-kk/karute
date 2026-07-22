// RecordingPipelinePort — the seam Decision 2 (packet 08) draws so the capture
// pipeline's upload + AI-route legs differ per world WITHOUT forking the
// GlobalRecorder / globalPipeline / draft singletons (packet-10's durability
// layer lands on ONE implementation). The web arm keeps the current supabase-js
// upload + same-origin /api/ai routes; the thin arm gets a service-minted signed
// upload URL + the /api/app/v1/ai facade twins (no supabase-js in the bundle).

import { createClient } from '@/lib/supabase/client'
import type {
  EnqueueRecordingJobInput,
  RecordingJobStatusView,
} from '@/actions/recording-jobs'

export interface RecordingPipelinePort {
  /** AI route base — web '/api/ai', thin '/api/app/v1/ai'. */
  aiBase: string
  /**
   * Upload the take and return the transcribe-leg request body + a cleanup fn.
   * Web uploads to Supabase Storage via supabase-js and returns a signed URL
   * (`{ audioUrl }`); thin gets a service-minted upload URL from the facade, PUTs
   * the blob, and returns the tenant-prefixed storage path (`{ path }`).
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
  /** Poll job status by recording-session id. */
  jobStatus(
    recordingSessionId: string,
  ): Promise<RecordingJobStatusView | { error: string }>
}

/** Web default — same-origin /api/ai + the supabase-js upload flow, byte-
 *  identical to the pre-port pipeline. */
export const webRecordingPort: RecordingPipelinePort = {
  aiBase: '/api/ai',
  async prepareTranscription(blob) {
    const supabase = createClient()
    const fileName = `rec_${Date.now()}.webm`
    const { error: uploadError } = await supabase.storage
      .from('recordings')
      .upload(fileName, blob, { upsert: true })
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)
    const { data: signedData, error: signError } = await supabase.storage
      .from('recordings')
      .createSignedUrl(fileName, 3600)
    if (signError || !signedData?.signedUrl) {
      throw new Error(`Failed to get signed URL: ${signError?.message}`)
    }
    return {
      body: { audioUrl: signedData.signedUrl },
      cleanup: () => {
        supabase.storage.from('recordings').remove([fileName]).catch(() => {})
      },
    }
  },
  async stageForJob(blob) {
    const supabase = createClient()
    const fileName = `rec_${Date.now()}.webm`
    const { error: uploadError } = await supabase.storage
      .from('recordings')
      .upload(fileName, blob, { upsert: true })
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)
    // NO cleanup — the worker deletes the object on success.
    return { path: fileName }
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
