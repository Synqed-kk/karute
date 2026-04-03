import { NextResponse } from 'next/server'
import { zodResponseFormat } from 'openai/helpers/zod'
import { SummaryResultSchema } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getSummarySystemPrompt } from '@/lib/prompts'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { transcript, locale } = body

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    }

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgSettings } = await (supabase as any)
      .from('organization_settings')
      .select('business_type')
      .limit(1)
      .single()
    const businessType = orgSettings?.business_type || 'salon/clinic'

    const systemPrompt = getSummarySystemPrompt(locale ?? 'en')

    const completion = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Summarize this ${businessType} session transcript:\n\n${transcript}`,
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
