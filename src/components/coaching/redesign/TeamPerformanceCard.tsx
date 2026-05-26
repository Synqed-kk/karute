'use client'

// ─────────────────────────────────────────────────────────────
// TeamPerformanceCard — owner hero card on /coaching
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/TeamPerformanceCard.tsx
// (full file, ~50 lines). Visual chrome preserved 1:1. Spike
// props were non-nullable; widened to optional so the card
// renders with em-dash placeholders + a 対応予定 footer until
// Anthony wires the data hook.
//
// DATA SOURCE (when wired):
//   staff-performance.ts → teamSummary
//   EXPECTED TYPE: TeamPerformanceSummary
//   RLS: owner / manager of the store may SELECT
//   AI: none — pure aggregation
//   REAL-TIME: no (nightly batch is fine)
//
// PRIVACY: Layer 3 — aggregate only. No staff identifiers
// surface in the props OR the rendered output.

import { useTranslations } from 'next-intl'
import { TrendingUp, Users, Wand2 } from 'lucide-react'

export interface TeamPerformanceSummary {
  avgClosingRate: number // 0..1
  avgRebookingRate: number // 0..1
  avgRevenueJpy: number
  avgSatisfaction: number // 0..5
  monthlyTrendPct: number // signed integer percentage
  totalSessions: number
}

interface TeamPerformanceCardProps {
  /** Real summary when available. `null` (the default) renders
   *  the no-data chrome with em-dash placeholders. */
  summary?: TeamPerformanceSummary | null
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

export function TeamPerformanceCard({
  summary = null,
}: TeamPerformanceCardProps) {
  const t = useTranslations('coaching.owner.teamPerformance')
  const tHints = useTranslations('coaching.common')

  const metrics: Array<{ label: string; value: string }> = [
    {
      label: t('metricClosing'),
      value: summary
        ? `${Math.round(summary.avgClosingRate * 100)}%`
        : '—',
    },
    {
      label: t('metricRebooking'),
      value: summary
        ? `${Math.round(summary.avgRebookingRate * 100)}%`
        : '—',
    },
    {
      label: t('metricAvgRevenue'),
      value: summary ? formatYen(summary.avgRevenueJpy) : '—',
    },
    {
      label: t('metricSatisfaction'),
      value: summary
        ? `${summary.avgSatisfaction.toFixed(1)} / 5.0`
        : '—',
    },
  ]

  return (
    <div className="rounded-lg border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-card p-5 dark:border-indigo-500/20 dark:from-indigo-500/[0.04] dark:to-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-indigo-600 dark:text-indigo-300" />
          <h3 className="text-sm font-semibold text-foreground">
            {t('cardTitle')}
          </h3>
        </div>
        {summary && (
          <div className="flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300">
            <TrendingUp className="size-3.5" />
            <span className="tabular-nums">
              {summary.monthlyTrendPct >= 0
                ? `+${summary.monthlyTrendPct}`
                : summary.monthlyTrendPct}
              %
            </span>
            <span className="font-normal text-muted-foreground">
              {t('vsLastMonth')}
            </span>
          </div>
        )}
      </div>

      {/* 2x2 metric grid */}
      <div className="mb-3 grid grid-cols-2 gap-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="mb-0.5 text-[11px] text-muted-foreground">
              {m.label}
            </div>
            <div className="text-xl font-semibold tabular-nums">{m.value}</div>
          </div>
        ))}
      </div>

      <div className="border-t border-indigo-100 pt-3 text-xs text-muted-foreground dark:border-indigo-500/15">
        {t('totalSessionsLabel')}{' '}
        <span className="tabular-nums font-medium text-foreground">
          {summary?.totalSessions ?? '—'}
        </span>
      </div>

      {/* Empty-state footer */}
      {!summary && (
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
