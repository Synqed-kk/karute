'use client'

import { Link } from '@/i18n/navigation'
import type { CustomerListRow } from '../types'
import { STATUS_STYLES } from '../types'

interface CustomerRowDesktopProps {
  c: CustomerListRow
  staffColor: string | null
}

export function CustomerRowDesktop({ c, staffColor }: CustomerRowDesktopProps) {
  const status = STATUS_STYLES[c.status]
  return (
    <Link
      href={`/customers/${c.id}` as Parameters<typeof Link>[0]['href']}
      className="grid grid-cols-[minmax(0,2fr)_120px_120px_140px_120px_140px_60px] items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/30"
      style={{
        borderLeftStyle: 'solid',
        borderLeftWidth: '3px',
        borderLeftColor: staffColor ?? 'transparent',
      }}
    >
      {/* Customer */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
          {c.initials}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {c.name}
            </span>
            <span className="shrink-0 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {c.karuteNumber}
            </span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            <span className="tabular-nums">{c.age ?? '—'}</span>
            <span> · </span>
            <span>{c.gender ?? '—'}</span>
            <span> · </span>
            <span>Joined {c.joinDate}</span>
          </div>
        </div>
      </div>

      {/* Visits */}
      <div className="flex flex-col gap-1">
        <Dots filled={c.visitsDone} total={c.visitsTotal} />
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {c.visitsDone}/{c.visitsTotal}
        </span>
      </div>

      {/* Last visit */}
      <div className="flex flex-col">
        <span className="text-xs tabular-nums text-foreground">
          {c.lastVisitDate}
        </span>
        <span className="text-[10px] text-muted-foreground">{c.lastVisitAgo}</span>
      </div>

      {/* AI predict */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {c.aiPredict.label}
        </span>
        <span className="text-xs text-foreground">{c.aiPredict.when}</span>
      </div>

      {/* Status */}
      <div>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} ${status.border}`}
        >
          {status.label}
        </span>
      </div>

      {/* Staff */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {staffColor && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: staffColor }}
          />
        )}
        <span className="truncate">
          {c.preferredStaffName ?? '—'}
        </span>
      </div>

      {/* Total */}
      <div className="text-right text-sm font-semibold tabular-nums text-foreground">
        {c.totalKarute}
      </div>
    </Link>
  )
}

function Dots({ filled, total }: { filled: number; total: number }) {
  const dots = Math.max(total, filled, 5)
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: dots }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < filled ? 'bg-sky-400' : 'bg-muted'
          }`}
        />
      ))}
    </div>
  )
}
