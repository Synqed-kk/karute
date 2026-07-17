'use client'

// 案D's stat header (Liam-approved): the top block of Kitano's hand-maintained
// 顧客管理 sheet — 予約なし N件(%) · 残数 · 未消化 ¥ — transplanted above
// the list. He pinned these three numbers at the top of his sheet; here they
// are computed live from the rows already in memory (zero extra queries) and
// the tappable ones TAP to filter the list to their members (tap again to clear).
//
// 残数 bits (Liam-approved mock, 7/17, from Kitano's 6/30 ask): the old single
// 残り1回 stat is now three smaller tappable bits — 残１/残２/残３ N人 — each an
// exact remaining-count filter. They are a SEPARATE dimension from the status
// filter (multi-select union), so 残１ × 予約なし composes — the combo the
// sheet could never answer.
//
// Honesty gates: the pack stats (残数, 未消化) hide until pack data exists
// (pre-import they'd read a confident-but-false 0). 予約なし is real today.

import { useTranslations } from 'next-intl'
import type { CustomerListFilterKey } from './CustomersStatusFilters'
import { PACK_REMAINING_OPTIONS } from './CustomersStatusFilters'

export interface ListStats {
  total: number
  noBooking: number
  unconsumedTotal: number
  /** Any pack data at all? false pre-import → pack stats hide. */
  hasPackData: boolean
  /** Booking enrichment actually loaded? When the synqed-core env is missing,
   *  enrichment silently returns empty → every row reads 予約なし → the strip
   *  would confidently claim 100%. Same honesty gate as the pack stats. */
  hasBookingData: boolean
}

export function CustomerListStatsStrip({
  stats,
  active,
  onSelect,
  packCounts,
  packFilter,
  onPackToggle,
}: {
  stats: ListStats
  active: CustomerListFilterKey
  onSelect: (key: CustomerListFilterKey) => void
  /** Count of customers at exactly n remaining, keyed by PACK_REMAINING_OPTIONS. */
  packCounts: Record<number, number>
  packFilter: ReadonlySet<number>
  onPackToggle: (n: number) => void
}) {
  const t = useTranslations('customers.list.stats')
  if (stats.total === 0) return null
  const showNoBooking = stats.hasBookingData || active === 'noBooking'
  // Group stays visible while any 残n filter is active even if pack data
  // vanishes — otherwise the only tap-to-clear control disappears mid-use
  // (same guard the hide-when-zero pills use).
  const showPackRemaining = stats.hasPackData || packFilter.size > 0
  const showUnconsumed = stats.hasPackData && stats.unconsumedTotal > 0
  if (!showNoBooking && !showPackRemaining && !showUnconsumed) return null
  const pct = Math.round((stats.noBooking / stats.total) * 100)
  const toggle = (key: CustomerListFilterKey) =>
    onSelect(active === key ? 'all' : key)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] tabular-nums">
      {showNoBooking && (
      <button
        type="button"
        aria-pressed={active === 'noBooking'}
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
      )}
      {/* 未消化 keeps its ORIGINAL spot — line 1 right (案① Liam 7/17): on
       *  mobile the 残数 bits break to their own second line (order+basis),
       *  so no lone right-floated amount; ≥md everything fits one line. */}
      {showUnconsumed && (
        // ml-auto only while 予約なし is there to balance it — if the booking
        // stat hides (honesty gate), a right-floated lone amount would
        // recreate the orphan this layout exists to avoid (Greptile P1).
        <span
          className={`order-2 font-semibold text-foreground md:order-3 md:ml-auto ${
            showNoBooking ? 'ml-auto' : ''
          }`}
        >
          {t('unconsumed', {
            amount: stats.unconsumedTotal.toLocaleString('ja-JP'),
          })}
        </span>
      )}
      {/* 残１/残２/残３ — slightly smaller than 予約なし (Liam: "make the
       *  current one smaller too"); active = the strip's existing underline
       *  treatment. Counts render in foreground-black (same rule as the
       *  未消化 amount: orange = the tappable word, black = the number —
       *  Liam 7/17, the all-amber bits blended together). Individual bits
       *  never hide at 0 so the row doesn't jump around while filtering. */}
      {showPackRemaining && (
        <span className="order-3 inline-flex basis-full items-baseline gap-3 text-[10px] md:order-2 md:basis-auto">
          {PACK_REMAINING_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={packFilter.has(n)}
              onClick={() => onPackToggle(n)}
              className={`inline-flex items-baseline gap-1 rounded transition-colors ${
                packFilter.has(n) ? 'underline underline-offset-2' : ''
              }`}
            >
              <span
                className={`font-semibold ${
                  packFilter.has(n)
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-amber-600/90 dark:text-amber-400'
                }`}
              >
                {t(`packRemainingLabel${n}`)}
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {t('packRemainingCount', { n: packCounts[n] ?? 0 })}
              </span>
            </button>
          ))}
        </span>
      )}
    </div>
  )
}
