// Appointments-screen assembly (design-parity P-B). The 予約 page's Stage-2
// derivation — staff pickers, 新規/回数券/no-show enrichment folding, agenda
// views, week/month projections — extracted from the page body onto explicit
// inputs so the web page and the facade screen GET render from ONE
// implementation (the buildRecordScreen / runKaruteChat shape). Pure and
// synchronous by design: every read happens in the caller (cookie fan-out on
// the page, Bearer fan-out in the facade route), so this can never re-fetch
// or diverge between the two.

import type { DayWeekMonthView, MonthGridCell } from '@synqed-kk/ui'
import type { Appointment } from '@synqed-kk/client'
import type { AppointmentRow } from '@/actions/appointments'
import type { OrgSettings } from '@/actions/org-settings'
import type { StaffMember } from '@/lib/staff'
import type { CachedCustomerOption } from '@/lib/customers/cached'
import type { CustomerEnrichment } from '@/lib/customers/list-enrich'
import type { ReservationStaff } from '@/components/reservation/StaffRow'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { staffRoleLabel } from '@/lib/staff/role-label'
import {
  appointmentsToWeekData,
  appointmentsToMonthCells,
  appointmentsToMonthFacts,
  type WeekDayRowData,
} from '@/lib/adapters/reservation'
import type { AppointmentWindow } from '@/lib/appointments/by-date'
import type { DayHoursFact } from '@/lib/operating-hours'
import { appointmentsToReservationViews } from '@/lib/adapters/reservation-view'
import { isReturningCustomer } from '@/lib/customers/status-signals'
import { firstVisitFromBooking } from '@/lib/customers/first-visit'
import { newCountByDay, type FirstVisitInputs } from '@/lib/appointments/first-visit'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { getOperatingHoursForDate } from '@/lib/operating-hours'
import { jstStartOfToday, partsInJst } from '@/lib/date/jst'
import { jstMidnight } from '@/lib/date/calendar-range'
import { isClassBoundBusinessType } from '@/lib/welcome/business-types'
import type { CapacityFact, LaneKind } from '@/lib/capacity/capacity'
import type { computeWeekRange, computeMonthRange } from '@/lib/date/calendar-range'

