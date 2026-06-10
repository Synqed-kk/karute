'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel'
import { useUnreadCount } from '@/lib/notifications/hooks'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
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
import { Bell, CalendarPlus } from 'lucide-react'
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
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const unreadCount = useUnreadCount()
  // Hide the bell while recording (same posture as RecordPageHeader)
  // so the layout-level DiscreetRecordingIndicator doesn't overlap
  // it on scroll. Bell returns when recording stops.
  const { state: recState } = useGlobalRecorder()
  const isRecording = recState === 'recording' || recState === 'paused'
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

  // Mon-first localized weekday headers for MonthGrid (2024-01-01 is a Monday).
  // Memoized — the 7 Intl.DateTimeFormat + 7 Date allocations only recompute
  // when the locale changes, not on every render.
  const monthWeekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2024, 0, 1 + i)),
        ),
      ) as [string, string, string, string, string, string, string],
    [locale],
  )

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
    // System padding rule: page wrapper owns its horizontal padding
    // (the (app) layout no longer provides any). Matches the spike's
    // reservation page wrapper (`px-4 md:px-6`). Cards inside this
    // wrapper sit at 16/24px from edge — chrome (date selector, toggles,
    // legend) lands at the same offset for visual alignment.
    <div className="relative space-y-3 px-4 md:px-6">
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

      {/* ─────────────────────────────────────────────────────────────
       *  Sticky title bar — 予約 + bell. Pattern matches the existing
       *  CustomersListHeader / KaruteRecordListView sticky bars so the
       *  three top-level mobile pages share the same chrome.
       *
       *  Bell is a STUB. Spike has the full notifications system built
       *  (8 categories, localStorage pub/sub + documented Supabase swap
       *  path). See MERGE_NOTES_FOR_ANTHONY.md "Notifications system"
       *  section for the end-to-end handoff:
       *    spike sources →
       *      src/lib/notifications.ts          (state layer + Supabase
       *                                          swap docs inline)
       *      src/mock/notifications.ts         (NotificationItem schema +
       *                                          8 categories)
       *      src/components/notifications/NotificationsPanel.tsx
       *                                         (drawer UI)
       *      src/components/layout/MobileHeader.tsx (bell + unread badge)
       *
       *  Pre-merge: click does nothing. Bell can stay a stub for the
       *  visual; notifications land in their own PR. The button is
       *  positioned absolutely on the right of the centered title so a
       *  red `<span>` unread-count badge can be overlaid on the icon
       *  later without restructuring (spike uses `useUnreadCount()`).
       *  ─────────────────────────────────────────────────────────────
       */}
      {/* Mobile-hidden — the global MobileHeader (layout-level) now
       *  owns mobile chrome (title + bell). Showing both produced
       *  doubled bars at the top of every list page. Desktop keeps
       *  this local sticky bar so the title + bell stay reachable
       *  on wider viewports. */}
      <div className="sticky top-0 z-20 -mx-4 hidden border-b border-border/40 bg-background/80 px-4 backdrop-blur md:-mx-6 md:block md:px-6">
        <div className="relative flex items-center justify-center py-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
            {tReservation('title')}
          </h1>
          {!isRecording && (
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className="absolute right-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={tCommon('notifications')}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-none tabular-nums text-white ring-2 ring-background"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Wrapper scopes --color-accent to blue so the package's Today
       *  button (which uses `text-[var(--color-accent)]`) renders blue
       *  + clickable, matching the spike. Hover gets a blue tint via
       *  the package's `hover:bg-[var(--color-accent)]/10`. CSS rule
       *  defined in globals.css under `.reservation-today-blue`.
       *
       *  newBookingSlot is REQUIRED here — the package's default
       *  new-booking button also uses --color-accent for its bg,
       *  which would tint blue from our wrapper. The spike + Liam
       *  want it dark/black (primary contrast against the page).
       *  Custom slot below uses bg-foreground / text-background so
       *  it's independent of --color-accent. */}
      <div className="reservation-today-blue">
        <ReservationPageHeader
          dateDisplay={formatLongDateJst(headerDate, locale)}
          dateDisplayCompact={formatCompactDateJst(headerDate, locale)}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
          onPickDate={handlePickDate}
          onNewBooking={() => setDialogOpen(true)}
          // @synqed-kk/ui ships English defaults baked into the component
          // ("Today", "New Reservation", etc.). Same pattern as the
          // DayWeekMonthToggle — pass localized strings via the `copy`
          // prop so the JA build reads "今日" instead of "Today".
          copy={{
            title: tReservation('title'),
            todayLabel: tReservation('today'),
            newReservationLabel: tReservation('new'),
            prevLabel: tReservation('prev'),
            nextLabel: tReservation('next'),
          }}
          // Replaces the package's default new-booking button so the
          // wrapper's blue --color-accent override doesn't leak into
          // the button's bg. Mirrors the package's default markup
          // (mobile icon-button, desktop labeled button) but uses
          // bg-foreground/text-background so the styling is locked
          // to dark regardless of the surrounding accent scope.
          newBookingSlot={
            <>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                aria-label={tReservation('new')}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-colors hover:opacity-90 md:hidden"
              >
                <CalendarPlus className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="hidden h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors hover:opacity-90 md:inline-flex"
              >
                <CalendarPlus className="size-3.5" aria-hidden />
                {tReservation('new')}
              </button>
            </>
          }
        />
      </div>

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

      {/* Legend — wrapped in a bordered card matching the spike.
       *
       *  Previously had a Loader2 chip rendered next to this box when
       *  `isPending` fired (during date-nav transitions). The chip
       *  appeared inline-after the legend, which forced flex-wrap to
       *  re-flow the legend pills around it — Liam called this out as
       *  "pushes one of the sections to the side, looks random and
       *  weird". Removed: the agenda's `transition-opacity` below
       *  already provides loading feedback (content drops to 50%
       *  opacity during pending). No additional indicator needed. */}
      <div className="hidden flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs md:flex">
        <span className="text-muted-foreground">
          {tReservation('legend.label')}
        </span>
        {/* Trimmed to the states that still mark rows (exceptions-only). */}
        {(['in_session', 'new'] as const).map(
          (tone) => (
            <span key={tone} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{
                  background: `var(--reservation-${tone.replace('_', '-')}-bg)`,
                  // solid for ALL — the dashed 新規 swatch was a legend-only artifact
                  // that never matched the actual badge (solid).
                  border: `1px solid var(--reservation-${tone.replace('_', '-')}-border)`,
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

      {/* space-y-6 (24px) — agenda card has visual weight (bg + rounded
       *  corners + content); the ReservationTotals beneath is light
       *  tabular text. Without explicit spacing the totals visually
       *  touched the card's bottom border (no space-y here previously,
       *  just transition-opacity). System rhythm convention for this
       *  page: chrome rows = space-y-3 (12px, tight); agenda → summary
       *  stats = space-y-6 (24px, generous so the eye reads them as
       *  distinct sections rather than a continuation of the list). */}
      <div
        className={`space-y-6 transition-opacity duration-150 ${isPending ? 'pointer-events-none opacity-50' : ''}`}
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
                selectedDateYmd={ymdInJst(selectedDate)}
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
              copy={{
                weekdayLabels: monthWeekdayLabels,
                legendLight: tReservation('month.legendLight'),
                legendMedium: tReservation('month.legendMedium'),
                legendBusy: tReservation('month.legendBusy'),
              }}
              onPickDay={(date) => navigateTo('day', date)}
              className="h-full"
            />
          </div>
        ) : (
          <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-card)] p-8 text-center text-sm text-[var(--color-text-muted)] ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {tReservation('empty.noData')}
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

      <NotificationsPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
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
  const locale = useLocale()
  const t = useTranslations('reservation.weekCard')
  const weekStart = new Date(weekStartIso)
  const copy = {
    todayBadge: t('today'),
    bookingsCountSuffix: t('bookings'),
    utilizedLabel: t('utilized'),
    openLabel: t('open'),
    newLabel: t('new'),
    reminderLabel: t('reminder'),
    consentLabel: t('consent'),
    pendingLabel: t('pending'),
    emptyLabel: t('empty'),
    moreLabel: t('more'),
  }
  const formatOpenDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (locale.startsWith('ja')) {
      return h > 0 ? (m > 0 ? `${h}時間${m}分` : `${h}時間`) : `${m}分`
    }
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
      {data.map((day, i) => {
        const date = new Date(weekStart)
        date.setDate(date.getDate() + i)
        return (
          <WeekDayCard
            key={i}
            data={day}
            copy={copy}
            formatOpenDuration={formatOpenDuration}
            onPick={() => onPickDay(date)}
          />
        )
      })}
    </div>
  )
}
