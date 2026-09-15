'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel'
import { useUnreadCount } from '@/lib/notifications/hooks'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import {
  DayWeekMonthToggle,
  MonthGrid,
  ReservationPageHeader,
  type DayWeekMonthView,
  type MonthGridCell,
} from '@synqed-kk/ui'
import { useTranslations, useLocale } from 'next-intl'
import { Bell, CalendarPlus } from 'lucide-react'
import { useRouter, usePathname } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import {
  formatCompactDateJst,
  formatLongDateJst,
  jstStartOfToday,
  jstWallTimeToDate,
  ymdInJst,
} from '@/lib/date/jst'
import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import { ReservationMobileAgenda } from '@/components/karute/spike-lifted/reservation/ReservationMobileAgenda'
import {
  ReservationStaffFilter,
  type ReservationStaffEntry,
} from '@/components/karute/spike-lifted/reservation/ReservationStaffFilter'
import { ReservationTotals } from '@/components/reservation/ReservationTotals'
import { DayNumbersLine } from '@/components/appointments/DayNumbersLine'
import { WeekRows } from '@/components/appointments/WeekRows'
import { DateJumpPanel } from '@/components/appointments/DateJumpPanel'
import { NewBookingDialog } from '@/components/appointments/NewBookingDialog'
import { BookingActionSheetWrapper } from '@/components/appointments/BookingActionSheetWrapper'
import { CancelBookingSheet } from '@/components/appointments/CancelBookingSheet'
import { cn } from '@/lib/utils'
import type { OrgSettings } from '@/actions/org-settings'
import type { AppointmentRow } from '@/actions/appointments'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import type { CachedMenuOption } from '@/lib/menus/cached'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import type { ReservationStaff } from '@/components/reservation/StaffRow'
import type { BusinessHours } from '@/components/reservation/TimeAxis'

interface AppointmentsViewProps {
  staff: {
    id: string
    name: string
    avatarInitials: string
    avatarUrl?: string
    /** 経営メンバー — hidden from the booking picker's default list (the 担当
     *  view filter below keeps offering everyone). */
    isManagement?: boolean
  }[]
  activeStaffId: string | null
  authProfileId: string | null
  customers: CustomerOption[]
  locale: string
  orgSettings: OrgSettings | null
  initialAppointments?: AppointmentRow[]
  initialView: DayWeekMonthView
  selectedDateIso: string
  weekData: WeekDayRowData[] | null
  weekStartIso: string | null
  monthData: MonthGridCell[] | null
  monthStartIso: string | null
  /** The SELECTED day's row — the day line's four numbers, from the same
   *  adapter the week rows come from, so the two surfaces cannot disagree.
   *  Null = a server or a baked bundle that predates the field; the old
   *  ReservationTotals stays as the honest fallback for exactly that case. */
  dayTotals: WeekDayRowData | null
  /** The window could not be read to exhaustion, so screen.ts nulled weekData,
   *  monthData and dayTotals. The WEB page never hands this over — it throws
   *  before it renders and the route error boundary shows the retry screen;
   *  the THIN screen passes `dto.truncated`, and on that door an incomplete
   *  read used to reach the 「データがありません」 branch below (R1-2, D5). */
  truncated?: boolean
  /** The salon's `solo_mode` capability, resolved SERVER-side (screen.ts).
   *  Never read org settings in here: the thin door carries none, so a view-
   *  side read would hand the phone a silent `false`. */
  soloMode: boolean
  reservationViews: ReservationView[]
  reservationStaff: ReservationStaff[]
  /** The ACTIVE STORE's staff ids — the grid's color palette source (a
   *  経営メンバー dropping out of the lanes must not repaint anyone). */
  colorRosterIds?: readonly string[]
  businessHours: BusinessHours
  /** Active staff filter ('all' | 'self' | <staffId>) read from ?staff= URL
   *  param by the server. The ReservationStaffFilter widget mutates the URL
   *  to change scope; this prop is just for highlighting the active pill. */
  staffFilter: string
  /** Active menu catalog for the booking dialog's picker. Degraded-allowed:
   *  absent/[] just means the dialog keeps its free-text service field. */
  menus?: CachedMenuOption[]
  /** The date-jump panel's month reader, injected by the host: the web page
   *  passes the getMonthCells server action, the thin screen passes a facade
   *  GET (that route is Bearer-only, so the two cannot share one door — see
   *  getMonthCells' comment). A rejection is honest: that month shows its
   *  「取得できませんでした」 line and retries on the next visit. */
  loadMonthCells: (monthKey: string) => Promise<MonthCellDTOType[]>
}

