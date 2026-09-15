// Appointments-screen assembly (design-parity P-B). The 予約 page's Stage-2
// derivation — staff pickers, 新規/回数券/no-show enrichment folding, agenda
// views, week/month projections — extracted from the page body onto explicit
// inputs so the web page and the facade screen GET render from ONE
// implementation (the buildRecordScreen / runKaruteChat shape). Pure and
// synchronous by design: every read happens in the caller (cookie fan-out on
// the page, Bearer fan-out in the facade route), so this can never re-fetch
// or diverge between the two.

import type { DayWeekMonthView } from '@synqed-kk/ui'
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
  type MonthCell,
  type WeekDayRowData,
} from '@/lib/adapters/reservation'
import { countedClientIds, type AppointmentWindow } from '@/lib/appointments/by-date'
import { monthCompareDeltaFrom, monthCompareWindow } from '@/lib/appointments/month-compare'
import { isTerminalStatus } from '@/lib/appointments/status'
import type { DayHoursFact } from '@/lib/operating-hours'
import { appointmentsToReservationViews } from '@/lib/adapters/reservation-view'
import {
  isNewCustomerForDay,
  newCountByDay,
  titleVerdictByClient,
  type NewCustomerInputs,
} from '@/lib/appointments/first-visit'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { getOperatingHoursForDate } from '@/lib/operating-hours'
import { jstStartOfToday, partsInJst } from '@/lib/date/jst'
import { jstMidnight } from '@/lib/date/calendar-range'
import { isClassBoundBusinessType } from '@/lib/welcome/business-types'
import type { CapacityFact, LaneKind } from '@/lib/capacity/capacity'
import type { computeWeekRange, computeMonthRange } from '@/lib/date/calendar-range'

/** ⚖ R1-2 — the withheld answer, shared so every surface of a screen whose
 *  history read failed reads the same empty map rather than its own. */
