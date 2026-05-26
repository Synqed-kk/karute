'use client'

// ─────────────────────────────────────────────────────────────
// ScaffoldHint — the 対応予定 indicator block
// ─────────────────────────────────────────────────────────────
// Extracted from CoachingScaffoldCard (now deleted) after it
// became clear the same dashed-blue-border + Wand2 + amber pill
// + italic body block was being copy-pasted across 12 coaching
// surfaces with byte-identical JSX. This file is the single
// source of truth.
//
// USAGE
//
//   import { ScaffoldHint } from './ScaffoldHint'
//   const t = useTranslations('coaching.staff.monthlyGrowth')
//   // …inside the real card chrome, where data would go:
//   <ScaffoldHint hint={t('emptyHint')} />
//
// The amber 対応予定 pill is internalized — every coaching surface
// reads it from `coaching.common.scaffoldLabel`. The body copy
// is per-card and comes through `hint`.
//
// SIZE / DENSITY
//
// This primitive renders the canonical sizing used by 12 of the
// 14 coaching cards (`p-3`, `size-3`, `text-[11px]`). Two cards
// (MonthlyGrowthCard, TeamPerformanceCard) and one route view
// (LearningModulesView) keep their own inline scaffold block
// because their layouts call for intentionally different padding
// — promoting their variants to props now would be YAGNI.

import { Wand2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ScaffoldHintProps {
  /** Pre-localized body copy explaining what'll surface once
   *  Anthony wires the relevant data hook. */
  hint: string
}

export function ScaffoldHint({ hint }: ScaffoldHintProps) {
  const tCommon = useTranslations('coaching.common')

  return (
    <div className="flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
      <Wand2
        className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 inline-flex items-center">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {tCommon('scaffoldLabel')}
          </span>
        </div>
        <p className="text-[11px] italic leading-relaxed text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  )
}
