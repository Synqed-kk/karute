import { NextResponse } from 'next/server'
import { toFile } from 'openai'
import { openai } from '@/lib/openai'

/**
 * Maximum request duration — Vercel Pro timeout.
 * Whisper transcription for 1–5 minute recordings typically completes in 5–15 seconds,
 * but we allow 60 seconds for slow uploads or longer recordings.
 */
export const maxDuration = 60

/**
 * POST /api/ai/transcribe
 *
 * Accepts FormData with:
 * - audio (File): the recorded audio blob (audio/webm or audio/mp4)
 * - locale (string, optional): 'ja' or 'en', defaults to 'ja'
 *
 * Returns: { transcript: string }
 *
 * Privacy: audio is held in memory as a Buffer and goes out of scope
 * after the response — never written to disk or Supabase Storage (AI-05).
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData()

    const audioFile = formData.get('audio') as File | null
    const locale = (formData.get('locale') as string | null) ?? 'ja'

    // Validate audio presence
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
    }

    // Convert File to Buffer — stays in memory, never persisted
    const buffer = Buffer.from(await audioFile.arrayBuffer())

    // Determine MIME type — default to audio/webm if empty (Chrome default)
    const mimeType = audioFile.type || 'audio/webm'

    // Determine file extension from MIME type
    // iOS Safari records audio/mp4; Chrome records audio/webm
    const extension = mimeType.includes('mp4') ? 'audio.mp4' : 'audio.webm'

    // Call Whisper transcription
    // gpt-4o-mini-transcribe: cost-efficient, high quality, supports Japanese
    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(buffer, extension, { type: mimeType }),
      model: 'gpt-4o-mini-transcribe',
      language: locale === 'ja' ? 'ja' : 'en',
      response_format: 'text',
    })

    // buffer goes out of scope here — no persistent reference (AI-05 compliance)
    return NextResponse.json({ transcript: transcription })
  } catch (error) {
    console.error('[/api/ai/transcribe] Error:', error)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