const EMPTY_NEW_COUNTS: ReadonlyMap<string, number> = new Map()

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
  /** ⚖ R1-5 — the store's booking roster for the CAPACITY DIVISOR, from
   *  `rosterForStore`: assigned to this store or explicitly floating, and
   *  NEVER a member no assignment row could place. Same roster as the lens
   *  above, opposite posture, because they answer different questions: a
   *  picker may be generous, a denominator may not. null = no store to ask or
   *  the assignment read failed → no capacity at all. */
  divisorStaffIds?: Set<string> | null
  /** ⚖ R1-9 — the 担当 filter named somebody the roster could not place, so
   *  the caller shipped an EMPTY window on purpose (resolveFetchStaffId's
   *  `unknown`). Zero rows is honest about the bookings and a lie about the
   *  store, so the day gets no capacity rather than one lane at 0 %. */
  staffFilterUnknown?: boolean
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
  /** The PREVIOUS month's compared window (monthCompareWindow's range) — read
   *  only in month view, and only while the 先月同期間比 switch is on. Absent →
   *  the clause has no number and stays absent. */
  prevMonthWindow?: AppointmentWindow | null
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
  monthData: MonthCell[] | null
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
  /** ⚖ R1-2 — false when the history read behind the 新規 rule did not happen,
   *  so every 新規 number on this screen is 0 and none of them may print. Rides
   *  beside `monthNewCounts` for the month cells (each week row carries its
   *  own copy, because rows travel alone through the wire and the metric
   *  menu). */
  newCountKnown: boolean
  monthStartIso: string | null
  /** 先月同期間比 — the displayed month's counted bookings so far MINUS the same
   *  elapsed span of the previous month. Null = no honest number, so the clause
   *  is absent (a future month, a truncated read, or no base to compare with);
   *  see month-compare.ts for the three cases. */
  monthCompareDelta: number | null
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
    divisorStaffIds,
    staffFilterUnknown,
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
    prevMonthWindow,
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

  // Cached customer by id — carries the QR returning-signals (the
  // existing-customer import flag, visit_count, 回数券).
  const cachedById = new Map(customers.map((c) => [c.id, c] as const))
  // ⚖ R1-1 — the day list's 新規 tag, from THE shared predicate.
  //
  // The rule itself has not changed a conjunct: a known existing customer is
  // never 新規 even with no karute/past appointment yet (QR-migrated regulars —
  // without that guard they all showed 新規), a 回数券 holder is never 新規, and
  // the day's course names outrank our inference either way. It MOVED, into
  // `lib/appointments/first-visit.ts`, because the 新規 NUMBER beside this list
  // now counts exactly what this map tags. Two functions for one question is
  // how a screen starts contradicting its own list — which is what the number's
  // own rule was doing on four measured inputs before R1.
  const firstVisitInputs: NewCustomerInputs = {
    customers: cachedById,
    enrichment,
    packUsage,
  }
  // ⚖ R2-1 — same row-set as newCountByDay's own verdict: a CANCELLED/NO_SHOW
  // row's title must not force a verdict for a client's other, counted row.
  // dayAppointments carries terminal rows too (the agenda's includeCancelled
  // tombstones), which newCountByDay's window never sees — filter here so the
  // tag and the number build titleVerdictByClient from the same rows, not
  // just the same function.
  const dayTitleVerdict = titleVerdictByClient(
    dayAppointments
      .filter((a) => !isTerminalStatus(a.synqed_status))
      .map((a) => ({ clientId: a.client_id, title: a.title })),
  )
  const isFirstTimeByClient = new Map<string, boolean>()
  for (const a of dayAppointments) {
    isFirstTimeByClient.set(
      a.client_id,
      isNewCustomerForDay(a.client_id, dayTitleVerdict, firstVisitInputs),
    )
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

  // ⚖ PKT-2 / R1-1 — the 新規 producer, reading the SAME predicate the tag
  // above reads. It counts, per JST day, the people whose row on that day
  // carries the tag; nothing about a day's answer depends on which window the
  // day was read in, so the memo below is a cost saver and no longer a
  // correctness mechanism — the week row, the selected day's totals and the
  // month cell agree because the rule is the same, not because they share a
  // map.
  //
  // ⚖ R1-2 — and it FAILS CLOSED. An empty enrichment map beside a window that
  // genuinely holds customers does not mean none of them has ever been here: it
  // means the history read never happened (both doors resolve the business id
  // with a catch and then SKIP the call — page.tsx `getBusinessId().catch(() =>
  // null)`). The old rule answered that state with its maximal number — 新規 =
  // everybody — beside a list showing no 新規 chip at all. The number is
  // withheld instead. The LIST is untouched: an absent entry already reads
  // 予約済 there, which is why this is the number catching up, not a new rule.
  const newCountKnown =
    enrichment.size > 0 || countedClientIds(weekWin, monthWin, dayWin).length === 0
  const newCountCache = new Map<AppointmentWindow, ReadonlyMap<string, number>>()
  const newCountsFor = (win: AppointmentWindow): ReadonlyMap<string, number> => {
    if (!newCountKnown) return EMPTY_NEW_COUNTS
    let m = newCountCache.get(win)
    if (!m) newCountCache.set(win, (m = newCountByDay(win.counted, firstVisitInputs)))
    return m
  }
  const soloMode = orgSettings?.solo_mode === true

  // ── THE DIVISOR (S4) — the store's own booking roster, counted ──────────
  //
  // ⚖ R1-5: this is `divisorStaffIds`, NOT the picker lens beside it. Both
  // doors build it from `rosterForStore(…)`, bounded by the clamp's store
  // (web: page.tsx; facade: route.ts), and it only ever holds ids drawn from
  // `staffList` — so it IS the store's roster ∩ the business roster. Deriving
  // the headcount here rather than in each door is what makes the
  // store-isolation invariant provable at ONE site for both: no other store's
  // staff count can reach a divisor, because no other store's ids are in this
  // set.
  //
  // The picker's set differs by one arm, and that arm is the whole reason
  // there are two: `filterStaffIdsToStore` keeps a member it cannot LINK to an
  // assignment row in EVERY store, which is a generous list and an inflated
  // denominator — 銀座 divided by eight lanes when four people work there.
  //
  // The POSTURE flips too. A null lens means "no store to ask, or the
  // assignment read failed"; the pickers read that as "show everyone" (fail
  // open, which is right for a list), and a divisor must read it as "we do not
  // know this store's roster" and hand out NO capacity — never the business
  // roster (C1 §5 / C3 E28). Same value, opposite default, on purpose.
  //
  // Every StaffRole counts: OWNER, ADMIN, STYLIST and ASSISTANT all take
  // bookings and the SDK has no non-booking role, so there is nothing to
  // filter on. A receptionist is therefore counted — a recorded overcount,
  // closed when a real `takesBookings` exists.
  //
  // ⚖ R1-6: an EMPTY roster is not an answer either. `getStaffList` is graceful
  // by design — a failed profiles read resolves to [] — so a degraded web read
  // produced `Set{}`, which is not null and slipped past the gate above. The
  // module's lane FLOOR then set lanes to whoever happened to be booked, and
  // the store showed a confident percentage on exactly the days somebody worked
  // and nothing on the days nobody did: capacity derived from who got booked,
  // the one derivation this packet exists to forbid. A store with literally
  // zero staff has no capacity anyway, so nothing honest is lost by reading 0
  // as unknown.
  const rosterHeadcount = divisorStaffIds?.size ? divisorStaffIds.size : null
  // 自分/担当 = ONE person's day, so ONE lane (the module's caller contract
  // (a)), and the window was already filtered at the fetch. The exception is
  // 'self' with no resolvable viewer id: that fetch is NOT filtered and the
  // views below fall back to the whole salon, so the day keeps the store's
  // roster rather than dividing a salon by one person.
  const filteredToOnePerson =
    staffFilter !== 'all' && !(staffFilter === 'self' && !activeStaffId)
  // ⚖ R1-9 — except when the filter names somebody the roster cannot place.
  // That fetch is replaced with an EMPTY window by construction, so "one lane,
  // nothing booked" would print 稼働 0 % and 空き = the whole declared day for a
  // person nobody can find. Honest about the rows, a lie about the store.
  const capacityRoster = staffFilterUnknown
    ? null
    : filteredToOnePerson
      ? 1
      : rosterHeadcount
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
      { byDay: newCountsFor(win), known: newCountKnown },
      { cancelled: win.cancelled, noShow: win.noShow },
      hoursFacts,
      soloMode,
      { rosterHeadcount: capacityRoster, laneKind },
    )

  let weekData: WeekDayRowData[] | null = null
  let monthData: MonthCell[] | null = null
  let monthFacts: ReadonlyMap<string, CapacityFact> | null = null
  let monthNewCounts: ReadonlyMap<string, number> | null = null
  let weekStartIso: string | null = null
  let monthStartIso: string | null = null
  let monthCompareDelta: number | null = null

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
        // ONE source for 休: the same map the week rows read their own `closed`
        // from, so the month cell and the week row cannot disagree about a day.
        hoursFacts,
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
    // 先月同期間比. The displayed month's own window is one side of it, so the
    // clause and 「予約 N件」 are derived from the SAME rows; the other side is
    // the caller's extra read. Either read truncated → null, never a low
    // number (month-compare.ts).
    monthCompareDelta = monthCompareDeltaFrom(
      monthCompareWindow(monthRange.monthStart, now),
      monthWin,
      prevMonthWindow,
    )
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
    newCountKnown,
    monthStartIso,
    monthCompareDelta,
    dayTotals,
    truncated,
    soloMode,
  }
}
