import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { DashboardPageView } from '@/components/dashboard/redesign/DashboardPageView'
import { getDashboardData } from '@/lib/dashboard/cached'
import { getStaffColor } from '@/lib/staff/colors'
import { getBusinessProfile } from '@/lib/welcome/business-types'
import { startTiming } from '@/lib/perf/timing'
import type { DashboardAppointment, AppointmentStatusKey } from '@/components/dashboard/redesign/TodaysAppointmentsCard'
import type { DashboardRecentKarute } from '@/components/dashboard/redesign/RecentKaruteCard'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function deriveKaruteNumber(id: string): string {
  return id.replace(/-/g, '').slice(0, 5).toUpperCase()
}
function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function DashboardPage() {
  const t = startTiming('dashboard')
  const supabase = await createClient()

  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    dashboard,
    orgSettings,
  ] = await Promise.all([
    t.phase('authUser', () => supabase.auth.getUser()),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getActiveStaffId()),
    t.phase('dashboardData', () => getDashboardData()),
    t.phase('orgSettings', () => getOrgSettings()),
  ])
  t.end()

  const activeStaff = staffList.find((s) => s.id === activeStaffId)
  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))

  const now = new Date()
  const appointments: DashboardAppointment[] = dashboard.todayAppointments.map(
    (a) => {
      const start = new Date(a.start_time)
      const isPast = start.getTime() + a.duration_minutes * 60_000 < now.getTime()
      const hasRecording = !!a.karute_record_id
      const statusKey: AppointmentStatusKey = hasRecording
        ? 'completed'
        : isPast
          ? 'completed'
          : 'booked'
      const statusLabel =
        statusKey === 'completed'
          ? '完了'
          : statusKey === 'booked'
            ? '予約済'
            : statusKey
      return {
        id: a.id,
        time: hhmm(start),
        duration: a.duration_minutes,
        customerName: a.customers?.name ?? 'Unknown',
        karuteNumber: a.karute_record_id
          ? deriveKaruteNumber(a.karute_record_id)
          : null,
        service: a.title ?? 'Session',
        staffName: staffNameById.get(a.staff_profile_id) ?? 'Unknown',
        staffColor: getStaffColor(a.staff_profile_id),
        statusKey,
        statusLabel,
        reservationMemo: a.notes,
      }
    },
  )

  const recentKarute: DashboardRecentKarute[] = dashboard.recentKarute.map(
    (r) => {
      const dt = new Date(r.session_date ?? r.created_at)
      const entryCount = Array.isArray(r.entries)
        ? (r.entries[0]?.count ?? 0)
        : 0
      return {
        id: r.id,
        customerName: r.customers?.name ?? 'Unknown',
        karuteNumber: deriveKaruteNumber(r.id),
        sessionDate: formatShortDate(dt),
        summary: r.summary ?? '—',
        entryCount,
        staffName: r.staff_profile_id
          ? (staffNameById.get(r.staff_profile_id) ?? 'Unknown')
          : 'Unknown',
        staffColor: getStaffColor(r.staff_profile_id),
      }
    },
  )

  const stats = {
    weeklyRecordings: { value: dashboard.weeklyKaruteCount },
    todaysCustomers: { value: appointments.length },
    monthlyKarute: { value: dashboard.monthlyKaruteCount },
    // Stubbed — rebooking rate needs a returning-customer/total calc that we
    // haven't wired up yet. Render an em-dash placeholder.
    rebookingRate: { value: null },
  }

  const onboardingComplete = Boolean(orgSettings?.setup_completed_at)
  const businessProfile = orgSettings?.business_type
    ? getBusinessProfile(orgSettings.business_type)
    : null

  return (
    <DashboardPageView
      staffName={activeStaff?.full_name ?? user?.email ?? 'User'}
      isOwner={true /* TODO: derive from profile role once roles are wired */}
      dateFormatted={formatLongDate(now)}
      onboardingComplete={onboardingComplete}
      businessProfile={businessProfile}
      stats={stats}
      appointments={appointments}
      recentKarute={recentKarute}
    />
  )
}
