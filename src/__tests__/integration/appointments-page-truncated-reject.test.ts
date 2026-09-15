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
