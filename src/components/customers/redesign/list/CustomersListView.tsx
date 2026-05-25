'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CustomerListRow } from '../types'
import { CustomersListHeader } from './CustomersListHeader'
import { CustomerSearchInput } from './CustomerSearchInput'
import {
  CustomersStatusFilters,
  applyCustomerFilter,
  type CustomerListFilterKey,
  type CustomerListCounts,
} from './CustomersStatusFilters'
import {
  CustomersStaffFilter,
  type StaffFilterEntry,
  type StaffFilterKey,
} from './CustomersStaffFilter'
import { CustomersListPagination } from './CustomersListPagination'
import { CustomerRowDesktop } from './CustomerRowDesktop'
import { CustomerCardMobile } from './CustomerCardMobile'
import { ComingSoonChip } from '../ComingSoonChip'
import { getStaffColor } from '@/lib/staff/colors'

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
  /**
   * Full tenant staff roster (id + display name). Fed in from the server
   * page so the staff-filter pills can render every stylist, not just the
   * ones who happen to own customers in the current page of results.
   */
  staffList: StaffFilterEntry[]
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
   * The カルテ tab passes `/karute/customer` so cards land on the
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
  karuteContext = false,
  hrefBase = '/customers',
  heading,
}: CustomersListViewProps) {
  const t = useTranslations('customers.list')
  const tCustomers = useTranslations('customers')
  const [statusFilter, setStatusFilter] = useState<CustomerListFilterKey>('all')
  const [staffFilter, setStaffFilter] = useState<StaffFilterKey>('all')
  const [page, setPage] = useState(0)

  // Reset to page 1 whenever the filter changes — otherwise switching
  // to a smaller result set could leave the viewer stranded on an
  // out-of-range page (or worse, an apparently empty list).
  useEffect(() => {
    setPage(0)
  }, [statusFilter, staffFilter, query])

  const counts: CustomerListCounts = useMemo(() => {
    const since30 = new Date()
    since30.setDate(since30.getDate() - 30)
    return {
      all: rows.length,
      preferredStaff: selfStaffId
        ? rows.filter((r) => r.preferredStaffId === selfStaffId).length
        : 0,
      newRecent: rows.filter(
        (r) => r.joinDateIso && new Date(r.joinDateIso) >= since30,
      ).length,
      followup: rows.filter((r) => r.status === 'needs-followup').length,
      dormant: rows.filter((r) => r.status === 'dormant').length,
    }
  }, [rows, selfStaffId])

  // Filter composition: status filter (existing) AND staff filter (new).
  // Order doesn't matter for correctness — both are simple predicates.
  const filteredRows = useMemo(() => {
    const indices = applyCustomerFilter(rows, statusFilter, selfStaffId)
    const afterStatus = indices.map((i) => rows[i])
    if (staffFilter === 'all') return afterStatus
    const targetId = staffFilter === 'self' ? selfStaffId : staffFilter
    if (!targetId) return afterStatus
    return afterStatus.filter((r) => r.preferredStaffId === targetId)
  }, [rows, statusFilter, selfStaffId, staffFilter])

  // Slice the filtered list into the current page's window. `page` is
  // clamped against the latest filtered length so a stale state can't
  // render an empty middle page after a filter change.
  const pagedRows = useMemo(() => {
    const start = page * PAGE_SIZE
    return filteredRows.slice(start, start + PAGE_SIZE)
  }, [filteredRows, page])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 pt-0 pb-6 md:gap-4 md:pb-6">
      <CustomersListHeader
        total={totalRegistered}
        showing={filteredRows.length}
        heading={heading}
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

      <CustomersStatusFilters
        active={statusFilter}
        onChange={setStatusFilter}
        counts={counts}
      />

      {filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">
            {query ? t('noMatch', { query }) : tCustomers('empty.title')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {query ? t('noMatchHint') : tCustomers('empty.description')}
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
                staffColor={getStaffColor(c.preferredStaffId)}
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
                staffColor={getStaffColor(c.preferredStaffId)}
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
