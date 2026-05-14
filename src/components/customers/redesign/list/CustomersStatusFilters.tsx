'use client'

import { ChevronDown } from 'lucide-react'
import type { CustomerStatusKey } from '../types'

export type CustomerListFilterKey =
  | 'all'
  | 'preferredStaff'
  | 'newRecent'
  | 'followup'
  | 'dormant'

export interface CustomerListCounts {
  all: number
  preferredStaff: number
  newRecent: number
  followup: number
  dormant: number
}

interface CustomersStatusFiltersProps {
  active: CustomerListFilterKey
  onChange: (key: CustomerListFilterKey) => void
  counts: CustomerListCounts
}

const ITEMS: Array<{ id: CustomerListFilterKey; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'preferredStaff', label: 'Preferred Staff' },
  { id: 'newRecent', label: 'New (last 30d)' },
  { id: 'followup', label: 'Needs follow-up' },
  { id: 'dormant', label: 'Dormant (90d+)' },
]

export function CustomersStatusFilters({
  active,
  onChange,
  counts,
}: CustomersStatusFiltersProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {ITEMS.map((item) => {
          const isActive = item.id === active
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span>{item.label}</span>
              <span
                className={`tabular-nums ${isActive ? 'text-sky-300' : 'text-muted-foreground/70'}`}
              >
                {counts[item.id]}
              </span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="hidden h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
        title="Sort placeholder — sort UX coming"
        disabled
      >
        <span className="text-muted-foreground/70">Sort:</span>
        <span>Last visit (recent)</span>
        <ChevronDown size={14} />
      </button>
    </div>
  )
}

export function applyCustomerFilter(
  rows: Array<{ status: CustomerStatusKey; joinDateIso: string | null; preferredStaffId: string | null }>,
  filter: CustomerListFilterKey,
  selfStaffId: string | null,
): Array<number> {
  // Returns the indices of rows matching the filter so the caller can map.
  const out: number[] = []
  const since30 = new Date()
  since30.setDate(since30.getDate() - 30)
  rows.forEach((r, i) => {
    if (filter === 'all') out.push(i)
    else if (filter === 'preferredStaff') {
      if (selfStaffId && r.preferredStaffId === selfStaffId) out.push(i)
    } else if (filter === 'newRecent') {
      if (r.joinDateIso && new Date(r.joinDateIso) >= since30) out.push(i)
    } else if (filter === 'followup') {
      if (r.status === 'needs-followup') out.push(i)
    } else if (filter === 'dormant') {
      if (r.status === 'dormant') out.push(i)
    }
  })
  return out
}
