import { NextResponse } from 'next/server'
import { zodResponseFormat } from 'openai/helpers/zod'
import { ExtractionResultSchema } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getExtractionSystemPrompt } from '@/lib/prompts'
import { getOrgSettings } from '@/actions/org-settings'
import { enforceAiRateLimit, reportAiUsage } from '@/lib/ai-rate-limit'
import { featureAllowed } from '@/lib/subscription/feature-gate'
import { defensivePreamble, wrapUntrustedContent, MAX_TRANSCRIPT_CHARS } from '@/lib/ai-safety'

export const maxDuration = 120

export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('extract')
  if (limited) return limited
  // Plan gate (P4): AI karute generation is a paid capability. Inert until
  // billing arms (KARUTE_BILLING_ENFORCEMENT) — see feature-gate.ts.
  if (!(await featureAllowed('aiKaruteGeneration'))) {
    return NextResponse.json(
      { error: 'PLAN_LOCKED', feature: 'aiKaruteGeneration' },
      { status: 403 },
    )
  }
  try {
    const body = await request.json()
    const { transcript, locale, customerName, sessionDate } = body

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    }

    // Business type from synqed-core → extraction tuned per business (整体 vs gym
    // vs dental). Best-effort: falls back to the neutral persona on failure.
    const orgSettings = await getOrgSettings().catch(() => null)
    const systemPrompt = getExtractionSystemPrompt(
      locale ?? 'en',
      orgSettings?.business_type,
      {
        customerName: typeof customerName === 'string' ? customerName : null,
        sessionDate: typeof sessionDate === 'string' ? sessionDate : null,
      },
    )

    const completion = await openai.chat.completions.parse({
      // gpt-4o (not -mini): the extraction must FOLLOW detailed instructions
      // (carry concrete dates into titles, consolidate next_visit) — exactly
      // where mini is weakest. DEDICATED env var (not the shared AI_MODEL) so a
      // system-wide AI_MODEL=gpt-4o-mini cost setting can't silently revert this
      // to the very model that caused the bug. gpt-4o supports json_schema
      // structured outputs (zodResponseFormat).
      model: process.env.AI_EXTRACT_MODEL || 'gpt-4o',
      // Deterministic extraction — unpinned this ran at the API default (1.0),
      // which is run-to-run category flapping. Same 0.2 as memory-extract.
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt + '\n\n' + defensivePreamble(locale ?? 'en') },
        {
          role: 'user',
          content: `Extract karute entries from this session transcript:\n\n${wrapUntrustedContent('transcript', transcript, MAX_TRANSCRIPT_CHARS)}`,
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
