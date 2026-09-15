/**
 * G1 (Greptile round 2, FIXLIST-1A-R2) — a truncated window must never render
 * as a calm, empty week/month/day: that is pixel-identical to an honest zero.
 * The page now THROWS when `screen.truncated` is true, so the route-group
 * boundary (`(app)/error.tsx`) shows the retry screen instead of
 * AppointmentsView's null-data fallback ("データがありません。").
 *
 * Same harness as customers-picker-store-scope.test.ts: the page is invoked
 * as the plain async function it is; a throw surfaces as a rejected promise.
 */
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))
jest.mock('@/components/perf/QuietRefresh', () => ({ QuietRefresh: () => null }))
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: () => null,
}))
// 先月同期間比 forced ON for this file (4c): the WEB door's half of the compare
// is "it reads the previous span and hands the number to the view", and a test
// that only holds while the registry says `true` would stop proving it the day
// somebody flips the switch back. Nothing else in the registry changes.
jest.mock('@/lib/appointments/booking-switches', () => {
  const actual = jest.requireActual(
    '@/lib/appointments/booking-switches',
  ) as { BOOKING_SWITCHES: Record<string, boolean> }
  return { BOOKING_SWITCHES: { ...actual.BOOKING_SWITCHES, monthCompare: true } }
})
jest.mock('@/lib/perf/render-stamp', () => ({ renderStamp: () => '2026-09-15T00:00:00.000Z' }))
jest.mock('@/lib/perf/timing', () => ({
  startTiming: () => ({
    phase: (_n: string, run: () => unknown) => run(),
    end: () => {},
  }),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } }),
}))
jest.mock('@/lib/staff', () => ({
  getStaffList: async () => [],
  getCurrentUserStaffId: async () => null,
  getBusinessId: async () => 'biz-1',
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: async () => ({
    storeId: 'store-1', viewAll: false, allowedStoreIds: ['store-1'], degraded: false,
  }),
  storeStaffIdSet: async () => null,
  storeDivisorRosterForBusiness: async () => null,
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: async () => ({ ticket_packs_enabled: false, operating_hours: null }),
}))
// The seam this suite pins: the window action's `truncated` flag must reach a
// thrown error, never a silently-null screen.
const getAppointmentWindow = jest.fn()
jest.mock('@/actions/appointments-window', () => ({
  getAppointmentWindow: (...a: unknown[]) => getAppointmentWindow(...a),
}))
jest.mock('@/lib/appointments/day-agenda-cached', () => ({ getCachedDayAgenda: async () => [] }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerList: async () => [] }))
jest.mock('@/lib/customers/list-enrich', () => ({ enrichCustomers: async () => new Map() }))
jest.mock('@/lib/packs/store', () => ({ listAllPackUsage: async () => new Map() }))
jest.mock('@/lib/menus/cached', () => ({
  getCachedMenuOptions: async () => [],
  scopeMenuOptions: (rows: unknown[]) => rows,
}))

import AppointmentsPage from '@/app/[locale]/(app)/appointments/page'

const TRUNCATED = { counted: [], cancelled: [], noShow: [], truncated: true, hoursFacts: [] }
const WHOLE = { counted: [], cancelled: [], noShow: [], truncated: false, hoursFacts: [] }

const invoke = () =>
  AppointmentsPage({
    // Default view ('day', no `?view=`) so the single window read is the
    // day window — the exact seam getAppointmentWindow feeds.
    params: Promise.resolve({ locale: 'ja' }),
    searchParams: Promise.resolve({}),
  })

beforeEach(() => {
  jest.clearAllMocks()
})

describe('予約 page — truncated window rejects instead of rendering empty', () => {
  it('a truncated window read makes the page render REJECT', async () => {
    getAppointmentWindow.mockResolvedValue(TRUNCATED)
    await expect(invoke()).rejects.toThrow('appointments: window truncated — read incomplete')
  })

  it('a whole (non-truncated) window renders normally', async () => {
    getAppointmentWindow.mockResolvedValue(WHOLE)
    await expect(invoke()).resolves.toBeTruthy()
  })
})

/** The page is invoked as the plain async function it is (nothing renders it),
 *  so the props it hands the view are read off the element it RETURNED. */
