'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel'
import { useUnreadCount } from '@/lib/notifications/hooks'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import {
  DayWeekMonthToggle,
  ReservationPageHeader,
  type DayWeekMonthView,
} from '@synqed-kk/ui'
import { useTranslations, useLocale } from 'next-intl'
import { Bell, CalendarPlus } from 'lucide-react'
import { useRouter, usePathname } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  formatCompactDateJst,
  formatLongDateJst,
  jstStartOfToday,
  jstWallTimeToDate,
  ymdInJst,
} from '@/lib/date/jst'
import { jstMidnight } from '@/lib/date/calendar-range'
import {
  firstDayOfMonthKey,
  monthKeyInJst,
  monthKeyOf,
  shiftMonthKey,
} from '@/lib/appointments/date-jump'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import { ReservationMobileAgenda } from '@/components/karute/spike-lifted/reservation/ReservationMobileAgenda'
import {
  ReservationStaffFilter,
  type ReservationStaffEntry,
} from '@/components/karute/spike-lifted/reservation/ReservationStaffFilter'
import { ReservationTotals } from '@/components/reservation/ReservationTotals'
import { DayNumbersLine } from '@/components/appointments/DayNumbersLine'
import { WeekRows } from '@/components/appointments/WeekRows'
import { MonthPage } from '@/components/appointments/MonthPage'
import { SelectedDayCard } from '@/components/appointments/SelectedDayCard'
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
import type { MonthCell, WeekDayRowData } from '@/lib/adapters/reservation'
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
  monthData: MonthCell[] | null
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
//
// R2-1 (LENS-1 #1, HIGH) — 月 no longer advances via `next.setMonth()`: raw
// Date month arithmetic overflows from a 31st (8/31 › used to land on 10/1,
// skipping September whole; 3/31 ‹ didn't move at all). The month step goes
// through the SAME helpers `onPickMonth` below already uses — one home, no
// new date math — landing on the target month's 1st, or on `today` when the
// target IS the current month.
function shiftDate(date: Date, view: DayWeekMonthView, dir: 1 | -1, today: Date): Date {
  if (view === 'day') {
    const next = new Date(date)
    next.setDate(next.getDate() + dir)
    return next
  }
  if (view === 'week') {
    const next = new Date(date)
    next.setDate(next.getDate() + dir * 7)
    return next
  }
  const targetKey = shiftMonthKey(monthKeyInJst(date), dir)
  return targetKey === monthKeyInJst(today) ? today : firstDayOfMonthKey(targetKey)
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
  // LENS-1 1B-WIRE L1-5 — the same rule, the same reason, on the 月 page. A
  // month the server could not read to exhaustion arrived here as a calm
  // 「データがありません」 card: a phone staring at an EMPTY month when the truth
  // is "we could not read it" is the one lie a booking screen must not tell,
  // and it is worse on a month than on a week (thirty days of nothing).
  const monthFailed =
    view === 'month' && (props.truncated === true || (props.monthData === null && !isPending))
  const selectedDate = new Date(props.selectedDateIso)
  const selectedIso = ymdInJst(selectedDate)
  // B3 — the ring moves on the FINGER, not on the round trip. The page only
  // learns the new day when the server answers (web: the transition commits;
  // phone: the DTO lands), which is several hundred ms of a cell that does not
  // look tapped — and 「tap a day = stay」 lives or dies on that feeling.
  //
  // R1-1 (LENS-1 #1) — the hold belongs to the MOVE that opened it, never to
  // the day the page happens to be showing. The first shape held `{ iso, from }`
  // and compared `from` against the current selection, so coming BACK to the day
  // the tap was made from — 今日, the back gesture, the date-jump panel — re-armed
  // a spent hold: the ring and the chip sat on a day the page had already left
  // and the card stayed pending forever, with an invisible door into the wrong
  // day. So the hold is discarded at BOTH ends of its own move: the effect below
  // spends it when its answer lands, and `navigateTo` spends it when any other
  // navigation starts (a 今日 press that re-selects the day already selected
  // changes no prop at all, so the effect alone could not see it).
  const [tappedHold, setTappedHold] = useState<{ iso: string; target: string } | null>(null)
  const shownDayIso = tappedHold?.iso ?? selectedIso
  // G2 (Greptile round 1, FIX-932-G1) — the effect above only spends the hold
  // when ITS OWN answer lands (`tappedHold.iso === selectedIso`). The back
  // gesture (web: the browser back button; phone: the OS back swipe) is the
  // other way a move ends: it never calls `navigateTo`, so neither
  // `tappedHold` nor `selectedIso` (still A's, since B's DTO never arrived)
  // ever changes — the effect never re-runs and the hold sat on B forever
  // while the page was back on A (the exact freeze LENS-1 named).
  // `target` is the search string `navigateTo` pushed for this move; the
  // CURRENT location's search — the same `next/navigation` hook both the web
  // page and the shell already expose (the shell's own via the vite alias,
  // no new listener) — is the one thing that changes the instant the browser
  // actually leaves that target, landed or not.
  //
  // G2B — on the web, `useSearchParams()` keeps A's search until the
  // transition COMMITS (Next resolves the new tree first, then the URL), so
  // `currentSearch !== target` reads true for the whole time B is in flight —
  // `abandoned` alone spent the hold the instant it was armed. `isPending` is
  // the one signal that is true for that entire trip on the web (and always
  // false on the phone, where pushState commits synchronously): a move still
  // in flight is never abandoned.
  const currentSearch = useSearchParams().toString()
  useEffect(() => {
    if (!tappedHold) return
    const landed = tappedHold.iso === selectedIso
    const abandoned = !isPending && currentSearch !== tappedHold.target
    if (landed || abandoned) setTappedHold(null)
  }, [tappedHold, selectedIso, currentSearch, isPending])
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

  function navigateTo(nextView: DayWeekMonthView, nextDate: Date): string {
    // R1-1 — any move spends the held tap. A month-cell tap re-arms it right
    // after this call (both writes are urgent and batch into one commit, so the
    // newest finger wins); every other door — the arrows, 今日, the date-jump
    // panel, the view switch, the card's own door — leaves it spent.
    setTappedHold(null)
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
    // G2 — the target this move is heading for, returned so a month-cell tap
    // can key its hold to it (see tappedHold's declaration above).
    const target = search.toString()
    startTransition(() => {
      router.push(`${pathname}?${target}` as Parameters<typeof router.push>[0])
    })
    return target
  }

  function handlePrev() {
    navigateTo(view, shiftDate(selectedDate, view, -1, today))
  }
  function handleNext() {
    navigateTo(view, shiftDate(selectedDate, view, 1, today))
  }
  function handleToday() {
    navigateTo(view, today)
  }
  function handlePickDate() {
    setPickerOpen((o) => !o)
  }
  // R2-4 (LENS-1 #4 rider) — this used to be a brand-new inline arrow built
  // INSIDE the JSX ternary on every render (`(year, month) => navigateTo(...)`
  // as an onPickMonth prop expression). A plain named function, like
  // handlePrev/handleNext/handleToday above, is this component's own idiom
  // for that — this repo's React Compiler auto-memoizes plain functions in a
  // render body on its own (its `react-hooks/preserve-manual-memoization`
  // lint refuses a manual `useCallback` wrapper here: `today`, a plain
  // mutable Date, is not a dependency it can prove is safe to key on).
  // B1 · B4 — a 月-page cell tap SELECTS the day and STAYS on the month page:
  // `?date=` moves, `?view=` does not (C2). Both doors already re-read the
  // whole screen for the new date, so the selected day's rows and its
  // `dayTotals` arrive in the SAME payload as the month cells — no second
  // action, no second fetch, nothing to keep in sync.
  //
  // With `selectedDayCard` OFF there is no card for the selection to fill, so
  // the tap has to take the staff member somewhere: it keeps today's behaviour
  // and opens the day page. The switch is honest either way — it never leaves
  // a tap doing nothing.
  function handlePickMonthDay(iso: string) {
    const date = jstWallTimeToDate(iso, '00:00')
    if (!BOOKING_SWITCHES.selectedDayCard) {
      navigateTo('day', date)
      return
    }
    const target = navigateTo('month', date)
    setTappedHold({ iso, target })
  }
  function handlePickMonth(year: number, month: number) {
    navigateTo(
      'month',
      monthKeyOf(year, month) === monthKeyInJst(today) ? today : jstMidnight(year, month, 1),
    )
  }

  // The chip names the SELECTED day, and §v11b is why that matters here: the
  // card below has no date header precisely because this chip already says
  // which day it describes. So in 月 mode the chip follows the ring — held tap
  // included — or for the whole round trip the ring sits on one day while the
  // only thing naming a day says another. 日/週 are untouched: nothing there
  // moves ahead of the server.
  const headerDate =
    view === 'month' ? jstWallTimeToDate(shownDayIso, '00:00') : selectedDate

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
        // (v4 space-y is a zero-specificity :where() rule) — so the
        // wrapper below owns the whole seam (9px since 9/15, the mock's
        // own number; 24px before that). Same natural-height row as
        // 顧客/カルテ (32px controls set the height).
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
        // MODE PRESERVED: picking a day never switches 日/週/月 — so in 月
        // mode this IS navigateTo('month', date): the page stays on the month
        // page and the tapped day becomes its selection.
        onPickDay={(date) => navigateTo(view, date)}
        weekdayLabels={monthWeekdayLabels}
        // ⚖ §v11b — in 月 mode the chip opens on the twelve month chips, never
        // a day grid over a day grid (the two calendars looked identical, which
        // is what started this whole round). 日/週 are unchanged.
        defaultLevel={view === 'month' ? 2 : 1}
        // ⚖ §v11 point 1 / spec §1 — in 月 mode the chip's twelve month chips
        // are the whole point of opening at level 2: picking one LANDS that
        // month on the page (the mock's mGrid handler, MOCK 1263-1272), it
        // does not drop into a day grid the staff member did not ask for.
        // Selection = the 1st, or TODAY when the pick is the current month, so
        // 「今月」 through the chip and 今日 agree. 日/週 pass nothing and keep
        // the panel's own level-2 → level-1 behaviour.
        onPickMonth={view === 'month' ? handlePickMonth : undefined}
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
      {/* THE SEAM, AND THE ONE THAT OWNS IT — the approved mock's own two
       *  numbers (DATE-JUMP-PICKER-MOCK.html, measured at 393 on the phone
       *  shell, not read off the CSS):
       *
       *    date-bar control bottom → 日/週/月 control top   =  9px
       *    日/週/月 control bottom → the page's next block  = 11px
       *
       *  In the mock those two fall out of the row boxes (a 56px date bar
       *  holding a 40px control leaves 8px under it; the 52px filter row
       *  centres its 40px control in a 42px content box, leaving 1px above
       *  and 1px + its 10px padding below). This page's rows are natural
       *  height — tight around their 32px controls — so the seam has to be
       *  stated here instead, and these are the two places to state it: the
       *  padding above, and the margin that replaces space-y-4's 16px below
       *  (space-y-4 is a zero-specificity :where() rule, so a normal mb-*
       *  utility wins — the same mechanism as the anchor's mb-0 above).
       *
       *  SUPERSEDES the 8/7 24px seam (pt-6): that number predates the
       *  calendar mock Liam approved on 9/14, and on 9/15 he measured this
       *  page against the mock and the 24px read as a gap. Padding above,
       *  not margin: margins collapse. */}
      <div className="pt-[9px] mb-[11px]">
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
      {/* R1-6 (LENS-3 #3 + #4) — the 月 branch sits OUTSIDE the pending
       *  wrapper below, and that is the whole point of PIECE 4b. The wrapper's
       *  `pointer-events-none opacity-50` is the 日/週 treatment: those views
       *  LEAVE on a tap, and blocking input for the round trip is what stops a
       *  second 翌日 tap re-pushing a stale-derived date. Since 4b a 月 cell tap
       *  STAYS, so that same wrapper was locking the page's primary gesture for
       *  the whole read — a second day tap during a pending one vanished with no
       *  acknowledgement at all — and washing the grid, the ring the finger had
       *  just landed and the card down to 50 % under a second, longer curve that
       *  fought the card's own 120 ms. The month page keeps its input and its
       *  full strength; the card's two shims are what says "working", and a tap
       *  during a pending read simply replaces the pending move. `aria-busy`
       *  stays — it says busy without taking the page away. */}
      {view === 'month' && (monthFailed || props.monthData) ? (
        /* The app-local month grid + month line (spec §4 / mock §v10-§v11c),
         *  replacing @synqed-kk/ui's MonthGrid ON THE PAGE. The package grid
         *  has no selected day, no 休 cell, and prints its day numbers from a
         *  raw Date — the runtime's local day, which on the UTC server is
         *  yesterday's. The pop-down keeps rendering through it (approved,
         *  byte-frozen); the page does not. */
        /* ONE block, not two: the grid and its card are one thing, and the 8 px
         *  between them is the mock's own seam (`.dayline{margin:0 0 8px}`'s
         *  rhythm), not the page's 24 px section gap. It is a direct child of
         *  the page's own `space-y-4` now, exactly where the dimmed wrapper
         *  used to sit, so the gap above it is unchanged. */
          <div aria-busy={isPending}>
          <MonthPage
            cells={props.monthData ?? []}
            // B3 — the OPTIMISTIC day, so the ring lands under the finger; it
            // is the real selection the rest of the time.
            selectedDateIso={shownDayIso}
            todayIso={ymdInJst(today)}
            weekdayLabels={monthWeekdayLabels}
            // PKT-2 owns the strict 新規/再来 producer; today's
            // newCustomerCount is the QR import flag and must not print
            // (spec §8). 'off' = the month line is 予約 alone, never a
            // substitute metric in that slot.
            typeSlot="off"
            locale={props.locale}
            // The router transition IS the month line's pending state, exactly
            // as it is the week's: mid-move the total on screen is the month
            // being left.
            pending={isPending}
            // A cut-off read renders the failed line ALONE — no grid numbers,
            // no month line — exactly as WeekRows does with `failed`.
            failed={monthFailed}
            // B1 — tap a day = STAY. The month page is a place you read, not a
            // launcher: the tap moves the selection and the card below answers
            // it. The day page is one more tap away, through the card's door.
            onPickDay={handlePickMonthDay}
            // R1-2 (D-1) — a leading/trailing cell belongs to the month either
            // side, so tapping it MOVES THE PAGE to that month with that day
            // selected, exactly as the mock's grid handler does. It never opens
            // a day page: the staff member tapped a date in a month they are
            // not looking at, and the answer to that is to show them the month.
            onPickOtherMonthDay={(iso) => navigateTo('month', jstWallTimeToDate(iso, '00:00'))}
          />
          {/* B2 — what the tap is FOR. It reads the payload the page already
           *  holds (the selected day's rows + its dayTotals ride in with the
           *  month cells), so it costs no read of its own.
           *
           *  `mt-2` is the mock's 8 px seam to the grid card, and it is the
           *  only rule on it now: this block carries no space-y of its own, so
           *  the grid and the card sit at the mock's 8 px and nothing else.
           *
           *  A failed month renders no card at all — the page already SAYS the
           *  read failed, and a calm empty card under that sentence would take
           *  it back. */}
          {BOOKING_SWITCHES.selectedDayCard && !monthFailed && (
            <SelectedDayCard
              className="mt-2"
              dateIso={shownDayIso}
              rows={props.reservationViews}
              dayTotals={props.dayTotals}
              soloMode={props.soloMode}
              locale={props.locale}
              // The answer for the tapped day has not landed yet: on the web
              // the transition is still running, on the phone the DTO is still
              // in flight, and in BOTH cases the rows on screen are the day
              // being moved away from.
              pending={isPending || shownDayIso !== selectedIso}
              onOpenDay={(iso) => navigateTo('day', jstWallTimeToDate(iso, '00:00'))}
            />
          )}
          </div>
      ) : (
      <div
        data-pending-dim
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
                // R3-18 — the router transition IS this line's pending state,
                // exactly as it is the week's: during a ‹ / › / 今日 / calendar
                // move the numbers still on screen describe the OLD day. The
                // line shows the mock's two shims instead of reading as this
                // day's totals.
                pending={isPending}
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
        ) : (
          /* 「データがありません」 — reached only while a router transition is
           *  still in flight and that view's first data has not arrived yet.
           *  Neither a cut-off 週 (R1-2) nor a cut-off 月 (A5b) lands here any
           *  more: both render their own failed line above, which SAYS the read
           *  failed instead of painting an empty calendar. */
          <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-card)] p-8 text-center text-sm text-[var(--color-text-muted)] ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {tReservation('empty.noData')}
          </div>
        )}
      </div>
      )}

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
