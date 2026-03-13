import { NextResponse } from 'next/server'
import { classifyTranscript } from '@/lib/services/classification.service'
import { transcribeRecording, ResourceNotFoundError } from '@/lib/services/transcription.service'
import { classificationRequestSchema } from '@/lib/validations/recording'

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const parsed = classificationRequestSchema.safeParse(body)
    if (!parsed.success) {
      const { fieldErrors, formErrors } = parsed.error.flatten()
      return NextResponse.json(
        {
          error: formErrors[0] ?? 'Invalid request',
          details: fieldErrors,
          formErrors,
        },
        { status: 400 }
      )
    }

    const { recordingSessionId, transcript: directTranscript, businessType } = parsed.data
    const locale = (body as Record<string, unknown>).locale as string | undefined

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

    const result = await classifyTranscript({ transcript, businessType, locale })

    return NextResponse.json({
      summary: result.summary,
      entries: result.entries,
    })
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    const message = error instanceof Error ? error.message : 'Classification failed'
    console.error('[POST /api/classifications]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
