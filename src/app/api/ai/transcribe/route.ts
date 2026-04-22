import { NextResponse } from 'next/server'
import { toFile } from 'openai'
import { openai } from '@/lib/openai'

export const maxDuration = 300

/**
 * POST /api/ai/transcribe
 *
 * Accepts either:
 * - FormData with audio file (legacy, small files)
 * - JSON with { audioUrl, locale } (for large files via Storage signed URL)
 *
 * Returns: { transcript: string }
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? ''

    let buffer: Buffer
    let mimeType = 'audio/webm'
    let locale = 'ja'

    if (contentType.includes('application/json')) {
      // New path: download from signed URL
      const { audioUrl, locale: loc } = await request.json()
      locale = loc ?? 'ja'

      if (!audioUrl) {
        return NextResponse.json({ error: 'No audioUrl provided' }, { status: 400 })
      }

      const audioRes = await fetch(audioUrl)
      if (!audioRes.ok) {
        return NextResponse.json({ error: `Failed to download audio: ${audioRes.status}` }, { status: 400 })
      }

      buffer = Buffer.from(await audioRes.arrayBuffer())
      mimeType = audioRes.headers.get('content-type') ?? 'audio/webm'
    } else {
      // Legacy path: FormData upload
      const formData = await request.formData()
      const audioFile = formData.get('audio') as File | null
      locale = (formData.get('locale') as string | null) ?? 'ja'

      if (!audioFile) {
        return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
      }

      buffer = Buffer.from(await audioFile.arrayBuffer())
      mimeType = audioFile.type || 'audio/webm'
    }

    const extension = mimeType.includes('mp4') ? 'audio.mp4' : 'audio.webm'

    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(buffer, extension, { type: mimeType }),
      model: 'gpt-4o-mini-transcribe',
      language: locale === 'ja' ? 'ja' : 'en',
      response_format: 'text',
    })

    return NextResponse.json({ transcript: transcription })
  } catch (error) {
    console.error('[/api/ai/transcribe] Error:', error)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
