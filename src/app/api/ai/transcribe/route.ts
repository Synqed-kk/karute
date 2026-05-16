import { NextResponse } from 'next/server'
import { enforceAiRateLimit } from '@/lib/ai-rate-limit'
import {
  transcribeUrlWithDeepgram,
  transcribeWithDeepgram,
  type DeepgramTranscribeResult,
} from '@/lib/deepgram'
import { getOrgSettings } from '@/actions/org-settings'

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
 * Returns:
 * ```
 * {
 *   transcript: string            // plain text — what karute_records persists
 *   durationSec?: number          // audio length per Deepgram metadata
 *   confidence?: number           // alternative-level confidence (0–1)
 *   words?: Array<{ word, start, end, confidence, speaker? }>
 *   paragraphs?: Array<{ speaker, start, end, text }>  // only when diarized
 * }
 * ```
 *
 * The `transcript` field is the only one existing consumers read; the rest
 * are additive and tied to Deepgram's response. Diarization is controlled by
 * org_settings.speaker_diarization (default true).
 */
export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('transcribe')
  if (limited) return limited
  try {
    const contentType = request.headers.get('content-type') ?? ''

    // Honor the org's speaker_diarization toggle. Missing settings → true
    // (matches OrgSettings getter default + spike spec).
    const orgSettings = await getOrgSettings().catch(() => null)
    const diarize = orgSettings?.speaker_diarization !== false

    if (contentType.includes('application/json')) {
      const { audioUrl, locale: loc } = await request.json()
      if (!audioUrl) {
        return NextResponse.json({ error: 'No audioUrl provided' }, { status: 400 })
      }
      const result = await transcribeUrlWithDeepgram(audioUrl, {
        language: (loc ?? 'ja') === 'en' ? 'en' : 'ja',
        diarize,
      })
      return NextResponse.json(serialize(result))
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
      diarize,
    })

    return NextResponse.json(serialize(result))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[/api/ai/transcribe]', message)
    return NextResponse.json(
      { error: 'Transcription failed', detail: message },
      { status: 500 },
    )
  }
}

// Strip empty arrays so the response stays small when Deepgram doesn't
// return word-level data (which can happen on very short clips).
function serialize(result: DeepgramTranscribeResult) {
  return {
    transcript: result.transcript,
    durationSec: result.durationSec,
    confidence: result.confidence,
    ...(result.words.length ? { words: result.words } : {}),
    ...(result.paragraphs.length ? { paragraphs: result.paragraphs } : {}),
  }
}
