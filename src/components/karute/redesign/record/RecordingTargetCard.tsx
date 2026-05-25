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
  /** Drives the status pill next to the 録音対象 label. Defaults to
   *  'booked' when unspecified so existing call-sites don't break.
   *  Values mirror RecordTargetBooking.statusKey for consistency. */
  statusKey?: 'in-session' | 'booked' | 'new' | 'done'
  /** True when this is the customer's first-ever visit. Surfaces as
   *  the green 新規 pill when no in-session signal is present
   *  (matches spike's AppointmentSelectorCard precedence:
   *  施術中 > 新規 > 予約済). */
  isNew?: boolean
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

  // No booking selected — render the full card chrome with the
  // picker button visible so staff can switch into a booking, and a
  // scaffold-style body that explains what'll show here once a
  // booking is selected. The picker dropdown itself surfaces either
  // real bookings (when present) or a 対応予定 scaffold message that
  // tells Anthony exactly what needs wiring.
  if (!appointment) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-5 shadow-sm md:p-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center text-sky-400">
              <Clock size={16} />
            </span>
            <span className="text-sm font-semibold text-foreground">
              {t('title')}
            </span>
          </div>
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
              <div className="absolute right-0 top-10 z-20 w-[320px] rounded-xl border border-border bg-card p-3 shadow-lg md:w-[420px]">
                {nearbyBookings.length > 0 ? (
                  <ul className="flex flex-col">
                    {nearbyBookings.map((b) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            onSwitchBooking?.(b)
                          }}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="w-12 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                            {b.start}
                          </span>
                          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
                            {b.initials}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[13px] font-medium text-foreground">
                              {b.customer}
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
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <PickerScaffold t={t} />
                )}
              </div>
            )}
          </div>
        </header>

        {/* Empty-state body — describes what'll appear here once a
         *  booking is selected. Anthony: this is the contract for
         *  the populated state above (RecordingTargetCard's normal
         *  render path). */}
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-4">
          <p className="text-[13px] font-medium text-foreground/90">
            {t('noBookingPrimary')}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {t('noBookingSecondary')}
          </p>
        </div>
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
          <StatusPill
            statusKey={appointment.statusKey}
            isNew={appointment.isNew}
            t={t}
          />
        </div>
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
            <div className="absolute right-0 top-10 z-20 w-[320px] rounded-xl border border-border bg-card p-2 shadow-lg md:w-[420px]">
              {nearbyBookings.length > 0 ? (
                <>
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
                </>
              ) : (
                <PickerScaffold t={t} />
              )}
            </div>
          )}
        </div>
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
            <span className="text-[13px] text-muted-foreground">{t('honorific')}</span>
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
            {t('staffPrefix', { name: appointment.staffName })}
          </div>
        </div>
      </div>
    </section>
  )
}

// Status pill — derives label + color from appointment status.
// Precedence: 施術中 > 新規 > 予約済 (matches spike's
// AppointmentSelectorCard). Hides on 'done' since the recording
// flow doesn't surface completed bookings as the default target.
function StatusPill({
  statusKey,
  isNew,
  t,
}: {
  statusKey: RecordTargetAppointment['statusKey']
  isNew: RecordTargetAppointment['isNew']
  t: ReturnType<typeof useTranslations>
}) {
  if (statusKey === 'in-session') {
    return (
      <span className="inline-flex h-[22px] items-center rounded-full border border-orange-400/40 bg-orange-500/15 px-2.5 text-[11px] font-medium text-orange-400">
        {t('inSession')}
      </span>
    )
  }
  if (isNew || statusKey === 'new') {
    return (
      <span className="inline-flex h-[22px] items-center rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 text-[11px] font-medium text-emerald-400">
        {t('firstVisit')}
      </span>
    )
  }
  if (statusKey === 'done') {
    return null
  }
  return (
    <span className="inline-flex h-[22px] items-center rounded-full border border-sky-400/40 bg-sky-500/15 px-2.5 text-[11px] font-medium text-sky-400">
      {t('booked')}
    </span>
  )
}

// Picker scaffold — shown inside the 「別の予約を選択」 dropdown when
// the server didn't return any nearby bookings. Surfaces the
// 対応予定 contract so Anthony + staff see what'll appear here once
// the booking-list query is wired (sessions/page.tsx already issues
// the query — when real appointments exist, this branch is replaced
// by the real list above).
function PickerScaffold({
  t,
}: {
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {t('pickerScaffoldLabel')}
          </span>
        </div>
        <p className="text-[12px] italic leading-relaxed text-muted-foreground">
          {t('pickerScaffoldBody')}
        </p>
      </div>
    </div>
  )
}
