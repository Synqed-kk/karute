'use client'

import { Control, useController } from 'react-hook-form'
import { useLocale, useTranslations } from 'next-intl'
import { ENTRY_CATEGORIES, EntryCategory } from '@/types/ai'
import { getCategoryConfig } from '@/lib/karute/categories'

/**
 * Tailwind classes per category. Keys MUST match the lowercase
 * canonical enum values in `src/types/ai.ts` and `src/lib/karute/categories.ts`.
 * Falls back to a neutral chip if the AI ever returns an off-list value.
 */
const CATEGORY_COLORS: Record<EntryCategory, string> = {
  symptom: 'bg-red-500/20 text-red-600 border-red-500/30 dark:text-red-300',
  treatment: 'bg-green-500/20 text-green-600 border-green-500/30 dark:text-green-300',
  body_area: 'bg-purple-500/20 text-purple-600 border-purple-500/30 dark:text-purple-300',
  preference: 'bg-blue-500/20 text-blue-600 border-blue-500/30 dark:text-blue-300',
  lifestyle: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30 dark:text-emerald-300',
  next_visit: 'bg-cyan-500/20 text-cyan-600 border-cyan-500/30 dark:text-cyan-300',
  product: 'bg-pink-500/20 text-pink-600 border-pink-500/30 dark:text-pink-300',
  other: 'bg-gray-500/20 text-gray-600 border-gray-500/30 dark:text-gray-300',
}

interface EntryCardProps {
  index: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>
  onRemove: () => void
}

export function EntryCard({ index, control, onRemove }: EntryCardProps) {
  const t = useTranslations('review')
  const locale = useLocale()

  const { field: categoryField } = useController({
    control,
    name: `entries.${index}.category`,
  })
  const { field: titleField } = useController({
    control,
    name: `entries.${index}.title`,
  })
  const { field: sourceQuoteField } = useController({
    control,
    name: `entries.${index}.source_quote`,
  })
  const { field: confidenceField } = useController({
    control,
    name: `entries.${index}.confidence_score`,
  })
  const { field: isManualField } = useController({
    control,
    name: `entries.${index}.is_manual`,
  })

  // Edit-time promotion: the first staff change to any editable field flips this
  // row to human IN ITS VALUE, so the flag survives useFieldArray index shifts.
  // Promotion only — never demotes.
  const promote = () => {
    if (!isManualField.value) isManualField.onChange(true)
  }

  const category = categoryField.value as EntryCategory
  const rawConfidence = confidenceField.value as number | null
  const isManual = Boolean(isManualField.value)
  const categoryColor = CATEGORY_COLORS[category] ?? 'bg-gray-500/20 text-gray-600 border-gray-500/30 dark:text-gray-300'

  // Display label comes from the shared category config so the dropdown
  // shows "症状" / "施術" in JA and "Symptom" / "Treatment" in EN while
  // the form value stays the canonical lowercase enum string.
  const displayLabel = (cat: EntryCategory): string => {
    const cfg = getCategoryConfig(cat)
    return locale === 'ja' ? cfg.labelJa : cfg.label
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Top row: category selector + confidence badge + remove button */}
      <div className="flex items-center justify-between gap-2">
        <select
          {...categoryField}
          onChange={(e) => {
            categoryField.onChange(e)
            promote()
          }}
          className={`text-xs font-medium px-2 py-1 rounded-full border ${categoryColor} bg-transparent cursor-pointer focus:outline-none`}
        >
          {ENTRY_CATEGORIES.map((cat) => (
            <option key={cat} value={cat} className="bg-card text-foreground">
              {displayLabel(cat)}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          {/* Confidence badge is an AI signal — hidden for hand-added/edited
              rows (is_manual) and for null confidence. Keys on provenance, never
              the number alone (a manual row core stores as 0 must still hide). */}
          {!isManual && rawConfidence != null && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              {Math.round(rawConfidence * 100)}%
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded p-1 transition-colors"
            aria-label="Remove entry"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Title — inline editable input styled as text */}
      <input
        {...titleField}
        onChange={(e) => {
          titleField.onChange(e)
          promote()
        }}
        type="text"
        placeholder={t('entryTitlePlaceholder')}
        className="w-full bg-transparent text-foreground font-medium text-sm placeholder-muted-foreground border-b border-transparent hover:border-border focus:border-ring focus:outline-none py-0.5 transition-colors"
      />

      {/* Source quote — inline editable, italicized */}
      <input
        {...sourceQuoteField}
        onChange={(e) => {
          sourceQuoteField.onChange(e)
          promote()
        }}
        type="text"
        placeholder={t('sourceQuotePlaceholder')}
        className="w-full bg-transparent text-muted-foreground text-xs italic placeholder-muted-foreground/50 border-b border-transparent hover:border-border focus:border-ring focus:outline-none py-0.5 transition-colors"
      />
    </div>
  )
}
