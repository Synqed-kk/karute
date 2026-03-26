'use client'

import { Control, useController } from 'react-hook-form'
import { ENTRY_CATEGORIES, EntryCategory } from '@/types/ai'

const CATEGORY_COLORS: Record<EntryCategory, string> = {
  Preference: 'bg-blue-500/20 text-blue-600 border-blue-500/30 dark:text-blue-300',
  Treatment: 'bg-green-500/20 text-green-600 border-green-500/30 dark:text-green-300',
  Lifestyle: 'bg-purple-500/20 text-purple-600 border-purple-500/30 dark:text-purple-300',
  Health: 'bg-red-500/20 text-red-600 border-red-500/30 dark:text-red-300',
  Allergy: 'bg-orange-500/20 text-orange-600 border-orange-500/30 dark:text-orange-300',
  Style: 'bg-pink-500/20 text-pink-600 border-pink-500/30 dark:text-pink-300',
}

interface EntryCardProps {
  index: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>
  onRemove: () => void
}

export function EntryCard({ index, control, onRemove }: EntryCardProps) {
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

  const category = categoryField.value as EntryCategory
  const confidencePercent = Math.round((confidenceField.value as number) * 100)
  const categoryColor = CATEGORY_COLORS[category] ?? 'bg-gray-500/20 text-gray-600 border-gray-500/30 dark:text-gray-300'

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Top row: category selector + confidence badge + remove button */}
      <div className="flex items-center justify-between gap-2">
        <select
          {...categoryField}
          className={`text-xs font-medium px-2 py-1 rounded-full border ${categoryColor} bg-transparent cursor-pointer focus:outline-none`}
        >
          {ENTRY_CATEGORIES.map((cat) => (
            <option key={cat} value={cat} className="bg-card text-foreground">
              {cat}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            {confidencePercent}%
          </span>
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
        type="text"
        placeholder="Entry title..."
        className="w-full bg-transparent text-foreground font-medium text-sm placeholder-muted-foreground border-b border-transparent hover:border-border focus:border-ring focus:outline-none py-0.5 transition-colors"
      />

      {/* Source quote — inline editable, italicized */}
      <input
        {...sourceQuoteField}
        type="text"
        placeholder="Source quote from transcript..."
        className="w-full bg-transparent text-muted-foreground text-xs italic placeholder-muted-foreground/50 border-b border-transparent hover:border-border focus:border-ring focus:outline-none py-0.5 transition-colors"
      />
    </div>
  )
}
