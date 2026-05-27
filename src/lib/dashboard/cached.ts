import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
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

    // Profiles → staff_profile_ids in this tenant, for the appointments query.
    const { data: tenantStaff } = await sb
      .from('profiles')
      .select('id')
      .eq('customer_id', businessId)
    const staffIds = (tenantStaff ?? []).map((s: { id: string }) => s.id)

    const todayStart = `${todayDay}T00:00:00Z`
    const todayEnd = `${todayDay}T23:59:59Z`

    // Karute reads go through synqed-core (source of truth). Built inline with
    // the cached businessId since unstable_cache runs outside request/auth
    // scope. from/to filter created_at upstream, so .total gives the counts.
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    const synqed =
      baseUrl && apiKey
        ? new SynqedClient({ baseUrl, apiKey, businessId })
        : null

    const [weekly, monthly, appointmentsRes, recentRes, customerList] =
      await Promise.all([
        synqed?.karuteRecords
          .list({ from: weekStartIso, page_size: 1 })
          .catch(() => ({ total: 0 })) ?? Promise.resolve({ total: 0 }),
        synqed?.karuteRecords
          .list({ from: monthStartIso, page_size: 1 })
          .catch(() => ({ total: 0 })) ?? Promise.resolve({ total: 0 }),
        // TODO: today's appointments still read Supabase directly — same
        // legacy-table drift as karute had; route through synqed-core too.
        sb
          .from('appointments')
          .select(
            'id, start_time, duration_minutes, staff_profile_id, title, notes, karute_record_id, customers:client_id ( name )',
          )
          .in('staff_profile_id', staffIds.length ? staffIds : ['__none__'])
          .gte('start_time', todayStart)
          .lte('start_time', todayEnd)
          .order('start_time', { ascending: true }),
        synqed?.karuteRecords
          .list({ page_size: 5 })
          .catch(() => ({ karute_records: [] })) ??
          Promise.resolve({ karute_records: [] }),
        synqed?.customers
          .list({ page_size: 500 })
          .catch(() => ({ customers: [] })) ??
          Promise.resolve({ customers: [] }),
      ])

    const customerNameById = new Map(
      ('customers' in customerList ? customerList.customers : []).map((c) => [
        c.id,
        c.name,
      ]),
    )

    const recentKarute: DashboardRecentKarute[] = (
      'karute_records' in recentRes ? recentRes.karute_records : []
    ).map((r) => ({
      id: r.id,
      summary: r.ai_summary,
      created_at: r.created_at,
      session_date: r.created_at,
      staff_profile_id: r.staff_id,
      customers: r.customer_id
        ? { name: customerNameById.get(r.customer_id) ?? 'Unknown' }
        : null,
      entries: [{ count: r.entry_count ?? 0 }],
    }))

    return {
      weeklyKaruteCount: 'total' in weekly ? weekly.total : 0,
      monthlyKaruteCount: 'total' in monthly ? monthly.total : 0,
      todayAppointments: (appointmentsRes.data ?? []) as DashboardTodayAppointment[],
      recentKarute,
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
  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const todayDay = yesterday.toISOString().split('T')[0]
  return dashboardByDay(
    businessId,
    todayDay,
    startOfWeek.toISOString(),
    startOfMonth.toISOString(),
  )
}
