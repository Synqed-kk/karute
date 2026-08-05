'use client'

import { useTranslations } from 'next-intl'
import { FilePlus } from 'lucide-react'

import { Link } from '@/i18n/navigation'

interface KaruteListHeaderProps {
  monthCount: number
  last14Count: number
  showingCount: number
}

export function KaruteListHeader({
  monthCount,
  last14Count,
  showingCount,
}: KaruteListHeaderProps) {
  const t = useTranslations('karuteList')
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {t('title')}
        </h1>
        <div className="flex flex-wrap items-center gap-1 text-[13px] tabular-nums text-muted-foreground">
          <span>{t('stats.thisMonth', { n: monthCount })}</span>
          <span aria-hidden>·</span>
          <span>{t('stats.last14', { n: last14Count })}</span>
          <span aria-hidden>·</span>
          <span>{t('stats.showing', { n: showingCount })}</span>
        </div>
      </div>
      <Link
        href="/sessions"
        className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        <FilePlus size={16} />
        <span>{t('newKarute')}</span>
      </Link>
    </div>
  )
}
