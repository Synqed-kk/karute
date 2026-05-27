// ─────────────────────────────────────────────────────────────
// Pattern library categories
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/PatternLibrary.tsx
// CATEGORY_INFO (lines 25-55). The 5 keys are the production
// taxonomy — Anthony's pattern-generation prompt classifies
// every extracted pattern into one of these slots before
// storing. New categories require a coordinated update on
// both ends (this file + AI_PROMPTS.md §11).

export type PatternCategory =
  | 'counseling_questions'
  | 'conversation_flow'
  | 'closing'
  | 'rebooking'
  | 'objection_handling'

/** Render order on the library page. */
export const PATTERN_CATEGORIES: readonly PatternCategory[] = [
  'counseling_questions',
  'conversation_flow',
  'closing',
  'rebooking',
  'objection_handling',
]
