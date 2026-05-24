'use client'

import { useMemo, useState } from 'react'
import type { CustomerListRow } from '../types'
import { CustomersListHeader } from './CustomersListHeader'
import { CustomerSearchInput } from './CustomerSearchInput'
import {
  CustomersStatusFilters,
  applyCustomerFilter,
  type CustomerListFilterKey,
  type CustomerListCounts,
} from './CustomersStatusFilters'
import { CustomerRowDesktop } from './CustomerRowDesktop'
import { CustomerCardMobile } from './CustomerCardMobile'
import { ComingSoonChip } from '../ComingSoonChip'
import { getStaffColor } from '@/lib/staff/colors'

interface CustomersListViewProps {
  rows: CustomerListRow[]
  totalRegistered: number
  query: string
  selfStaffId: string | null
}

export function CustomersListView({
  rows,
  totalRegistered,
  query,
  selfStaffId,
}: CustomersListViewProps) {
  const [statusFilter, setStatusFilter] = useState<CustomerListFilterKey>('all')

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

  const visibleRows = useMemo(() => {
    const indices = applyCustomerFilter(rows, statusFilter, selfStaffId)
    return indices.map((i) => rows[i])
  }, [rows, statusFilter, selfStaffId])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <CustomersListHeader
        total={totalRegistered}
        showing={visibleRows.length}
      />

      <CustomerSearchInput initialQuery={query} />

      <CustomersStatusFilters
        active={statusFilter}
        onChange={setStatusFilter}
        counts={counts}
      />

      {visibleRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">
            {query ? `No customers match "${query}"` : 'No customers'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {query
              ? 'Try a different search term or clear filters.'
              : 'Add a new customer to get started.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table — column template kept in lock-step with CustomerRowDesktop */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:block">
            <div className="grid grid-cols-[minmax(0,2fr)_130px_110px_120px_160px_60px] items-center gap-3 border-b border-border px-4 py-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Customer</span>
              <span>Last visit</span>
              <span className="flex items-center gap-1.5">
                Recommend
                <ComingSoonChip />
              </span>
              <span>Status</span>
              <span>Staff</span>
              <span className="text-right">Total</span>
            </div>
            {visibleRows.map((c) => (
              <CustomerRowDesktop
                key={c.id}
                c={c}
                staffColor={getStaffColor(c.preferredStaffId)}
              />
            ))}
          </div>

          {/* Mobile list — rows separate via their own border-b */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:hidden">
            {visibleRows.map((c) => (
              <CustomerCardMobile
                key={c.id}
                c={c}
                staffColor={getStaffColor(c.preferredStaffId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
