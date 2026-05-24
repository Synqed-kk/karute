'use client'

import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CustomerStatusKey } from '../types'
import { ComingSoonChip } from '../ComingSoonChip'

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

const FILTER_KEYS: CustomerListFilterKey[] = [
  'all',
  'preferredStaff',
  'newRecent',
  'followup',
  'dormant',
]

export function CustomersStatusFilters({
  active,
  onChange,
  counts,
}: CustomersStatusFiltersProps) {
  const t = useTranslations('customers.list')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_KEYS.map((key) => {
          const isActive = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span>{t(`filters.${key}`)}</span>
              <span
                className={`tabular-nums ${isActive ? 'text-sky-300' : 'text-muted-foreground/70'}`}
              >
                {counts[key]}
              </span>
            </button>
          )
        })}
      </div>
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
