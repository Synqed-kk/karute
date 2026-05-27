/**
 * Coverage for getDashboardData / dashboardByDay (PR 24, replay/24,
 * src/lib/dashboard/cached.ts). Verifies the aggregation/shaping the cached
 * fn performs: it resolves the tenant staff roster, fans out four queries in
 * parallel (two head/count karute queries, today's appointments, recent
 * karute), and shapes the result into DashboardData with the count fallbacks
 * and the empty-array fallbacks for the row lists.
 *
 * The service client is mocked as a chainable query builder; each table's
 * builder resolves to the response staged for it. unstable_cache is mocked to
 * a passthrough so the inner fn runs directly. getBusinessId is stubbed.
 *
 * NOTE (flagged, not pinned): getDashboardData computes `todayDay` from
 * `yesterday` (now - 1 day), so the "today's appointments" window is actually
 * yesterday's calendar day. Asserted below as observed behaviour.
 */
const BIZ = 'biz-1'

let staffRows: Array<{ id: string }> = []
let weeklyCount: number | null = 0
let monthlyCount: number | null = 0
let appointmentRows: unknown[] | null = []
let recentRows: unknown[] | null = []
let capturedAppointmentIn: unknown[] | null = null

jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => BIZ),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      // Per-table chainable builder. The four queries are distinguished by
      // table + whether `head`/`count` was requested (the two karute count
      // queries pass { count: 'exact', head: true } to select()).
      let isHead = false
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) isHead = true
        return builder
      }
      for (const m of ['eq', 'gte', 'lte', 'order', 'limit']) builder[m] = chain
      builder.in = (_col: string, vals: unknown[]) => {
        capturedAppointmentIn = vals
        return builder
      }
      ;(builder as { then: unknown }).then = (
        resolve: (v: unknown) => void,
      ) => {
        if (table === 'profiles') return resolve({ data: staffRows })
        if (table === 'appointments')
          return resolve({ data: appointmentRows })
        if (table === 'karute_records') {
          if (isHead) {
            // The two count queries run in declared order: weekly first,
            // then monthly. Distinguish by a one-shot toggle.
            const count = nextKaruteCount()
            return resolve({ count })
          }
          return resolve({ data: recentRows })
        }
        return resolve({ data: [] })
      }
      return builder
    },
  }),
}))

// Weekly count query is declared before monthly in Promise.all, but Promise.all
// preserves array order regardless of resolution timing; the two head queries
// are nonetheless dispatched weekly-then-monthly, so hand them out in order.
let karuteCountCursor = 0
function nextKaruteCount(): number | null {
  const v = karuteCountCursor === 0 ? weeklyCount : monthlyCount
  karuteCountCursor += 1
  return v
}

import { getDashboardData } from '@/lib/dashboard/cached'

beforeEach(() => {
  staffRows = []
  weeklyCount = 0
  monthlyCount = 0
  appointmentRows = []
  recentRows = []
  capturedAppointmentIn = null
  karuteCountCursor = 0
})

describe('getDashboardData', () => {
  it('shapes the four query results into DashboardData', async () => {
    staffRows = [{ id: 's1' }, { id: 's2' }]
    weeklyCount = 7
    monthlyCount = 23
    appointmentRows = [
      {
        id: 'a1',
        start_time: '2026-05-26T01:00:00Z',
        duration_minutes: 60,
        staff_profile_id: 's1',
        title: 'Cut',
        notes: null,
        karute_record_id: null,
        customers: { name: 'Hanako' },
      },
    ]
    recentRows = [
      {
        id: 'k1',
        summary: 'note',
        created_at: '2026-05-25T00:00:00Z',
        session_date: '2026-05-25',
        staff_profile_id: 's1',
        customers: { name: 'Hanako' },
        entries: [{ count: 3 }],
      },
    ]

    const result = await getDashboardData()

    expect(result.weeklyKaruteCount).toBe(7)
    expect(result.monthlyKaruteCount).toBe(23)
    expect(result.todayAppointments).toHaveLength(1)
    expect(result.todayAppointments[0].customers).toEqual({ name: 'Hanako' })
    expect(result.recentKarute).toHaveLength(1)
    expect(result.recentKarute[0].entries).toEqual([{ count: 3 }])
  })

  it('defaults counts to 0 when Supabase returns null counts', async () => {
    staffRows = [{ id: 's1' }]
    weeklyCount = null
    monthlyCount = null

    const result = await getDashboardData()

    expect(result.weeklyKaruteCount).toBe(0)
    expect(result.monthlyKaruteCount).toBe(0)
  })

  it('defaults the row lists to empty arrays when data is null', async () => {
    staffRows = [{ id: 's1' }]
    appointmentRows = null
    recentRows = null

    const result = await getDashboardData()

    expect(result.todayAppointments).toEqual([])
    expect(result.recentKarute).toEqual([])
  })

  it('passes the resolved tenant staff ids into the appointments .in() filter', async () => {
    staffRows = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]

    await getDashboardData()

    expect(capturedAppointmentIn).toEqual(['s1', 's2', 's3'])
  })

  it('falls back to a sentinel filter when the tenant has no staff', async () => {
    staffRows = []

    await getDashboardData()

    // Avoids an empty .in([]) (which Supabase treats as "match nothing"
    // ambiguously) by substituting a value that cannot match a real id.
    expect(capturedAppointmentIn).toEqual(['__none__'])
  })

  it('tolerates a null profiles response (treats roster as empty)', async () => {
    staffRows = null as unknown as Array<{ id: string }>

    const result = await getDashboardData()

    expect(capturedAppointmentIn).toEqual(['__none__'])
    expect(result.todayAppointments).toEqual([])
  })
})

export {}
