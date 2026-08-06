'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { usePathname, useRouter } from '@/i18n/navigation'
import type { CustomerListRow } from '../types'
import { CustomersListHeader } from './CustomersListHeader'
import { CustomerSearchInput } from './CustomerSearchInput'
import {
  CustomersStatusFilters,
  applyCustomerFilter,
  applyPackRemainingFilter,
  PACK_REMAINING_OPTIONS,
  type CustomerListFilterKey,
  type CustomerListCounts,
} from './CustomersStatusFilters'
import {
  CustomerListStatsStrip,
  type ListStats,
} from './CustomerListStatsStrip'
import {
  CustomersStaffFilter,
  type StaffFilterEntry,
  type StaffFilterKey,
} from './CustomersStaffFilter'
import { CustomersListPagination } from './CustomersListPagination'
import { CustomerRowDesktop } from './CustomerRowDesktop'
import { CustomerCardMobile } from './CustomerCardMobile'
import { ComingSoonChip } from '../ComingSoonChip'
import { assignStaffColors } from '@/lib/staff-colors'

/**
 * Cards per page. 12 matches the design spike's footer pagination
 * ("24名中 1〜12名を表示"). Works on both mobile (avoids long scroll)
 * and desktop (table stays compact above the fold). Server already
 * fetches up to 500 customers per page-load, so pagination is
 * purely client-side slicing.
 */
const PAGE_SIZE = 12

interface CustomersListViewProps {
  rows: CustomerListRow[]
  totalRegistered: number
  query: string
  selfStaffId: string | null
  /** Booking enrichment loaded? false → the 予約なし stat hides (honesty gate). */
  bookingDataAvailable?: boolean
  /**
   * Per-customer 今月消化 yen (this month-to-date + previous month same
   * window), keyed by customer id. null = burn data unavailable → the strip
   * hides the stat (honesty gate — a partial sum must never render).
   */
  burnByCustomer?: Record<string, { mtd: number; prev: number }> | null
  /**
   * Customers whose in-window burns could not be priced (orphaned packs).
   * The stat hides in any view that CONTAINS one of them (its sum would be
   * partial); views without them stay exact.
   */
  burnUnpricedIds?: string[]
  /**
   * Full tenant staff roster (id + display name). Fed in from the server
   * page so the staff-filter pills can render every stylist, not just the
   * ones who happen to own customers in the current page of results.
   */
  staffList: StaffFilterEntry[]
  /**
   * 指名スタッフ roster for CustomerSheet's "+ 新規顧客" dialog. Passed
   * EXPLICITLY by each mount (web page / thin screen) as the FULL tenant
   * roster — never derived from `staffList`, which the web page store-clamps
   * for the 担当 filter pills. 指名 can point at any staff in the tenant,
   * matching the profile-edit dialog's behavior.
   */
  assignableStaff: { id: string; name: string }[]
  /**
   * When `true`, every customer card renders an AI-status chip row
   * underneath the contact line (体調予測 / 推奨 / 要約 / 録音, all
   * 対応予定). Used by the カルテ tab to frame the same customer
   * list as karute folders. Defaults to false on the 顧客 tab so
   * the CRM view stays compact.
   */
  karuteContext?: boolean
  /**
   * URL base for each card's tap target. Defaults to `/customers`
   * so 顧客-tab cards land on the customer profile (with tabs).
   * No production caller overrides this today (カルテ tab Phase B); /customers cards land on the
   * karute-detail page (vertical stack, spike's layout).
   */
  hrefBase?: string
  /**
   * Page heading override (rendered in CustomersListHeader). Defaults
   * to the customer-list heading; the カルテ tab passes its own so
   * the page identity matches the bottom-nav tab the user came from.
   */
  heading?: string
}