// The header's date chip is rendered by @synqed-kk/ui, which exposes no class
// hook, ref or open-state prop for it — but `dateDisplay` IS a ReactNode, so
// the chip's own copy carries the marker these rules select on. Scoped to the
// wrapper below; no package change, and no marker just means no pressed state.
// The chip's own colors are plain single-class utilities, so :has() outranks
// them on specificity and the order these land in the sheet doesn't matter.
//
// Spelled out in FULL, never composed from a shared `button:has(…)` constant:
// Tailwind extracts class candidates from source TEXT, so an interpolated
// class name generates no CSS at all and the pressed state dies silently
// (verified against the built stylesheet, which is the only honest check).
// ⚖ R3-16 — the ease was missing, so the rotation inherited Tailwind's
// default `cubic-bezier(.4, 0, .2, 1)` (an ease-in-out) and loitered before it
// turned, while DateJumpPanel's own chevron left immediately on the mock's
// curve. 160 ms was already right; the two chevrons now agree on both numbers.
const CHIP_CHEVRON =
  '[&_button:has([data-date-jump-chip])>svg]:transition-transform [&_button:has([data-date-jump-chip])>svg]:duration-[160ms] [&_button:has([data-date-jump-chip])>svg]:ease-[cubic-bezier(0.23,1,0.32,1)] [&_button:has([data-date-jump-chip])>svg]:motion-reduce:transition-none'
