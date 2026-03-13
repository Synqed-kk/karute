import { NextResponse } from 'next/server'
import { getOpenAI } from '@/lib/ai/openai'
import { transcribeRecording, ResourceNotFoundError } from '@/lib/services/transcription.service'
import { transcriptionRequestSchema } from '@/lib/validations/recording'

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get('content-type') ?? ''

  // Handle FormData (free tier — raw audio upload, no database)
  if (contentType.includes('multipart/form-data')) {
    try {
      const formData = await request.formData()
      const audioFile = formData.get('audio')

      if (!audioFile || !(audioFile instanceof File)) {
        return NextResponse.json(
          { error: 'No audio file provided' },
          { status: 400 }
        )
      }

      const locale = (formData.get('locale') as string) || 'ja'
      const whisperLang = locale === 'en' ? 'en' : 'ja'

      const openai = getOpenAI()
      const response = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
        language: whisperLang,
        response_format: 'verbose_json',
      })

      const segments =
        (
          (response as unknown as Record<string, unknown>).segments as Array<{
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

      return NextResponse.json({
        text: response.text,
        segments,
        language: whisperLang,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Transcription failed'
      console.error('[POST /api/transcriptions] FormData error:', error)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  // Handle JSON (dashboard — uses recording session from database)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const parsed = transcriptionRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { recordingSessionId } = parsed.data
    const result = await transcribeRecording(recordingSessionId)

    return NextResponse.json({
      text: result.text,
      segments: result.segments,
      language: result.language,
    })
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    const message = error instanceof Error ? error.message : 'Transcription failed'
    console.error('[POST /api/transcriptions]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
