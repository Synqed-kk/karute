'use client'

import { Phone } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { formatJpPhone } from '@/lib/format/phone'
import type { CustomerListRow } from '../types'
import { STATUS_STYLES } from '../types'
import { AiStatusChipRow } from './AiStatusChipRow'

interface CustomerRowDesktopProps {
  c: CustomerListRow
  staffColor: string | null
  /** See CustomerCardMobile — same flag, same purpose. */
  karuteContext?: boolean
  /** See CustomerCardMobile — same flag, same purpose. */
  hrefBase?: string
}

/**
 * Desktop list row — mirrors the design-spike's `CustomerRow` columns:
 *   ▎ Customer (avatar + name + 様 + #karute + meta) | Last visit | Recommend | Status | Staff + phone | Total
 *
 * Visits-dots column was removed (the underlying course-graduation model
 * isn't built yet; surfacing a stub doesn't help). Recommend column is
 * kept but dimmed because the rebooking-window AI isn't wired either.
 *
 * Column template must stay in lock-step with `CustomersListView`'s
 * header row.
 */
export function CustomerRowDesktop({
  c,
  staffColor,
  karuteContext = false,
  hrefBase = '/customers',
}: CustomerRowDesktopProps) {
  const t = useTranslations('customers.list')
  const status = STATUS_STYLES[c.status]
  const honorific = t('row.honorific')
  return (
    <Link
      href={`${hrefBase}/${c.id}` as Parameters<typeof Link>[0]['href']}
      className="relative grid grid-cols-[minmax(0,2fr)_130px_110px_120px_160px_60px] items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/30 last:border-b-0"
    >
      {/* Staff color stripe on left edge — gray fallback when no staff
       *  is assigned so the accent stays visually present (matches
       *  spike behavior). Inset from top/bottom lets the row's border-b
       *  pass through, giving the cut-into-sections look. */}
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
        style={{ background: staffColor ?? 'var(--border)' }}
      />

      {/* Customer */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground ring-1 ring-border/60">
          {c.initials}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[15px] font-medium text-foreground md:text-sm">
              {c.name}
            </span>
            {honorific && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {honorific}
              </span>
            )}
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {c.karuteNumber}
            </span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground tabular-nums">
            <span>{c.age ?? '—'}</span>
            <span> · </span>
            <span>{c.gender ?? '—'}</span>
            <span> · </span>
            <span>{t('joined', { date: c.joinDate })}</span>
          </div>
          {karuteContext && <AiStatusChipRow />}
        </div>
      </div>

      {/* Last visit */}
      <div className="flex min-w-0 flex-col tabular-nums">
        <span className="text-xs text-foreground">{c.lastVisitDate}</span>
        <span className="text-[10px] text-muted-foreground">
          {c.lastVisitAgo}
        </span>
        {c.lastVisitService && (
          <span className="truncate text-[10px] text-muted-foreground/80">
            {c.lastVisitService}
          </span>
        )}
      </div>

      {/* Recommend — stubbed; rebooking-window model wraps here later */}
      <div
        className="flex flex-col opacity-40"
        title="Coming soon — rebooking AI not yet wired"
      >
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('row.recommendPrefix')}
        </span>
        <span className="text-xs text-foreground tabular-nums">
          {c.aiPredict.when}
        </span>
      </div>

      {/* Status */}
      <div>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} ${status.border}`}
        >
          {t(`status.${c.status}`)}
        </span>
      </div>

      {/* Staff + phone */}
      <div className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 truncate">
          {staffColor && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: staffColor }}
              aria-hidden
            />
          )}
          <span className="truncate">
            {t('row.staff', { name: c.preferredStaffName ?? '—' })}
          </span>
        </span>
        {c.phone && (
          <span className="inline-flex items-center gap-1 truncate tabular-nums">
            <Phone className="size-2.5 shrink-0" aria-hidden />
            <span className="truncate">{formatJpPhone(c.phone)}</span>
          </span>
        )}
      </div>

      {/* Total — visit count badge */}
      <div className="text-right">
        <span className="inline-flex h-5 items-center rounded bg-muted px-1.5 text-[11px] font-medium tabular-nums text-foreground/80">
          {c.totalKarute}
        </span>
      </div>
    </Link>
  )
}
