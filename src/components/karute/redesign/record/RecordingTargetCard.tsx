'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronUp, Clock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { SelectBookingSheet } from './SelectBookingSheet'

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

export function RecordingTargetCard({
  appointment,
  nearbyBookings = [],
  onSwitchBooking,
}: RecordingTargetCardProps) {
  const t = useTranslations('recording.target')
  // 「別の予約を選択」 now opens a full bottom sheet (matches the
  // spike's SelectBookingSheet) instead of a tiny popover dropdown,
  // so staff can scroll through the whole day's bookings.
  const [sheetOpen, setSheetOpen] = useState(false)

  const handleSelect = (b: RecordTargetBooking) => {
    setSheetOpen(false)
    onSwitchBooking?.(b)
  }

  // No booking selected — render the full card chrome with the
  // picker button visible so staff can switch into a booking, and a
  // scaffold body that explains what'll appear here once a booking
  // is selected.
  if (!appointment) {
    return (
      <>
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
            <ChoosePickerButton open={sheetOpen} setOpen={setSheetOpen} label={t('choose')} />
          </header>

          {/* Empty-state body — describes what'll appear here once a
           *  booking is selected. */}
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-4">
            <p className="text-[13px] font-medium text-foreground/90">
              {t('noBookingPrimary')}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {t('noBookingSecondary')}
            </p>
          </div>
        </section>
        <SelectBookingSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          bookings={nearbyBookings}
          currentBookingId={null}
          onSelect={handleSelect}
        />
      </>
    )
  }

  return (
    <>
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
          <ChoosePickerButton open={sheetOpen} setOpen={setSheetOpen} label={t('choose')} />
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
      <SelectBookingSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        bookings={nearbyBookings}
        currentBookingId={appointment.id}
        onSelect={handleSelect}
      />
    </>
  )
}

// 「別の予約を選択」 button — opens the SelectBookingSheet. Visual
// matches the prior popover-trigger styling (small text + chevron),
// but the chevron points up since the sheet rises from the bottom.
function ChoosePickerButton({
  open,
  setOpen,
  label,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
        open && 'bg-muted text-foreground',
      )}
    >
      {label}
      <ChevronUp size={14} />
    </button>
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
