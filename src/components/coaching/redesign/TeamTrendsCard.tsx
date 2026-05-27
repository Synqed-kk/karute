'use client'

// ─────────────────────────────────────────────────────────────
// TeamTrendsCard — owner dashboard Row 1 right
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/TeamTrendsCard.tsx
// (~93 lines). Visual preserved 1:1.
//
// PRIVACY: Layer 2 — categorical only, no individual staff
// callout. focusAreas is rolled up to a frequency map; the
// 3-up tile counts are anonymous head-counts.
//
// DATA SOURCE (when wired):
//   useStaffPerformanceData().staff → derived trend rollups +
//   categorical focus-area frequency. Pure aggregation, no AI.

import { useTranslations } from 'next-intl'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'

import type { StaffPerformance } from './owner-types'

import { ScaffoldHint } from './ScaffoldHint'

interface TeamTrendsCardProps {
  staff?: StaffPerformance[] | null
}

export function TeamTrendsCard({ staff = null }: TeamTrendsCardProps) {
  const t = useTranslations('coaching.owner.teamTrends')
  const items = staff ?? []
  const hasData = items.length > 0

  const up = items.filter((s) => s.growthTrend === 'up').length
  const flat = items.filter((s) => s.growthTrend === 'flat').length
  const down = items.filter((s) => s.growthTrend === 'down').length

  // Categorical rollup — never names individual staff (Layer 2).
  const focusAreaFrequency = items
    .flatMap((s) => s.focusAreas)
    .reduce<Record<string, number>>((acc, area) => {
      acc[area] = (acc[area] ?? 0) + 1
      return acc
    }, {})
  const topFocusAreas = Object.entries(focusAreaFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="size-4 text-indigo-600 dark:text-indigo-300" />
        <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
      </div>

      {/* 3-up trend tiles. min-h on the icon+label row keeps numbers
       *  vertically aligned across all three tiles even when a label
       *  wraps to two lines on narrow mobile (matches spike). */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-green-50/60 p-3 dark:bg-green-500/[0.08]">
          <div className="mb-1 flex min-h-[2.25rem] items-start gap-1 text-green-700 dark:text-green-300">
            <TrendingUp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="text-[11px] font-medium leading-tight">
              {t('tileGrowing')}
            </span>
          </div>
          <div className="text-xl font-semibold tabular-nums text-green-900 dark:text-green-200">
            {hasData ? up : '—'}
            <span className="ml-0.5 text-xs font-normal text-green-700 dark:text-green-300">
              {t('headCount')}
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.04]">
          <div className="mb-1 flex min-h-[2.25rem] items-start gap-1 text-gray-600 dark:text-gray-400">
            <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="text-[11px] font-medium leading-tight">
              {t('tileStable')}
            </span>
          </div>
          <div className="text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {hasData ? flat : '—'}
            <span className="ml-0.5 text-xs font-normal text-gray-600 dark:text-gray-400">
              {t('headCount')}
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-orange-50/60 p-3 dark:bg-orange-500/[0.08]">
          <div className="mb-1 flex min-h-[2.25rem] items-start gap-1 text-orange-700 dark:text-orange-300">
            <TrendingDown className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="text-[11px] font-medium leading-tight">
              {t('tileNeedsSupport')}
            </span>
          </div>
          <div className="text-xl font-semibold tabular-nums text-orange-900 dark:text-orange-200">
            {hasData ? down : '—'}
            <span className="ml-0.5 text-xs font-normal text-orange-700 dark:text-orange-300">
              {t('headCount')}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-black/5 pt-3 dark:border-white/5">
        <div className="mb-2 text-[11px] text-muted-foreground">
          {t('focusAreasHeader')}
        </div>
        {hasData && topFocusAreas.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {topFocusAreas.map(([area, count]) => (
              <span
                key={area}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50/70 px-2 py-0.5 text-[11px] text-indigo-800 dark:bg-indigo-500/[0.12] dark:text-indigo-300"
              >
                {area}
                <span className="font-medium tabular-nums text-indigo-600 dark:text-indigo-300">
                  {count}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <ScaffoldHint hint={t('emptyHint')} />
        )}
      </div>
    </div>
  )
}
