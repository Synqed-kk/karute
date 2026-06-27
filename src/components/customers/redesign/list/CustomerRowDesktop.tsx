'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { getStaffColorByKey, type StaffColor } from '@/lib/staff-colors'
import type { CustomerListRow } from '../types'
import { STATUS_STYLES } from '../types'
import { AiStatusChipRow } from './AiStatusChipRow'

interface CustomerRowDesktopProps {
  c: CustomerListRow
  staffColorKey: StaffColor['key'] | null
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
  staffColorKey,
  karuteContext = false,
  hrefBase = '/customers',
}: CustomerRowDesktopProps) {
  const t = useTranslations('customers.list')
  const status = STATUS_STYLES[c.status]
  const honorific = t('row.honorific')
  const staff = getStaffColorByKey(staffColorKey)
  return (
    <Link
      href={`${hrefBase}/${c.id}` as Parameters<typeof Link>[0]['href']}
      className="relative grid grid-cols-[minmax(0,2fr)_130px_110px_120px_160px_60px] items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/30 last:border-b-0"
    >

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
          {/* Meta segments render only with real content (age/gender are
           *  stub-null today); 登録日 only while 新規. Mirrors the mobile card. */}
          {(() => {
            const segs: string[] = []
            if (c.age != null) segs.push(t('row.ageValue', { age: c.age }))
            if (c.gender) segs.push(c.gender)
            if (c.status === 'new') segs.push(t('joined', { date: c.joinDate }))
            return segs.length > 0 ? (
              <div className="truncate text-[11px] text-muted-foreground tabular-nums">
                {segs.join(' · ')}
              </div>
            ) : null
          })()}
          {karuteContext && <AiStatusChipRow />}
        </div>
      </div>

      {/* Last visit — when the date is unknown but a visit COUNT exists (QR
       *  carries visit_count without visit rows), say 「最終来店日の記録なし」
       *  instead of 来店履歴なし, which contradicts the nonzero Total column. */}
      <div className="flex min-w-0 flex-col tabular-nums">
        <span className="text-xs text-foreground">{c.lastVisitDate}</span>
        {/* ago-token carries the emphasis (amber once 要フォロー/休眠 — same
         *  resolver thresholds as the mobile card). */}
        <span
          className={
            c.status === 'needs-followup' || c.status === 'dormant'
              ? 'text-[10px] font-medium text-amber-600 dark:text-amber-400'
              : 'text-[10px] text-muted-foreground'
          }
        >
          {c.lastVisitDate === '—' && c.totalKarute > 0
            ? t('lastVisit.dateUnknown')
            : c.lastVisitAgo}
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

      {/* Status — EXCEPTIONS-ONLY (Liam): 継続中 renders no chip so the rare
       *  新規/要フォロー/休眠 pop when scanning. Empty cell = fine. */}
      <div>
        {c.status !== 'on-track' && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.text} ${status.border}`}
          >
            {t(`status.${c.status}`)}
          </span>
        )}
      </div>

      {/* Staff — ☎ digits removed (案B, chopstick: one phone policy on EVERY
       *  list surface). The staff sheet never tracked phone; profile keeps it. */}
      <div className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 truncate">
          {staffColorKey && (
            <span
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', staff.stripe)}
              aria-hidden
            />
          )}
          <span className="truncate">
            {t('row.staff', { name: c.preferredStaffName ?? c.bookingStaffName ?? '—' })}
          </span>
        </span>
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