export function parseDateParam(value: string | undefined): Date {
  // Interpret the ?date= YYYY-MM-DD as a JST calendar day. Vercel runs in
  // UTC so `new Date(y, m, d)` would otherwise create a UTC-local instant
  // and the day-view would render the wrong day for half the JST clock.
  if (!value) return jstStartOfToday()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return jstStartOfToday()
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`)
  return isNaN(d.getTime()) ? jstStartOfToday() : d
}

export function parseViewParam(value: string | undefined): DayWeekMonthView {
  return value === 'week' || value === 'month' ? value : 'day'
}

/**
 * Parse the ?staff= URL param into one of:
 *   - 'all'     — every staff's bookings (matches the spike default)
 *   - 'self'    — only the signed-in user's bookings
 *   - <staffId> — a specific staff member's bookings (per-staff pill)
 *
 * Defaults to 'all' to mirror the design spike — the reservation tab is the
 * salon-wide schedule, not a per-staff todo. The Self/All toggle + per-staff
 * pills are rendered by the AppointmentsView; this reader keeps the URL as
 * the single source of truth.
 */
export function parseStaffParam(value: string | undefined): string {
  if (!value) return 'all'
  if (value === 'all' || value === 'self') return value
  // Treat anything else as a staff_profile_id — validated downstream.
  return value
}

// No `view` input: the week/month ranges (null = day view) already encode it —
// the caller resolves view → ranges before the build.
export interface AppointmentsScreenInputs {
  locale: string
  now: Date
  selectedDate: Date
  staffFilter: string
  staffList: StaffMember[]
  /** The viewer's own staff/profile id, RAW (unclamped): the 'self' filter is
   *  about the viewer, not the store's picker. */
  activeStaffId: string | null
  /** Active store's staff-id lens (null = no filtering / fail open). */
  storeStaffIds: Set<string> | null
  orgSettings: OrgSettings | null
  customers: CachedCustomerOption[]
  dayAppointments: AppointmentRow[]
  weekRange: ReturnType<typeof computeWeekRange> | null
  monthRange: ReturnType<typeof computeMonthRange> | null
  weekRangeAppts: Appointment[] | null
  monthRangeAppts: Appointment[] | null
  /** The partitioned windows (fetchAppointmentWindow). A window WINS over the
   *  matching legacy array above; the arrays stay so every existing caller and
   *  test keeps compiling. */
  weekWindow?: AppointmentWindow | null
  monthWindow?: AppointmentWindow | null
  /** The selected day's own window — fetched only in day view; in week/month
   *  view the selected day is already inside the bigger window. */
  dayWindow?: AppointmentWindow | null
  /** That day's resolved hours, keyed by JST YYYY-MM-DD (resolveWindowHours). */
  hoursFacts?: ReadonlyMap<string, DayHoursFact>
  /** THIS STORE's vertical — the per-store column when core carries it, else
   *  the business-wide setting; both doors resolve it that way. It decides one
   *  thing only: whether the store is class-bound, where one booking row is
   *  many people and no percentage is honest at any layer. Absent/null reads
   *  as not class-bound. */
  businessType?: string | null
  enrichment: Map<string, CustomerEnrichment>
  packUsage: ReadonlyMap<string, { remaining: number; size: number }>
}

export interface AppointmentsScreen {
  staff: {
    id: string
    name: string
    avatarInitials: string
    avatarUrl?: string
    /** 経営メンバー — rides along so the booking picker AND the 担当 view
     *  filter's own default list (StaffSelector) can both default-hide them
     *  client-side, search reveals (⚖ 2026-09-01 overturn of Ⓒ). The LIST
     *  itself stays complete — the server must keep offering everyone. */
    isManagement?: boolean
  }[]
  reservationStaff: ReservationStaff[]
  /** The palette source for the day grid: every staff id in the ACTIVE STORE
   *  (the same store-scoped list the lanes are filtered from), NOT the business
   *  roster. assignStaffColors hands out colors by sorted position, so feeding
   *  it the lane list — which the management rule now shortens — would re-hue
   *  everyone after a hidden member on the days that member is idle. Taking the
   *  store list one level up fixes that: hues are stable across a toggle flip
   *  because the store roster doesn't move when the flag does.
   *
   *  Deliberately NOT the business roster: under the store-isolation law a
   *  branch's staff must not receive other stores' ids at all, and this array
   *  ships to the client. The residual cost is that appointment CARDS are still
   *  colored business-wide (appointmentsToReservationViews), so in a
   *  multi-store tenant a lane avatar and a card avatar can pick different hues
   *  for the same person — the pre-existing #496 mismatch, unchanged by this
   *  PR rather than fixed by it. */
  colorRosterIds: string[]
  visibleActiveStaffId: string | null
  reservationViews: ReservationView[]
  businessHours: { start: number; end: number }
  weekData: WeekDayRowData[] | null
  weekStartIso: string | null
  monthData: MonthGridCell[] | null
  /** The month's capacity facts, keyed by the cell's own id (JST YYYY-MM-DD),
   *  beside the cells rather than inside them: MonthGridCell is the package's
   *  type and cannot grow app fields. Built from the SAME rows and the same
   *  counted-row predicate as the cells, so a cell's dot and its percentage
   *  can never describe different days. In-month days only — the padding
   *  cells render no numbers. */
  monthFacts: ReadonlyMap<string, CapacityFact> | null
  /** ⚖ PKT-2 — the month's 新規 count per JST day, keyed by the cell's own id,
   *  beside the cells for the same reason monthFacts is. From the SAME window
   *  memo the week rows and the day totals read, so one day cannot come out
   *  two ways on one screen. Null when the month was not read. */
  monthNewCounts: ReadonlyMap<string, number> | null
  monthStartIso: string | null
  /** The SELECTED day's row, from the same adapter the week rows come from —
   *  so the day line and the week row can never disagree. Null when no window
   *  covers the selected day, or when the read was truncated. */
  dayTotals: WeekDayRowData | null
  /** Any window could not be read to exhaustion. Then weekData, monthData and
   *  dayTotals are ALL null and the surface renders the failed-read state —
   *  never a low number. */
  truncated: boolean
  /** The salon's `solo_mode` capability, resolved HERE from org settings so
   *  the view never reads settings itself (the thin door carries no
   *  orgSettings at all — reading them in the view would hand the phone a
   *  silent `false` and kill the 未設定 discriminator, spec §8). */
  soloMode: boolean
}

/**
 * Which CORE staff id should the window fetch filter on?
 *
 * `appointments.staff_id` is a CORE staff id; the app's roster, the ?staff=
 * param and the viewer's own id are PROFILE (auth) ids. Sending a profile id as
 * `staff_id` would filter to nothing and read as "an empty week".
 *
 *   'all'                        → no filter
 *   'self' with a viewer id      → that viewer's core id
 *   'self' with no viewer id     → no filter (exactly the day path's behaviour)
 *   a profile id in the map      → its core id
 *   an UNLINKED core id (a map VALUE, i.e. already core-side) → itself
 *   anything else                → unknown: the caller ships an EMPTY window,
 *                                  never an unfiltered one
 */
export function resolveFetchStaffId(
  staffFilter: string,
  activeStaffId: string | null,
  coreStaffByProfileId: ReadonlyMap<string, string>,
): { staffId: string | null; unknown: boolean } {
  if (staffFilter === 'all') return { staffId: null, unknown: false }
  const wanted = staffFilter === 'self' ? activeStaffId : staffFilter
  if (!wanted) return { staffId: null, unknown: false }
  const mapped = coreStaffByProfileId.get(wanted)
  if (mapped) return { staffId: mapped, unknown: false }
  for (const coreId of coreStaffByProfileId.values()) {
    if (coreId === wanted) return { staffId: wanted, unknown: false }
  }
  return { staffId: null, unknown: true }
}

export function buildAppointmentsScreen(
  input: AppointmentsScreenInputs,
): AppointmentsScreen {
  const {
    locale,
    now,
    selectedDate,
    staffFilter,
    staffList,
    activeStaffId,
    storeStaffIds,
    orgSettings,
    customers,
    dayAppointments,
    weekRange,
    monthRange,
    weekRangeAppts,
    monthRangeAppts,
    weekWindow,
    monthWindow,
    dayWindow,
    hoursFacts,
    businessType,
    enrichment,
    packUsage,
  } = input

  // The 担当 pickers/filters below only offer the active store's staff
  // (floating staff included) — the full roster leaked every branch's staff
  // names into every store. Row-name resolution keeps the FULL staffList
  // (appointmentsToReservationViews) so a booking recorded by another
  // branch's staff still renders their name.
  const visibleStaff = storeStaffIds
    ? staffList.filter((s) => storeStaffIds.has(s.id))
    : staffList
  // Clamp the dialog default the same way: a cross-store viewer pinned to a
  // store they're not assigned to must not silently file a booking under
  // their own (hidden) id — treat it like an absent id (Greptile on #496).
  // The self-filter below keeps the RAW activeStaffId: "my bookings" is
  // about the viewer, not the store's picker.
  const visibleActiveStaffId =
    activeStaffId && storeStaffIds && !storeStaffIds.has(activeStaffId)
      ? null
      : activeStaffId

  const staff = visibleStaff.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    avatarInitials: (s.full_name ?? 'U').slice(0, 2).toUpperCase(),
    avatarUrl: s.avatar_url ?? undefined,
    isManagement: s.isManagement ?? false,
  }))

  // 経営メンバー drop OUT of the day grid — but only on days they have nothing
  // on. Counting ALL of today's rows, cancelled and no-show included, is
  // deliberate (Liam ruling Ⓑ): hiding the lane would make a same-day
  // cancellation vanish from the grid entirely, which is exactly when the
  // salon needs to see it. The viewer always keeps their own lane.
  //
  // A FILTER on the already-store-scoped list, never a union back over the
  // raw roster — a union would re-admit another branch's staff.
  const bookedToday = new Set(dayAppointments.map((a) => a.staff_profile_id))
  const reservationStaff: ReservationStaff[] = visibleStaff
    .filter(
      (s) =>
        !(s.isManagement ?? false) ||
        s.id === activeStaffId ||
        // Explicitly filtering 担当 to this person is a direct request to see
        // THEIR day — returning an empty grid instead would make the 担当
        // filter look broken on exactly the members it's required to keep
        // offering (this is the day-LANE list; the picker roster below is
        // separate and always complete — ⚖ 2026-09-01 overturn of Ⓒ moved
        // the "never hides" guarantee off the CLIENT filter, not off this
        // server-side lane rule).
        s.id === staffFilter ||
        bookedToday.has(s.id),
    )
    .map((s) => ({
      id: s.id,
      name: s.full_name ?? 'Unknown',
      // The person's own 役職 first; else the authority code mapped to Japanese
      // (never the raw enum — the grid was leaking "STYLIST" under every name).
      role: s.position ?? staffRoleLabel(s.display_role),
      // TODO(phase-1.5): wire synqed-core role to derive takesBookings
      takesBookings: true,
      initials: (s.full_name ?? '?').trim().slice(0, 1) || '?',
    }))

  // QR "returning customer" flag per client (cached customer list). A known
  // existing customer is NEVER 新規 — even with no karute/past appointment yet
  // (QR-migrated regulars who hold 回数券). Without this they all showed 新規.
  // Cached customer by id — carries the QR returning-signals (visit_count, 回数券).
  const cachedById = new Map(customers.map((c) => [c.id, c] as const))
  // "First-time customer" = NOT returning, via the SAME resolver signal the 顧客
  // list + profile use (isReturningCustomer). One source of truth → a 回数券 or
  // visit_count regular is never shown 新規 here while reading 継続中 elsewhere.
  const isFirstTimeByClient = new Map<string, boolean>()
  for (const [id, e] of enrichment.entries()) {
    const cc = cachedById.get(id)
    isFirstTimeByClient.set(
      id,
      !isReturningCustomer({
        joinDateIso: null,
        lastVisitIso: null,
        isExistingCustomer: cc?.isExistingCustomer,
        visitCount: cc?.visitCount,
        // QR flag OR a real ticket_packs ledger entry — a manually-registered
        // pack holder is returning even before QR knows about them.
        hasTicketPack: (cc?.hasTicketPack ?? false) || packUsage.has(id),
        karuteCount: e.totalKarute,
        pastAppointmentCount: e.pastAppointmentCount,
      }),
    )
  }
  // The reservation system outranks inference (Liam's rule): a booking on a
  // 新規 course IS a first visit; a booking on any other named course means
  // returning — our own missing history proves nothing. Titleless bookings
  // keep the inferred value set above.
  for (const a of dayAppointments) {
    const fromBooking = firstVisitFromBooking(a.title)
    if (fromBooking !== null) isFirstTimeByClient.set(a.client_id, fromBooking)
  }

  // Sequential salon karute number per customer — same helper + same cached
  // customer list the 顧客 page + karute detail use, so the agenda row's
  // #00139 matches every other surface exactly (it sorts deterministically).
  const karuteNumberByClientId = assignSequentialKaruteNumbers(customers)

  // `now` (wall-clock) is intentional here: computeDisplayStatus needs to
  // know whether an appointment is past/in-progress/future relative to right
  // now, not to the date being viewed.
  // Prior no-show totals ride the SAME enrichment read fetched by the caller
  // (zero extra calls) — the cancel sheet derives its first-time/repeat line
  // from this, and the repeat chip reads it, so all surfaces agree with the
  // 顧客 list's 無断欠席 badge.
  const noShowCountByClient = new Map<string, number>()
  for (const [id, e] of enrichment.entries()) {
    noShowCountByClient.set(id, e.noShowCount)
  }

  const allReservationViews = appointmentsToReservationViews(
    dayAppointments,
    staffList,
    now,
    isFirstTimeByClient,
    karuteNumberByClientId,
    packUsage,
    noShowCountByClient,
  )

  // Apply the Self/All/specific-staff filter. URL is the source of truth so
  // the back button restores the scope and links can deep-link a specific
  // staff's day (?staff=<id>).
  const reservationViews = (() => {
    if (staffFilter === 'all') return allReservationViews
    if (staffFilter === 'self') {
      if (!activeStaffId) return allReservationViews
      return allReservationViews.filter((r) => r.staffId === activeStaffId)
    }
    return allReservationViews.filter((r) => r.staffId === staffFilter)
  })()

  const dayOpHours = getOperatingHoursForDate(orgSettings?.operating_hours, selectedDate)
  const businessHours = {
    start: Math.floor(dayOpHours.openMinute / 60),
    end: Math.ceil(dayOpHours.closeMinute / 60),
  }

  // Project the caller's range fetches into the week/month data shapes the
  // AppointmentsView expects — synchronous transforms of already-read rows.
  //
  // A WINDOW wins over the legacy raw array: the array carries no terminal
  // partitions and no truncation flag, so it is only the compatibility shape
  // for callers that have not moved to fetchAppointmentWindow yet.
  const asWindow = (rows: Appointment[] | null | undefined): AppointmentWindow | null =>
    rows ? { counted: rows, cancelled: [], noShow: [], truncated: false } : null
  const weekWin = weekWindow ?? asWindow(weekRangeAppts)
  const monthWin = monthWindow ?? asWindow(monthRangeAppts)
  const dayWin = dayWindow ?? null
  const truncated = [weekWin, monthWin, dayWin].some((w) => w?.truncated === true)

  // The week's average business-hours minutes — the fallback denominator for a
  // day whose capacity is NOT defensible (the adapter's unchanged arithmetic).
  // Without a week range the selected day's own org hours are that fallback, so
  // the week rows and dayTotals always share one number.
  const fallbackDayMinutes = weekRange
    ? (() => {
        let sum = 0
        const cur = new Date(weekRange.weekStart)
        for (let i = 0; i < 7; i++) {
          const dh = getOperatingHoursForDate(orgSettings?.operating_hours, cur)
          sum += Math.max(0, dh.closeMinute - dh.openMinute)
          cur.setDate(cur.getDate() + 1)
        }
        return Math.round(sum / 7)
      })()
    : Math.max(0, dayOpHours.closeMinute - dayOpHours.openMinute)

  // ⚖ PKT-2 — the 新規 producer. What stood here was a set of customers
  // carrying the QuickReserve `is_existing_customer === false` import flag: a
  // different source answering a different question, and the number it fed
  // never printed. It is deleted rather than kept beside the new rule — two
  // formulas for one number is how a screen starts contradicting its own list.
  //
  // Per WINDOW, never per day: rule (3) needs the whole window to find a
  // customer's earliest booking. Memoized by window object, so the week rows
  // and the selected day's totals read the SAME map — the same day cannot come
  // out two ways on one screen.
  const firstVisitInputs: FirstVisitInputs = { enrichment, packUsage }
  const newCountCache = new Map<AppointmentWindow, ReadonlyMap<string, number>>()
  const newCountsFor = (win: AppointmentWindow): ReadonlyMap<string, number> => {
    let m = newCountCache.get(win)
    if (!m) newCountCache.set(win, (m = newCountByDay(win.counted, firstVisitInputs)))
    return m
  }
  const soloMode = orgSettings?.solo_mode === true

  // ── THE DIVISOR (S4) — the same store lens the pickers use, counted ───────
  //
  // `storeStaffIds` is already bounded by the clamp's store on BOTH doors (web:
  // storeStaffIdSet(staffList, scope.storeId); facade:
  // storeStaffIdSetForBusiness(staffList, clamp.storeId, businessId)), and
  // filterStaffIdsToStore only ever keeps ids drawn from `staffList`, so the
  // lens IS the store's roster ∩ the business roster. Deriving the headcount
  // here rather than in each door is what makes the store-isolation invariant
  // provable at ONE site for both — no other store's staff count can reach a
  // divisor, because no other store's ids are in this set.
  //
  // But the POSTURE flips. A null lens means "no store to ask, or the
  // assignment read failed"; the pickers read that as "show everyone" (fail
  // open, which is right for a list), and a divisor must read it as "we do not
  // know this store's roster" and hand out NO capacity — never the business
  // roster (C1 §5 / C3 E28). Same value, opposite default, on purpose.
  //
  // Every StaffRole counts: OWNER, ADMIN, STYLIST and ASSISTANT all take
  // bookings and the SDK has no non-booking role, so there is nothing to
  // filter on. A receptionist is therefore counted — a recorded overcount,
  // closed when a real `takesBookings` exists.
  const rosterHeadcount = storeStaffIds ? storeStaffIds.size : null
  // 自分/担当 = ONE person's day, so ONE lane (the module's caller contract
  // (a)), and the window was already filtered at the fetch. The exception is
  // 'self' with no resolvable viewer id: that fetch is NOT filtered and the
  // views below fall back to the whole salon, so the day keeps the store's
  // roster rather than dividing a salon by one person.
  const filteredToOnePerson =
    staffFilter !== 'all' && !(staffFilter === 'self' && !activeStaffId)
  const capacityRoster = filteredToOnePerson ? 1 : rosterHeadcount
  // ── THE LANE KIND (S5) ───────────────────────────────────────────────────
  // A yoga class of twelve is ONE booking row, so minutes booked over minutes
  // open is a percentage of nothing. Those stores always take the count table
  // — at every layer, behind every switch, until core models class capacity
  // (C1 §6 / C2). Read from the STORE's own vertical where core carries it,
  // so a chain can run a studio next to a salon.
  const laneKind: LaneKind = isClassBoundBusinessType(businessType) ? 'none' : 'staff'

  const rowsFor = (win: AppointmentWindow, from: Date, to: Date): WeekDayRowData[] =>
    appointmentsToWeekData(
      win.counted,
      from,
      to,
      fallbackDayMinutes,
      now,
      locale,
      newCountsFor(win),
      { cancelled: win.cancelled, noShow: win.noShow },
      hoursFacts,
      soloMode,
      { rosterHeadcount: capacityRoster, laneKind },
    )

  let weekData: WeekDayRowData[] | null = null
  let monthData: MonthGridCell[] | null = null
  let monthFacts: ReadonlyMap<string, CapacityFact> | null = null
  let monthNewCounts: ReadonlyMap<string, number> | null = null
  let weekStartIso: string | null = null
  let monthStartIso: string | null = null

  if (weekRange && weekWin) {
    if (!truncated) {
      weekData = rowsFor(weekWin, weekRange.weekStart, weekRange.weekEnd)
    }
    weekStartIso = weekRange.weekStart.toISOString()
  } else if (monthRange && monthWin) {
    if (!truncated) {
      monthData = appointmentsToMonthCells(
        monthWin.counted,
        monthRange.monthStart,
        monthRange.monthEnd,
        now,
      )
      // The same rows, the same month, one call beside the other — the cells
      // and their facts cannot come from different reads.
      monthFacts = appointmentsToMonthFacts(
        monthWin.counted,
        monthRange.monthStart,
        monthRange.monthEnd,
        { hoursFacts, soloMode, rosterHeadcount: capacityRoster, laneKind },
      )
      // Same window, same memo as the week rows would take — a month cell's
      // 新規 and the week row's 新規 for one day are one number.
      monthNewCounts = newCountsFor(monthWin)
    }
    monthStartIso = monthRange.monthStart.toISOString()
  }

  // The selected day's row, from the SAME adapter — its own window when one was
  // fetched, else the week/month window IF the selected day genuinely lies
  // inside it (a day outside the fetched range would read 0件, which is a lie).
  const covers = (r: { rangeFrom: Date; rangeTo: Date } | null): boolean =>
    r != null && selectedDate >= r.rangeFrom && selectedDate <= r.rangeTo
  const dayTotalsWindow =
    dayWin ??
    (weekWin && covers(weekRange) ? weekWin : monthWin && covers(monthRange) ? monthWin : null)
  let dayTotals: WeekDayRowData | null = null
  if (dayTotalsWindow && !truncated) {
    const p = partsInJst(selectedDate)
    const dayStart = jstMidnight(p.year, p.month, p.day)
    dayTotals = rowsFor(dayTotalsWindow, dayStart, dayStart)[0] ?? null
  }

  return {
    staff,
    reservationStaff,
    colorRosterIds: visibleStaff.map((s) => s.id),
    visibleActiveStaffId,
    reservationViews,
    businessHours,
    weekData,
    weekStartIso,
    monthData,
    monthFacts,
    monthNewCounts,
    monthStartIso,
    dayTotals,
    truncated,
    soloMode,
  }
}
