'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Clock } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface RecordTargetBooking {
  id: string
  start: string
  end: string
  customer: string
  initials: string
  karute: string | null
  service: string
  staff: string
  statusKey: 'done' | 'in-session' | 'booked' | 'new'
  statusLabel: string
}

export interface RecordTargetAppointment {
  id: string
  customerName: string
  initials: string
  karuteNumber: string | null
  service: string
  timeRange: string
  staffName: string
}

interface RecordingTargetCardProps {
  appointment: RecordTargetAppointment | null
  nearbyBookings?: RecordTargetBooking[]
  onSwitchBooking?: (booking: RecordTargetBooking) => void
}

const STATUS_TONE: Record<RecordTargetBooking['statusKey'], string> = {
  done: 'bg-foreground/8 text-muted-foreground',
  'in-session': 'bg-orange-500/15 text-orange-400 border border-orange-400/40',
  booked: 'bg-emerald-500/15 text-emerald-400',
  new: 'bg-sky-500/15 text-sky-400',
}

export function RecordingTargetCard({
  appointment,
  nearbyBookings = [],
  onSwitchBooking,
}: RecordingTargetCardProps) {
  const t = useTranslations('recording.target')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!appointment) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        {t('noBooking')}
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center text-sky-400">
            <Clock size={16} />
          </span>
          <span className="text-sm font-semibold text-foreground">
            {t('title')}
          </span>
          <span className="inline-flex h-[22px] items-center rounded-full border border-orange-400/40 bg-orange-500/15 px-2.5 text-[11px] font-medium text-orange-400">
            {t('inSession')}
          </span>
        </div>
        {nearbyBookings.length > 0 && (
          <div className="relative" ref={wrapRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                open && 'bg-muted text-foreground',
              )}
            >
              {t('choose')}
              <ChevronDown
                size={14}
                className={cn('transition-transform', open && 'rotate-180')}
              />
            </button>
            {open && (
              <div className="absolute right-0 top-10 z-20 w-[420px] rounded-xl border border-border bg-card p-2 shadow-lg">
                <div className="mb-1 flex items-center justify-between px-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span>
                    {t('nearbyAround', { time: appointment.timeRange.split(/[–-]/)[0] })}
                  </span>
                </div>
                <ul className="flex flex-col">
                  {nearbyBookings.map((b) => {
                    const isCurrent = b.id === appointment.id
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            onSwitchBooking?.(b)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted',
                            isCurrent && 'bg-muted',
                          )}
                        >
                          <span className="w-12 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                            {b.start}
                          </span>
                          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
                            {b.initials}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="flex items-baseline gap-1.5 truncate text-[13px] font-medium text-foreground">
                              {b.customer}
                              {b.karute && (
                                <span className="text-[11px] tabular-nums text-muted-foreground">
                                  {b.karute}
                                </span>
                              )}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">
                              {b.service} · {b.staff}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'inline-flex h-[20px] shrink-0 items-center rounded-full px-2 text-[10px] font-semibold',
                              STATUS_TONE[b.statusKey],
                            )}
                          >
                            {b.statusLabel}
                          </span>
                          {isCurrent && (
                            <span className="ml-1 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                              {t('current')}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-base font-bold text-foreground">
          {appointment.initials}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-base font-semibold text-foreground">
              {appointment.customerName}
            </span>
            {appointment.karuteNumber && (
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {appointment.karuteNumber}
              </span>
            )}
          </div>
          <div className="text-[13px] text-foreground/80">{appointment.service}</div>
          <div className="text-[12px] tabular-nums text-muted-foreground">
            {appointment.timeRange}
            <span className="mx-1.5">·</span>
            Staff: {appointment.staffName}
          </div>
        </div>
      </div>
    </section>
  )
}
