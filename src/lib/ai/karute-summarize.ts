import 'server-only'
import { zodResponseFormat } from 'openai/helpers/zod'
import { SummaryResultSchema, type SummaryResult } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getSummarySystemPrompt } from '@/lib/prompts'
import {
  defensivePreamble,
  wrapUntrustedContent,
  MAX_TRANSCRIPT_CHARS,
} from '@/lib/ai-safety'
import type { AiUsage } from './karute-extract'

/**
 * The karute-summary LLM call — the body previously inlined in
 * `POST /api/ai/summarize`, moved VERBATIM (packet 07 §Build 1(ii)) so the
 * legacy route AND the server-side regenerate orchestration (Decision 2) share
 * ONE implementation. Identity-agnostic: `businessType` is resolved by the
 * caller (cookie or client-threaded), never fetched here. NO rate-limit /
 * feature-gate / usage report — those stay with the caller (shared accounting).
 */
export async function runKaruteSummary(params: {
  transcript: string
  locale: string
  customerName: string | null
  sessionDate: string | null
  businessType: string | null | undefined
}): Promise<{ result: SummaryResult; usage: AiUsage | null }> {
  const { transcript, locale, customerName, sessionDate, businessType } = params

  const businessNoun = businessType || 'salon/clinic'
  const systemPrompt = getSummarySystemPrompt(locale ?? 'en', businessType, {
    customerName,
    sessionDate,
  })

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
        content: `Summarize this ${businessNoun} session transcript:\n\n${wrapUntrustedContent('transcript', transcript, MAX_TRANSCRIPT_CHARS)}`,
      },
    ],
    response_format: zodResponseFormat(SummaryResultSchema, 'summary_result'),
  })

  const result = completion.choices[0].message.parsed as SummaryResult
  const usage = completion.usage
    ? { tokensIn: completion.usage.prompt_tokens ?? 0, tokensOut: completion.usage.completion_tokens ?? 0 }
    : null
  return { result, usage }
}
