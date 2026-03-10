import { NextResponse } from 'next/server'
import { classifyTranscript } from '@/lib/services/classification.service'
import { transcribeRecording } from '@/lib/services/transcription.service'
import { classificationRequestSchema } from '@/lib/validations/recording'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json()

    const parsed = classificationRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { recordingSessionId, transcript: directTranscript, businessType } = parsed.data

    // Get transcript: either directly provided or via transcription
    let transcript: string

    if (directTranscript) {
      transcript = directTranscript
    } else if (recordingSessionId) {
      const transcription = await transcribeRecording(recordingSessionId)
      transcript = transcription.text
    } else {
      return NextResponse.json(
        { error: 'recordingSessionId または transcript が必要です' },
        { status: 400 }
      )
    }

    const result = await classifyTranscript({ transcript, businessType })

    return NextResponse.json({
      summary: result.summary,
      entries: result.entries,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Classification failed'

    if (message.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }

    console.error('[POST /api/classifications]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
