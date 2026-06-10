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

// 指名あり removed by design (Liam, proposal ②): mislabeled (it counted
// "nominated ME", not "has a nomination") and structurally dead (QR sync never
// writes assigned_staff_id) — the 自分 staff pill already covers "my customers".
// The filter logic stays; only the pill is gone.
const FILTER_KEYS: CustomerListFilterKey[] = [
  'all',
  'newRecent',
  'followup',
  'dormant',
]

// Pills that hide while their count is 0 (proposal ②): a confident「休眠 0」
// reads as "no dormant customers", which is false while the data simply isn't
// imported yet. They reappear automatically at the first nonzero count.
const HIDE_WHEN_ZERO: ReadonlySet<CustomerListFilterKey> = new Set([
  'followup',
  'dormant',
])

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
          if (HIDE_WHEN_ZERO.has(key) && counts[key] === 0 && active !== key) {
            return null
          }
          const isActive = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-foreground hover:bg-muted'
              }`}
            >
              <span>{t(`filters.${key}`)}</span>
              <span
                className={`tabular-nums ${isActive ? 'text-background/70' : 'text-muted-foreground'}`}
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
    }
  })
  return out
}
