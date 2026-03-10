import { getOpenAI } from '@/lib/ai/openai'
import { prisma } from '@/lib/db/client'
import { getServiceClient } from '@/lib/supabase/storage'

const BUCKET_NAME = 'recordings'

export type TranscriptionSegmentResult = {
  text: string
  startTime: number
  endTime: number
  segmentIndex: number
}

export type TranscriptionResult = {
  text: string
  segments: TranscriptionSegmentResult[]
  language: string
}

/**
 * Transcribes a recording session using OpenAI Whisper.
 *
 * 1. Fetches the recording session from the database
 * 2. Downloads audio from Supabase Storage via signed URL
 * 3. Sends to OpenAI Whisper for transcription
 * 4. Parses response into structured segments
 */
export async function transcribeRecording(
  recordingSessionId: string
): Promise<TranscriptionResult> {
  // 1. Fetch recording session
  const session = await prisma.recordingSession.findUnique({
    where: { id: recordingSessionId },
  })

  if (!session) {
    throw new Error(`Recording session not found: ${recordingSessionId}`)
  }

  if (!session.audioStoragePath) {
    throw new Error(`No audio file for recording session: ${recordingSessionId}`)
  }

  // 2. Download audio from Supabase Storage
  const supabase = getServiceClient()

  const { data: audioData, error: downloadError } = await supabase.storage
    .from(BUCKET_NAME)
    .download(session.audioStoragePath)

  if (downloadError || !audioData) {
    throw new Error(
      `Failed to download audio: ${downloadError?.message ?? 'Unknown error'}`
    )
  }

  // Convert Blob to File for OpenAI SDK
  const audioFile = new File([audioData], 'audio.webm', {
    type: 'audio/webm',
  })

  // 3. Call OpenAI Whisper with verbose_json for timestamps
  const openai = getOpenAI()

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: audioFile,
    language: 'ja',
    response_format: 'verbose_json',
  })

  // 4. Parse response into segments
  const segments: TranscriptionSegmentResult[] = (
    (response as Record<string, unknown>).segments as Array<{
      text: string
      start: number
      end: number
      id: number
    }>
  )?.map((seg, index) => ({
    text: seg.text.trim(),
    startTime: seg.start,
    endTime: seg.end,
    segmentIndex: index,
  })) ?? []

  return {
    text: response.text,
    segments,
    language: 'ja',
  }
}
