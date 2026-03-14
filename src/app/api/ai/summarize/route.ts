import { NextResponse } from 'next/server'
import { zodResponseFormat } from 'openai/helpers/zod'
import { SummaryResultSchema } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getSummarySystemPrompt } from '@/lib/prompts'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { transcript, locale } = body

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    }

    const systemPrompt = getSummarySystemPrompt(locale ?? 'en')

    const completion = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Summarize this salon session transcript:\n\n${transcript}`,
        },
      ],
      response_format: zodResponseFormat(SummaryResultSchema, 'summary_result'),
    })

    const result = completion.choices[0].message.parsed

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Summary generation failed' }, { status: 500 })
  }
}
