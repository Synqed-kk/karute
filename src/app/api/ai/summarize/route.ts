import { NextResponse } from 'next/server'
import { zodResponseFormat } from 'openai/helpers/zod'
import { SummaryResultSchema } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getSummarySystemPrompt } from '@/lib/prompts'
import { createClient } from '@/lib/supabase/server'
import { enforceAiRateLimit } from '@/lib/ai-rate-limit'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'

export const maxDuration = 60

export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('summarize')
  if (limited) return limited
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
        { role: 'system', content: systemPrompt + '\n\n' + defensivePreamble(locale ?? 'en') },
        {
          role: 'user',
          content: `Summarize this ${businessType} session transcript:\n\n${wrapUntrustedContent('transcript', transcript)}`,
        },
      ],
      response_format: zodResponseFormat(SummaryResultSchema, 'summary_result'),
    })

    const result = completion.choices[0].message.parsed

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/ai/summarize]', message)
    return NextResponse.json(
      { error: 'Summary generation failed', detail: message },
      { status: 500 },
    )
  }
}
