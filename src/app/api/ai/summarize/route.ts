import { NextResponse } from 'next/server'
import { zodResponseFormat } from 'openai/helpers/zod'
import { SummaryResultSchema } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getSummarySystemPrompt } from '@/lib/prompts'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { defensivePreamble, wrapUntrustedContent, MAX_TRANSCRIPT_CHARS } from '@/lib/ai-safety'

export const maxDuration = 120

export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('summarize')
  if (limited) return limited
  try {
    const body = await request.json()
    const { transcript, locale, customerName, sessionDate } = body

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    }

    // Business type from synqed-core. (The previous from('organization_settings')
    // read a Supabase table that doesn't exist — it silently failed to the
    // default, so the summary was never actually business-type-aware.)
    const orgSettings = await getOrgSettings().catch(() => null)
    const businessType = orgSettings?.business_type || 'salon/clinic'

    const systemPrompt = getSummarySystemPrompt(
      locale ?? 'en',
      orgSettings?.business_type,
      {
        customerName: typeof customerName === 'string' ? customerName : null,
        sessionDate: typeof sessionDate === 'string' ? sessionDate : null,
      },
    )

    const completion = await openai.chat.completions.parse({
      // gpt-4o (not -mini): the summary is reasoning-heavy (condense narrative,
      // keep concrete dates) — the spike AI_PROMPTS.md §3 calls for a strong
      // reasoning model here. DEDICATED env var (not the shared AI_MODEL) so a
      // system-wide cost setting can't silently revert it. gpt-4o supports
      // structured outputs.
      model: process.env.AI_SUMMARIZE_MODEL || 'gpt-4o',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + defensivePreamble(locale ?? 'en') },
        {
          role: 'user',
          content: `Summarize this ${businessType} session transcript:\n\n${wrapUntrustedContent('transcript', transcript, MAX_TRANSCRIPT_CHARS)}`,
        },
      ],
      response_format: zodResponseFormat(SummaryResultSchema, 'summary_result'),
    })

    const result = completion.choices[0].message.parsed
    if (completion.usage) {
      void reportAiUsage('summarize', completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0)
    }
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
