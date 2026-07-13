/**
 * Store-scope (RBAC) clamp on the NOTIFICATION FEED loaders.
 *
 * The feed post-dates the #465 clamp sweep and shipped with no store concept:
 * a Ginza-clamped staff's bell showed Daikanyama's 新規予約, the whole-business
 * 要フォロー/休眠 counts, and every store's 未保存カルテ (found by the
 * Apple-review account 7/14).
 *
 * These tests pin the fix: buildNotificationFeed threads the resolved
 * scope.storeId (never a raw cookie) into
 *   - the recent-bookings appointments.list read,
 *   - the DRAFT karuteRecords.list read,
 *   - the chase/sync roll-up's customer list (store-filtered lens),
 * and a null storeId (no stores / failed lookup) keeps the old unfiltered
 * behavior. The customer-name LOOKUP stays business-wide on purpose — names
 * must resolve even for not-yet-store-pinned customers.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// Spies shared with the SynqedClient mock below (derive.ts constructs the
// client directly, so the mock class hands back module-level spies).
const appointmentsList = jest.fn(async () => ({ appointments: [] }))
const karuteRecordsList = jest.fn(async () => ({ karute_records: [] }))

jest.mock('@synqed-kk/client', () => {
  class SynqedClient {
    appointments = { list: appointmentsList }
    karuteRecords = { list: karuteRecordsList }
  }
  return { SynqedClient }
})

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
  getCachedCustomerListFor: jest.fn(async () => [
    {
      id: 'cust-1',
      name: '銀座 花子',
      isExistingCustomer: true,
      created_at: '2026-01-01T00:00:00Z',
      visitCount: 3,
      hasTicketPack: false,
      karute_number: 1,
    },
  ]),
}))

jest.mock('@/lib/customers/list-enrich', () => ({
  effectiveLastVisitIso: jest.fn(() => '2026-06-01T00:00:00Z'),
  enrichCustomers: jest.fn(async () => new Map()),
  resolveCustomerStatus: jest.fn(() => 'on-track'),
}))

jest.mock('@/actions/appointments', () => ({
  getAppointmentsByDate: jest.fn(async () => []),
}))

import { buildNotificationFeed } from '@/lib/notifications/derive'
import { getCachedCustomerListFor } from '@/lib/customers/cached'

const BIZ = 'biz-1'

beforeAll(() => {
  process.env.SYNQED_CORE_URL = 'https://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('notification feed store scope', () => {
  it('threads the clamped storeId into the recent-bookings read', async () => {
    await buildNotificationFeed(BIZ, 'ja', 'store-ginza')
    expect(appointmentsList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })

  it('threads the clamped storeId into the DRAFT karute read', async () => {
    await buildNotificationFeed(BIZ, 'ja', 'store-ginza')
    expect(karuteRecordsList).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DRAFT', store_id: 'store-ginza' }),
    )
  })

  it('rolls up chase/sync over the STORE-scoped customer list', async () => {
    await buildNotificationFeed(BIZ, 'ja', 'store-ginza')
    expect(getCachedCustomerListFor).toHaveBeenCalledWith(BIZ, 'store-ginza')
  })

  it('keeps the customer-name LOOKUP business-wide (single-arg call present)', async () => {
    await buildNotificationFeed(BIZ, 'ja', 'store-ginza')
    const calls = (getCachedCustomerListFor as jest.Mock).mock.calls
    expect(calls).toEqual(expect.arrayContaining([[BIZ]]))
  })

  it('null storeId = no store filter (business has no stores / lookup failed)', async () => {
    await buildNotificationFeed(BIZ, 'ja', null)
    expect(appointmentsList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: undefined }),
    )
    expect(karuteRecordsList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: undefined }),
    )
    expect(getCachedCustomerListFor).toHaveBeenCalledWith(BIZ, undefined)
  })

  it('omitted storeId behaves like null (backward-compatible default)', async () => {
    await buildNotificationFeed(BIZ, 'ja')
    expect(appointmentsList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: undefined }),
    )
  })
})
