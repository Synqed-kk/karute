'use client'

// ─────────────────────────────────────────────────────────────
// PatternExampleCard — single pattern card in the library grid
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/PatternExampleCard.tsx
// (~37 lines). Visual preserved 1:1.
//
// PRIVACY: Layer 2 — sourceStaffName is owner-only. Backend
// MUST strip it server-side for staff callers; the `showSource`
// prop is a UX safety net, not the gate.
//
// Title + (optional source name) → description → indented
// blockquote with the actual pattern text → footer with
// learner count.

import { Quote, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { TopPerformerPattern } from './LearnFromTopCard'

interface PatternExampleCardProps {
  pattern: TopPerformerPattern
  /** True only on owner-side renders. */
  showSource: boolean
}

export function PatternExampleCard({
  pattern,
  showSource,
}: PatternExampleCardProps) {
  const t = useTranslations('coaching.patterns')

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">
          {pattern.title}
        </div>
        {showSource && pattern.sourceStaffName && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <UserRound className="size-2.5" aria-hidden />
            {pattern.sourceStaffName}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        {pattern.description}
      </p>

      {pattern.exampleText && (
        <div className="relative rounded-r-md border-l-2 border-indigo-200 bg-indigo-50/40 py-2 pl-4 pr-3 dark:border-indigo-500/20 dark:bg-indigo-500/[0.08]">
          <Quote
            className="absolute left-1 top-2 size-2.5 text-indigo-400"
            aria-hidden
          />
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-indigo-900 dark:text-indigo-200">
            {pattern.exampleText}
          </p>
        </div>
      )}

      {typeof pattern.learningCount === 'number' && (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {t('learnersFooter', { n: pattern.learningCount })}
        </div>
      )}
    </div>
  )
}
