import { NextResponse } from 'next/server'
import { zodResponseFormat } from 'openai/helpers/zod'
import { ExtractionResultSchema } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getExtractionSystemPrompt } from '@/lib/prompts'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'

export const maxDuration = 60

export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('extract')
  if (limited) return limited
  try {
    const body = await request.json()
    const { transcript, locale } = body

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    }

    const systemPrompt = getExtractionSystemPrompt(locale ?? 'en')

    const completion = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + defensivePreamble(locale ?? 'en') },
        {
          role: 'user',
          content: `Extract karute entries from this session transcript:\n\n${wrapUntrustedContent('transcript', transcript)}`,
        },
      ],
      response_format: zodResponseFormat(ExtractionResultSchema, 'extraction_result'),
    })

    const result = completion.choices[0].message.parsed
    if (completion.usage) {
      void reportAiUsage('extract', completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0)
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/ai/extract]', message)
    return NextResponse.json(
      { error: 'Extraction failed', detail: message },
      { status: 500 },
    )
  }
}
