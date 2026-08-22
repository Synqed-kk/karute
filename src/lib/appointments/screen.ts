// Appointments-screen assembly (design-parity P-B). The 予約 page's Stage-2
// derivation — staff pickers, 新規/回数券/no-show enrichment folding, agenda
// views, week/month projections — extracted from the page body onto explicit
// inputs so the web page and the facade screen GET render from ONE
// implementation (the buildRecordScreen / runKaruteChat shape). Pure and
// synchronous by design: every read happens in the caller (cookie fan-out on
// the page, Bearer fan-out in the facade route), so this can never re-fetch
// or diverge between the two.

import type { DayWeekMonthView, MonthGridCell, WeekDayCardData } from '@synqed-kk/ui'
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
} from '@/lib/adapters/reservation'
import { appointmentsToReservationViews } from '@/lib/adapters/reservation-view'
import { isReturningCustomer } from '@/lib/customers/status-signals'
import { firstVisitFromBooking } from '@/lib/customers/first-visit'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { getOperatingHoursForDate } from '@/lib/operating-hours'
import { jstStartOfToday } from '@/lib/date/jst'
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
  weekData: WeekDayCardData[] | null
  weekStartIso: string | null
  monthData: MonthGridCell[] | null
  monthStartIso: string | null
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
  let weekData: WeekDayCardData[] | null = null
  let monthData: MonthGridCell[] | null = null
  let weekStartIso: string | null = null
  let monthStartIso: string | null = null

  if (weekRange && weekRangeAppts) {
    // Average business-hours minutes across the week (a single number for the
    // utilization chip — close enough for the overview view).
    const totalMinutes = (() => {
      let sum = 0
      const cur = new Date(weekRange.weekStart)
      for (let i = 0; i < 7; i++) {
        const dh = getOperatingHoursForDate(orgSettings?.operating_hours, cur)
        sum += Math.max(0, dh.closeMinute - dh.openMinute)
        cur.setDate(cur.getDate() + 1)
      }
      return Math.round(sum / 7)
    })()

    const newCustomerIds = new Set(
      customers.filter((c) => !c.isExistingCustomer).map((c) => c.id),
    )
    weekData = appointmentsToWeekData(
      weekRangeAppts,
      weekRange.weekStart,
      weekRange.weekEnd,
      totalMinutes,
      now,
      locale,
      newCustomerIds,
    )
    weekStartIso = weekRange.weekStart.toISOString()
  } else if (monthRange && monthRangeAppts) {
    monthData = appointmentsToMonthCells(
      monthRangeAppts,
      monthRange.monthStart,
      monthRange.monthEnd,
      now,
    )
    monthStartIso = monthRange.monthStart.toISOString()
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
    monthStartIso,
  }
}
