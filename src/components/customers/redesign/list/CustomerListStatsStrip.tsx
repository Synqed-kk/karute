'use client'

// 案D's stat header (Liam-approved): the top block of Kitano's hand-maintained
// 顧客管理 sheet — 予約なし N件(%) · 残り1回 N人 · 未消化 ¥ — transplanted above
// the list. He pinned these three numbers at the top of his sheet; here they
// are computed live from the rows already in memory (zero extra queries) and
// the first two TAP to filter the list to their members (tap again to clear).
//
// Honesty gates: the pack stats (残り1回, 未消化) hide until pack data exists
// (pre-import they'd read a confident-but-false 0). 予約なし is real today.

import { useTranslations } from 'next-intl'
import type { CustomerListFilterKey } from './CustomersStatusFilters'

export interface ListStats {
  total: number
  noBooking: number
  packLow: number
  unconsumedTotal: number
  /** Any pack data at all? false pre-import → pack stats hide. */
  hasPackData: boolean
}

export function CustomerListStatsStrip({
  stats,
  active,
  onSelect,
}: {
  stats: ListStats
  active: CustomerListFilterKey
  onSelect: (key: CustomerListFilterKey) => void
}) {
  const t = useTranslations('customers.list.stats')
  if (stats.total === 0) return null
  const pct =
    stats.total > 0 ? Math.round((stats.noBooking / stats.total) * 100) : 0
  const toggle = (key: CustomerListFilterKey) =>
    onSelect(active === key ? 'all' : key)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] tabular-nums">
      <button
        type="button"
        onClick={() => toggle('noBooking')}
        className={`inline-flex items-baseline gap-1 rounded transition-colors ${
          active === 'noBooking'
            ? 'font-semibold text-amber-700 underline underline-offset-2 dark:text-amber-300'
            : 'text-amber-700/90 hover:text-amber-700 dark:text-amber-400'
        }`}
      >
        <span className="font-semibold">
          {t('noBooking', { n: stats.noBooking })}
        </span>
        <span className="text-muted-foreground">({pct}%)</span>
      </button>
      {stats.hasPackData && stats.packLow > 0 && (
        <button
          type="button"
          onClick={() => toggle('packLow')}
          className={`rounded font-semibold transition-colors ${
            active === 'packLow'
              ? 'text-amber-700 underline underline-offset-2 dark:text-amber-300'
              : 'text-amber-600/90 hover:text-amber-700 dark:text-amber-400'
          }`}
        >
          {t('packLow', { n: stats.packLow })}
        </button>
      )}
      {stats.hasPackData && stats.unconsumedTotal > 0 && (
        <span className="ml-auto font-semibold text-foreground">
          {t('unconsumed', {
            amount: stats.unconsumedTotal.toLocaleString('ja-JP'),
          })}
        </span>
      )}
    </div>
  )
}
