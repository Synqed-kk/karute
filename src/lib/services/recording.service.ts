import { getServiceClient } from '@/lib/supabase/storage'

const BUCKET_NAME = 'recordings'

type UploadRecordingParams = {
  orgId: string
  sessionId: string
  audioBuffer: Buffer
  mimeType: string
}

type UploadRecordingResult = {
  storagePath: string
  fullPath: string
}

/**
 * Uploads a recording audio file to Supabase Storage.
 */
export async function uploadRecording(
  params: UploadRecordingParams
): Promise<UploadRecordingResult> {
  const { orgId, sessionId, audioBuffer, mimeType } = params
  const extension = mimeType === 'audio/webm' ? 'webm' : mimeType.split('/')[1] ?? 'webm'
  const storagePath = `recordings/${orgId}/${sessionId}.${extension}`

  const supabase = getServiceClient()

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, audioBuffer, {
      contentType: mimeType,
      upsert: true,
    })

  if (error) {
    throw new Error(`Recording upload failed: ${error.message}`)
  }

  return {
    storagePath,
    fullPath: `${BUCKET_NAME}/${storagePath}`,
  }
}

/**
 * Returns a signed URL for a recording (1 hour expiry).
 */
export async function getRecordingUrl(storagePath: string): Promise<string> {
  const supabase = getServiceClient()

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 3600) // 1 hour

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${error?.message ?? 'Unknown error'}`)
  }

  return data.signedUrl
}

/**
 * Deletes a recording from Supabase Storage.
 */
export async function deleteRecording(storagePath: string): Promise<void> {
  const supabase = getServiceClient()

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([storagePath])

  if (error) {
    throw new Error(`Failed to delete recording: ${error.message}`)
  }
}
