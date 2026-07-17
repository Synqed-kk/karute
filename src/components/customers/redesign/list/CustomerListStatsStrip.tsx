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
  /** UNFILTERED row count — render gate only; must not vanish mid-filter. */
  globalTotal: number
  /** Status-dimension scope (staff ∧ 残数 applied) — the 予約なし % denominator. */
  scopedTotal: number
  noBooking: number
  /** ¥ over the CURRENT view (all dimensions) — the slice's stranded money. */
  unconsumedTotal: number
  /** Any pack data at all? false pre-import → pack stats hide. UNFILTERED. */
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
  if (stats.globalTotal === 0) return null
  const showNoBooking = stats.hasBookingData || active === 'noBooking'
  // Group stays visible while any 残n filter is active even if pack data
  // vanishes — otherwise the only tap-to-clear control disappears mid-use
  // (same guard the hide-when-zero pills use).
  const showPackRemaining = stats.hasPackData || packFilter.size > 0
  const showUnconsumed = stats.hasPackData
  if (!showNoBooking && !showPackRemaining && !showUnconsumed) return null
  const pct =
    stats.scopedTotal > 0
      ? Math.round((stats.noBooking / stats.scopedTotal) * 100)
      : 0
  const toggle = (key: CustomerListFilterKey) =>
    onSelect(active === key ? 'all' : key)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] tabular-nums">
      {/* Selected = SOLID amber chip, white text (Liam 7/17: the darker-amber
       *  + underline state was too easy to miss; a background fill isn't).
       *  Constant padding on both states so toggling never shifts the row.
       *  One active language for the whole strip — 予約なし and the 残数 bits
       *  fill the same way. Red was considered and rejected: in Karute red
       *  means recording/warnings/無断, not "filter on". */}
      {/* Layout (Liam 7/17 v3): mobile line 1 = 予約なし alone (the booking
       *  stat), line 2 = the whole 回数券 story — 残数 bits left, 未消化 ¥
       *  right. Both lines end-anchored, no floating amount. ≥md it all fits
       *  one line: 予約なし · bits · 未消化 right. 未消化 is never alone on a
       *  line: showUnconsumed ⇒ hasPackData ⇒ the bits row renders. */}
      {showNoBooking && (
      <button
        type="button"
        aria-pressed={active === 'noBooking'}
        onClick={() => toggle('noBooking')}
        className={`inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 transition-colors ${
          active === 'noBooking'
            ? 'bg-amber-700 text-white dark:bg-amber-500 dark:text-amber-950'
            : 'text-amber-700/90 hover:text-amber-700 dark:text-amber-400'
        }`}
      >
        <span className="font-semibold">
          {t('noBooking', { n: stats.noBooking })}
        </span>
        {/* Full opacity on the selected chip — /80·/70 alphas measured 3.8:1
         *  (fail); hierarchy vs the label comes from weight, not opacity. */}
        <span
          className={
            active === 'noBooking' ? 'text-white dark:text-amber-950' : 'text-muted-foreground'
          }
        >
          ({pct}%)
        </span>
      </button>
      )}
      {/* Mobile line break after 予約なし (only while the 回数券 row exists) —
       *  a breaker element, NOT basis-full on the button, so the selected
       *  chip's fill hugs its text instead of painting the whole line. */}
      {showNoBooking && showPackRemaining && (
        <span aria-hidden className="basis-full md:hidden" />
      )}
      {/* 残１/残２/残３ — slightly smaller than 予約なし (Liam: "make the
       *  current one smaller too"); selected = the same solid amber chip as
       *  予約なし. Inactive counts render in foreground-black (orange = the
       *  tappable word, black = the number — Liam 7/17); on the filled chip
       *  both go white. Constant padding both states → no row shift on tap.
       *  Individual bits never hide at 0 so the row doesn't jump around. */}
      {showPackRemaining && (
        <span className="inline-flex items-baseline gap-1.5 text-[10px]">
          {PACK_REMAINING_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={packFilter.has(n)}
              onClick={() => onPackToggle(n)}
              className={`inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 transition-colors ${
                packFilter.has(n) ? 'bg-amber-700 dark:bg-amber-500' : ''
              }`}
            >
              <span
                className={`font-semibold ${
                  packFilter.has(n)
                    ? 'text-white dark:text-amber-950'
                    : 'text-amber-600/90 dark:text-amber-400'
                }`}
              >
                {t(`packRemainingLabel${n}`)}
              </span>
              <span
                className={`font-semibold tabular-nums ${
                  packFilter.has(n) ? 'text-white dark:text-amber-950' : 'text-foreground'
                }`}
              >
                {t('packRemainingCount', { n: packCounts[n] ?? 0 })}
              </span>
            </button>
          ))}
        </span>
      )}
      {/* 未消化 ¥ — right end of the 回数券 row (v3). View-scoped: the yen
       *  sum of the CURRENTLY filtered list, so 残１×予約なし reads as "the
       *  call-list is worth this much". ¥0 renders (it's a real answer for a
       *  slice), keeping the layout stable. */}
      {showUnconsumed && (
        <span className="ml-auto font-semibold text-foreground">
          {t('unconsumed', {
            amount: stats.unconsumedTotal.toLocaleString('ja-JP'),
          })}
        </span>
      )}
    </div>
  )
}
