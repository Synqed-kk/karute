import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { buildDashboardStats } from '@/lib/adapters/dashboard'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Stats: recordings this week
  const startOfWeek = new Date()
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
  startOfWeek.setHours(0, 0, 0, 0)

  // Wide UTC window (±1 day) so any timezone catches today.
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const tomorrow = new Date(now)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const todayStart = yesterday.toISOString().split('T')[0] + 'T00:00:00Z'
  const todayEnd = tomorrow.toISOString().split('T')[0] + 'T23:59:59Z'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    recordingsRes,
    karuteRes,
    appointmentsRes,
    recentKaruteRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
    sb
      .from('karute_records')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfWeek.toISOString()),
    sb
      .from('karute_records')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfWeek.toISOString()),
    sb
      .from('appointments')
      .select(
        'id, start_time, duration_minutes, staff_profile_id, customers:client_id ( name )',
      )
      .gte('start_time', todayStart)
      .lte('start_time', todayEnd)
      .order('start_time', { ascending: true }),
    sb
      .from('karute_records')
      .select(
        'id, summary, created_at, staff_profile_id, customers:client_id ( name )',
      )
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const activeStaff = staffList.find((s) => s.id === activeStaffId)

  const todayAppointments = (appointmentsRes.data ?? []).map(
    (a: {
      id: string
      start_time: string
      duration_minutes: number
      staff_profile_id: string
      customers: { name: string } | null
    }) => ({
      id: a.id,
      startTime: a.start_time,
      durationMinutes: a.duration_minutes,
      staffId: a.staff_profile_id,
      customerName: a.customers?.name ?? 'Unknown',
      staffName:
        staffList.find((s) => s.id === a.staff_profile_id)?.full_name ??
        'Unknown',
    }),
  )

  const recentKarute = (recentKaruteRes.data ?? []).map(
    (r: {
      id: string
      summary: string | null
      created_at: string
      staff_profile_id: string | null
      customers: { name: string } | null
    }) => ({
      id: r.id,
      summary: r.summary,
      createdAt: r.created_at,
      staffId: r.staff_profile_id ?? '',
      customerName: r.customers?.name ?? 'Unknown',
    }),
  )

  const stats = buildDashboardStats(
    recordingsRes.count ?? 0,
    todayAppointments.length,
    karuteRes.count ?? 0,
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