// R13 selected recipe (CLAUDE.md) — never a solid fill.
const CHIP_OPEN =
  '[&_button:has([data-date-jump-chip])]:border-primary [&_button:has([data-date-jump-chip])]:bg-primary/8 [&_button:has([data-date-jump-chip])]:text-primary [&_button:has([data-date-jump-chip])>svg]:rotate-180'

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
  // Staff cancel flow: long-press an active row → confirm (hold-pill) sheet;
  // tap a greyed キャンセル済み row → cancelled sheet with 元に戻す.
  const [cancelTarget, setCancelTarget] = useState<{
    view: ReservationView
    mode: 'confirm' | 'cancelled'
  } | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const unreadCount = useUnreadCount()
  // Hide the bell while recording (same posture as RecordPageHeader)
  // so the layout-level DiscreetRecordingIndicator doesn't overlap
  // it on scroll. Bell returns when recording stops.
  const { state: recState } = useGlobalRecorder()
  const isRecording = recState === 'recording' || recState === 'paused'
  // 日付ジャンプ (2026-09-14): the chip opens the app's own calendar panel.
  // The hidden native date input it used to call showPicker() on is GONE —
  // one door to a date, and the OS wheel was never the one staff wanted.
  const [pickerOpen, setPickerOpen] = useState(false)
  const dateJumpAnchorRef = useRef<HTMLDivElement>(null)

  const view = props.initialView
  // R1-2 (D5): a cut-off read must SAY so. `truncated` nulls weekData
  // server-side, and a null week that is not still arriving means the read did
  // not answer the question — both used to land on 「データがありません」 below,
  // a calm empty week that reads as "nothing booked". `!isPending` is what
  // keeps a fresh mount mid-transition out of it.
  const weekFailed =
    view === 'week' && (props.truncated === true || (props.weekData === null && !isPending))
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
    // ⚖ spec §1/§6: 自分 / 全スタッフ / 担当 feeds EVERY number on every
    // surface — it is applied at the FETCH (`staff_id` on appointments.list),
    // not at render. A move that dropped it would not look broken: the page
    // would simply show the whole salon's numbers under a 担当 pill that still
    // reads as selected, with nothing on screen saying the scope changed.
    // 'all' is left out on purpose — `parseStaffParam(undefined)` already
    // resolves to it, so spelling it would only add noise to the URL.
    if (props.staffFilter && props.staffFilter !== 'all') {
      search.set('staff', props.staffFilter)
    }
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
    setPickerOpen((o) => !o)
  }

  const headerDate = selectedDate

  return (
    // System padding rule: page wrapper owns its horizontal padding
    // (the (app) layout no longer provides any). Matches the spike's
    // reservation page wrapper (`px-4 md:px-6`). Cards inside this
    // wrapper sit at 16/24px from edge — chrome (date selector, toggles,
    // legend) lands at the same offset for visual alignment.
    // space-y-4 (Liam 8/7): the date-nav row and the 日週月/filter row
    // both carry borders — 12px read as touching; 16px matches the
    // 顧客/カルテ header rhythm.
    <div className="relative space-y-4 px-4 md:px-6">
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

      {/* R13 (2026-08-06): the app-level karute-theme accent override in
       *  globals.css turned --color-accent blue system-wide, so the old
       *  .reservation-today-blue wrapper and the custom dark newBookingSlot
       *  (the "intentional black button" — carve-out killed by Liam 8/6)
       *  are gone; the package defaults now render Today + new-booking in
       *  the accent. */}
      {/* The anchor for the date-jump panel: the chip and the panel live in
       *  ONE box, so a pointerdown on the chip is never "outside" the panel
       *  (which would close it just as the chip's own click reopens it). */}
      <div
        ref={dateJumpAnchorRef}
        className={cn('relative mb-0', CHIP_CHEVRON, pickerOpen && CHIP_OPEN)}
      >
      <ReservationPageHeader
        // Header structure contract (Liam 8/7): mb-0 kills the package's
        // baked mb-4 — and, same property, the page's space-y-4 margin
        // (v4 space-y is a zero-specificity :where() rule) — so the pt-6
        // wrapper below owns the whole 24px seam. Same natural-height
        // row as 顧客/カルテ (32px controls set the height).
        // The anchor wrapper above carries mb-0 too, and for the second
        // half of that reason: since the date-jump panel moved the anchor
        // in between, IT is the direct child space-y-4 measures — this
        // header is a grandchild, so its own mb-0 no longer meets the
        // :where() rule it used to cancel (measured: 40px seam, not 24).
        className="mb-0"
        dateDisplay={
          <span data-date-jump-chip>{formatLongDateJst(headerDate, locale)}</span>
        }
        dateDisplayCompact={
          <span data-date-jump-chip>{formatCompactDateJst(headerDate, locale)}</span>
        }
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onPickDate={handlePickDate}
        // Unified create pill (Liam 8/6, 案A): the package default is an
        // icon-only square on mobile — the slot override keeps the same
        // shared-Button「+ ラベル」pill as the 顧客/カルテ list pages. The
        // slot bypasses the package's onNewBooking/newReservationLabel
        // props entirely, so they are not passed — the slot's own onClick
        // and label are the single source of truth.
        newBookingSlot={
          <Button
            type="button"
            aria-label={tReservation('new')}
            onClick={() => setDialogOpen(true)}
          >
            <CalendarPlus className="size-3.5 min-[380px]:hidden" aria-hidden />
            <span className="hidden min-[380px]:inline">{tReservation('new')}</span>
          </Button>
        }
        // @synqed-kk/ui ships English defaults baked into the component
        // ("Today", "New Reservation", etc.). Same pattern as the
        // DayWeekMonthToggle — pass localized strings via the `copy`
        // prop so the JA build reads "今日" instead of "Today".
        copy={{
          title: tReservation('title'),
          todayLabel: tReservation('today'),
          prevLabel: tReservation('prev'),
          nextLabel: tReservation('next'),
        }}
      />

      <DateJumpPanel
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        anchorRef={dateJumpAnchorRef}
        selectedDate={selectedDate}
        // In 月 mode the page already holds this month's cells — no fetch.
        seedCells={view === 'month' ? props.monthData : null}
        loadMonthCells={props.loadMonthCells}
        // MODE PRESERVED: picking a day never switches 日/週/月.
        onPickDay={(date) => navigateTo(view, date)}
        weekdayLabels={monthWeekdayLabels}
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
      {/* pt-6 = the whole 24px seam (Liam 8/7): both neighbors are
       *  bordered controls and 16px read as touching. The header's mb-0
       *  zeroes space-y-4's contribution too (same margin property,
       *  higher specificity), so this padding is the seam's single
       *  owner. Padding, not margin: margins collapse. */}
      <div className="pt-6">
      <ReservationStaffFilter
        staffList={props.staff.map<ReservationStaffEntry>((s) => ({
          id: s.id,
          name: s.name,
          initials: s.avatarInitials,
          isManagement: s.isManagement,
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
      </div>

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
            {/* The day's numbers (spec §2 / mock §v9d): one flowing line of
             *  四 values, above the list, from the SAME adapter row the week
             *  page renders — the two surfaces cannot disagree. Its own
             *  `mb-2` is the whole seam to the list card, so it sits OUTSIDE
             *  the space-y-6 wrapper's rhythm by design (§v9c: "no extra
             *  margin beyond the page's normal 8px").
             *  ReservationTotals stays ONLY while `dayTotals` is null — a
             *  stale phone bundle or a server that predates the field. */}
            {props.dayTotals ? (
              <DayNumbersLine
                row={props.dayTotals}
                soloMode={props.soloMode}
                // PKT-2 owns the strict 新規/再来 producer; today's
                // newCustomerCount is the QR import flag and must not print
                // (spec §8). 'off' = the fill order supplies the fourth cell.
                typeSlot="off"
                locale={props.locale}
              />
            ) : null}
            <div className="hidden md:block">
              {/* Desktop grid keeps terminal (cancelled/no-show) rows hidden
               *  for now — a greyed grid-block treatment is a follow-up;
               *  phones are the staff device. The mobile agenda below renders
               *  them as tombstones. */}
              <ReservationGrid
                staff={props.reservationStaff}
                colorRosterIds={props.colorRosterIds}
                reservations={props.reservationViews.filter((r) => !r.isCancelled && !r.isNoShow)}
                businessHours={props.businessHours}
                onSelect={setSelected}
              />
            </div>
            <div className="md:hidden">
              <ReservationMobileAgenda
                selectedDateYmd={ymdInJst(selectedDate)}
                reservations={props.reservationViews}
                onSelect={setSelected}
                onLongPress={(v) => setCancelTarget({ view: v, mode: 'confirm' })}
                onSelectCancelled={(v) => setCancelTarget({ view: v, mode: 'cancelled' })}
              />
            </div>
            {/* Totals must not count terminal rows — a no-show is not a
             *  visit, and a burned ticket is accounted in packs, not here.
             *  FALLBACK ONLY (PKT-1b-WIRE W-B): once `dayTotals` arrives, the
             *  numbers line above says the same thing better and this block
             *  goes away. Kept for the skew window where an old server or an
             *  old baked bundle sends no row — blanking the day's totals
             *  there would be a silent regression. */}
            {props.dayTotals ? null : (
              <ReservationTotals
                reservations={props.reservationViews.filter((r) => !r.isCancelled && !r.isNoShow)}
              />
            )}
          </>
        ) : view === 'week' && (weekFailed || (props.weekData && props.weekStartIso)) ? (
          /* The app-local seven-row week (spec §3 / mock §v5-§v6), replacing
           *  @synqed-kk/ui's WeekDayCard grid: the package card cannot show a
           *  single number 1a put on the wire. The rolling 7 days from the
           *  selected day are KEPT (spec F6) — `computeWeekRange` still owns
           *  the range; never the mock's Monday snap. */
          <WeekRows
            rows={props.weekData ?? []}
            weekStartIso={props.weekStartIso ?? ''}
            selectedDateIso={ymdInJst(selectedDate)}
            todayIso={ymdInJst(today)}
            soloMode={props.soloMode}
            // PKT-2 owns the strict 新規/再来 producer; today's
            // newCustomerCount is the QR import flag and must not print
            // (spec §8). 'off' = the fill order supplies the fourth cell.
            typeSlot="off"
            locale={props.locale}
            // The router transition IS the week's pending state: during a
            // ‹ / › / 今日 / calendar move the rows on screen still describe
            // the OLD week. The wrapper's 50% dim says "busy"; the shimmer
            // pills say WHICH numbers are not to be read yet (mock
            // weekSumHTML/weekGridHTML's `pend` branch).
            // R1-2 (D5): the failed line, with its retry tail, instead of the
            // 「データがありません」 branch. WeekRows renders it alone — no rows,
            // no summary — so `rows` above is only the not-failed path's data.
            failed={weekFailed}
            pending={isPending}
            // jstWallTimeToDate, not `new Date(iso)`: a bare parse of
            // "2026-09-17" is UTC midnight, which is the 16th in JST — the
            // tap would open the wrong day for the whole JST morning.
            onPickDay={(iso) => navigateTo('day', jstWallTimeToDate(iso, '00:00'))}
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
          /* 「データがありません」 — reached only when the read ANSWERED and
           *  there is nothing to show: a 月 with no monthData (that door's own
           *  failed line is #921's next round, D11), or a 週 whose first data
           *  has not arrived yet while the router transition is still pending.
           *  A cut-off 週 no longer lands here — it renders WeekRows' failed
           *  line above (R1-2). */
          <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-card)] p-8 text-center text-sm text-[var(--color-text-muted)] ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {tReservation('empty.noData')}
          </div>
        )}
      </div>

      <NewBookingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customers={props.customers}
        staff={props.staff.map((s) => ({
          id: s.id,
          name: s.name,
          isManagement: s.isManagement,
        }))}
        selfStaffId={props.authProfileId}
        menus={props.menus}
        initialDate={ymdInJst(selectedDate)}
        initialStaffId={props.activeStaffId}
        onCreated={() => startTransition(() => router.refresh())}
      />

      <BookingActionSheetWrapper
        selected={selected}
        onClose={() => setSelected(null)}
      />

      <CancelBookingSheet
        booking={cancelTarget?.view ?? null}
        mode={cancelTarget?.mode ?? 'confirm'}
        onClose={() => setCancelTarget(null)}
      />

      <NotificationsPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </div>
  )
}
