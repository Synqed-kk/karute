'use client'

// 明日 strip — the last thing staff check before going home: how many
// customers, any first-timers, who opens the day. Dumb display; renders
// nothing when tomorrow is empty.
//
// Design-parity P-B-1: flipped from an async server component to a client
// leaf (useTranslations) — see DashboardPageView.

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export interface TomorrowStripData {
  dateLabel: string
  ymd: string
  count: number
  firstTimers: number
  firstTimeHm: string
  firstName: string
}

export function TomorrowStrip({ data }: { data: TomorrowStripData | null }) {
  const t = useTranslations('dashboard.flow')
  if (!data || data.count === 0) return null
  return (
    <Link
      href={{ pathname: '/appointments', query: { date: data.ymd } }}
      className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-[13px] hover:bg-muted/40"
    >
      <span className="font-medium">{t('tomorrowTitle', { date: data.dateLabel })}</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {t('tomorrowLine', {
          n: data.count,
          f: data.firstTimers,
          time: data.firstTimeHm,
          name: data.firstName,
        })}
      </span>
      <span className="ml-auto shrink-0 text-muted-foreground" aria-hidden>
        ›
      </span>
    </Link>
  )
}
