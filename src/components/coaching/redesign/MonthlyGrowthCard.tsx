'use client'

// ─────────────────────────────────────────────────────────────
// MonthlyGrowthCard — staff hero card on /coaching
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/MonthlyGrowthCard.tsx
// (lines 28-72). Visual chrome preserved 1:1. The spike's props
// are non-nullable; we widened them to optional so the card can
// render with "—" placeholders + a small 対応予定 footer until
// Anthony wires the data hook.
//
// DATA SOURCE (when wired):
//   personalGrowth.ts via usePersonalGrowthData()
//   EXPECTED TYPE: PersonalGrowth.growth
//   RLS: SELECT allowed only where staff_id = auth.uid()
//   AI: score + delta computed from staff's own session metrics
//   REAL-TIME: no
//
// ANTHONY: when you pass real growth data through, all four
// numeric props populate + the delta indicator + footer 対応予定
// hint disappear automatically (presence-checks below).

import { useTranslations } from 'next-intl'
import { Sparkles, TrendingUp, Wand2 } from 'lucide-react'

import { PrivacyLockBadge } from './PrivacyLockBadge'

export interface MonthlyGrowthData {
  score: number
  delta: number
  sessionsAnalyzed: number
  patternsMastered: number
  patternsInProgress: number
}

interface MonthlyGrowthCardProps {
  /** Real growth data when available. `null` (the default) renders
   *  the no-data chrome with em-dash placeholders + 対応予定 hint. */
  growth?: MonthlyGrowthData | null
}

export function MonthlyGrowthCard({ growth = null }: MonthlyGrowthCardProps) {
  const t = useTranslations('coaching.staff.monthlyGrowth')
  const tHints = useTranslations('coaching.common')

  const score = growth?.score ?? null
  const delta = growth?.delta ?? null
  const stats = [
    { label: t('statSessionsAnalyzed'), value: growth?.sessionsAnalyzed ?? null },
    { label: t('statPatternsMastered'), value: growth?.patternsMastered ?? null },
    { label: t('statPatternsInProgress'), value: growth?.patternsInProgress ?? null },
  ]

  return (
    <div className="rounded-lg border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-card p-5 dark:border-indigo-500/20 dark:from-indigo-500/[0.04] dark:to-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-indigo-600 dark:text-indigo-300" />
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        </div>
        <PrivacyLockBadge label={tHints('privacyLayer1Badge')} />
      </div>

      {/* Big score + delta row */}
      <div className="mb-4 flex items-end gap-3">
        <div className="text-4xl font-semibold tabular-nums tracking-tight text-indigo-800 dark:text-indigo-300">
          {score ?? '—'}
        </div>
        {delta !== null && (
          <div className="mb-1 flex items-center gap-1 text-sm font-medium text-green-700 dark:text-green-300">
            <TrendingUp className="size-3.5" />
            <span className="tabular-nums">{delta >= 0 ? `+${delta}` : delta}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t('vsLastMonth')}
            </span>
          </div>
        )}
      </div>

      {/* Three-stat strip */}
      <div className="grid grid-cols-3 gap-2 border-t border-indigo-100 pt-3 dark:border-indigo-500/15">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="text-base font-semibold tabular-nums">
              {s.value ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Empty-state footer — only shows when growth isn't wired yet. */}
      {growth === null && (
        <div className="mt-4 flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-2.5 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
          <Wand2
            className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 inline-flex items-center">
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {tHints('scaffoldLabel')}
              </span>
            </div>
            <p className="text-[11px] italic leading-relaxed text-muted-foreground">
              {t('emptyHint')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
