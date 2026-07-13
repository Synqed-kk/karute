/**
 * Store lens on the dashboard PACK surfaces (Ginza leak, #465 family).
 *
 * Pack data has no store column server-side, so the loaders clamp by store
 * MEMBERSHIP: holders outside the viewer's store-filtered customer list are
 * dropped before any alert/totals math (getPackAlerts), and the 未処理来店
 * window read is store-filtered server-side (loadUnprocessedVisits). Found
 * on the Ginza Apple-review login 7/14: Daikanyama pack holders surfaced in
 * the Ginza dashboard's リブック提案/お久しぶり cards.
 *
 * Fail-closed rule: if the store lens fetch errors, getPackAlerts returns
 * the EMPTY shape — never another store's holders.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

const usageEntry = (unconsumed: number) => ({
  remaining: 3,
  size: 10,
  unconsumed,
  hasActivePack: true,
})

jest.mock('@/lib/packs/store', () => ({
  listAllPackUsage: jest.fn(async () =>
    new Map([
      ['c-ginza', usageEntry(10_000)],
      ['c-daikanyama', usageEntry(90_000)],
    ]),
  ),
  listAllLifecycles: jest.fn(async () => new Map()),
  listActiveDismissals: jest.fn(async () => new Set()),
  listRecentContacts: jest.fn(async () => []),
  listVisitReconcileDismissals: jest.fn(async () => []),
  listRecentRedemptions: jest.fn(async () => []),
}))

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

const listForMock = jest.fn(async () => [
  {
    id: 'c-ginza',
    name: '銀座 花子',
    isExistingCustomer: true,
    created_at: '2026-01-01T00:00:00Z',
    visitCount: 3,
    hasTicketPack: true,
    karute_number: 1,
  },
])

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
  getCachedCustomerListFor: (...args: unknown[]) => listForMock(...(args as [])),
}))

jest.mock('@/lib/customers/list-enrich', () => ({
  effectiveLastVisitIso: jest.fn((a: string | null) => a),
  enrichCustomers: jest.fn(async () => new Map()),
}))

const appointmentsList = jest.fn(async () => ({ appointments: [] }))
const karuteRecordsList = jest.fn(async () => ({ karute_records: [] }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    appointments: { list: appointmentsList },
    karuteRecords: { list: karuteRecordsList },
  })),
}))

import { getPackAlerts } from '@/lib/packs/alerts'
import { loadUnprocessedVisits } from '@/lib/packs/reconcile'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getPackAlerts store lens', () => {
  it('drops holders outside the store-filtered customer list (totals follow)', async () => {
    const res = await getPackAlerts(undefined, 'store-ginza')
    expect(listForMock).toHaveBeenCalledWith('biz-1', 'store-ginza')
    expect(res.totals.holderCount).toBe(1)
    expect(res.totals.unconsumedTotal).toBe(10_000)
  })

  it('no storeId = business-wide (pre-existing behavior preserved)', async () => {
    const res = await getPackAlerts()
    expect(listForMock).not.toHaveBeenCalled()
    expect(res.totals.holderCount).toBe(2)
    expect(res.totals.unconsumedTotal).toBe(100_000)
  })

  it('fails CLOSED when the lens fetch errors (empty shape, never cross-store)', async () => {
    listForMock.mockRejectedValueOnce(new Error('core down'))
    const res = await getPackAlerts(undefined, 'store-ginza')
    expect(res.totals.holderCount).toBe(0)
    expect(res.contact).toEqual([])
    expect(res.low).toEqual([])
  })
})

describe('loadUnprocessedVisits store lens', () => {
  it('store-filters the appointment window read server-side', async () => {
    await loadUnprocessedVisits('store-ginza')
    expect(appointmentsList).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })

  it('leaves the karute has-record lookup UNFILTERED (mis-stamped legacy guard)', async () => {
    await loadUnprocessedVisits('store-ginza')
    expect(karuteRecordsList).toHaveBeenCalled()
    const arg = (karuteRecordsList.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(arg.store_id).toBeUndefined()
  })

  it('no storeId = unfiltered window (pre-existing behavior preserved)', async () => {
    await loadUnprocessedVisits()
    const arg = (appointmentsList.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(arg.store_id).toBeUndefined()
  })
})
