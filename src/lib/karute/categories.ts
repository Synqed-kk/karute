/**
 * Entry category constants for karute records.
 * Single source of truth — imported by:
 *   - UI components (CategoryBadge, AddEntrySheet selectors)
 *   - Phase 2 GPT extraction schema (to constrain AI output to valid categories)
 *   - Phase 4 Server Actions (validation before DB insert)
 */

export const ENTRY_CATEGORIES = [
  {
    value: 'symptom',
    label: 'Symptom',
    labelJa: '症状',
    color: 'bg-red-500/20 text-red-300 border-red-500/30',
  },
  {
    value: 'treatment',
    label: 'Treatment',
    labelJa: 'トリートメント',
    color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  },
  {
    value: 'body_area',
    label: 'Body Area',
    labelJa: '部位',
    color: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  },
  {
    value: 'preference',
    label: 'Preference',
    labelJa: '好み',
    color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  },
  {
    value: 'lifestyle',
    label: 'Lifestyle',
    labelJa: 'ライフスタイル',
    color: 'bg-green-500/20 text-green-300 border-green-500/30',
  },
  {
    value: 'next_visit',
    label: 'Next Visit',
    labelJa: '次回来店',
    color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  },
  {
    value: 'product',
    label: 'Product',
    labelJa: '製品',
    color: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  },
  {
    value: 'other',
    label: 'Other',
    labelJa: 'その他',
    color: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  },
] as const

/** Union type of all valid category string values */
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number]['value']

/** Category config object shape */
export type EntryCategoryConfig = (typeof ENTRY_CATEGORIES)[number]

/**
 * Look up a category config by value.
 * Falls back to the 'other' category for unknown values so the UI
 * never crashes on unexpected category strings from AI extraction.
 */
export function getCategoryConfig(category: string): EntryCategoryConfig {
  return (
    (ENTRY_CATEGORIES.find(
      (c) => c.value === category,
    ) as EntryCategoryConfig | undefined) ??
    (ENTRY_CATEGORIES.find((c) => c.value === 'other') as EntryCategoryConfig)
  )
}
