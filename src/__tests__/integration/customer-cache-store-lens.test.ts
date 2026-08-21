/**
 * getCachedCustomerList(storeId?) / getCachedCustomerListFor — the REAL
 * functions, against the REAL core call (⚖ Liam 2026-08-17).
 *
 * Every other suite that touches the store lens mocks this module, so the
 * forwarding itself — does a passed storeId actually reach
 * `client.customers.list({ store_id })`? — was never exercised anywhere: the
 * mutation "drop the storeId forward" survived the whole suite while all four
 * picker surfaces stayed green, because they assert the ARGUMENT, not the read.
 * This file closes that gap at the only place it can be closed.
 *
 * Idiom borrowed wholesale from customers-list-all.test.ts: unstable_cache is a
 * REAL keyed memoizer (a passthrough would let a dropped cache-key arg pass
 * silently), and SynqedClient is constructed per businessId so a call can be
 * attributed to a tenant.
 */
process.env.SYNQED_CORE_URL = 'http://synqed.test'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const mockCacheStore = new Map<string, unknown>()
jest.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: never[]) => Promise<unknown>) =>
    async (...args: never[]) => {
      const key = JSON.stringify(args)
      if (!mockCacheStore.has(key)) mockCacheStore.set(key, await fn(...args))
      return mockCacheStore.get(key)
    },
}))

type ListArg = { page: number; page_size?: number; store_id?: string; sort_by?: string }
const customersList = jest.fn(async ({ store_id }: ListArg) => ({
  // The double IS core's store filter: only in-store rows come back, so a
  // dropped forward shows up as the other branch's customer in the result.
  customers:
    store_id === 'store-A'
      ? [{ id: 'cust-ginza', name: '銀座 花子', created_at: '2026-01-01T00:00:00Z' }]
      : [
          { id: 'cust-ginza', name: '銀座 花子', created_at: '2026-01-01T00:00:00Z' },
          { id: 'cust-daikanyama', name: '代官山 太郎', created_at: '2026-01-02T00:00:00Z' },
        ],
  total: store_id === 'store-A' ? 1 : 2,
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => ({ customers: { list: customersList } })),
}))
jest.mock('@/lib/staff', () => ({ getBusinessId: async () => 'biz-1' }))

import { getCachedCustomerList, getCachedCustomerListFor } from '@/lib/customers/cached'

/** The store_id every recorded core call was made with. */
const storeIdsSeen = () =>
  customersList.mock.calls.map((c) => (c[0] as ListArg).store_id)

beforeEach(() => {
  mockCacheStore.clear()
  customersList.mockClear()
})

describe('getCachedCustomerList — the store lens reaches core', () => {
  it('a passed storeId travels into customers.list as store_id', async () => {
    const rows = await getCachedCustomerList('store-A')
    expect(storeIdsSeen()).toEqual(['store-A'])
    expect(rows.map((c) => c.id)).toEqual(['cust-ginza'])
  })

  it('omitting it stays business-wide — no store_id on the wire', async () => {
    const rows = await getCachedCustomerList()
    expect(storeIdsSeen()).toEqual([undefined])
    expect(rows.map((c) => c.id)).toEqual(['cust-daikanyama', 'cust-ginza']) // name-sorted
  })

  it('the two lenses are SEPARATE cache entries — a scoped read never serves the wide one', async () => {
    await getCachedCustomerList('store-A')
    await getCachedCustomerList()
    await getCachedCustomerList('store-A') // cache hit, no third call
    expect(storeIdsSeen()).toEqual(['store-A', undefined])
  })

  // The arity guard (cached.ts:123-125): an explicit `undefined` argument would
  // key a SECOND unstable_cache entry for the same business-wide list. Both
  // entry points must land on the identical single-arg tuple.
  it('an explicit undefined lens shares the business-wide entry, never forks it', async () => {
    await getCachedCustomerList(undefined)
    await getCachedCustomerListFor('biz-1', undefined)
    await getCachedCustomerListFor('biz-1')
    expect(customersList).toHaveBeenCalledTimes(1)
    expect(mockCacheStore.size).toBe(1)
  })

  it('getCachedCustomerListFor forwards its lens the same way', async () => {
    await getCachedCustomerListFor('biz-1', 'store-A')
    expect(storeIdsSeen()).toEqual(['store-A'])
  })
})
