/**
 * Coverage for getDashboardData / dashboardByDay (src/lib/dashboard/cached.ts).
 *
 * All reads now go through synqed-core (the source of truth), so the
 * SynqedClient constructor is mocked. dashboardByDay fans out nine calls in
 * declared order: weekly count, monthly count, rolling-7-day count, today's
 * appointments, tomorrow's appointments, today's karute (for the
 * appointment→recording link), recent karute, the tenant customer list (for
 * name resolution), and the staff list (synqed staff.id → profile id
 * translation, PR #179). It shapes them into DashboardData with count +
 * empty-array fallbacks. The synqed client is business-scoped, so there is no
 * longer a profiles→staff-id filter step.
 *
 * unstable_cache is mocked to a passthrough so the inner fn runs directly;
 * getBusinessId is stubbed.
 */
process.env.SYNQED_CORE_URL = 'http://synqed.test'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const BIZ = 'biz-1'

const karuteRecords = { list: jest.fn() }
const appointments = { list: jest.fn() }
const customers = { list: jest.fn() }
const staff = { list: jest.fn() }

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => ({ karuteRecords, appointments, customers, staff })),
}))

jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => BIZ),
}))

// getDashboardData scopes every read via resolveStoreScope().storeId — the
// RBAC-clamped store (a branch-restricted staff can't see another branch's day).
// Default here to the all-stores lens (storeId null) so the existing shaping
// tests are unaffected; individual tests override it.
const resolveStoreScopeMock = jest.fn()
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScopeMock(),
}))

import { getDashboardData } from '@/lib/dashboard/cached'

// karuteRecords.list is invoked in this order inside the Promise.all:
// weekly (count) → monthly (count) → rolling 7d (count) → today's karute →
// recent. Stage each.
function stageKarute(opts: {
  weekly?: { total: number } | Record<string, never>
  monthly?: { total: number } | Record<string, never>
  weekly7?: { total: number } | Record<string, never>
  todayKarute?: unknown[]
  recent?: unknown[]
}) {
  karuteRecords.list
    .mockResolvedValueOnce(opts.weekly ?? { total: 0 })
    .mockResolvedValueOnce(opts.monthly ?? { total: 0 })
    .mockResolvedValueOnce(opts.weekly7 ?? { total: 0 })
    .mockResolvedValueOnce({ karute_records: opts.todayKarute ?? [] })
    .mockResolvedValueOnce({ karute_records: opts.recent ?? [] })
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveStoreScopeMock.mockResolvedValue({ storeId: null, viewAll: true, allowedStoreIds: null })
  appointments.list.mockResolvedValue({ appointments: [] })
  customers.list.mockResolvedValue({ customers: [] })
  staff.list.mockResolvedValue({ staff: [] })
})

describe('getDashboardData', () => {
  it('shapes the synqed query results into DashboardData', async () => {
    stageKarute({
      weekly: { total: 7 },
      monthly: { total: 23 },
      weekly7: { total: 5 },
      todayKarute: [{ id: 'k9', appointment_id: 'a1' }],
      recent: [
        {
          id: 'k1',
          ai_summary: 'note',
          created_at: '2026-05-25T00:00:00Z',
          staff_id: 's1',
          customer_id: 'c1',
          entry_count: 3,
        },
      ],
    })
    appointments.list.mockResolvedValue({
      appointments: [
        {
          id: 'a1',
          starts_at: '2026-05-26T01:00:00Z',
          duration_minutes: 60,
          staff_id: 's1',
          title: 'Cut',
          notes: null,
          customer_id: 'c1',
        },
      ],
    })
    customers.list.mockResolvedValue({ customers: [{ id: 'c1', name: 'Hanako' }] })
    // PR #179: rows arrive keyed by the synqed staff id ('s1'); the dashboard
    // resolves names off the profile id — expect the translated value below.
    staff.list.mockResolvedValue({ staff: [{ id: 's1', user_id: 'p1' }] })

    const result = await getDashboardData()

    expect(result.weeklyKaruteCount).toBe(7)
    expect(result.monthlyKaruteCount).toBe(23)
    expect(result.weekKaruteCount).toBe(5)
    // appointments.list is shared by the today + tomorrow fetches in this
    // staging, so tomorrow mirrors today — shape is what matters here.
    expect(result.tomorrowAppointments).toHaveLength(1)
    expect(result.todayAppointments).toHaveLength(1)
    expect(result.todayAppointments[0]).toMatchObject({
      id: 'a1',
      start_time: '2026-05-26T01:00:00Z',
      duration_minutes: 60,
      staff_profile_id: 'p1',
      title: 'Cut',
      // linked from today's karute by appointment_id
      karute_record_id: 'k9',
      customers: { name: 'Hanako' },
    })
    expect(result.recentKarute).toHaveLength(1)
    expect(result.recentKarute[0]).toMatchObject({
      id: 'k1',
      summary: 'note',
      staff_profile_id: 'p1',
      customers: { name: 'Hanako' },
      entries: [{ count: 3 }],
    })
  })

  it('defaults counts to 0 when synqed responses omit total', async () => {
    stageKarute({ weekly: {}, monthly: {} })

    const result = await getDashboardData()

    expect(result.weeklyKaruteCount).toBe(0)
    expect(result.monthlyKaruteCount).toBe(0)
  })

  it('defaults the row lists to empty arrays when there is no data', async () => {
    stageKarute({ weekly: { total: 0 }, monthly: { total: 0 } })

    const result = await getDashboardData()

    expect(result.todayAppointments).toEqual([])
    expect(result.tomorrowAppointments).toEqual([])
    expect(result.recentKarute).toEqual([])
  })

  it('scopes every read to the RBAC-clamped store (branch-restricted staff, unset cookie)', async () => {
    // A Ginza-assigned staff with no store cookie: resolveStoreScope clamps to
    // their assigned store, NOT the business primary (代官山). Every karute +
    // appointment read must carry that store_id, or the dashboard leaks the
    // other branch's day (the Apple-review bug).
    resolveStoreScopeMock.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })
    stageKarute({ weekly: { total: 0 }, monthly: { total: 0 } })

    await getDashboardData()

    for (const call of karuteRecords.list.mock.calls) {
      expect(call[0]).toMatchObject({ store_id: 'store-ginza' })
    }
    for (const call of appointments.list.mock.calls) {
      expect(call[0]).toMatchObject({ store_id: 'store-ginza' })
    }
    // Sanity: reads actually happened (the assertions above are not vacuous).
    expect(karuteRecords.list).toHaveBeenCalled()
    expect(appointments.list).toHaveBeenCalled()
  })

  it('leaves an appointment unlinked when no karute references it', async () => {
    stageKarute({
      weekly: { total: 0 },
      monthly: { total: 0 },
      todayKarute: [], // no karute today
    })
    appointments.list.mockResolvedValue({
      appointments: [
        {
          id: 'a1',
          starts_at: '2026-05-26T01:00:00Z',
          duration_minutes: 60,
          staff_id: 's1',
          title: 'Cut',
          notes: null,
          customer_id: 'c1',
        },
      ],
    })

    const result = await getDashboardData()

    expect(result.todayAppointments[0].karute_record_id).toBeNull()
    // Unknown customer (not in the tenant list) resolves to null, not a crash.
    expect(result.todayAppointments[0].customers).toBeNull()
  })
})

export {}
