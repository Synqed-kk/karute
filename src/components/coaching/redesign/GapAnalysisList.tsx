'use client'

// ─────────────────────────────────────────────────────────────
// GapAnalysisList — staff drill-down growth-area list
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/GapAnalysisList.tsx
// (~65 lines). Visual preserved 1:1.
//
// PRIVACY: Layer 2 — categorical growth areas only.
//   Server-side prompt guard MUST reject + regenerate any
//   output that references a specific customer, session date,
//   or transcript quote before it is returned to the owner.
//   The spike's preserved language: "成長エリア / サポートポイント"
//   never "弱点 / 問題".
//
// DATA SOURCE (when wired):
//   useCategoricalInsightsData(staffId)
//   Weekly batch via claude-sonnet-4-6; never realtime.

import { useTranslations } from 'next-intl'
import { ArrowUpRight } from 'lucide-react'

import type { CategoricalInsight, InsightPriority } from './owner-types'

import { ScaffoldHint } from './ScaffoldHint'

interface GapAnalysisListProps {
  insights?: CategoricalInsight[] | null
}

function priorityColor(p: InsightPriority): string {
  if (p === 'high')
    return 'bg-orange-50 dark:bg-orange-500/10 border-orange-100 dark:border-orange-500/15 text-orange-900 dark:text-orange-200'
  if (p === 'medium')
    return 'bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/15 text-amber-900 dark:text-amber-200'
  return 'bg-green-50 dark:bg-green-500/10 border-green-100 dark:border-green-500/15 text-green-900 dark:text-green-200'
}

export function GapAnalysisList({ insights = null }: GapAnalysisListProps) {
  const t = useTranslations('coaching.staffDrill')
  const items = insights ?? []
  const hasItems = items.length > 0

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('gapTitle')}</h3>
        <span className="text-[11px] text-muted-foreground">
          {t('gapSubtitle')}
        </span>
      </div>

      {hasItems ? (
        <div className="space-y-3">
          {items.map((ins) => {
            const label =
              ins.priority === 'high'
                ? t('gapPriorityHigh')
                : ins.priority === 'medium'
                  ? t('gapPriorityMedium')
                  : t('gapPriorityStable')
            return (
              <div
                key={ins.id}
                className="rounded-md border border-gray-200 p-4 dark:border-white/10"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {ins.category}
                  </span>
                  <span
                    className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium ${priorityColor(ins.priority)}`}
                  >
                    {label}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums text-indigo-700 dark:text-indigo-300">
                    <ArrowUpRight className="size-3" aria-hidden />
                    {t('gapDiffFromTop', { pct: ins.gapFromTopPerformerPct })}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {ins.summary}
                </p>
              </div>
            )
          })}
        </div>
      ) : (
        <ScaffoldHint hint={t('gapEmptyHint')} />
      )}
    </div>
  )
}
