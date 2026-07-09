import { createClient } from '@/lib/supabase/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { staffRoleLabel } from '@/lib/staff/role-label'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { getOrgSettings } from '@/actions/org-settings'
import { getAppointmentsByDate, getAppointmentsInRange } from '@/actions/appointments'
import { getCachedCustomerList } from '@/lib/customers/cached'
import {
  appointmentsToWeekData,
  appointmentsToMonthCells,
} from '@/lib/adapters/reservation'
import { appointmentsToReservationViews } from '@/lib/adapters/reservation-view'
import { enrichCustomers, isReturningCustomer } from '@/lib/customers/list-enrich'
import { firstVisitFromBooking } from '@/lib/customers/first-visit'
import { listAllPackUsage } from '@/lib/packs/store'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { getBusinessId } from '@/lib/staff'
import { getOperatingHoursForDate } from '@/lib/operating-hours'
import type { DayWeekMonthView } from '@synqed-kk/ui'
import type { ReservationStaff } from '@/components/reservation/StaffRow'
import { jstStartOfToday, ymdInJst } from '@/lib/date/jst'
import {
  computeWeekRange,
  computeMonthRange,
} from '@/lib/date/calendar-range'

function parseDateParam(value: string | undefined): Date {
  // Interpret the ?date= YYYY-MM-DD as a JST calendar day. Vercel runs in
  // UTC so `new Date(y, m, d)` would otherwise create a UTC-local instant
  // and the day-view would render the wrong day for half the JST clock.
  if (!value) return jstStartOfToday()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return jstStartOfToday()
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`)
  return isNaN(d.getTime()) ? jstStartOfToday() : d
}

function parseViewParam(value: string | undefined): DayWeekMonthView {
  return value === 'week' || value === 'month' ? value : 'day'
}

// Date-range pre-computers (JST-anchored) live in a tested lib so the week/
// month fetch windows stay correct on the UTC runtime — see calendar-range.ts.

/**
 * Parse the ?staff= URL param into one of:
 *   - 'all'     — every staff's bookings (matches the spike default)
 *   - 'self'    — only the signed-in user's bookings
 *   - <staffId> — a specific staff member's bookings (per-staff pill)
 *
 * Defaults to 'all' to mirror the design spike — the reservation tab is the
 * salon-wide schedule, not a per-staff todo. The Self/All toggle + per-staff
 * pills are rendered by the AppointmentsView; this server-side reader keeps
 * the URL as the single source of truth.
 */
function parseStaffParam(value: string | undefined): string {
  if (!value) return 'all'
  if (value === 'all' || value === 'self') return value
  // Treat anything else as a staff_profile_id — validated downstream.
  return value
}

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ date?: string; view?: string; staff?: string }>
}) {
  const { locale } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const selectedDate = parseDateParam(sp.date)
  const view = parseViewParam(sp.view)
  const staffFilter = parseStaffParam(sp.staff)
  // YYYY-MM-DD of the date being viewed, in JST (Vercel server is UTC, so
  // getFullYear/getMonth on a raw Date would emit the UTC calendar day —
  // wrong for half the JST clock).
  const selectedDateStr = ymdInJst(selectedDate)

  // ─────────────────────────────────────────────────────────────
  // STAGE 1 — fan out everything that doesn't depend on the
  // dayAppointments result. Previously getBusinessId() and the
  // week/month range fetch ran SEQUENTIALLY after this block,
  // adding a 500-1000ms waterfall on every navigation. Neither
  // has a dependency on the items below, so both live here now.
  //
  // Week/month range pre-compute moves into Stage 1 too — its
  // date math depends only on `selectedDate` + `view`, both
  // derived synchronously from URL params above.
  // ─────────────────────────────────────────────────────────────
  const weekRange = view === 'week' ? computeWeekRange(selectedDate) : null
  const monthRange = view === 'month' ? computeMonthRange(selectedDate) : null

  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    orgSettings,
    customers,
    dayAppointments,
    businessId,
    weekRangeAppts,
    monthRangeAppts,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getCurrentUserStaffId(),
    getOrgSettings(),
    getCachedCustomerList(),
    // The agenda is the ONE consumer that wants cancelled rows — rendered as
    // thin greyed キャンセル済み tombstones in their original slot. Every other
    // getAppointmentsByDate caller keeps the hidden-by-default contract.
    getAppointmentsByDate(selectedDateStr, 540, { includeCancelled: true }),
    getBusinessId().catch(() => null),
    weekRange
      ? getAppointmentsInRange(
          weekRange.rangeFrom.toISOString(),
          weekRange.rangeTo.toISOString(),
        )
      : Promise.resolve(null),
    monthRange
      ? getAppointmentsInRange(
          monthRange.rangeFrom.toISOString(),
          monthRange.rangeTo.toISOString(),
        )
      : Promise.resolve(null),
  ])

  const authProfileId = user?.id ?? null

  const staff = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    avatarInitials: (s.full_name ?? 'U').slice(0, 2).toUpperCase(),
    avatarUrl: s.avatar_url ?? undefined,
  }))

  const now = new Date()

  const reservationStaff: ReservationStaff[] = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    // The person's own 役職 first; else the authority code mapped to Japanese
    // (never the raw enum — the grid was leaking "STYLIST" under every name).
    role: s.position ?? staffRoleLabel(s.display_role),
    // TODO(phase-1.5): wire synqed-core role to derive takesBookings
    takesBookings: true,
    initials: (s.full_name ?? '?').trim().slice(0, 1) || '?',
  }))

  // ─────────────────────────────────────────────────────────────
  // STAGE 2 — only enrichCustomers, since it genuinely depends on
  // dayAppointments (it needs the client_ids of today's bookings)
  // AND businessId. Both came back in Stage 1.
  // ─────────────────────────────────────────────────────────────
  const clientIdsForDay = Array.from(
    new Set(dayAppointments.map((a) => a.client_id)),
  )
  // Pack usage loads in parallel — the 残3/10 pill on each agenda row. Empty
  // map until the ticket_packs migration applies (graceful). 回数券 off (org
  // setting, wave 1) → skip the read; the pills just don't render.
  const ticketsEnabled = orgSettings?.ticket_packs_enabled ?? true
  const [enrichment, packUsage] = await Promise.all([
    businessId && clientIdsForDay.length
      ? enrichCustomers(businessId, clientIdsForDay)
      : Promise.resolve(new Map()),
    ticketsEnabled
      ? listAllPackUsage()
      : Promise.resolve(new Map() as Awaited<ReturnType<typeof listAllPackUsage>>),
  ])
  // QR "returning customer" flag per client (cached 500-customer list). A known
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
  // Prior no-show totals ride the SAME enrichment read fetched above (zero
  // extra calls) — the cancel sheet derives its first-time/repeat line from
  // this, and the repeat chip reads it, so all surfaces agree with the 顧客
  // list's 無断欠席 badge.
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

  // Project Stage-1 range fetches into the week/month data shapes
  // the AppointmentsView expects. The async fetches already ran in
  // Stage 1's Promise.all — here we just synchronously transform.
  let weekData: Awaited<ReturnType<typeof appointmentsToWeekData>> | null = null
  let monthData: Awaited<ReturnType<typeof appointmentsToMonthCells>> | null = null
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

  return (
    <AppointmentsView
      staff={staff}
      activeStaffId={activeStaffId ?? staff[0]?.id ?? null}
      authProfileId={authProfileId}
      customers={customers}
      locale={locale}
      orgSettings={orgSettings}
      initialAppointments={dayAppointments}
      initialView={view}
      selectedDateIso={selectedDate.toISOString()}
      weekData={weekData}
      weekStartIso={weekStartIso}
      monthData={monthData}
      monthStartIso={monthStartIso}
      reservationViews={reservationViews}
      reservationStaff={reservationStaff}
      businessHours={businessHours}
      staffFilter={staffFilter}
    />
  )
}
