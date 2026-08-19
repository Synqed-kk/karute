'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronUp, Clock, Mic, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { SelectBookingSheet } from './SelectBookingSheet'
import { badge } from '@/lib/badge-styles'

export interface RecordTargetBooking {
  id: string
  start: string
  end: string
  customer: string
  /** The booking's customer id — the join key into RecordCustomerFact (the
   *  picker dialog's 回数券/新規 chips) and the "booked TODAY" marker on search
   *  rows. Optional: a pair-16 DTO predates the field. */
  customerId?: string
  initials: string
  karute: string | null
  service: string
  staff: string
  /** Assigned staff id — drives the avatar color (same palette as the 予約 agenda). */
  staffId: string | null
  /** Distinct staff color, resolved from the full roster on the page
   *  (sessions/page.tsx via assignStaffColors). The picker avatar reads
   *  this through getStaffColorByKey — never a per-id hash — so a stylist's
   *  color matches every other surface. Null → neutral fallback. */
  staffColorKey: import('@/lib/staff-colors').StaffColor['key'] | null
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
  statusKey?: 'in-session' | 'booked' | 'new' | 'done' | 'walk-in'
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
  /** Idle with NO own booking today (mock A2, 8/19). Both handlers present →
   *  the card carries the two explicit actions: another stylist's customer is
   *  never offered here. Absent → the unbound placeholder, the OTHER
   *  null-appointment state (an anonymous record-anyway take in flight).
   *  Neither shows the day picker — it lists the whole salon. */
  onChooseCustomer?: () => void
  onRecordWithoutCustomer?: () => void
}

export function RecordingTargetCard({
  appointment,
  nearbyBookings = [],
  onSwitchBooking,
  onChooseCustomer,
  onRecordWithoutCustomer,
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

  // No OWN booking today (mock A2) — never guess a colleague's customer.
  // Two explicit ways forward: choose the customer, or record a walk-in and
  // bind them at save (the pre-existing record-anyway flow).
  if (!appointment && onChooseCustomer && onRecordWithoutCustomer) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-5 shadow-sm md:p-6">
        <header className="mb-4 flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center text-sky-400">
            <Clock size={16} />
          </span>
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
        </header>

        <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-4">
          <p className="text-[14px] font-semibold text-foreground">{t('noOwnBooking')}</p>
          <p className="mb-3.5 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {t('noOwnBookingHint')}
          </p>
          <div className="flex flex-col gap-2.5">
            {/* R13: solid accent for the commit action, quiet outline for the
             *  secondary. Plain buttons (like ChoosePickerButton below) — this
             *  card stays free of the @synqed-kk/ui import. */}
            <button
              type="button"
              onClick={onChooseCustomer}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              <Search size={17} />
              {t('chooseCustomer')}
            </button>
            <button
              type="button"
              onClick={onRecordWithoutCustomer}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Mic size={17} />
              {t('recordWithoutCustomer')}
            </button>
          </div>
        </div>
        <p className="mt-2.5 px-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {t('walkInFootnote')}
        </p>
      </section>
    )
  }

  // Still no bound target, and the two actions aren't on offer — an anonymous
  // 選択せずに録音する take is in flight (A-1, 8/19). Minimal UNBOUND
  // placeholder: the 別の予約を選択 picker must never render in a null-target
  // state, in ANY of them, because its sheet lists the WHOLE salon's day —
  // the back door around the own-customer-only rule. Switching mid-take was
  // already inert (handleSwitchBooking no-ops while live), so nothing is lost.
  if (!appointment) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-5 shadow-sm md:p-6">
        <header className="mb-4 flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center text-sky-400">
            <Clock size={16} />
          </span>
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
        </header>

        <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-4">
          <p className="text-[13px] font-medium text-foreground/90">{t('noBooking')}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {t('unboundHint')}
          </p>
        </div>
      </section>
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
              <span className="min-w-0 truncate text-base font-semibold text-foreground">
                {appointment.customerName}
              </span>
              <span className="shrink-0 text-[13px] text-muted-foreground">{t('honorific')}</span>
              {appointment.karuteNumber && (
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
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
  // Walk-in (no booking) — neutral 当日 pill, NOT 施術中. A walk-in has no
  // reservation, so a booking-status badge would be misleading.
  if (statusKey === 'walk-in') {
    return (
      <span className={`inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11px] font-medium ${badge('slate')}`}>
        {t('walkIn')}
      </span>
    )
  }
  if (statusKey === 'in-session') {
    return (
      <span className={`inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11px] font-medium ${badge('orange')}`}>
        {t('inSession')}
      </span>
    )
  }
  if (isNew || statusKey === 'new') {
    return (
      <span className={`inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11px] font-medium ${badge('blue')}`}>
        {t('firstVisit')}
      </span>
    )
  }
  if (statusKey === 'done') {
    return null
  }
  return (
    <span className={`inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11px] font-medium ${badge('green')}`}>
      {t('booked')}
    </span>
  )
}
