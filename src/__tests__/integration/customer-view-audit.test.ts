/**
 * customer.view (packet 30 §1): a single-record open of
 * customers/[id]/page.tsx emits ONE customer.view event, AFTER the record is
 * confirmed to exist (a 404 open is not a view — the 7/17 ruling). The
 * customers LIST page (page.tsx one level up) emits NOTHING — re-affirming
 * that ruling for the negative pin. Every dependency of both pages is
 * mocked; only the audit spine (@/lib/audit + @/lib/staff's identity
 * resolvers) runs for real, spied via console per the existing writer idiom.
 */
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
jest.mock('next-intl/server', () => ({
  getLocale: jest.fn(async () => 'ja'),
  getTranslations: jest.fn(async () => (k: string) => k),
}))
jest.mock('@/lib/staff', () => ({
  getStaffList: jest.fn(async () => []),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'user-1'),
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(async () => ({})) }))
jest.mock('@/lib/customers/queries', () => ({
  getCustomer: jest.fn(async (id: string) => (id === 'missing' ? null : { id, name: 'Y' })),
}))
jest.mock('@/lib/customers/customer-detail-cached', () => ({
  getCustomerContact: jest.fn(async () => ({})),
}))
jest.mock('@/lib/karute/synqed-records', () => ({ listSynqedKaruteRows: jest.fn(async () => []) }))
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: jest.fn(async () => ({ customers: [] })),
  listAllCustomersCached: jest.fn(async () => ({ customers: [] })),
}))
jest.mock('@/actions/customers', () => ({
  listCustomerPhotos: jest.fn(async () => ({ photos: [] })),
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
}))
jest.mock('@/lib/karute/customer-memory', () => ({ getCustomerMemory: jest.fn(async () => ({})) }))
jest.mock('@/lib/karute/ai-passport', () => ({ getCachedPassport: jest.fn(async () => null) }))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn(async () => ({})) }))
jest.mock('@/components/customers/redesign/profile/CustomerProfileView', () => ({
  CustomerProfileView: () => null,
}))
// AI再エンゲージメント slot (reengagement packet): page.tsx now mounts this at
// module scope alongside CustomerProfileView — same reason as that mock
// above, its own import chain (ai-reengagement.ts → ai-cache.ts →
// @synqed-kk/client's RUNTIME import) has nothing to do with the
// customer.view pin this file tests.
jest.mock('@/components/customers/redesign/profile/CustomerReengagementSlot', () => ({
  CustomerReengagementSlot: () => null,
}))
jest.mock('@/lib/customers/list-enrich', () => ({ enrichCustomers: jest.fn(async () => ({})) }))
jest.mock('@/lib/packs/store', () => ({
  getCustomerLifecycleChecked: jest.fn(async () => null),
  listCustomerPacks: jest.fn(async () => []),
  listAllLifecycles: jest.fn(async () => []),
  listAllPackUsage: jest.fn(async () => []),
  listBurnRedemptions: jest.fn(async () => null),
}))
jest.mock('@/lib/customers/profile-screen', () => ({
  buildCustomerProfileScreen: jest.fn(async () => ({
    // Minimal shape the page now reads directly (reengagement packet) to
    // build CustomerReengagementSlot's props, not just spread into the
    // (mocked, prop-ignoring) CustomerProfileView.
    customer: {
      id: 'cust-1',
      name: 'Y',
      status: 'on-track',
      visitCount: 0,
      preferredStaffName: null,
      visitPace: null,
    },
    hasNextBooking: false,
  })),
}))

// List page (customers/page.tsx) — the negative pin.
jest.mock('@/components/customers/redesign/list/CustomersListView', () => ({
  CustomersListView: () => null,
}))
jest.mock('@/lib/customers/screen-rows', () => ({
  buildCustomersListScreen: jest.fn(() => ({
    rows: [],
    totalRegistered: 0,
    staffList: [],
    bookingDataAvailable: false,
  })),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: null, allowedStoreIds: null })),
  storeStaffIdSet: jest.fn(async () => null),
}))
jest.mock('@/lib/perf/timing', () => ({
  startTiming: () => ({ phase: (_n: string, fn: () => unknown) => fn(), end: () => {} }),
}))

import { auditLines } from './helpers/audit-lines'
import CustomerProfilePage from '@/app/[locale]/(app)/customers/[id]/page'
import CustomersPage from '@/app/[locale]/(app)/customers/page'

// Drain the fire-and-forget auditWeb chain deterministically before asserting —
// the page deliberately does NOT await the emit (void, never blocks render), so
// without this the pins would pass or fail by incidental microtask depth.
const drain = () => new Promise((r) => setImmediate(r))

describe('customer.view — single-record open', () => {
  it('emits exactly one customer.view targeting the opened id', async () => {
    const lines = await auditLines(async () => {
      await CustomerProfilePage({ params: Promise.resolve({ id: 'cust-1', locale: 'ja' }) })
      await drain()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'customer',
      action: 'customer.view',
      actor_id: 'user-1',
      business_id: 'biz-1',
      target_type: 'customer',
      target_id: 'cust-1',
      severity: 'info',
      source: 'web',
    })
  })

  it('a 404 open (record does not exist) emits nothing — a missing record is not a view', async () => {
    const lines = await auditLines(async () => {
      await expect(
        CustomerProfilePage({ params: Promise.resolve({ id: 'missing', locale: 'ja' }) }),
      ).rejects.toThrow('NEXT_NOT_FOUND')
      await drain()
    })
    expect(lines).toHaveLength(0)
  })
})

describe('customer.view — negative pin: the LIST page never logs (7/17 ruling)', () => {
  it('rendering the customers list emits nothing', async () => {
    const lines = await auditLines(async () => {
      await CustomersPage({ searchParams: Promise.resolve({}) })
      await drain()
    })
    expect(lines).toHaveLength(0)
  })
})
