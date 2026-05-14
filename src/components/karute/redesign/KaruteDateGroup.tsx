'use client'

import { useTranslations, useLocale } from 'next-intl'

import type { KaruteRichRow } from '@/lib/adapters/karute-list'

import { KaruteRowDesktop } from './KaruteRowDesktop'
import { KaruteRowMobile } from './KaruteRowMobile'

interface KaruteDateGroupProps {
  isoDate: string
  rows: KaruteRichRow[]
  todayIso: string
}

function diffDays(todayIso: string, iso: string): number {
  const [ty, tm, td] = todayIso.split('-').map(Number)
  const [y, m, d] = iso.split('-').map(Number)
  const today = new Date(ty, tm - 1, td)
  const that = new Date(y, m - 1, d)
  return Math.round((today.getTime() - that.getTime()) / 86400000)
}

function formatHeading(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (locale.startsWith('ja')) {
    const wd = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()]
    return `${y}年${m}月${d}日(${wd})`
  }
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][dt.getDay()]
  return `${months[m - 1]} ${String(d).padStart(2, '0')}, ${y} (${wd})`
}

export function KaruteDateGroup({ isoDate, rows, todayIso }: KaruteDateGroupProps) {
  const t = useTranslations('karuteList.group')
  const locale = useLocale()
  const diff = diffDays(todayIso, isoDate)
  let rel: string | null = null
  if (diff === 0) rel = t('today')
  else if (diff === 1) rel = t('yesterday')
  else if (diff > 1 && diff < 7) rel = t('daysAgo', { n: diff })

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="tabular-nums">{formatHeading(isoDate, locale)}</span>
        {rel && (
          <span className="ml-0.5 text-[12px] font-semibold normal-case tracking-normal text-sky-500">
            · {rel}
          </span>
        )}
        <span aria-hidden>·</span>
        <span className="tabular-nums">{t('count', { n: rows.length })}</span>
      </div>
      <div className="hidden flex-col gap-2 md:flex">
        {rows.map((r) => (
          <KaruteRowDesktop key={r.id} row={r} />
        ))}
      </div>
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((r) => (
          <KaruteRowMobile key={r.id} row={r} />
        ))}
      </div>
    </section>
  )
}
