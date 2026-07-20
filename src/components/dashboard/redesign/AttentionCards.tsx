'use client'

// 本日の要注目 (Liam-approved 3+2 design) — ONLY the customers on today's
// book with something worth knowing, each with a one-line AI prep note
// (deterministic fallback when the AI is unavailable). The full schedule
// lives in the 予約 tab; this section must add insight, never duplicate it.
//
// Design-parity P-B-1: flipped from an async server component to a client
// leaf (useTranslations) — see DashboardPageView.

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { AttentionBadge } from '@/lib/dashboard/attention'

export interface AttentionCardView {
  clientId: string
  timeHm: string
  name: string
  badge: AttentionBadge
  badgeDays?: number
  line: string
}

const BADGE_STYLE: Record<AttentionBadge, string> = {
  lastOne:
    'bg-amber-50 font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  packDone: 'bg-orange-50 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300',
  first: 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  comeback: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300',
  memo: 'bg-muted text-muted-foreground',
}

export function AttentionCards({
  items,
  totalToday,
}: {
  items: AttentionCardView[]
  totalToday: number
}) {
  const t = useTranslations('dashboard.flow')
  if (items.length === 0) return null
  const badgeLabel = (i: AttentionCardView): string => {
    switch (i.badge) {
      case 'lastOne':
        return t('badgeLastOne')
      case 'packDone':
        return t('badgePackDone')
      case 'first':
        return t('firstVisit')
      case 'comeback':
        return t('badgeComeback', { n: i.badgeDays ?? 0 })
      case 'memo':
        return t('badgeMemo')
    }
  }
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-semibold">
        {t('attentionTitle')}{' '}
        <span className="text-xs font-normal text-muted-foreground">
          {t('attentionOf', { n: items.length, total: totalToday })}
        </span>
      </h2>
      <div className="mt-1 divide-y divide-border/60">
        {items.map((i) => (
          <Link
            key={i.clientId}
            href={`/customers/${i.clientId}`}
            className="flex gap-3 py-2.5 hover:bg-muted/40"
          >
            <span className="w-11 shrink-0 text-[13px] text-muted-foreground tabular-nums">
              {i.timeHm}
            </span>
            <div className="min-w-0">
              <p className="text-[13px]">
                <span className="font-medium">{i.name}</span>{' '}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${BADGE_STYLE[i.badge]}`}
                >
                  {badgeLabel(i)}
                </span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{i.line}</p>
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{t('attentionFootnote')}</p>
    </section>
  )
}
