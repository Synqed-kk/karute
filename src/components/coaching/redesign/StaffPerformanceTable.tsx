'use client'

// ─────────────────────────────────────────────────────────────
// StaffPerformanceTable — owner dashboard Row 3
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/StaffPerformanceTable.tsx
// (~166 lines). Visual preserved 1:1 — desktop fixed-column
// table + mobile card-per-row.
//
// PRIVACY: Layer 2 — aggregate metrics only. No session-level
// data. focusAreas reduced to categorical labels.
//
// CONSENT GATE: each row links to /coaching/staff/[id] which
// only renders for staff who have granted consent. Owner can
// see the row in this table regardless (aggregate is Layer 2)
// but the drill-down is gated.
//
// DATA SOURCE (when wired):
//   useStaffPerformanceData().staff → full list of StaffPerformance.

import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight, Crown, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'

import type { GrowthTrend, StaffPerformance } from './owner-types'

import { ScaffoldHint } from './ScaffoldHint'

interface StaffPerformanceTableProps {
  staff?: StaffPerformance[] | null
}

function TrendIcon({ trend }: { trend: GrowthTrend }) {
  if (trend === 'up')
    return <TrendingUp className="size-3.5 text-green-600 dark:text-green-300" />
  if (trend === 'down')
    return (
      <TrendingDown className="size-3.5 text-orange-600 dark:text-orange-300" />
    )
  return <Minus className="size-3.5 text-gray-400 dark:text-gray-500" />
}

function trendColor(trend: GrowthTrend): string {
  if (trend === 'up') return 'text-green-700 dark:text-green-300'
  if (trend === 'down') return 'text-orange-700 dark:text-orange-300'
  return 'text-gray-500 dark:text-gray-400'
}

export function StaffPerformanceTable({
  staff = null,
}: StaffPerformanceTableProps) {
  const t = useTranslations('coaching.owner.staffTable')
  const locale = useLocale()
  const items = staff ?? []
  const hasItems = items.length > 0

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-black/5 shadow-sm dark:ring-white/10">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-white/10 md:items-center">
        <h3 className="text-sm font-semibold">{t('cardTitle')}</h3>
        <span className="text-[11px] text-muted-foreground">
          {hasItems
            ? t('headerSummary', { n: items.length })
            : t('headerSummaryEmpty')}
        </span>
      </div>

      {!hasItems ? (
        <div className="p-5">
          <ScaffoldHint hint={t('emptyHint')} />
        </div>
      ) : (
        <>
          {/* Desktop: fixed-column table */}
          <div className="hidden md:block">
            <div className="flex items-center gap-4 border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
              <div className="w-8" aria-hidden />
              <div className="min-w-0 flex-1">{t('colStaff')}</div>
              <div className="w-[72px] text-right">{t('colClosing')}</div>
              <div className="w-[72px] text-right">{t('colRebooking')}</div>
              <div className="w-[88px] text-right">{t('colRevenue')}</div>
              <div className="w-[64px] text-right">{t('colSatisfaction')}</div>
              <div className="w-[88px] text-right">{t('colTrend')}</div>
              <div className="w-5" aria-hidden />
            </div>
            {items.map((s) => (
              <Link
                key={s.staffId}
                href={`/${locale}/coaching/staff/${s.staffId}`}
                className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 transition-colors last:border-0 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-xs font-semibold text-gray-700 dark:border-white/10 dark:bg-neutral-800 dark:text-gray-300">
                  {s.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {s.name}
                    </span>
                    {s.isTopPerformer && (
                      <Crown
                        className="size-3 shrink-0 text-amber-500"
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.role} · {t('sessionsCount', { n: s.sessionsThisMonth })}
                  </div>
                </div>
                <div className="w-[72px] text-right text-sm font-medium tabular-nums">
                  {Math.round(s.closingRate * 100)}%
                </div>
                <div className="w-[72px] text-right text-sm font-medium tabular-nums">
                  {Math.round(s.rebookingRate * 100)}%
                </div>
                <div className="w-[88px] text-right text-sm tabular-nums">
                  ¥{s.avgRevenueJpy.toLocaleString('ja-JP')}
                </div>
                <div className="w-[64px] text-right text-sm tabular-nums">
                  {s.customerSatisfaction.toFixed(1)}
                </div>
                <div className="flex w-[88px] items-center justify-end gap-1 text-xs tabular-nums">
                  <TrendIcon trend={s.growthTrend} />
                  <span className={`${trendColor(s.growthTrend)} font-medium`}>
                    {s.trendDeltaPct > 0 ? '+' : ''}
                    {s.trendDeltaPct}%
                  </span>
                </div>
                <ChevronRight
                  className="size-4 shrink-0 text-gray-400 dark:text-gray-500"
                  aria-hidden
                />
              </Link>
            ))}
          </div>

          {/* Mobile: card-per-row with labeled 2x2 metric grid */}
          <div className="md:hidden">
            {items.map((s) => (
              <Link
                key={s.staffId}
                href={`/${locale}/coaching/staff/${s.staffId}`}
                className="block border-b border-gray-100 px-4 py-3 transition-colors last:border-0 active:bg-gray-50 dark:border-white/5 dark:active:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-xs font-semibold text-gray-700 dark:border-white/10 dark:bg-neutral-800 dark:text-gray-300">
                    {s.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium text-foreground">
                        {s.name}
                      </span>
                      {s.isTopPerformer && (
                        <Crown
                          className="size-3.5 shrink-0 text-amber-500"
                          aria-hidden
                        />
                      )}
                    </div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {s.role} ·{' '}
                      {t('sessionsCount', { n: s.sessionsThisMonth })}
                    </div>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-gray-400 dark:text-gray-500"
                    aria-hidden
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 pl-[calc(36px+0.75rem)] sm:grid-cols-4">
                  <MobileMetric
                    label={t('colClosing')}
                    value={`${Math.round(s.closingRate * 100)}%`}
                  />
                  <MobileMetric
                    label={t('colRebooking')}
                    value={`${Math.round(s.rebookingRate * 100)}%`}
                  />
                  <MobileMetric
                    label={t('colRevenue')}
                    value={`¥${s.avgRevenueJpy.toLocaleString('ja-JP')}`}
                  />
                  <MobileMetric
                    label={t('colSatisfaction')}
                    value={s.customerSatisfaction.toFixed(1)}
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5 pl-[calc(36px+0.75rem)] text-[12px] tabular-nums">
                  <TrendIcon trend={s.growthTrend} />
                  <span className={`${trendColor(s.growthTrend)} font-medium`}>
                    {s.trendDeltaPct > 0 ? '+' : ''}
                    {s.trendDeltaPct}%
                  </span>
                  <span className="text-muted-foreground">
                    {t('vsLastMonth')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function MobileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider leading-none text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-[14px] font-medium leading-none tabular-nums text-foreground">
        {value}
      </div>
    </div>
  )
}
