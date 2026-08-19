'use client'

// The 顧客一覧 table + its instant search. Client-side so typing filters
// without a round-trip; state is in-memory and resets on refresh (play phase:
// no persistence). Values arrive pre-formatted — no dates, no data access here.

import { useMemo, useState } from 'react'
import { businessStrings } from '@/business/i18n'

const s = businessStrings.customers

export interface CustomerRow {
  id: string
  name: string
  furigana: string | null
  memberNumber: string
  phone: string | null
  nextSlot: string | null
  ticketBalance: number | null
  verified: boolean
}

const COLS = 'grid-cols-[minmax(170px,1.3fr)_minmax(126px,1fr)_120px_92px]'

export function CustomerTable({ rows }: { rows: CustomerRow[] }) {
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.name, r.furigana, r.memberNumber, r.phone].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [rows, query])

  return (
    <>
      <div className="flex items-center gap-2 px-5 py-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={s.searchPlaceholder}
          aria-label={s.searchPlaceholder}
          className="h-9 w-full max-w-md rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={() => setQuery('')}
          className="h-9 shrink-0 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted"
        >
          {s.clearSearch}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div
            className={`grid ${COLS} gap-3 border-y border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground`}
          >
            <span>{s.colPerson}</span>
            <span>{s.colNext}</span>
            <span>{s.colTicket}</span>
            <span>{s.colConfirm}</span>
          </div>

          {shown.map((r) => (
            <div
              key={r.id}
              className={`grid ${COLS} items-center gap-3 border-b border-border px-5 py-3 text-sm last:border-b-0 hover:bg-muted/40`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                  {r.name.replace(/\s/g, '').slice(0, 2)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.memberNumber} / {r.phone ?? s.phoneMissing}
                  </span>
                </span>
              </div>
              <span className={r.nextSlot ? '' : 'text-muted-foreground'}>
                {r.nextSlot ?? s.none}
              </span>
              <span className={r.ticketBalance == null ? 'text-muted-foreground' : ''}>
                {r.ticketBalance == null
                  ? s.none
                  : s.ticketUnit.replace('{count}', String(r.ticketBalance))}
              </span>
              {/* Status, not an action: neutral either way (one-way accent law). */}
              <span
                className={`justify-self-start rounded-full px-2 py-1 text-xs text-muted-foreground ${
                  r.verified ? 'bg-muted' : 'border border-border'
                }`}
              >
                {r.verified ? s.verified : s.unverified}
              </span>
            </div>
          ))}

          {shown.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium">{s.emptyTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.emptyBody}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
