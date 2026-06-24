import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'
import { getActiveStoreId } from '@/actions/stores'

export interface DashboardTodayAppointment {
  id: string
  client_id: string
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
  client_id: string | null
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
    activeStore: string | null,
  ): Promise<DashboardData> => {
    // All reads go through synqed-core (the source of truth). The client is
    // already business-scoped, so there's no tenant staff-id filter to build.
    // Built inline with the cached businessId since unstable_cache runs
    // outside request/auth scope.
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    const synqed =
      baseUrl && apiKey ? new SynqedClient({ baseUrl, apiKey, businessId }) : null

    const todayStart = `${todayDay}T00:00:00Z`
    const todayEnd = `${todayDay}T23:59:59Z`

    const [weekly, monthly, appointmentsRes, todayKaruteRes, recentRes, customerList, staffRes] =
      await Promise.all([
        // from/to filter created_at upstream, so .total gives the counts.
        synqed?.karuteRecords
          .list({ from: weekStartIso, page_size: 1 })
          .catch(() => ({ total: 0 })) ?? Promise.resolve({ total: 0 }),
        synqed?.karuteRecords
          .list({ from: monthStartIso, page_size: 1 })
          .catch(() => ({ total: 0 })) ?? Promise.resolve({ total: 0 }),
        // Dashboard "today" list scoped to the active store (a view filter;
        // null = all stores). The weekly/monthly karute counts above stay
        // business-wide until synqed-core can filter karute records by store.
        synqed?.appointments
          .list({ from: todayStart, to: todayEnd, page_size: 200, store_id: activeStore ?? undefined })
          .catch(() => ({ appointments: [] })) ??
          Promise.resolve({ appointments: [] }),
        // Today's karute, to link each appointment to its recording (status).
        synqed?.karuteRecords
          .list({ from: todayStart, to: todayEnd, page_size: 200 })
          .catch(() => ({ karute_records: [] })) ??
          Promise.resolve({ karute_records: [] }),
        synqed?.karuteRecords
          .list({ page_size: 5 })
          .catch(() => ({ karute_records: [] })) ??
          Promise.resolve({ karute_records: [] }),
        synqed?.customers
          .list({ page_size: 500 })
          .catch(() => ({ customers: [] })) ??
          Promise.resolve({ customers: [] }),
        synqed?.staff
          .list({ page_size: 200 })
          .catch(() => ({ staff: [] })) ??
          Promise.resolve({ staff: [] }),
      ])

    const customerNameById = new Map(
      ('customers' in customerList ? customerList.customers : []).map((c) => [
        c.id,
        c.name,
      ]),
    )

    // synqed staff.id → supabase profile id (= staff.user_id). Appointments and
    // karute records arrive keyed by the synqed staff id, but the dashboard
    // resolves staff names off the profile id (getStaffList) — the same boundary
    // translation getAppointmentsByDate does. Without it, manually-added bookings
    // (whose staff_id is the synqed id, not a profile id) render "Unknown". QR
    // rows keep working: a profile id isn't a key here, so `?? raw` leaves it.
    const profileByStaffId = new Map(
      ('staff' in staffRes ? staffRes.staff : [])
        .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
        .map((s) => [s.id, s.user_id]),
    )

    const karuteByAppointment = new Map<string, string>()
    for (const k of 'karute_records' in todayKaruteRes
      ? todayKaruteRes.karute_records
      : []) {
      if (k.appointment_id) karuteByAppointment.set(k.appointment_id, k.id)
    }

    const todayAppointments: DashboardTodayAppointment[] = (
      'appointments' in appointmentsRes ? appointmentsRes.appointments : []
    )
      // Drop cancelled bookings (the QR sync marks them) so the dashboard's
      // "today" list doesn't show them full-color — matches the agenda's hide.
      .filter((a) => a.status !== 'CANCELLED')
      .map((a) => ({
      id: a.id,
      client_id: a.customer_id,
      start_time: a.starts_at,
      duration_minutes: a.duration_minutes ?? 0,
      staff_profile_id: profileByStaffId.get(a.staff_id) ?? a.staff_id,
      title: a.title,
      notes: a.notes,
      karute_record_id: karuteByAppointment.get(a.id) ?? null,
      customers: customerNameById.has(a.customer_id)
        ? { name: customerNameById.get(a.customer_id)! }
        : null,
    }))

    const recentKarute: DashboardRecentKarute[] = (
      'karute_records' in recentRes ? recentRes.karute_records : []
    ).map((r) => ({
      id: r.id,
      client_id: r.customer_id ?? null,
      summary: r.ai_summary,
      created_at: r.created_at,
      session_date: r.created_at,
      staff_profile_id: profileByStaffId.get(r.staff_id) ?? r.staff_id,
      customers: r.customer_id
        ? { name: customerNameById.get(r.customer_id) ?? 'Unknown' }
        : null,
      entries: [{ count: r.entry_count ?? 0 }],
    }))

    return {
      weeklyKaruteCount: 'total' in weekly ? weekly.total : 0,
      monthlyKaruteCount: 'total' in monthly ? monthly.total : 0,
      todayAppointments,
      recentKarute,
    }
  },
  ['dashboard-v4'],
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
  // Active store threads in as an extra positional arg so it becomes part of the
  // cache key — a store-scoped dashboard is never served from another store's
  // cache entry. Read in request scope (unstable_cache runs outside it).
  const activeStore = await getActiveStoreId()
  return dashboardByDay(
    businessId,
    todayDay,
    startOfWeek.toISOString(),
    startOfMonth.toISOString(),
    activeStore,
  )
}
