/**
 * 予約 booking-picker CUSTOMER isolation on the WEB page (⚖ Liam 2026-08-17: a
 * branch's staff must not even know another branch's customers exist). Unlike
 * the menu union next door — a business-wide cache clamped at the consumer —
 * the customer list is SERVER-filtered: the page threads its resolved store
 * lens into getCachedCustomerList, so the combobox's client-side search is
 * store-clamped by construction. The facade twin lives in
 * app-api-screens-appointments.test.ts.
 *
 * Reads ignore `degraded` (shipped F-A convention, store-scope.ts) — the
 * menus-picker sibling's fail-closed blindness is the WRITE-offer posture and
 * is deliberately NOT copied here.
 *
 * Same harness as menus-picker-store-scope.test.ts: the page is invoked as the
 * plain async function it is and its element tree is read — no render.
 */
import type { ReactElement } from 'react'

jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))
jest.mock('@/components/perf/QuietRefresh', () => ({ QuietRefresh: () => null }))
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: () => null,
}))
jest.mock('@/lib/perf/render-stamp', () => ({ renderStamp: () => '2026-08-27T00:00:00.000Z' }))
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
  getCurrentUserStaffId: async () => 'staff-1',
  getBusinessId: async () => 'biz-1',
}))
const resolveStoreScope = jest.fn()
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScope(),
  storeStaffIdSet: async () => null,
  // Pure derivation of the faked scope — the REAL one, since the lens IS what
  // this suite pins.
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: async () => ({ ticket_packs_enabled: false, operating_hours: null }),
}))
jest.mock('@/actions/appointments', () => ({ getAppointmentsInRange: async () => [] }))
jest.mock('@/lib/appointments/day-agenda-cached', () => ({ getCachedDayAgenda: async () => [] }))
jest.mock('@/lib/customers/list-enrich', () => ({ enrichCustomers: async () => new Map() }))
jest.mock('@/lib/packs/store', () => ({ listAllPackUsage: async () => new Map() }))
jest.mock('@/lib/menus/cached', () => ({
  getCachedMenuOptions: async () => [],
  scopeMenuOptions: (rows: unknown[]) => rows,
}))

// Stands in for core's server-side store filter: the lens the page passes IS
// the list it gets back. A dropped argument therefore shows up as the other
// branch's customer sitting in the picker.
const getCachedCustomerList = jest.fn(async (..._a: unknown[]) => [] as CachedCustomerOption[])
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: (...a: unknown[]) => getCachedCustomerList(...a),
}))

import AppointmentsPage from '@/app/[locale]/(app)/appointments/page'
import type { CachedCustomerOption } from '@/lib/customers/cached'

const MINE = 'store-ginza'
const OTHER = 'store-daikanyama'

const customer = (id: string, name: string): CachedCustomerOption => ({
  id,
  name,
  phone: null,
  furigana: null,
  isExistingCustomer: true,
  created_at: '2026-01-01T00:00:00.000Z',
  visitCount: 1,
  hasTicketPack: false,
  karute_number: null,
})
const OWN = customer('cust-ginza', '銀座 花子')
const FOREIGN = customer('cust-daikanyama', '代官山 太郎')
const ALL = [OWN, FOREIGN]
const BY_STORE: Record<string, CachedCustomerOption[]> = { [MINE]: [OWN], [OTHER]: [FOREIGN] }

/** The customers prop the page hands the picker, read off the element tree. */
async function pickerCustomers(): Promise<CachedCustomerOption[]> {
  const tree = (await AppointmentsPage({
    params: Promise.resolve({ locale: 'ja' }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ children: ReactElement<{ customers?: CachedCustomerOption[] }>[] }>
  const view = tree.props.children.find((c) => c?.props && 'customers' in c.props)
  if (!view) throw new Error('AppointmentsView (the customers consumer) is not in the page tree')
  return view.props.customers as CachedCustomerOption[]
}

beforeEach(() => {
  jest.clearAllMocks()
  getCachedCustomerList.mockImplementation(async (storeId?: unknown) =>
    typeof storeId === 'string' ? (BY_STORE[storeId] ?? []) : ALL,
  )
})

describe('予約 picker customer scope (web page)', () => {
  it('a clamped actor gets ONLY their own store’s customers', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: [MINE], degraded: false,
    })
    expect(await pickerCustomers()).toEqual([OWN])
    expect(getCachedCustomerList).toHaveBeenCalledWith(MINE)
  })

  it('a stores.viewAll actor keeps the business-wide list', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: true, allowedStoreIds: null, degraded: false,
    })
    expect(await pickerCustomers()).toEqual(ALL)
    // The page passes the undefined lens straight through; the arity guard that
    // stops it forking a second cache entry lives one level down, inside
    // getCachedCustomerListFor (cached.ts:123-125).
    expect(getCachedCustomerList).toHaveBeenCalledWith(undefined)
  })

  it('floating staff (no assignment) stay unclamped — the house convention', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: null, degraded: false,
    })
    expect(await pickerCustomers()).toEqual(ALL)
  })

  it('a degraded assignment lookup stays business-wide — reads ignore F-A', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: null, degraded: true,
    })
    expect(await pickerCustomers()).toEqual(ALL)
  })
})
