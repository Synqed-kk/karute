// RecordingPipelinePort — the seam Decision 2 (packet 08) draws so the capture
// pipeline's upload + AI-route legs differ per world WITHOUT forking the
// GlobalRecorder / globalPipeline / draft singletons (packet-10's durability
// layer lands on ONE implementation). The web arm keeps the current supabase-js
// upload + same-origin /api/ai routes; the thin arm gets a service-minted signed
// upload URL + the /api/app/v1/ai facade twins (no supabase-js in the bundle).

import { createClient } from '@/lib/supabase/client'

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
}

let current: RecordingPipelinePort = webRecordingPort
export function getRecordingPipelinePort(): RecordingPipelinePort {
  return current
}
export function setRecordingPipelinePort(port: RecordingPipelinePort): void {
  current = port
}
