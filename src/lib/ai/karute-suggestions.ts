import 'server-only'
import OpenAI from 'openai'
import { personaSystemFragment } from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'
import type { AiUsage } from '@/lib/ai/karute-extract'

/**
 * The session-suggestions LLM body — previously inlined in
 * `POST /api/ai/suggestions`, moved (packet 08 §Build 1(iii)) so the legacy
 * cookie route AND the facade twin (Decision 1) share ONE implementation.
 * Identity-agnostic: `businessType` is resolved by the caller (cookie
 * `getOrgSettings` on the web route, `orgSettingsWithClient` on the facade).
 * NO rate-limit / feature-gate / usage report / cache: those stay with the
 * caller so the accounting + cache path is shared, not duplicated.
 */

export type SuggestionEntry = { category: string; title: string }

export interface SuggestionsResult {
  suggestions: unknown[]
}

export async function runKaruteSuggestions(params: {
  transcript?: string
  summary?: string
  entries?: SuggestionEntry[]
  locale: string
  businessType: string | null | undefined
}): Promise<{ result: SuggestionsResult; usage: AiUsage | null }> {
  const { transcript, summary, entries, locale, businessType } = params

  if (!transcript && !summary) {
    return { result: { suggestions: [] }, usage: null }
  }

  const langInstruction =
    locale === 'ja' ? 'Respond entirely in Japanese.' : 'Respond entirely in English.'

  const context = [
    transcript
      ? `Transcript:\n${wrapUntrustedContent('transcript', transcript.slice(0, 2000))}`
      : '',
    summary ? `Summary: ${wrapUntrustedContent('summary', summary)}` : '',
    entries && entries.length > 0
      ? `Extracted entries:\n${wrapUntrustedContent('entries', entries.map((e) => `- [${e.category}] ${e.title}`).join('\n'))}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const completion = await openai.chat.completions.create({
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `${personaSystemFragment(businessType, locale)}\n\nBased on the session transcript and extracted data, generate 3-5 short, actionable suggestions. These could be:
- Follow-up actions for the staff
- Product or treatment recommendations for the customer
- Things to note for the next visit
- Potential concerns or opportunities

Return as a JSON array of objects with "text" (the suggestion) and "type" (one of: "follow-up", "recommendation", "note", "concern").
Example: [{"text": "Schedule a follow-up in 2 weeks to check hair condition", "type": "follow-up"}]
${langInstruction}

${defensivePreamble(locale)}`,
      },
      { role: 'user', content: context },
    ],
    temperature: 0.7,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  })

  const raw = completion.choices[0]?.message?.content ?? '{}'
  const usage = completion.usage
    ? {
        tokensIn: completion.usage.prompt_tokens ?? 0,
        tokensOut: completion.usage.completion_tokens ?? 0,
      }
    : null

  try {
    const parsed = JSON.parse(raw)
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : Array.isArray(parsed)
        ? parsed
        : []
    return { result: { suggestions }, usage }
  } catch {
    return { result: { suggestions: [] }, usage }
  }
}
