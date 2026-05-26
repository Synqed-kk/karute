'use client'

// Lifted from spike: components/coaching/CoachingSuggestionCard.tsx
// (lines 14-30). Used inside KaruteCoachingPanel to render each
// individual AI suggestion (live in-session OR archived per-karute).
//
// Confidence indicator (dot scale) lifted inline rather than as a
// separate ConfidenceIndicator component — that's a single-use
// helper in the spike that doesn't warrant its own file here.

import type { LucideIcon } from 'lucide-react'

interface CoachingSuggestionCardProps {
  icon: LucideIcon
  category: string
  title: string
  body: string
  /** 0..1 — drives the dot-scale indicator. */
  confidence: number
}

export function CoachingSuggestionCard({
  icon: Icon,
  category,
  title,
  body,
  confidence,
}: CoachingSuggestionCardProps) {
  return (
    <div className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3 dark:border-indigo-500/15 dark:bg-indigo-500/[0.08]">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="size-3.5 text-indigo-600 dark:text-indigo-300" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
          {category}
        </span>
        <span className="ml-auto">
          <ConfidenceIndicator value={confidence} />
        </span>
      </div>
      <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

// Dot-scale confidence indicator — 3 filled dots = high confidence
// (>0.8), 2 = medium (>0.5), 1 = low. Visual is a tighter signal
// than a percentage and matches the spike's design.
function ConfidenceIndicator({ value }: { value: number }) {
  const filled = value > 0.8 ? 3 : value > 0.5 ? 2 : 1
  return (
    <span aria-label={`Confidence ${Math.round(value * 100)}%`} className="inline-flex items-center gap-0.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={`size-1.5 rounded-full ${
            i < filled
              ? 'bg-indigo-500 dark:bg-indigo-300'
              : 'bg-indigo-200/60 dark:bg-indigo-500/20'
          }`}
        />
      ))}
    </span>
  )
}
