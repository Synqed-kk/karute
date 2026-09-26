'use client'

import { ChevronDown } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { CustomerStatusKey } from '../types'
import { ComingSoonChip } from '../ComingSoonChip'
import { SegmentedFilterBar, type WidthSteps } from './SegmentedFilterBar'

export type CustomerListFilterKey =
  | 'all'
  | 'newRecent'
  | 'followup'
  | 'dormant'
  // Stat-strip filter (案D header): entered by tapping the 予約なし stat.
  // The old 'packLow' key is gone — the strip's 残１/残２/残３ bits (a separate
  // packFilter dimension) replaced it; legacy ?f=packLow URLs migrate to the
  // 残１ bit at parse time in CustomersListView.
  | 'noBooking'

export interface CustomerListCounts {
  all: number
  newRecent: number
  followup: number
  dormant: number
  noBooking: number
}

// 残数 quick filters (6/30 Kitano meeting): exact remaining-ticket counts,
// multi-select union — tapping 残1+残2+残3 together is his「3回未満」population.
// A dimension SEPARATE from the status filter so 残1 × 予約なし composes (the
// combo the sheet could never answer: "残1 で予約なしの人は誰？").
export const PACK_REMAINING_OPTIONS = [1, 2, 3] as const

export function applyPackRemainingFilter<
  T extends { pack?: { remaining: number } | null },
>(rows: T[], selected: ReadonlySet<number>): T[] {
  if (selected.size === 0) return rows
  return rows.filter((r) => r.pack != null && selected.has(r.pack.remaining))
}

interface CustomersStatusFiltersProps {
  active: CustomerListFilterKey
  onChange: (key: CustomerListFilterKey) => void
  /** Contextual counts: staff ∧ 残数 applied (the faceted "tap = get N" numbers). */
  counts: CustomerListCounts
  /** UNFILTERED existence counts — drive hide-when-zero so segments never
   *  vanish (and the bar never reflows) just because the current slice hits 0. */
  baselineCounts: { followup: number; dormant: number }
}

// 指名あり removed by design (Liam, proposal ②): mislabeled (it counted
// "nominated ME", not "has a nomination") and structurally dead (QR sync never
// writes assigned_staff_id) — the 自分 staff pill already covers "my customers".
// The filter logic stays; only the pill is gone.
const FILTER_KEYS = [
  'all',
  'newRecent',
  'followup',
  'dormant',
] as const satisfies readonly CustomerListFilterKey[]

// Pills that hide while their count is 0 (proposal ②): a confident「休眠 0」
// reads as "no dormant customers", which is false while the data simply isn't
// imported yet. They reappear automatically at the first nonzero count.
const HIDE_WHEN_ZERO: ReadonlySet<CustomerListFilterKey> = new Set([
  'followup',
  'dormant',
])

/** The urgent word (要対応 family) — the status that asks a person to act:
 *  要フォロー (`needs-followup`). Step B keeps its count. */
const CUSTOMER_URGENT: readonly CustomerListFilterKey[] = ['followup']

/** ⚖ FIT BY DESIGN (04:2x): the track's width steps, per language, chosen
 *  from the real longest labels in the app's own fonts (all four words, a
 *  4-digit すべて, 3 digits on 要フォロー/休眠, 2 on 新規) and locked by the fit
 *  test (scripts/fit-harness/run.mjs). Viewport px = labels + counts + 4px
 *  label↔count + per-segment px-2 (→ px-1.5) + 38 + 4 margin:
 *          all counts   all, tight   urgent-only   urgent, tight   slide
 *    ja    ≥ 336        320–336      265–320       253–265         < 253
 *    en    ≥ 385        369–385      315–369       299–315         < 299
 *  (labels ja 136 / en 185 — Needs follow-up is 95; counts 77.7.) So every
 *  phone width shows every count in Japanese; English tightens at 375. */
const CUSTOMER_WORD_STEPS: Record<'ja' | 'en', WidthSteps> = {
  ja: {
    row: 'max-[253px]:overflow-x-auto max-[253px]:[scrollbar-width:none]',
    item: 'min-[320px]:max-[336px]:px-1.5 min-[253px]:max-[265px]:px-1.5 max-[253px]:shrink-0',
    count: 'max-[320px]:hidden',
  },
  en: {
    row: 'max-[299px]:overflow-x-auto max-[299px]:[scrollbar-width:none]',
    item: 'min-[369px]:max-[385px]:px-1.5 min-[299px]:max-[315px]:px-1.5 max-[299px]:shrink-0',
    count: 'max-[369px]:hidden',
  },
}

export function CustomersStatusFilters({
  active,
  onChange,
  counts,
  baselineCounts,
}: CustomersStatusFiltersProps) {
  const t = useTranslations('customers.list')
  const locale = useLocale()
  // 案A (Liam, 7/17): segmented bar via the shared SegmentedFilterBar. Label
  // qualifiers（30日以内／90日以上）dropped for width — the biggest single
  // win; staff learn the definition once. Hide-when-zero (proposal ②) keys
  // off the UNFILTERED baseline: a segment disappears only when its status
  // doesn't exist in the data at all, never because the current 残数/staff
  // slice hits 0 — the displayed count itself is contextual and may be 0.
  const segments = FILTER_KEYS.filter(
    (key) =>
      !(
        HIDE_WHEN_ZERO.has(key) &&
        baselineCounts[key as 'followup' | 'dormant'] === 0 &&
        active !== key
      ),
  ).map((key) => ({ key, label: t(`filters.${key}`), count: counts[key] }))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedFilterBar
        segments={segments}
        active={active}
        onChange={onChange}
        steps={CUSTOMER_WORD_STEPS[locale === 'en' ? 'en' : 'ja']}
        urgent={CUSTOMER_URGENT}
      />
      <div className="hidden items-center gap-2 md:inline-flex">
        <button
          type="button"
          className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground opacity-60"
          title="Coming soon — sort UX not wired"
          disabled
        >
          <span className="text-muted-foreground/70">Sort:</span>
          <span>Last visit (recent)</span>
          <ChevronDown size={14} />
        </button>
        <ComingSoonChip />
      </div>
    </div>
  )
}

export function applyCustomerFilter(
  rows: Array<{
    status: CustomerStatusKey
    joinDateIso: string | null
    preferredStaffId: string | null
    nextBookingDate?: string | null
  }>,
  filter: CustomerListFilterKey,
): Array<number> {
  // Returns the indices of rows matching the filter so the caller can map.
  const out: number[] = []
  const since30 = new Date()
  since30.setDate(since30.getDate() - 30)
  rows.forEach((r, i) => {
    if (filter === 'all') out.push(i)
    else if (filter === 'newRecent') {
      // status==='new' is the resolver's verdict (returning customers are
      // excluded) — without it, a bulk import where created_at = sync date
      // made ALL 192 customers count as 新規(30日以内) while their card chips
      // correctly said 継続中.
      if (
        r.status === 'new' &&
        r.joinDateIso &&
        new Date(r.joinDateIso) >= since30
      )
        out.push(i)
    } else if (filter === 'followup') {
      if (r.status === 'needs-followup') out.push(i)
    } else if (filter === 'dormant') {
      if (r.status === 'dormant') out.push(i)
    } else if (filter === 'noBooking') {
      // Kitano's #1 sheet stat: customers with no upcoming booking — but only
      // those still IN PLAY (卒業/離客 are closed cases, not rebook targets).
      if (
        !r.nextBookingDate &&
        r.status !== 'graduated' &&
        r.status !== 'lost'
      )
        out.push(i)
    }
  })
  return out
}
