'use client'

// 本日のながれ — the staff member's whole remaining day, always visible
// (no tap to see your own schedule). One line per booking: time, staff dot,
// name, course, and the ticket chip that starts the renewal conversation
// hours early (amber at 残1). Finished sessions collapse into one grey
// accordion row — done is done.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { getStaffColorByKey, type StaffColorKey } from '@/lib/staff-colors'

export interface DayFlowRow {
  id: string
  clientId: string
  timeHm: string
  customerName: string
  course: string | null
  staffInitial: string
  staffColorKey: StaffColorKey | 'neutral' | null
  ticket: { remaining: number; size: number } | null
  firstTime: boolean
  done: boolean
  isNext: boolean
}

function TicketChip({ row }: { row: DayFlowRow }) {
  const t = useTranslations('dashboard.flow')
  if (row.firstTime) {
    return (
      <span className="ml-auto shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
        {t('firstVisit')}
      </span>
    )
  }
  if (!row.ticket) return null
  const low = row.ticket.remaining <= 1
  return (
    <span
      className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
        low
          ? 'bg-amber-50 font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
      }`}
    >
      {t('remainingChip', { n: row.ticket.remaining })}
    </span>
  )
}

function Row({ row }: { row: DayFlowRow }) {
  const color = getStaffColorByKey(row.staffColorKey)
  return (
    <li>
      <Link
        href={`/customers/${row.clientId}`}
        className={`flex items-center gap-2 px-2 py-2 text-[13px] hover:bg-muted/40 ${
          row.isNext ? 'rounded-lg bg-primary/5' : ''
        }`}
      >
        <span
          className={`w-10 shrink-0 tabular-nums ${
            row.isNext ? 'font-semibold text-primary' : 'text-muted-foreground'
          }`}
        >
          {row.timeHm}
        </span>
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${color.bg} ${color.text}`}
          aria-hidden
        >
          {row.staffInitial}
        </span>
        <span className="min-w-0 truncate font-medium">{row.customerName}</span>
        {row.course && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{row.course}</span>
        )}
        <TicketChip row={row} />
      </Link>
    </li>
  )
}

export function DayFlow({ rows }: { rows: DayFlowRow[] }) {
  const t = useTranslations('dashboard.flow')
  const [showDone, setShowDone] = useState(false)
  if (rows.length === 0) return null

  const done = rows.filter((r) => r.done)
  const upcoming = rows.filter((r) => !r.done)
  const firstTimers = rows.filter((r) => r.firstTime).length
  // rows.length > 0 is guaranteed by the early return above.
  const pct = Math.round((done.length / rows.length) * 100)

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('flowTitle')}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('flowProgress', { d: done.length, total: rows.length })}
          {firstTimers > 0 && ` · ${t('firstTimers', { n: firstTimers })}`}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className="h-1 rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="mt-2 divide-y divide-border/60">
        {upcoming.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>
      {done.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="flex w-full items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={showDone}
          >
            {t('doneAccordion', { n: done.length })}
            <span aria-hidden>{showDone ? '▴' : '▾'}</span>
          </button>
          {showDone && (
            <ul className="divide-y divide-border/60 opacity-70">
              {done.map((r) => (
                <Row key={r.id} row={r} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
