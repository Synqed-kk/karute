/**
 * F-3 (fix round B7, 2026-09-01) — packet §Tests M6 requires the
 * assignableStaff flag mapping pinned at BOTH sites. The facade site
 * (app-api-screens-customers.test.ts) already pins it (mutation M20 red);
 * the WEB site (customers/page.tsx:145-149) had zero coverage — mutation
 * M21 (strip `isManagement: s.isManagement,` from the page's assignableStaff
 * map) stayed green across the full 5892-test suite.
 *
 * A dedicated file rather than folding into management-flag-data-plane.test.ts
 * (the packet's suggested fallback location): that file's roster-read
 * describe block imports `@/lib/staff` UNMOCKED (it exercises the real
 * column-mapping logic against a faked Supabase client), which a page-level
 * `jest.mock('@/lib/staff', ...)` here would collide with. Same idiom as
 * menus-picker-store-scope.test.ts / customer-view-audit.test.ts: the page
 * is invoked as the plain async function it is, its child view is mocked to
 * capture props, and the tree is read — no render.
 */
jest.mock('@/components/perf/QuietRefresh', () => ({ QuietRefresh: () => null }))
jest.mock('@/lib/perf/render-stamp', () => ({ renderStamp: () => '2026-09-01T00:00:00.000Z' }))
jest.mock('@/lib/perf/timing', () => ({
  startTiming: () => ({ phase: (_n: string, fn: () => unknown) => fn(), end: () => {} }),
}))
jest.mock('next-intl/server', () => ({
  getLocale: async () => 'ja',
  getTranslations: async () => (k: string) => k,
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: async () => 'staff-1',
  getStaffList: async () => [],
  getBusinessId: async () => 'biz-1',
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: async () => ({ ticket_packs_enabled: false, operating_hours: null }),
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: async () => ({}) }))
jest.mock('@/lib/customers/list-enrich', () => ({ enrichCustomers: async () => new Map() }))
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: jest.fn(async () => ({ customers: [] })),
  listAllCustomersCached: jest.fn(async () => ({ customers: [] })),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: async () => ({
    storeId: null,
    allowedStoreIds: null,
    viewAll: true,
    degraded: false,
  }),
  storeStaffIdSet: async () => null,
}))
jest.mock('@/lib/packs/store', () => ({
  listAllLifecycles: async () => [],
  listAllPackUsage: async () => new Map(),
  listBurnRedemptions: async () => null,
}))

jest.mock('@/components/customers/redesign/list/CustomersListView', () => ({
  CustomersListView: () => null,
}))

const KITANO = { id: 'p-kitano', name: '北野', initials: '北', isManagement: true }
jest.mock('@/lib/customers/screen-rows', () => ({
  buildCustomersListScreen: jest.fn(() => ({
    rows: [],
    totalRegistered: 0,
    staffList: [KITANO],
    bookingDataAvailable: false,
  })),
}))

import type { ReactElement } from 'react'
import CustomersPage from '@/app/[locale]/(app)/customers/page'

/** The assignableStaff prop the page hands the picker, read off the element
 *  tree (no render — same idiom as menus-picker-store-scope.test.ts's
 *  pickerMenus() / customers-picker-store-scope.test.ts's pickerCustomers()). */
async function assignableStaff(): Promise<
  { id: string; name: string; isManagement?: boolean }[]
> {
  const tree = (await CustomersPage({
    searchParams: Promise.resolve({}),
  })) as ReactElement<{
    children: ReactElement<{ assignableStaff?: { id: string; name: string; isManagement?: boolean }[] }>[]
  }>
  const view = tree.props.children.find((c) => c?.props && 'assignableStaff' in c.props)
  if (!view) throw new Error('CustomersListView (the assignableStaff consumer) is not in the page tree')
  return view.props.assignableStaff ?? []
}

describe('customers/page.tsx assignableStaff transport (verify mutation M21)', () => {
  it('the 指名スタッフ picker roster carries isManagement through the WEB page', async () => {
    expect(await assignableStaff()).toEqual([{ id: 'p-kitano', name: '北野', isManagement: true }])
  })
})
