import { NextResponse } from 'next/server'
import { enforceAiRateLimit } from '@/lib/ai-rate-limit'
import {
  transcribeUrlWithDeepgram,
  transcribeWithDeepgram,
} from '@/lib/deepgram'

export const maxDuration = 300

/**
 * POST /api/ai/transcribe
 *
 * Accepts either:
 * - FormData with audio file (small files, browser direct upload)
 * - JSON with { audioUrl, locale } (large files — caller uploaded to Supabase
 *   Storage and is passing us the signed URL). Deepgram fetches the audio
 *   directly from that URL, so we skip the round-trip through this function.
 *
 * Returns: { transcript: string }
 *
 * Provider: Deepgram nova-3 (replaces OpenAI Whisper as of 2026-05-15). The
 * response contract is unchanged so existing callers don't need to know.
 */
export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('transcribe')
  if (limited) return limited
  try {
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      const { audioUrl, locale: loc } = await request.json()
      if (!audioUrl) {
        return NextResponse.json({ error: 'No audioUrl provided' }, { status: 400 })
      }
      const result = await transcribeUrlWithDeepgram(audioUrl, {
        language: (loc ?? 'ja') === 'en' ? 'en' : 'ja',
      })
      return NextResponse.json({ transcript: result.transcript })
    }

    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null
    const locale = (formData.get('locale') as string | null) ?? 'ja'
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
    }
    const buffer = Buffer.from(await audioFile.arrayBuffer())
    const mimeType = audioFile.type || 'audio/webm'

    const result = await transcribeWithDeepgram(buffer, {
      language: locale === 'en' ? 'en' : 'ja',
      mimeType,
    })

    return NextResponse.json({ transcript: result.transcript })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[/api/ai/transcribe]', message)
    return NextResponse.json(
      { error: 'Transcription failed', detail: message },
      { status: 500 },
    )
  }
}
