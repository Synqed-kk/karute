/**
 * WithClient twins added for design-parity P-B-1 (dashboard extraction
 * prep) — mirrors packs-store-lens.test.ts's cookie-path coverage, but
 * pins the EXPLICIT client/businessId/storeId plumbing instead of a cookie
 * read. These twins take the client as a plain object argument, so the
 * functions under test are exercised directly (no store.ts module mock) —
 * but store.ts's cookie-wrapper siblings still value-import
 * @/lib/synqed/client, which value-imports the ESM-only @synqed-kk/client
 * package. Mock the PACKAGE (same fix dashboard-cached.test.ts uses), not
 * the module, so the real twin logic under test still loads.
 */

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => ({})),
}))
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: jest.fn(),
}))
jest.mock('@/lib/customers/list-enrich', () => ({
  effectiveLastVisitIso: jest.fn((a: string | null) => a),
  enrichCustomers: jest.fn(async () => new Map()),
}))

import {
  listActiveDismissalsWithClient,
  listRecentContactsWithClient,
  listVisitReconcileDismissalsWithClient,
  listRecentRedemptionsWithClient,
} from '@/lib/packs/store'
import { getPackAlertsWithClient } from '@/lib/packs/alerts'
import { loadUnprocessedVisitsWithClient } from '@/lib/packs/reconcile'
import { getCachedCustomerListFor } from '@/lib/customers/cached'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('store.ts WithClient twins (mechanical)', () => {
  it('listActiveDismissalsWithClient keeps only unexpired dismissals', async () => {
    const now = Date.now()
    const synqed = {
      packs: {
        listAlertDismissals: jest.fn(async () => [
          { customer_id: 'a', expires_at: null },
          { customer_id: 'b', expires_at: new Date(now + 10_000).toISOString() },
          { customer_id: 'c', expires_at: new Date(now - 10_000).toISOString() },
        ]),
      },
    }
    const set = await listActiveDismissalsWithClient(synqed as never)
    expect(set).toEqual(new Set(['a', 'b']))
  })

  it('listActiveDismissalsWithClient THROWS on failure (WithClient convention — no swallow)', async () => {
    const synqed = {
      packs: {
        listAlertDismissals: jest.fn(async () => {
          throw new Error('core down')
        }),
      },
    }
    await expect(listActiveDismissalsWithClient(synqed as never)).rejects.toThrow('core down')
  })

  it('listRecentContactsWithClient delegates straight through with the since cutoff', async () => {
    const listRecentContacts = jest.fn(async () => [
      { customer_id: 'a', contacted_at: '2026-01-01T00:00:00Z' },
    ])
    const synqed = { packs: { listRecentContacts } }
    const rows = await listRecentContactsWithClient(synqed as never, 31)
    expect(rows).toEqual([{ customer_id: 'a', contacted_at: '2026-01-01T00:00:00Z' }])
    expect(listRecentContacts).toHaveBeenCalledWith(expect.any(String))
  })

  it('listVisitReconcileDismissalsWithClient delegates straight through', async () => {
    const listVisitDismissals = jest.fn(async () => [
      { customer_id: 'a', appointment_id: null, visit_day: '2026-06-01' },
    ])
    const synqed = { packs: { listVisitDismissals } }
    const rows = await listVisitReconcileDismissalsWithClient(synqed as never, 8)
    expect(rows).toEqual([{ customer_id: 'a', appointment_id: null, visit_day: '2026-06-01' }])
  })

  it('listRecentRedemptionsWithClient delegates straight through', async () => {
    const listRecentRedemptions = jest.fn(async () => [
      { customer_id: 'a', appointment_id: 'ap1', redeemed_on: '2026-06-01' },
    ])
    const synqed = { packs: { listRecentRedemptions } }
    const rows = await listRecentRedemptionsWithClient(synqed as never, 7)
    expect(rows).toEqual([{ customer_id: 'a', appointment_id: 'ap1', redeemed_on: '2026-06-01' }])
  })
})

function fakePackAlertsSynqed(over: Partial<Record<string, jest.Mock>> = {}) {
  return {
    packs: {
      listActivePacks: jest.fn(async () => [
        { id: 'p-ginza', customer_id: 'c-ginza', kind: 'pack', pack_size: 10, unit_price: 1000 },
        { id: 'p-daikanyama', customer_id: 'c-daikanyama', kind: 'pack', pack_size: 10, unit_price: 9000 },
      ]),
      listAllRedemptionPackIds: jest.fn(async () => []),
      listLifecycles: jest.fn(async () => []),
      listAlertDismissals: jest.fn(async () => []),
      listRecentContacts: jest.fn(async () => [
        { customer_id: 'c-ginza', contacted_at: new Date().toISOString() },
        { customer_id: 'c-daikanyama', contacted_at: new Date().toISOString() },
      ]),
      ...over,
    },
  }
}

