import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { buildDashboardStats } from '@/lib/adapters/dashboard'
import { getDashboardData } from '@/lib/dashboard/cached'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    dashboard,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
    getDashboardData(),
  ])

  const activeStaff = staffList.find((s) => s.id === activeStaffId)

  const todayAppointments = dashboard.todayAppointments.map((a) => ({
    id: a.id,
    startTime: a.start_time,
    durationMinutes: a.duration_minutes,
    staffId: a.staff_profile_id,
    customerName: a.customers?.name ?? 'Unknown',
    staffName:
      staffList.find((s) => s.id === a.staff_profile_id)?.full_name ??
      'Unknown',
  }))

  const recentKarute = dashboard.recentKarute.map((r) => ({
    id: r.id,
    summary: r.summary,
    createdAt: r.created_at,
    staffId: r.staff_profile_id ?? '',
    customerName: r.customers?.name ?? 'Unknown',
  }))

  const stats = buildDashboardStats(
    dashboard.weeklyKaruteCount,
    todayAppointments.length,
    dashboard.weeklyKaruteCount,
  )

  return (
    <DashboardView
      staffName={activeStaff?.full_name ?? user?.email ?? 'User'}
      activeStaffId={activeStaffId ?? user?.id ?? null}
      stats={stats}
      todayAppointments={todayAppointments}
      recentKarute={recentKarute}
    />
  )
}
