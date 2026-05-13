'use client'

import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { getStaffColor } from '@/lib/staff-colors'
import type { KaruteRichRow } from '@/lib/adapters/karute-list'

import { KaruteStatusBadge } from './KaruteStatusBadge'

interface KaruteRowMobileProps {
  row: KaruteRichRow
}

export function KaruteRowMobile({ row }: KaruteRowMobileProps) {
  const t = useTranslations('karuteList.row')
  const color = row.staffId ? getStaffColor(row.staffId) : null

  return (
    <Link
      href={`/karute/${row.id}` as Parameters<typeof Link>[0]['href']}
      className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:bg-muted"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
          style={
            color
              ? {
                  background: color.bg,
                  color: color.text,
                  border: `1px solid ${color.border}`,
                }
              : {
                  background: 'var(--muted)',
                  color: 'var(--muted-foreground)',
                }
          }
        >
          {row.customerInitials}
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{row.customerName}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{row.karuteNumber}</span>
        </div>
        <KaruteStatusBadge status={row.status} size="xs" />
      </div>
      <div className="line-clamp-2 text-xs leading-snug text-muted-foreground">{row.summary}</div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {row.service ? `${row.service}${row.serviceDetail ? ' · ' + row.serviceDetail : ''}` : t('entries', { n: row.entryCount })}
          {row.duration != null ? ` · ${t('duration', { n: row.duration })}` : ''}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          {color && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: color.accent }}
              aria-hidden
            />
          )}
          <span>{row.staffName ?? '—'}</span>
        </span>
      </div>
    </Link>
  )
}