const businessWideCustomers = [
  { id: 'c-ginza', name: '銀座 花子' },
  { id: 'c-daikanyama', name: '代官山 太郎' },
]

describe('getPackAlertsWithClient (composed from the twins)', () => {
  beforeEach(() => {
    ;(getCachedCustomerListFor as jest.Mock).mockImplementation(
      (_biz: string, storeId?: string) =>
        storeId === undefined
          ? Promise.resolve(businessWideCustomers)
          : Promise.resolve(businessWideCustomers.filter((c) => c.id === 'c-ginza')),
    )
  })

  it('pins businessId/storeId reaching the store-lens customer-list read', async () => {
    const synqed = fakePackAlertsSynqed()
    await getPackAlertsWithClient(synqed as never, 'biz-1', undefined, 'store-ginza')
    expect(getCachedCustomerListFor).toHaveBeenCalledWith('biz-1', 'store-ginza')
  })

  it('drops holders outside the store-filtered customer list (totals follow)', async () => {
    const synqed = fakePackAlertsSynqed()
    const res = await getPackAlertsWithClient(synqed as never, 'biz-1', undefined, 'store-ginza')
    expect(res.totals.holderCount).toBe(1)
    expect(res.totals.unconsumedTotal).toBe(10_000)
  })

  it('no storeId = business-wide (pre-existing getPackAlerts behavior preserved)', async () => {
    const synqed = fakePackAlertsSynqed()
    const res = await getPackAlertsWithClient(synqed as never, 'biz-1')
    expect(getCachedCustomerListFor).toHaveBeenCalledWith('biz-1')
    expect(res.totals.holderCount).toBe(2)
    expect(res.totals.unconsumedTotal).toBe(100_000)
  })

  it('fails CLOSED when the lens fetch errors (empty shape, never cross-store)', async () => {
    ;(getCachedCustomerListFor as jest.Mock).mockImplementation((_biz: string, storeId?: string) =>
      storeId === undefined ? Promise.resolve(businessWideCustomers) : Promise.reject(new Error('core down')),
    )
    const synqed = fakePackAlertsSynqed()
    const res = await getPackAlertsWithClient(synqed as never, 'biz-1', undefined, 'store-ginza')
    expect(res.totals.holderCount).toBe(0)
    expect(res.contact).toEqual([])
  })
})

describe('loadUnprocessedVisitsWithClient (composed from the twins)', () => {
  function fakeReconcileSynqed() {
    return {
      packs: {
        listActivePacks: jest.fn(async () => [
          { id: 'p1', customer_id: 'c1', kind: 'pack', pack_size: 6, unit_price: 1000 },
        ]),
        listAllRedemptionPackIds: jest.fn(async () => []),
        listLifecycles: jest.fn(async () => []),
        listVisitDismissals: jest.fn(async () => []),
        listRecentRedemptions: jest.fn(async () => []),
      },
      appointments: { list: jest.fn(async () => ({ appointments: [] })) },
      karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) },
    }
  }

  it('store-filters the appointment window read server-side', async () => {
    ;(getCachedCustomerListFor as jest.Mock).mockResolvedValue([{ id: 'c1', name: 'A' }])
    const synqed = fakeReconcileSynqed()
    await loadUnprocessedVisitsWithClient(synqed as never, 'biz-1', 'store-ginza')
    expect(synqed.appointments.list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-ginza' }),
    )
  })

  it('businessId reaches the customer-list read', async () => {
    ;(getCachedCustomerListFor as jest.Mock).mockResolvedValue([{ id: 'c1', name: 'A' }])
    const synqed = fakeReconcileSynqed()
    await loadUnprocessedVisitsWithClient(synqed as never, 'biz-9', null)
    expect(getCachedCustomerListFor).toHaveBeenCalledWith('biz-9')
  })

  it('no holders short-circuits before any appointment/karute read', async () => {
    ;(getCachedCustomerListFor as jest.Mock).mockResolvedValue([])
    const synqed = fakeReconcileSynqed()
    synqed.packs.listActivePacks.mockResolvedValue([])
    const res = await loadUnprocessedVisitsWithClient(synqed as never, 'biz-1', null)
    expect(res).toEqual({ entries: [], truncated: 0 })
    expect(synqed.appointments.list).not.toHaveBeenCalled()
  })
})
