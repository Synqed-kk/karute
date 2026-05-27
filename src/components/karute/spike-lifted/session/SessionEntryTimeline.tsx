'use client'

// LIFTED FROM SPIKE (visual: verbatim)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/SessionEntryTimeline.tsx
//        + SessionEntryRow.tsx
//
// Session entry timeline — shows the AI-extracted entries from
// today's session, grouped by time + category. Always renders;
// empty state when AI hasn't extracted entries yet (which is the
// case until Anthony wires the entry-extraction pipeline).
//
// CATEGORIES (spike taxonomy):
//   施術 (treatment) · 相談 (concern) · 体調 (condition) ·
//   商品提案 (product) · 次回 (next visit)
//   Each has its own accent color; rendered as a rounded chip
//   before the time + content.
//
// ANTHONY: see AI_PROMPTS.md §4 in the spike for the category-
// classifier prompt. Pipeline = recording → diarized transcript →
// per-utterance category classification → grouped into entries.
// Entries persist on `karute_entries` (one row per utterance
// with category + time + content + ai_confidence).

import { useTranslations } from 'next-intl'

export type EntryCategory =
  | 'treatment'
  | 'concern'
  | 'condition'
  | 'product'
  | 'next'

export interface SessionEntry {
  id: string
  category: EntryCategory
  /** Display time "HH:MM" */
  time: string
  content: string
  /** 0..1 — AI confidence for the category assignment. */
  aiConfidence?: number
}

interface Props {
  sessionDate: string
  entries: SessionEntry[]
}

const CATEGORY_STYLE: Record<EntryCategory, string> = {
  treatment: 'bg-gray-900 text-white',
  concern:
    'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
  condition:
    'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/20',
  product:
    'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/20',
  next:
    'bg-green-50 text-green-700 border border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20',
}

export function SessionEntryTimeline({ sessionDate, entries }: Props) {
  const t = useTranslations('karute.session')
  const isEmpty = entries.length === 0
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold text-foreground">
          {t('title')}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {sessionDate}
        </span>
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-[12px] italic leading-relaxed text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <div className="space-y-0.5">
          {entries.map((entry) => (
            <SessionEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionEntryRow({ entry }: { entry: SessionEntry }) {
  const t = useTranslations('karute.session.categories')
  return (
    <div className="group flex items-start gap-3 border-b border-black/[0.04] px-1 py-3 transition-colors last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 md:rounded-md md:border-0 md:py-2.5">
      <span
        className={`inline-flex h-6 shrink-0 items-center justify-center rounded-full px-2.5 text-xs font-medium ${CATEGORY_STYLE[entry.category]}`}
      >
        {t(entry.category)}
      </span>
      <span className="w-11 shrink-0 pt-1 text-xs tabular-nums text-muted-foreground">
        {entry.time}
      </span>
      <p className="flex-1 text-sm leading-relaxed text-foreground/90">
        {entry.content}
      </p>
    </div>
  )
}
