import { createClient } from '@/lib/supabase/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { getOrgSettings } from '@/actions/org-settings'
import { getAppointmentsByDate, getAppointmentsInRange } from '@/actions/appointments'
import { getCachedCustomerList } from '@/lib/customers/cached'
import {
  appointmentsToWeekData,
  appointmentsToMonthCells,
} from '@/lib/adapters/reservation'
import { appointmentsToReservationViews } from '@/lib/adapters/reservation-view'
import { enrichCustomers } from '@/lib/customers/list-enrich'
import { getBusinessId } from '@/lib/staff'
import { getOperatingHoursForDate } from '@/lib/operating-hours'
import type { DayWeekMonthView } from '@synqed-kk/ui'
import type { ReservationStaff } from '@/components/reservation/StaffRow'
import { jstStartOfToday, ymdInJst, partsInJst } from '@/lib/date/jst'

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

const pad2 = (n: number) => String(n).padStart(2, '0')

/** A Date at JST midnight for the given JST calendar y/m/d (month is 1-12). */
function jstMidnight(year: number, month: number, day: number): Date {
  return new Date(`${year}-${pad2(month)}-${pad2(day)}T00:00:00+09:00`)
}

// JST-anchored week start. The runtime is UTC on Vercel, so getFullYear()/
// getMonth()/getDate()/getDay() report the UTC calendar day — which rolls a
// JST-midnight `d` back to the previous day (and the previous MONTH on the 1st).
// That made the month/week grid render one month off from the selected date.
// Derive from JST parts so the grid matches what the user picked.
function startOfWeekSun(d: Date): Date {
  const p = partsInJst(d)
  const out = jstMidnight(p.year, p.month, p.day)
  out.setDate(out.getDate() - p.weekday) // p.weekday: 0=Sun..6=Sat (JST)
  return out
}

// ─────────────────────────────────────────────────────────────
// Date-range pre-computers — pulled OUT of the await chain so
// they can be computed synchronously up-front, allowing the
// week/month range fetch to fan out alongside Stage 1 of the
// page-level Promise.all (instead of running serially after).
// ─────────────────────────────────────────────────────────────
function computeWeekRange(selectedDate: Date): {
  weekStart: Date
  weekEnd: Date
  rangeFrom: Date
  rangeTo: Date
} {
  const weekStart = startOfWeekSun(selectedDate)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const rangeFrom = new Date(weekStart)
  const rangeTo = new Date(weekEnd)
  rangeTo.setHours(23, 59, 59, 999)
  return { weekStart, weekEnd, rangeFrom, rangeTo }
}

function computeMonthRange(selectedDate: Date): {
  monthStart: Date
  monthEnd: Date
  rangeFrom: Date
  rangeTo: Date
} {
  // JST month boundaries (see startOfWeekSun note — raw getMonth() is UTC on
  // Vercel and rolls the 1st back into the previous month, so the whole month
  // grid rendered one month off from the selected date).
  const p = partsInJst(selectedDate)
  const monthStart = jstMidnight(p.year, p.month, 1)
  const daysInMonth = new Date(p.year, p.month, 0).getDate()
  const monthEnd = jstMidnight(p.year, p.month, daysInMonth)
  const rangeFrom = new Date(monthStart)
  rangeFrom.setDate(rangeFrom.getDate() - 7) // include leading days
  const rangeTo = new Date(monthEnd)
  rangeTo.setDate(rangeTo.getDate() + 7) // include trailing days
  rangeTo.setHours(23, 59, 59, 999)
  return { monthStart, monthEnd, rangeFrom, rangeTo }
}

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
    getAppointmentsByDate(selectedDateStr),
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
    role: s.display_role ?? s.position ?? '',
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
  const enrichment =
    businessId && clientIdsForDay.length
      ? await enrichCustomers(businessId, clientIdsForDay)
      : new Map()
  // "First-time customer" = no past appointments AND no recorded karute.
  // Previously this was derived from `totalKarute === 0` alone, which meant
  // any existing customer without a recorded karute rendered as 新規 on the
  // reservation agenda even if they'd been coming in for months. Liam hit
  // this on Vercel — every booking showed as 新規.
  const isFirstTimeByClient = new Map<string, boolean>()
  for (const [id, e] of enrichment.entries()) {
    isFirstTimeByClient.set(
      id,
      e.totalKarute === 0 && e.pastAppointmentCount === 0,
    )
  }

  // `now` (wall-clock) is intentional here: computeDisplayStatus needs to
  // know whether an appointment is past/in-progress/future relative to right
  // now, not to the date being viewed.
  const allReservationViews = appointmentsToReservationViews(
    dayAppointments,
    staffList,
    now,
    isFirstTimeByClient,
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

    weekData = appointmentsToWeekData(
      weekRangeAppts,
      weekRange.weekStart,
      weekRange.weekEnd,
      totalMinutes,
      now,
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
