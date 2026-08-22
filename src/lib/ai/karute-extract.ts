import 'server-only'
import { zodResponseFormat } from 'openai/helpers/zod'
import { ExtractionResultSchema, type ExtractionResult, type Entry } from '@/types/ai'
import { openai } from '@/lib/openai'
import { getExtractionSystemPrompt } from '@/lib/prompts'
import {
  defensivePreamble,
  wrapUntrustedContent,
  MAX_TRANSCRIPT_CHARS,
} from '@/lib/ai-safety'

/** Acceptance-boundary net for degenerate model output (the 8/21 ×39
 *  incident): dedupe near-identical entries, then cap each category.
 *  Runs on the model's fresh parse only — human rows never pass through. */
export const MAX_ENTRIES_PER_CATEGORY = 15

export function sanitizeExtractionEntries(entries: Entry[]): Entry[] {
  // Dedupe: same category + same normalized title = same entry, keep the
  // FIRST occurrence (array order preserved). Normalization is deliberately
  // narrow — trim + collapse whitespace + toLowerCase — the observed failure
  // was verbatim repetition, and aggressive merging is its own past bug (7/15).
  const seen = new Set<string>()
  const deduped: Entry[] = []
  for (const entry of entries) {
    const key = `${entry.category} ${entry.title.trim().replace(/\s+/g, ' ').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }

  // Cap: per-category, keep-first, after dedupe. Order otherwise preserved.
  const categoryCounts = new Map<string, number>()
  const capped = deduped.filter((entry) => {
    const count = categoryCounts.get(entry.category) ?? 0
    categoryCounts.set(entry.category, count + 1)
    return count < MAX_ENTRIES_PER_CATEGORY
  })

  if (capped.length < entries.length) {
    // Counts only — transcript-derived entry text/titles never reach logs.
    console.warn('[karute-extract] safety net trimmed entries', {
      before: entries.length,
      after: capped.length,
    })
  }

  return capped
}

/** Token usage from the OpenAI completion — the caller reports it for the daily
 *  $-cap via its own (cookie- or client-threaded) accounting path. */
export interface AiUsage {
  tokensIn: number
  tokensOut: number
}

/**
 * The karute-extraction LLM call — the body previously inlined in
 * `POST /api/ai/extract`, moved VERBATIM (packet 07 §Build 1(ii)) so the legacy
 * route AND the server-side regenerate orchestration (Decision 2) share ONE
 * implementation instead of the client round-tripping transcripts through the
 * store-blind route. Identity-agnostic: `businessType` is resolved by the caller
 * (cookie `getOrgSettings` on the web route, `orgSettingsWithClient` on the
 * facade) — never fetched here. NO rate-limit / feature-gate / usage report:
 * those stay with the caller so the accounting path is shared, not duplicated.
 */
export async function runKaruteExtraction(params: {
  transcript: string
  locale: string
  customerName: string | null
  sessionDate: string | null
  businessType: string | null | undefined
}): Promise<{ result: ExtractionResult; usage: AiUsage | null }> {
  const { transcript, locale, customerName, sessionDate, businessType } = params

  const systemPrompt = getExtractionSystemPrompt(locale ?? 'en', businessType, {
    customerName,
    sessionDate,
  })

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

  const parsed = completion.choices[0].message.parsed as ExtractionResult
  const result = { ...parsed, entries: sanitizeExtractionEntries(parsed.entries) }
  const usage = completion.usage
    ? { tokensIn: completion.usage.prompt_tokens ?? 0, tokensOut: completion.usage.completion_tokens ?? 0 }
    : null
  return { result, usage }
}
