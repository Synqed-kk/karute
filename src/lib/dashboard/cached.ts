import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId } from '@/lib/staff'

export interface DashboardTodayAppointment {
  id: string
  start_time: string
  duration_minutes: number
  staff_profile_id: string
  title: string | null
  notes: string | null
  karute_record_id: string | null
  customers: { name: string } | null
}

export interface DashboardRecentKarute {
  id: string
  summary: string | null
  created_at: string
  session_date: string | null
  staff_profile_id: string | null
  customers: { name: string } | null
  entries: Array<{ count: number }> | null
}

export interface DashboardData {
  weeklyKaruteCount: number
  monthlyKaruteCount: number
  todayAppointments: DashboardTodayAppointment[]
  recentKarute: DashboardRecentKarute[]
}

// Cache the dashboard data trio per (business, todayDay, weekStartIso). Mutation
// actions on karute_records / appointments call updateTag('dashboard') to drop
// the cache; the day-key keeps things from going stale across midnight.
const dashboardByDay = unstable_cache(
  async (
    businessId: string,
    todayDay: string,
    weekStartIso: string,
    monthStartIso: string,
  ): Promise<DashboardData> => {
    const service = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = service as any

    // Profiles → staff_profile_ids in this tenant, since we use the service
    // client and have to filter by tenant ourselves.
    const { data: tenantStaff } = await sb
      .from('profiles')
      .select('id')
      .eq('customer_id', businessId)
    const staffIds = (tenantStaff ?? []).map((s: { id: string }) => s.id)

    const todayStart = `${todayDay}T00:00:00Z`
    const todayEnd = `${todayDay}T23:59:59Z`

    const [
      weeklyKaruteCountRes,
      monthlyKaruteCountRes,
      appointmentsRes,
      recentKaruteRes,
    ] = await Promise.all([
      sb
        .from('karute_records')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', businessId)
        .gte('created_at', weekStartIso),
      sb
        .from('karute_records')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', businessId)
        .gte('created_at', monthStartIso),
      sb
        .from('appointments')
        .select(
          'id, start_time, duration_minutes, staff_profile_id, title, notes, karute_record_id, customers:client_id ( name )',
        )
        .in('staff_profile_id', staffIds.length ? staffIds : ['__none__'])
        .gte('start_time', todayStart)
        .lte('start_time', todayEnd)
        .order('start_time', { ascending: true }),
      sb
        .from('karute_records')
        .select(
          'id, summary, created_at, session_date, staff_profile_id, customers:client_id ( name ), entries ( count )',
        )
        .eq('customer_id', businessId)
        .order('session_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    return {
      weeklyKaruteCount: weeklyKaruteCountRes.count ?? 0,
      monthlyKaruteCount: monthlyKaruteCountRes.count ?? 0,
      todayAppointments: (appointmentsRes.data ?? []) as DashboardTodayAppointment[],
      recentKarute: (recentKaruteRes.data ?? []) as DashboardRecentKarute[],
    }
  },
  ['dashboard-v2'],
  { revalidate: 60, tags: ['dashboard'] },
)

export async function getDashboardData(): Promise<DashboardData> {
  const businessId = await getBusinessId()
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay())
  startOfWeek.setUTCHours(0, 0, 0, 0)
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  )
  // `todayDay` IS today (YYYY-MM-DD). The previous version derived it from
  // `now - 1 day`, so the "today's appointments" window targeted yesterday.
  const todayDay = now.toISOString().split('T')[0]
  return dashboardByDay(
    businessId,
    todayDay,
    startOfWeek.toISOString(),
    startOfMonth.toISOString(),
  )
}