export function CustomersListView({
  rows,
  totalRegistered,
  query,
  selfStaffId,
  staffList,
  assignableStaff,
  bookingDataAvailable = true,
  burnByCustomer = null,
  burnUnpricedIds = [],
  karuteContext = false,
  hrefBase = '/customers',
  heading,
}: CustomersListViewProps) {
  const t = useTranslations('customers.list')
  const tCustomers = useTranslations('customers')
  // List state lives in the URL (?f=&s=&p=) via replace — no history spam,
  // no scroll jump — so the BACK button restores the exact page + filters the
  // staff left (Liam: "go into a card, come back, don't reset me to page 1").
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const VALID_FILTERS: CustomerListFilterKey[] = [
    'all', 'newRecent', 'followup', 'dormant', 'noBooking',
  ]
  const [statusFilter, setStatusFilter] = useState<CustomerListFilterKey>(() => {
    const f = searchParams.get('f') as CustomerListFilterKey | null
    return f && VALID_FILTERS.includes(f) ? f : 'all'
  })
  const [staffFilter, setStaffFilter] = useState<StaffFilterKey>(
    () => (searchParams.get('s') as StaffFilterKey | null) ?? 'all',
  )
  // 残数 chips (?r=1,3) — multi-select union over exact remaining counts.
  const [packFilter, setPackFilter] = useState<ReadonlySet<number>>(() => {
    // Legacy ?f=packLow (the pre-redesign 残り1回 stat wrote it) migrates to
    // the 残１ bit — an old bookmark keeps filtering AND keeps a visible,
    // tap-to-clear control instead of silently narrowing the list.
    if (searchParams.get('f') === 'packLow') return new Set([1])
    const r = searchParams.get('r')
    if (!r) return new Set()
    const valid: readonly number[] = PACK_REMAINING_OPTIONS
    return new Set(r.split(',').map(Number).filter((n) => valid.includes(n)))
  })
  const togglePackFilter = (n: number) =>
    setPackFilter((prev) => {
      const next = new Set(prev)
      if (!next.delete(n)) next.add(n)
      return next
    })
  const [page, setPage] = useState(() =>
    Math.max(0, (parseInt(searchParams.get('p') ?? '1', 10) || 1) - 1),
  )
  useEffect(() => {
    const next = new URLSearchParams(window.location.search)
    if (page > 0) next.set('p', String(page + 1))
    else next.delete('p')
    if (statusFilter !== 'all') next.set('f', statusFilter)
    else next.delete('f')
    if (staffFilter !== 'all') next.set('s', String(staffFilter))
    else next.delete('s')
    if (packFilter.size > 0) next.set('r', [...packFilter].sort().join(','))
    else next.delete('r')
    const qs = next.toString()
    router.replace((pathname + (qs ? `?${qs}` : '')) as never, { scroll: false })
  }, [page, statusFilter, staffFilter, packFilter, pathname, router])

  // Reset to page 1 whenever the filter changes — otherwise switching
  // to a smaller result set could leave the viewer stranded on an
  // out-of-range page (or worse, an apparently empty list).
  useEffect(() => {
    setPage(0)
  }, [statusFilter, staffFilter, packFilter, query])

  // DISTINCT staff-color map, derived from the FULL tenant roster (the same
  // `staffList` that feeds the staff-filter pills). Computing it once here —
  // off the complete roster, not the current page — guarantees the assignment
  // is collision-free and identical to the filter pills + every other surface.
  // Each card looks up its own key by the displayed 担当 (指名 → booking).
  const staffColors = useMemo(
    () => assignStaffColors(staffList.map((s) => s.id)),
    [staffList],
  )

  // Counts come from THE SAME predicate the filter uses (applyCustomerFilter)
  // — the pill number and the filtered list can never disagree. Previously the
  // predicates were hand-duplicated here and had already drifted (the 新規 pill
  // counted by join date alone → 192/192 after the bulk import).
  // ── Faceted counts (Liam 7/17: every number = "what happens if I tap
  // this?", nothing frozen at business-wide totals while filters are on).
  // Convention: a control's count is computed with every OTHER dimension's
  // active filter applied, but NOT its own dimension — so within a dimension
  // you always see what switching would give you. The three dimensions are
  // status (segments + 予約なし), 残数 (bits, multi-select) and staff; the
  // search query is already applied server-side to `rows`, so every count
  // inherits it. INVARIANT (pinned by tests): tapping a control with count N
  // yields exactly N rows, given the other current selections.

  // Match the DISPLAYED 担当: a customer's 指名 (preferredStaffId) if set,
  // else the staff on their booking (bookingStaffId). Without the fallback
  // the pills filtered on 指名 only — so QR-synced customers (no 指名, but a
  // real booking staff) dropped out of every specific-staff filter even
  // though their card shows that staff as 担当.
  const staffRows = useMemo(() => {
    if (staffFilter === 'all') return rows
    const targetId = staffFilter === 'self' ? selfStaffId : staffFilter
    if (!targetId) return rows
    return rows.filter(
      (r) => (r.preferredStaffId ?? r.bookingStaffId) === targetId,
    )
  }, [rows, staffFilter, selfStaffId])

  // Status-dimension counts (segments + 予約なし): staff ∧ 残数 applied.
  const rowsForStatusCounts = useMemo(
    () => applyPackRemainingFilter(staffRows, packFilter),
    [staffRows, packFilter],
  )
  const counts: CustomerListCounts = useMemo(
    () => ({
      all: rowsForStatusCounts.length,
      newRecent: applyCustomerFilter(rowsForStatusCounts, 'newRecent').length,
      followup: applyCustomerFilter(rowsForStatusCounts, 'followup').length,
      dormant: applyCustomerFilter(rowsForStatusCounts, 'dormant').length,
      noBooking: applyCustomerFilter(rowsForStatusCounts, 'noBooking').length,
    }),
    [rowsForStatusCounts],
  )
  // Existence baseline from the UNFILTERED set: 要フォロー/休眠 segments hide
  // only when the status doesn't exist at all (pre-import), never because the
  // current slice happens to hit 0 — otherwise segments would vanish and the
  // bar would reflow mid-filtering.
  const baselineCounts = useMemo(
    () => ({
      followup: applyCustomerFilter(rows, 'followup').length,
      dormant: applyCustomerFilter(rows, 'dormant').length,
    }),
    [rows],
  )

  // 残数-dimension counts (bits): staff ∧ status applied. Buckets are
  // disjoint, so with multi-select the visible list is exactly the sum of
  // the selected bits' counts.
  const rowsForPackCounts = useMemo(
    () =>
      applyCustomerFilter(staffRows, statusFilter).map((i) => staffRows[i]),
    [staffRows, statusFilter],
  )
  const packCounts = useMemo(() => {
    const m: Record<number, number> = {}
    for (const n of PACK_REMAINING_OPTIONS)
      m[n] = rowsForPackCounts.filter((r) => r.pack?.remaining === n).length
    return m
  }, [rowsForPackCounts])

  // Full view: all three dimensions.
  const filteredRows = useMemo(
    () => applyPackRemainingFilter(rowsForPackCounts, packFilter),
    [rowsForPackCounts, packFilter],
  )

  // Kitano's sheet-top stats. 未消化 ¥ follows the CURRENT view (the stranded
  // money in what you're looking at — 残１×予約なし shows the call-list's yen,
  // not the shop total); the 予約なし % denominator is the status-dimension
  // scope. globalTotal + the honesty gates stay UNFILTERED — they gate
  // whether surfaces render at all and must not vanish mid-filter.
  const stats: ListStats = useMemo(
    () => ({
      globalTotal: rows.length,
      scopedTotal: rowsForStatusCounts.length,
      noBooking: counts.noBooking,
      unconsumedTotal: filteredRows.reduce(
        (sum, r) => sum + (r.pack?.unconsumed ?? 0),
        0,
      ),
      // 今月消化 follows the same view-scoping rule as 未消化: the yen the
      // CURRENTLY visible customers burned, so both ¥ figures describe the
      // same list (faceted-counts contract, #534).
      burnMtd: burnByCustomer
        ? filteredRows.reduce((sum, r) => sum + (burnByCustomer[r.id]?.mtd ?? 0), 0)
        : 0,
      burnPrev: burnByCustomer
        ? filteredRows.reduce((sum, r) => sum + (burnByCustomer[r.id]?.prev ?? 0), 0)
        : 0,
      hasBurnData: burnByCustomer != null,
      // View-scoped honesty gate: an unpriceable customer IN this view makes
      // its sum partial → hide. Out of view, the sum stays exact → show.
      burnUnpriceable:
        burnUnpricedIds.length > 0 &&
        (() => {
          const unpriced = new Set(burnUnpricedIds)
          return filteredRows.some((r) => unpriced.has(r.id))
        })(),
      hasPackData: rows.some((r) => r.pack != null),
      hasBookingData: bookingDataAvailable,
    }),
    [rows, rowsForStatusCounts.length, counts.noBooking, filteredRows, bookingDataAvailable, burnByCustomer, burnUnpricedIds],
  )

  // Slice the filtered list into the current page's window. `page` is
  // clamped against the latest filtered length so a stale state can't
  // render an empty middle page after a filter change.
  const pagedRows = useMemo(() => {
    const start = page * PAGE_SIZE
    return filteredRows.slice(start, start + PAGE_SIZE)
  }, [filteredRows, page])

  return (
    // Owns its own px-4 md:px-6 — the (app) layout provides no horizontal
    // padding now (system rule). Matches the spike's customer list page
    // which wraps with px-4 md:px-8; using md:px-6 here for consistency
    // with reservation + karute customer detail conventions.
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-0 pb-6 md:gap-4 md:px-6 md:pb-6">
      <CustomersListHeader
        total={totalRegistered}
        showing={filteredRows.length}
        heading={heading}
        assignableStaff={assignableStaff}
      />

      {/* Order mirrors the design spike: staff scope first (who am I
       *  looking at?), THEN search inside that scope, THEN status
       *  filter to narrow further. */}
      <CustomersStaffFilter
        staffList={staffList}
        selfStaffId={selfStaffId}
        selected={staffFilter}
        onChange={setStaffFilter}
      />

      <CustomerSearchInput initialQuery={query} />

      {/* Kitano's daily read (案D): 予約なし N件(%) · 残り1回 N人 · 未消化 ¥ —
       *  the sheet's pinned top block, tappable to filter. */}
      <CustomerListStatsStrip
        stats={stats}
        active={statusFilter}
        onSelect={setStatusFilter}
        packCounts={packCounts}
        packFilter={packFilter}
        onPackToggle={togglePackFilter}
      />

      <CustomersStatusFilters
        active={statusFilter}
        onChange={setStatusFilter}
        counts={counts}
        baselineCounts={baselineCounts}
      />

      {filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          {/* Three empty states, not two: a filter that matches nobody must
           *  NOT show the first-run onboarding copy (「最初の顧客を作成…」)
           *  while 450 customers exist — it shows "no match, clear filters"
           *  (reachable via a 0-count 残n bit or an empty staff filter). */}
          <p className="text-sm font-medium text-foreground">
            {query
              ? t('noMatch', { query })
              : rows.length > 0
                ? t('filterNoMatch')
                : tCustomers('empty.title')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {query || rows.length > 0
              ? t('noMatchHint')
              : tCustomers('empty.description')}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table — column template kept in lock-step with CustomerRowDesktop */}
          <div className="hidden overflow-hidden rounded-2xl border border-border/60 bg-card md:block">
            <div className="grid grid-cols-[minmax(0,2fr)_130px_110px_120px_160px_60px] items-center gap-3 border-b border-border px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{t('col.customer')}</span>
              <span>{t('col.lastVisit')}</span>
              <span className="flex items-center gap-1.5">
                {t('col.recommend')}
                <ComingSoonChip />
              </span>
              <span>{t('col.status')}</span>
              <span>{t('col.staff')}</span>
              <span className="text-right">{t('col.total')}</span>
            </div>
            {pagedRows.map((c) => (
              <CustomerRowDesktop
                key={c.id}
                c={c}
                staffColorKey={
                  staffColors.get(c.preferredStaffId ?? c.bookingStaffId ?? '')
                    ?.key ?? null
                }
                karuteContext={karuteContext}
                hrefBase={hrefBase}
              />
            ))}
          </div>

          {/* Mobile list — rows separate via their own border-b. Sits
           *  inside the layout's 16px horizontal padding so the rounded
           *  card has breathing room from the screen edges, matching the
           *  design spike (cards inset, not bleeding). */}
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card md:hidden">
            {pagedRows.map((c) => (
              <CustomerCardMobile
                key={c.id}
                c={c}
                staffColorKey={
                  staffColors.get(c.preferredStaffId ?? c.bookingStaffId ?? '')
                    ?.key ?? null
                }
                karuteContext={karuteContext}
                hrefBase={hrefBase}
              />
            ))}
          </div>

          <CustomersListPagination
            total={filteredRows.length}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
