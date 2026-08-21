/**
 * 録音 (sessions) picker CUSTOMER isolation on the WEB page (⚖ Liam
 * 2026-08-17). Twin of customers-picker-store-scope.test.ts for the record
 * page: the array the server SHIPS to the client is store-scoped for a clamped
 * actor, because a clamped client must never receive the other branch's names
 * at all (hide, never filter-after-ship — store-scope.ts ~:288-294).
 *
 * The same array doubles as the fallback name map for the 録音履歴 rows, the
 * recovery banner and the re-point dialog. Those rows carry their OWN
 * customerName (take snapshot, or the server fill in
 * actions/recordings-inbox.ts), which is what makes narrowing this array safe —
 * see recordings-inbox-web-action.test.ts and recordings-inbox-page.test.ts.
 *
 * The page is invoked as the plain async function it is and its returned
 * element tree is read — no render, so the client components are stubbed.
 */
import type { ReactElement } from 'react'

jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))
jest.mock('@/components/perf/QuietRefresh', () => ({ QuietRefresh: () => null }))
jest.mock('@/components/karute/redesign/record/RecordPageView', () => ({
  RecordPageView: () => null,
}))
jest.mock('@/lib/perf/render-stamp', () => ({ renderStamp: () => '2026-08-27T00:00:00.000Z' }))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string) => k,
  getLocale: async () => 'ja',
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: async () => 'staff-1',
  getStaffList: async () => [],
  getBusinessId: async () => 'biz-1',
}))
const resolveStoreScope = jest.fn()
jest.mock('@/lib/auth/store-scope', () => ({ resolveStoreScope: () => resolveStoreScope() }))
jest.mock('@/lib/customers/queries', () => ({ getCustomer: async () => null }))
jest.mock('@/actions/customers', () => ({ getCustomerConsent: async () => ({ consent: null }) }))
jest.mock('@/lib/customers/list-enrich', () => ({ enrichCustomers: async () => new Map() }))
jest.mock('@/lib/packs/store', () => ({
  listCustomerPacks: async () => [],
  getCustomerLifecycleChecked: async () => null,
  listAllPackUsage: async () => new Map(),
}))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: async () => null }))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: async () => new Set() }))
jest.mock('@/actions/appointments', () => ({
  getAppointmentsByDate: async () => [],
  getAppointmentById: async () => null,
}))
jest.mock('@/actions/karute', () => ({ getCustomerKaruteRecords: async () => [] }))
jest.mock('@/lib/karute/ai-brief', () => ({ getAiPreSessionBrief: async () => null }))
// The assembly is pinned by its own suites; this file is only about WHICH
// customers reach the client.
jest.mock('@/lib/karute/record-screen', () => ({
  buildRecordScreen: async () => ({ briefInputs: null }),
}))

// Stands in for core's server-side store filter: the lens the page passes IS
// the list it gets back.
const getCachedCustomerList = jest.fn(async (..._a: unknown[]) => [] as CachedCustomerOption[])
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: (...a: unknown[]) => getCachedCustomerList(...a),
}))

import SessionsPage from '@/app/[locale]/(app)/sessions/page'
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

/** The customers array the page SHIPS to the client component. */
async function shippedCustomers(): Promise<CachedCustomerOption[]> {
  const tree = (await SessionsPage({
    params: Promise.resolve({ locale: 'ja' }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ children: ReactElement<{ customers?: CachedCustomerOption[] }>[] }>
  const view = tree.props.children.find((c) => c?.props && 'customers' in c.props)
  if (!view) throw new Error('RecordPageView (the customers consumer) is not in the page tree')
  return view.props.customers as CachedCustomerOption[]
}

beforeEach(() => {
  jest.clearAllMocks()
  getCachedCustomerList.mockImplementation(async (storeId?: unknown) =>
    typeof storeId === 'string' ? (BY_STORE[storeId] ?? []) : ALL,
  )
})

describe('録音 picker customer scope (web sessions page)', () => {
  it('a clamped actor is SHIPPED only their own store’s customers', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: [MINE], degraded: false,
    })
    expect(await shippedCustomers()).toEqual([OWN])
    expect(getCachedCustomerList).toHaveBeenCalledWith(MINE)
  })

  it('a stores.viewAll actor keeps the business-wide list', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: true, allowedStoreIds: null, degraded: false,
    })
    expect(await shippedCustomers()).toEqual(ALL)
    expect(getCachedCustomerList).toHaveBeenCalledWith(undefined)
  })

  it('floating staff (no assignment) stay unclamped — the house convention', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: null, degraded: false,
    })
    expect(await shippedCustomers()).toEqual(ALL)
  })

  it('a degraded assignment lookup stays business-wide — reads ignore F-A', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: null, degraded: true,
    })
    expect(await shippedCustomers()).toEqual(ALL)
  })
})
