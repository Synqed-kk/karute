'use client'

import { useTranslations } from 'next-intl'
import { Mic } from 'lucide-react'

import type { DisplayStatus, ReservationView } from '@/lib/adapters/reservation-view'
import { getStaffColorByKey } from '@/lib/staff-colors'
import { cn } from '@/lib/utils'

interface StatusTone {
  bg: string
  border: string
  borderStyle: 'solid' | 'dashed'
  chipBg: string
  chipText: string
}

/** 残3/10 — live pack usage next to the course title. Color = urgency:
 *  emerald (sessions left) → amber (残1: next-pack conversation) → red
 *  (used up: renewal NOW). Same data source as the 顧客 list (chopstick). */
function PackPill({ remaining, size }: { remaining: number; size: number }) {
  const t = useTranslations('reservation')
  const tone =
    remaining === 0
      ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400'
      : remaining === 1
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium tabular-nums',
        tone,
      )}
    >
      {t('card.packLeft', { remaining, size })}
    </span>
  )
}

const STATUS_TONES: Record<DisplayStatus, StatusTone> = {
  booked: {
    bg: 'var(--reservation-booked-bg)',
    border: 'var(--reservation-booked-border)',
    borderStyle: 'solid',
    chipBg: 'var(--reservation-booked-chip-bg)',
    chipText: 'var(--reservation-booked-chip-text)',
  },
  in_session: {
    bg: 'var(--reservation-in-session-bg)',
    border: 'var(--reservation-in-session-border)',
    borderStyle: 'solid',
    chipBg: 'var(--reservation-in-session-chip-bg)',
    chipText: 'var(--reservation-in-session-chip-text)',
  },
  completed: {
    bg: 'var(--reservation-completed-bg)',
    border: 'var(--reservation-completed-border)',
    borderStyle: 'solid',
    chipBg: 'var(--reservation-completed-chip-bg)',
    chipText: 'var(--reservation-completed-chip-text)',
  },
  new: {
    bg: 'var(--reservation-new-bg)',
    border: 'var(--reservation-new-border)',
    borderStyle: 'solid',
    chipBg: 'var(--reservation-new-chip-bg)',
    chipText: 'var(--reservation-new-chip-text)',
  },
}

function addMinutes(hm: string, minutes: number): string {
  const [h, m] = hm.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

interface GridProps {
  view: ReservationView
  variant: 'grid'
  /** Pixels per minute. */
  ppm: number
  /** Business-hours start hour (e.g. 10 for 10:00). */
  startHour: number
  onSelect?: (view: ReservationView) => void
}

interface AgendaProps {
  view: ReservationView
  variant: 'agenda'
  onSelect?: (view: ReservationView) => void
}

export function AppointmentCard(props: GridProps | AgendaProps) {
  const t = useTranslations('reservation')
  const { view, onSelect } = props
  const tone = STATUS_TONES[view.displayStatus]
  const isCompleted = view.displayStatus === 'completed'
  const isLive = view.displayStatus === 'in_session'
  const staffColor = getStaffColorByKey(view.staffColorKey)
  const endTime = addMinutes(view.startTimeHm, view.durationMin)
  const statusLabel = t(`status.${view.displayStatus}`)
  const customerSuffix = t('card.customerSuffix')
  const interactive = !!onSelect
  const handleSelect = () => onSelect?.(view)
  const handleKey = (e: React.KeyboardEvent) => {
    if (!onSelect) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(view)
    }
  }

  if (props.variant === 'agenda') {
    return (
      <div
        className={cn(
          'flex items-stretch gap-3 rounded-lg border p-3',
          isCompleted && 'opacity-65',
          interactive && 'cursor-pointer transition-colors hover:bg-foreground/[0.03]',
        )}
        style={{
          background: tone.bg,
          borderColor: tone.border,
          borderStyle: tone.borderStyle,
        }}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? handleSelect : undefined}
        onKeyDown={interactive ? handleKey : undefined}
      >
        <div className="flex w-14 shrink-0 flex-col items-start justify-center border-r pr-3" style={{ borderColor: tone.border }}>
          <div className="text-base font-semibold tabular-nums">{view.startTimeHm}</div>
          <div className="text-xs text-muted-foreground">
            {t('card.duration', { n: view.durationMin })}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                staffColor.bg,
                staffColor.text,
              )}
            >
              {view.customerInitials}
            </span>
            <span className="truncate text-sm font-medium">
              {view.customerName}
              {customerSuffix && <span className="ml-0.5 text-muted-foreground">{customerSuffix}</span>}
            </span>
            {isLive && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{view.service}</span>
            {view.pack && (
              <PackPill remaining={view.pack.remaining} size={view.pack.size} />
            )}
          </div>
        </div>
        <span
          className="inline-flex h-6 shrink-0 items-center self-center rounded-full border px-2 text-[10px] font-medium"
          style={{ background: tone.chipBg, color: tone.chipText, borderColor: tone.border }}
        >
          {statusLabel}
        </span>
      </div>
    )
  }

  // grid variant
  const left = (() => {
    const [h, m] = view.startTimeHm.split(':').map(Number)
    return ((h - props.startHour) * 60 + m) * props.ppm
  })()
  const width = view.durationMin * props.ppm
  const tight = width < 100

  return (
    <div
      className={cn(
        'absolute overflow-hidden rounded-lg border-[1.5px] shadow-sm',
        isCompleted && 'opacity-70',
        interactive && 'cursor-pointer transition-shadow hover:shadow-md hover:ring-1 hover:ring-foreground/20',
      )}
      style={{
        left: left + 3,
        width: width - 6,
        top: 4,
        height: 80,
        background: tone.bg,
        borderColor: tone.border,
        borderStyle: tone.borderStyle,
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleSelect : undefined}
      onKeyDown={interactive ? handleKey : undefined}
    >
      <div className="flex h-full flex-col justify-between gap-1 p-2">
        <div className="flex items-start justify-between gap-1.5">
          <span className="min-w-0 truncate text-xs font-semibold text-foreground">
            {view.customerName}
            {customerSuffix && <span className="ml-0.5 text-muted-foreground">{customerSuffix}</span>}
          </span>
          {/* Exceptions-only chip (same policy as mobile): the tinted block
           *  background already carries the default states on the grid. */}
          {!tight &&
            (view.displayStatus === 'new' ||
              view.displayStatus === 'in_session') && (
            <span
              className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ background: tone.chipBg, color: tone.chipText }}
            >
              {statusLabel}
            </span>
          )}
        </div>
        {!tight && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="truncate">{view.service}</span>
            {view.pack && (
              <PackPill remaining={view.pack.remaining} size={view.pack.size} />
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground tabular-nums">
          <span>
            <span>{view.startTimeHm}</span>
            {!tight && (
              <>
                <span className="opacity-50"> – </span>
                <span>{endTime}</span>
              </>
            )}
            {width >= 80 && (
              <>
                <span className="opacity-50"> · </span>
                <span>{t('card.duration', { n: view.durationMin })}</span>
              </>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Mic className={cn('h-2.5 w-2.5', isLive ? 'text-red-500' : 'text-muted-foreground/70')} />
            {isLive && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
          </span>
        </div>
      </div>
    </div>
  )
}
