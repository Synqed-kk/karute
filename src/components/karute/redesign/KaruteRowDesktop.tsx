'use client'

import { useTranslations, useLocale } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { getStaffColorByKey } from '@/lib/staff-colors'
import type { KaruteRichRow } from '@/lib/adapters/karute-list'

import { KaruteStatusBadge } from './KaruteStatusBadge'

interface KaruteRowDesktopProps {
  row: KaruteRichRow
}

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

export function KaruteRowDesktop({ row }: KaruteRowDesktopProps) {
  const t = useTranslations('karuteList.row')
  const locale = useLocale()
  const [, mm, dd] = row.date.split('-')
  const dayLabel = `${mm}/${dd}`
  const dt = new Date(row.date)
  const weekday = (locale.startsWith('ja') ? WEEKDAYS_JA : WEEKDAYS_EN)[dt.getDay()]
  const color = getStaffColorByKey(row.staffColorKey)

  return (
    <Link
      href={`/karute/${row.id}` as Parameters<typeof Link>[0]['href']}
      className={cn(
        'grid items-start gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm transition-colors',
        'hover:bg-muted hover:border-border',
      )}
      style={{ gridTemplateColumns: '64px 44px minmax(0, 1fr)' }}
    >
      <div className="flex flex-col gap-0.5 pt-0.5">
        <div className="text-[15px] font-semibold tabular-nums tracking-tight text-foreground">
          {dayLabel}
        </div>
        <div className="text-[11px] text-muted-foreground">{weekday}</div>
      </div>
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1',
          color.bg,
          color.text,
          color.ring,
        )}
      >
        {row.customerInitials}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-foreground">{row.customerName}</span>
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {row.karuteNumber}
          </span>
          <span className="ml-auto">
            <KaruteStatusBadge status={row.status} />
          </span>
        </div>
        <div className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
          {row.summary}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {row.service && (
            <>
              <span className="font-medium text-foreground">
                {row.service}
                {row.serviceDetail ? ` · ${row.serviceDetail}` : ''}
              </span>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
            </>
          )}
          {row.duration != null && (
            <>
              <span className="tabular-nums text-muted-foreground">
                {t('duration', { n: row.duration })}
              </span>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
            </>
          )}
          <span className="tabular-nums text-muted-foreground">
            {t('entries', { n: row.entryCount })}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <span
              className={cn('inline-block h-1.5 w-1.5 rounded-full', color.stripe)}
              aria-hidden
            />
            <span className="text-muted-foreground">{row.staffName ?? '—'}</span>
          </span>
        </div>
      </div>
    </Link>
  )
}
