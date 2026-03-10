import { NextResponse } from 'next/server'
import { transcribeRecording } from '@/lib/services/transcription.service'
import { transcriptionRequestSchema } from '@/lib/validations/recording'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json()

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
    const message = error instanceof Error ? error.message : 'Transcription failed'

    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }

    console.error('[POST /api/transcriptions]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
