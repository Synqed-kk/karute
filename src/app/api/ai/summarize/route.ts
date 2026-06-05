import { NextResponse } from 'next/server'
import { zodResponseFormat } from 'openai/helpers/zod'
import { SummaryResultSchema } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getSummarySystemPrompt } from '@/lib/prompts'
import { getOrgSettings } from '@/actions/org-settings'
import { getBusinessPersona } from '@/lib/karute/business-persona'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
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

    // Business-aware summary: business_type lives in synqed-core org-settings
    // (a JSON blob), NOT a Supabase `organization_settings` table — the prior
    // direct query always missed and fell back to a generic label. getOrgSettings
    // is unstable_cache'd by businessId; null/unset → generic persona.
    const org = await getOrgSettings()
    const persona = getBusinessPersona(org?.business_type)

    const systemPrompt = getSummarySystemPrompt(locale ?? 'en', persona)

    const completion = await openai.chat.completions.parse({
      // gpt-4o (not -mini): the summary is reasoning-heavy (condense narrative,
      // keep concrete dates) — the spike AI_PROMPTS.md §3 calls for a strong
      // reasoning model here. DEDICATED env var (not the shared AI_MODEL) so a
      // system-wide cost setting can't silently revert it. gpt-4o supports
      // structured outputs.
      model: process.env.AI_SUMMARIZE_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + defensivePreamble(locale ?? 'en') },
        {
          role: 'user',
          content: `Summarize this ${persona.businessNounEn} session transcript:\n\n${wrapUntrustedContent('transcript', transcript)}`,
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
