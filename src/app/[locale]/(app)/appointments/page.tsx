import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
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

function parseDateParam(value: string | undefined): Date {
  if (!value) return new Date()
  // Match YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return new Date()
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? new Date() : d
}

function parseViewParam(value: string | undefined): DayWeekMonthView {
  return value === 'week' || value === 'month' ? value : 'day'
}

function startOfWeekSun(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() - out.getDay())
  return out
}

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ date?: string; view?: string }>
}) {
  const { locale } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const selectedDate = parseDateParam(sp.date)
  const view = parseViewParam(sp.view)
  const todayStr = new Date().toISOString().split('T')[0]
  const tzOffset = 0 // server is UTC; client will re-fetch with correct offset if needed

  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    orgSettings,
    customers,
    todayAppointments,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
    getOrgSettings(),
    getCachedCustomerList(),
    getAppointmentsByDate(todayStr, tzOffset),
  ])

  const authProfileId = user?.id ?? null

  const staff = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    avatarInitials: (s.full_name ?? 'U').slice(0, 2).toUpperCase(),
    avatarUrl: s.avatar_url ?? undefined,
  }))

  const today = new Date()

  const reservationStaff: ReservationStaff[] = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    role: s.display_role ?? s.position ?? '',
    // TODO(phase-1.5): wire synqed-core role to derive takesBookings
    takesBookings: true,
    initials: (s.full_name ?? '?').trim().slice(0, 1) || '?',
  }))

  // Visit count per client is needed to derive the "新規 (new)" status for
  // first-time customers. Only the clients on today's calendar matter — keeps
  // the enrichCustomers fan-out tiny vs. running it for the whole tenant.
  const clientIdsToday = Array.from(
    new Set(todayAppointments.map((a) => a.client_id)),
  )
  const businessId = await getBusinessId().catch(() => null)
  const enrichment =
    businessId && clientIdsToday.length
      ? await enrichCustomers(businessId, clientIdsToday)
      : new Map()
  const visitCountByClient = new Map<string, number>()
  for (const [id, e] of enrichment.entries()) {
    visitCountByClient.set(id, e.totalKarute)
  }

  const reservationViews = appointmentsToReservationViews(
    todayAppointments,
    staffList,
    today,
    visitCountByClient,
  )

  const dayOpHours = getOperatingHoursForDate(orgSettings?.operating_hours, today)
  const businessHours = {
    start: Math.floor(dayOpHours.openMinute / 60),
    end: Math.ceil(dayOpHours.closeMinute / 60),
  }

  // Pre-compute week/month data server-side based on view + selectedDate.
  let weekData: Awaited<ReturnType<typeof appointmentsToWeekData>> | null = null
  let monthData: Awaited<ReturnType<typeof appointmentsToMonthCells>> | null = null
  let weekStartIso: string | null = null
  let monthStartIso: string | null = null

  if (view === 'week') {
    const weekStart = startOfWeekSun(selectedDate)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const rangeFrom = new Date(weekStart)
    const rangeTo = new Date(weekEnd)
    rangeTo.setHours(23, 59, 59, 999)
    const appts = await getAppointmentsInRange(rangeFrom.toISOString(), rangeTo.toISOString())

    // Average business-hours minutes across the week (a single number for the
    // utilization chip — close enough for the overview view).
    const totalMinutes = (() => {
      let sum = 0
      const cur = new Date(weekStart)
      for (let i = 0; i < 7; i++) {
        const dh = getOperatingHoursForDate(orgSettings?.operating_hours, cur)
        sum += Math.max(0, dh.closeMinute - dh.openMinute)
        cur.setDate(cur.getDate() + 1)
      }
      return Math.round(sum / 7)
    })()

    weekData = appointmentsToWeekData(appts, weekStart, weekEnd, totalMinutes, today)
    weekStartIso = weekStart.toISOString()
  } else if (view === 'month') {
    const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
    const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)
    const rangeFrom = new Date(monthStart)
    rangeFrom.setDate(rangeFrom.getDate() - 7) // include leading days
    const rangeTo = new Date(monthEnd)
    rangeTo.setDate(rangeTo.getDate() + 7) // include trailing days
    rangeTo.setHours(23, 59, 59, 999)
    const appts = await getAppointmentsInRange(rangeFrom.toISOString(), rangeTo.toISOString())
    monthData = appointmentsToMonthCells(appts, monthStart, monthEnd, today)
    monthStartIso = monthStart.toISOString()
  }

  return (
    <AppointmentsView
      staff={staff}
      activeStaffId={activeStaffId ?? staff[0]?.id ?? null}
      authProfileId={authProfileId}
      customers={customers}
      locale={locale}
      orgSettings={orgSettings}
      initialAppointments={todayAppointments}
      initialView={view}
      selectedDateIso={selectedDate.toISOString()}
      weekData={weekData}
      weekStartIso={weekStartIso}
      monthData={monthData}
      monthStartIso={monthStartIso}
      reservationViews={reservationViews}
      reservationStaff={reservationStaff}
      businessHours={businessHours}
    />
  )
}
