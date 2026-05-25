'use client'

import { useRef, useState, useTransition } from 'react'
import {
  DayWeekMonthToggle,
  MonthGrid,
  ReservationPageHeader,
  WeekDayCard,
  type DayWeekMonthView,
  type MonthGridCell,
  type WeekDayCardData,
} from '@synqed-kk/ui'
import { useTranslations, useLocale } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { useRouter, usePathname } from '@/i18n/navigation'
import {
  formatCompactDateJst,
  formatLongDateJst,
  jstStartOfToday,
  ymdInJst,
} from '@/lib/date/jst'
import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import { ReservationMobileAgenda } from '@/components/karute/spike-lifted/reservation/ReservationMobileAgenda'
import {
  ReservationStaffFilter,
  type ReservationStaffEntry,
} from '@/components/karute/spike-lifted/reservation/ReservationStaffFilter'
import { ReservationTotals } from '@/components/reservation/ReservationTotals'
import { NewBookingDialog } from '@/components/appointments/NewBookingDialog'
import { BookingActionSheetWrapper } from '@/components/appointments/BookingActionSheetWrapper'
import type { OrgSettings } from '@/actions/org-settings'
import type { AppointmentRow } from '@/actions/appointments'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import type { ReservationStaff } from '@/components/reservation/StaffRow'
import type { BusinessHours } from '@/components/reservation/TimeAxis'

interface AppointmentsViewProps {
  staff: {
    id: string
    name: string
    avatarInitials: string
    avatarUrl?: string
  }[]
  activeStaffId: string | null
  authProfileId: string | null
  customers: CustomerOption[]
  locale: string
  orgSettings: OrgSettings | null
  initialAppointments?: AppointmentRow[]
  initialView: DayWeekMonthView
  selectedDateIso: string
  weekData: WeekDayCardData[] | null
  weekStartIso: string | null
  monthData: MonthGridCell[] | null
  monthStartIso: string | null
  reservationViews: ReservationView[]
  reservationStaff: ReservationStaff[]
  businessHours: BusinessHours
  /** Active staff filter ('all' | 'self' | <staffId>) read from ?staff= URL
   *  param by the server. The ReservationStaffFilter widget mutates the URL
   *  to change scope; this prop is just for highlighting the active pill. */
  staffFilter: string
}

// formatLongDate / formatCompactDate / formatYmd all delegate to the JST
// helpers — karute is Japan-targeted, so display always reflects Tokyo
// wall-clock regardless of where the renderer is (Vercel UTC server vs.
// traveler-with-VPN browser).

// Cursor delta for prev/next, tuned to the visible chrome. The week/month
// views advance the full unit; the day view advances one day.
function shiftDate(date: Date, view: DayWeekMonthView, dir: 1 | -1): Date {
  const next = new Date(date)
  if (view === 'day') next.setDate(next.getDate() + dir)
  else if (view === 'week') next.setDate(next.getDate() + dir * 7)
  else next.setMonth(next.getMonth() + dir)
  return next
}

