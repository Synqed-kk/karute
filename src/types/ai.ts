import { z } from 'zod'

/**
 * Fixed predefined set of entry categories for AI extraction.
 * Used by GPT structured output to constrain category values.
 *
 * MUST match the DB enum on `karute_entries.category`. The save action
 * pipes these values through `.toUpperCase()` directly into the Prisma
 * enum (`SYMPTOM | TREATMENT | BODY_AREA | PREFERENCE | LIFESTYLE |
 * NEXT_VISIT | PRODUCT | OTHER`), so any mismatch surfaces as a
 * `P2003` "Invalid enum value" error at save time. Keep this list in
 * lockstep with `src/lib/karute/categories.ts` — that file owns the
 * display labels (Symptom / Treatment / Body Area / 症状 / etc.).
 *
 * Previously the list used legacy TitleCase labels (Preference,
 * Treatment, Lifestyle, Health, Allergy, Style) that did NOT map to
 * the DB enum — 'Health' uppercased to 'HEALTH' which is rejected by
 * Prisma. Liam hit this bug on Vercel; see git log for the fix commit.
 */
export const ENTRY_CATEGORIES = [
  'symptom',
  'treatment',
  'body_area',
  'preference',
  'lifestyle',
  'next_visit',
  'product',
  'other',
] as const

export type EntryCategory = (typeof ENTRY_CATEGORIES)[number]

/**
 * Zod schema for a single AI-extracted karute entry.
 * All fields are required — no .optional() fields per structured output restriction.
 */
export const EntrySchema = z.object({
  category: z.enum(ENTRY_CATEGORIES),
  title: z.string(),
  source_quote: z.string(),
  confidence_score: z.number().min(0).max(1),
})

export type Entry = z.infer<typeof EntrySchema>

/**
 * Zod schema for the full extraction result returned by GPT.
 * Wraps an array of entries — structured output guarantees this shape.
 */
export const ExtractionResultSchema = z.object({
  entries: z.array(EntrySchema),
})

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

/**
 * Zod schema for the session summary returned by GPT.
 *
 * `summary` is an ARRAY of bullet strings (not one string) — this forces the
 * model to physically separate the 3–4 key points, so it can't collapse them
 * into one run-on paragraph (the bug behind the "本日のセッション" wall of text).
 * The spike (AI_PROMPTS.md §3) returns the same `summary: string[]` shape.
 * The pipeline joins these with "\n" for the string `karute.summary` field;
 * the karute-detail adapter splits them back into bullets.
 */
export const SummaryResultSchema = z.object({
  summary: z.array(z.string()).min(1).max(6),
})

export type SummaryResult = z.infer<typeof SummaryResultSchema>
