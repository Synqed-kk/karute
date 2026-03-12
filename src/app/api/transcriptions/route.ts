import { NextResponse } from 'next/server'
import { transcribeRecording, ResourceNotFoundError } from '@/lib/services/transcription.service'
import { transcriptionRequestSchema } from '@/lib/validations/recording'

export async function POST(request: Request): Promise<NextResponse> {
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
