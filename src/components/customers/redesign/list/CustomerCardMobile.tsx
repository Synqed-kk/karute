'use client'

import { Link } from '@/i18n/navigation'
import type { CustomerListRow } from '../types'
import { STATUS_STYLES } from '../types'

interface CustomerCardMobileProps {
  c: CustomerListRow
  staffColor: string | null
}

export function CustomerCardMobile({ c, staffColor }: CustomerCardMobileProps) {
  const status = STATUS_STYLES[c.status]
  return (
    <Link
      href={`/customers/${c.id}` as Parameters<typeof Link>[0]['href']}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/30"
      style={{
        borderLeftStyle: 'solid',
        borderLeftWidth: '3px',
        borderLeftColor: staffColor ?? 'var(--border)',
      }}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
          {c.initials}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">
              {c.name}
            </span>
            <span className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {c.karuteNumber}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <span className="tabular-nums">{c.age ?? '—'}</span>
            <span> · </span>
            <span>{c.gender ?? '—'}</span>
            <span> · </span>
            <span className="tabular-nums">{c.totalKarute} karute</span>
          </div>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} ${status.border}`}
        >
          {status.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Cell label="Visits">
          <div className="flex items-center gap-2">
            <Dots filled={c.visitsDone} total={c.visitsTotal} />
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {c.visitsDone}/{c.visitsTotal}
            </span>
          </div>
        </Cell>
        <Cell label="Last visit">
          <div className="text-xs tabular-nums text-foreground">
            {c.lastVisitDate}
          </div>
          <div className="text-[10px] text-muted-foreground">{c.lastVisitAgo}</div>
        </Cell>
        <Cell label="AI predict">
          <div className="text-xs text-foreground">{c.aiPredict.when}</div>
          <div className="text-[10px] text-muted-foreground">
            {c.aiPredict.label}
          </div>
        </Cell>
        <Cell label="Staff">
          <div className="flex items-center gap-1.5 text-xs text-foreground">
            {staffColor && (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: staffColor }}
              />
            )}
            <span className="truncate">{c.preferredStaffName ?? '—'}</span>
          </div>
        </Cell>
      </div>
    </Link>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
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
