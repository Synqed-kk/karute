'use client'

import { useTranslations } from 'next-intl'

import type { ReservationView, DisplayStatus } from '@/lib/adapters/reservation-view'

interface ReservationTotalsProps {
  reservations: ReservationView[]
}

// 予約済 dropped (Liam): the headline already counts every booking — a
// 予約済 N beside 本日の予約 N件 restated the same number. Remaining tones
// render only when nonzero, so a normal day reads as one phrase.
const TONES: Array<{ key: DisplayStatus; cssKey: string }> = [
  { key: 'completed', cssKey: 'completed' },
  { key: 'in_session', cssKey: 'in-session' },
  { key: 'new', cssKey: 'new' },
]

export function ReservationTotals({ reservations }: ReservationTotalsProps) {
  const t = useTranslations('reservation')
  const counts = reservations.reduce<Record<DisplayStatus, number>>(
    (acc, r) => {
      acc[r.displayStatus] = (acc[r.displayStatus] ?? 0) + 1
      return acc
    },
    { booked: 0, in_session: 0, completed: 0, new: 0 },
  )

  return (
    <div className="flex flex-wrap items-center gap-4 px-1 text-xs">
      <span className="font-medium text-foreground">
        {t('totals.today', { n: reservations.length })}
      </span>
      {/* 残り = the count the desk actually uses mid-day. */}
      {reservations.length - counts.completed > 0 && counts.completed > 0 && (
        <span className="text-muted-foreground">
          {t('totals.remaining', { n: reservations.length - counts.completed })}
        </span>
      )}
      {TONES.some(({ key }) => counts[key] > 0) && (
        <span className="text-muted-foreground">·</span>
      )}
      {(() => {
        const renewal = reservations.filter((r) => r.needsRenewal).length
        const unrecorded = reservations.filter(
          (r) => r.displayStatus === 'completed' && !r.isCancelled && !r.karuteRecordId,
        ).length
        return (
          <>
            {renewal > 0 && (
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {t('totals.renewal', { n: renewal })}
              </span>
            )}
            {unrecorded > 0 && (
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {t('totals.unrecorded', { n: unrecorded })}
              </span>
            )}
          </>
        )
      })()}
      {TONES.filter(({ key }) => counts[key] > 0).map(({ key, cssKey }) => (
        <span key={key} className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: `var(--reservation-${cssKey}-chip-bg)` }}
            aria-hidden
          />
          <span>{t(`status.${key}`)}</span>
          <span className="font-medium text-foreground tabular-nums">{counts[key]}</span>
        </span>
      ))}
    </div>
  )
}