function viewPropsOf(tree: unknown): Record<string, unknown> {
  const children = (tree as { props: { children: unknown[] } }).props.children
  const el = (children as { props?: Record<string, unknown> }[]).find(
    (c) => c && typeof c === 'object' && c.props != null && 'monthData' in c.props,
  )
  if (!el?.props) throw new Error('AppointmentsView element not found in the page output')
  return el.props
}

describe('予約 page — 先月同期間比 (4c) reads the previous span and reaches the view', () => {
  const appt = (id: string, day: string) =>
    ({
      id,
      kind: 'BOOKING',
      customer_id: 'cust-1',
      staff_id: 'staff-1',
      starts_at: new Date(`${day}T10:00:00+09:00`).toISOString(),
      ends_at: new Date(`${day}T11:00:00+09:00`).toISOString(),
      duration_minutes: 60,
      status: 'SCHEDULED',
    }) as never

  it('hands the view a number built from BOTH spans, and 0件 days are not the base', async () => {
    // Two counted bookings in last month's compared days, five in this month's,
    // and one BEFORE the compared window — the row that makes the zero-base
    // question answerable at all. +3件.
    const PREV = ['2026-07-28', '2026-08-03', '2026-08-04']
    const THIS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
    getAppointmentWindow.mockImplementation(async (fromIso: string) => {
      // Only the compare read starts before August — it opens seven days ahead
      // of the previous month for exactly that reason.
      const isPrevRead = fromIso < new Date('2026-08-01T00:00:00+09:00').toISOString()
      return {
        ...WHOLE,
        counted: (isPrevRead ? PREV : THIS).map((d, i) => appt(`x-${i}-${d}`, d)),
      }
    })
    const tree = await AppointmentsPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ view: 'month', date: '2026-09-15' }),
    })
    const froms = getAppointmentWindow.mock.calls.map((c) => c[0])
    expect(froms).toContain(new Date('2026-08-25T00:00:00+09:00').toISOString())
    expect(froms).toContain(new Date('2026-07-25T00:00:00+09:00').toISOString())
    expect(viewPropsOf(tree).monthCompareDelta).toBe(3)
  })

  it('reads the previous span WITHOUT the hours it would throw away', async () => {
    getAppointmentWindow.mockResolvedValue(WHOLE)
    await AppointmentsPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ view: 'month', date: '2026-09-15' }),
    })
    const prevCall = getAppointmentWindow.mock.calls.find(
      (c) => (c[0] as string) < new Date('2026-08-01T00:00:00+09:00').toISOString(),
    )!
    const monthCall = getAppointmentWindow.mock.calls.find((c) => c !== prevCall)!
    // The compare wants a COUNT; the page's hours facts come from the
    // displayed window, so the store's hours + 臨時休業 reads over the
    // previous month were two core calls thrown away on every 月 page view.
    expect(prevCall[3]).toBe(false)
    expect(monthCall[3]).toBeUndefined()
  })

  it('a FAILED previous read costs the CLAUSE, never the screen', async () => {
    // Only the optional annotation's read is down; the month's own read is
    // whole. An annotation may go missing — the 予約 screen may not.
    getAppointmentWindow.mockImplementation(async (fromIso: string) => {
      if (fromIso < new Date('2026-08-01T00:00:00+09:00').toISOString()) {
        throw new Error('core: previous span unavailable')
      }
      return { ...WHOLE, counted: [appt('a', '2026-09-02')] }
    })
    const tree = await AppointmentsPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ view: 'month', date: '2026-09-15' }),
    })
    const props = viewPropsOf(tree)
    expect(props.monthCompareDelta).toBeNull()
    // …and the grid the page exists for is still there, with its real count.
    expect(props.monthData).not.toBeNull()
    expect(
      (props.monthData as { inMonth: boolean; count: number }[]).reduce(
        (n, c) => (c.inMonth ? n + c.count : n),
        0,
      ),
    ).toBe(1)
  })

  it('a FUTURE month costs no extra read and gets no clause', async () => {
    getAppointmentWindow.mockResolvedValue(WHOLE)
    const nextYear = `${new Date().getFullYear() + 1}-05-15`
    const tree = await AppointmentsPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ view: 'month', date: nextYear }),
    })
    // One window read only: the month's own. Nothing elapsed to compare with.
    expect(getAppointmentWindow).toHaveBeenCalledTimes(1)
    expect(viewPropsOf(tree).monthCompareDelta).toBeNull()
  })
})