export function AppointmentsView(props: AppointmentsViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState<ReservationView | null>(null)
  const datePickerRef = useRef<HTMLInputElement>(null)

  const view = props.initialView
  const selectedDate = new Date(props.selectedDateIso)
  // `today` is reserved for the Today button (jump-to-now) — the displayed
  // header always reflects whichever date is currently selected.
  // jstStartOfToday() returns the UTC instant of JST 00:00 today, so
  // arithmetic on it (via shiftDate) stays consistent in JST.
  const today = jstStartOfToday()
  const locale = useLocale()
  const tReservation = useTranslations('reservation')
  const tCommon = useTranslations('common')

  function navigateTo(nextView: DayWeekMonthView, nextDate: Date) {
    const search = new URLSearchParams()
    search.set('view', nextView)
    search.set('date', ymdInJst(nextDate))
    startTransition(() => {
      router.push(
        `${pathname}?${search.toString()}` as Parameters<typeof router.push>[0],
      )
    })
  }

  function handlePrev() {
    navigateTo(view, shiftDate(selectedDate, view, -1))
  }
  function handleNext() {
    navigateTo(view, shiftDate(selectedDate, view, 1))
  }
  function handleToday() {
    navigateTo(view, today)
  }
  function handlePickDate() {
    const input = datePickerRef.current
    if (!input) return
    if (typeof input.showPicker === 'function') {
      input.showPicker()
    } else {
      input.focus()
      input.click()
    }
  }
  function handlePickerChange(value: string) {
    if (!value) return
    const [y, m, d] = value.split('-').map(Number)
    if (!y || !m || !d) return
    // Interpret the picker's YYYY-MM-DD as JST midnight, so the cursor
    // lands on the same calendar day in Tokyo regardless of runtime tz.
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    navigateTo(view, new Date(`${ymd}T00:00:00+09:00`))
  }

  const headerDate = selectedDate

  return (
    // No own `p-4 md:p-6` here — the (app) layout already wraps every page
    // in that padding. Doubling it pushed chrome + cards to 32px from the
    // screen edge instead of 16px, so the reservation page sat further in
    // than customers / karute (which never had this extra layer). Strip
    // the redundant wrapper so the whole system shares one consistent
    // 16px inset on mobile, matching the design spike's positioning.
    <div className="relative space-y-3">
      {/* Hidden native date picker; opened by the header's date button. */}
      <input
        ref={datePickerRef}
        type="date"
        defaultValue={ymdInJst(selectedDate)}
        onChange={(e) => handlePickerChange(e.target.value)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />

      <ReservationPageHeader
        dateDisplay={formatLongDateJst(headerDate, locale)}
        dateDisplayCompact={formatCompactDateJst(headerDate, locale)}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onPickDate={handlePickDate}
        onNewBooking={() => setDialogOpen(true)}
      />

      {/* Chrome: Day/Week/Month toggle + Self/All segmented + per-staff pills
       *  Row 1: DWM toggle (localized via copy prop — defaults to English
       *         in @synqed-kk/ui, which read wrong on the JA build) +
       *         Self/All segmented toggle on the same line.
       *  Row 2: per-staff colored pills.
       *  Wrapped in ReservationStaffFilter so the picker owns its own URL
       *  state — DWM is just slotted in via prependSlot.
       *
       *  Defaults to "全スタッフ" so the agenda reads as the whole-salon
       *  schedule (matches the spike's mobile screenshot Liam shared).
       *  Picker mutates ?staff= which the page reads server-side to
       *  refilter reservationViews. */}
      <ReservationStaffFilter
        staffList={props.staff.map<ReservationStaffEntry>((s) => ({
          id: s.id,
          name: s.name,
          initials: s.avatarInitials,
        }))}
        selfStaffId={props.activeStaffId}
        selected={props.staffFilter}
        prependSlot={
          <DayWeekMonthToggle
            view={view}
            onChange={(v) => navigateTo(v, selectedDate)}
            copy={{
              day: tReservation('view.day'),
              week: tReservation('view.week'),
              month: tReservation('view.month'),
            }}
          />
        }
      />

      {/* Legend — wrapped in a bordered card matching the spike. Same row
       *  as the loading spinner so the spinner anchors flush right. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {tReservation('legend.label')}
          </span>
          {(['booked', 'in_session', 'completed', 'new', 'pending'] as const).map(
            (tone) => (
              <span key={tone} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{
                    background: `var(--reservation-${tone.replace('_', '-')}-bg)`,
                    border: `1px ${tone === 'pending' || tone === 'new' ? 'dashed' : 'solid'} var(--reservation-${tone.replace('_', '-')}-border)`,
                  }}
                />
                {tReservation(`status.${tone}`)}
              </span>
            ),
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="reservation-block-pattern inline-block h-2.5 w-4 rounded-sm border border-border" />
            {tReservation('legend.block')}
          </span>
        </div>
        {isPending && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            {tCommon('loading')}
          </span>
        )}
      </div>

      <div
        className={`transition-opacity duration-150 ${isPending ? 'pointer-events-none opacity-50' : ''}`}
        aria-busy={isPending}
      >
        {view === 'day' ? (
          <>
            <div className="hidden md:block">
              <ReservationGrid
                staff={props.reservationStaff}
                reservations={props.reservationViews}
                businessHours={props.businessHours}
                onSelect={setSelected}
              />
            </div>
            <div className="md:hidden">
              <ReservationMobileAgenda
                reservations={props.reservationViews}
                onSelect={setSelected}
              />
            </div>
            <ReservationTotals reservations={props.reservationViews} />
          </>
        ) : view === 'week' && props.weekData && props.weekStartIso ? (
          <WeekGridSection
            data={props.weekData}
            weekStartIso={props.weekStartIso}
            onPickDay={(date) => navigateTo('day', date)}
          />
        ) : view === 'month' && props.monthData ? (
          <div className="md:h-[calc(100vh-260px)]">
            <MonthGrid
              cells={props.monthData}
              onPickDay={(date) => navigateTo('day', date)}
              className="h-full"
            />
          </div>
        ) : (
          <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-card)] p-8 text-center text-sm text-[var(--color-text-muted)] ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            No data.
          </div>
        )}
      </div>

      <NewBookingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customers={props.customers}
        staff={props.staff.map((s) => ({ id: s.id, name: s.name }))}
        initialDate={ymdInJst(selectedDate)}
        initialStaffId={props.activeStaffId}
        onCreated={() => startTransition(() => router.refresh())}
      />

      <BookingActionSheetWrapper
        selected={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

function WeekGridSection({
  data,
  weekStartIso,
  onPickDay,
}: {
  data: WeekDayCardData[]
  weekStartIso: string
  onPickDay: (date: Date) => void
}) {
  const weekStart = new Date(weekStartIso)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
      {data.map((day, i) => {
        const date = new Date(weekStart)
        date.setDate(date.getDate() + i)
        return (
          <WeekDayCard
            key={i}
            data={day}
            onPick={() => onPickDay(date)}
          />
        )
      })}
    </div>
  )
}
