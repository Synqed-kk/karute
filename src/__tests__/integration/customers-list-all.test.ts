/**
 * listAllCustomers pages synqed-core's customer list to completion (the server
 * clamps page_size at 500, so a single call drops everyone past #500 off the
 * 顧客 + カルテ surfaces). Two traps the council flagged and these lock down:
 *  1. paginateDedupe returns by-id INSERTION order, not the server sort — so the
 *     helper MUST re-sort in memory or the list silently reorders.
 *  2. The SAME search must go into every page closure; applying it only on page 1
 *     would page the unfiltered set against a filtered total.
 *
 * Web性能 (speed lever 3): the WEB pages' no-search case is served by the new
 * listAllCustomersCached (unstable_cache, 60s, tag 'customers') while search —
 * and every facade caller — stays on the untouched live listAllCustomers. The
 * suite below locks down that split:
 *  3. the live function never memoizes — search / facade calls stay fresh.
 *  4. the cache key carries businessId — two tenants never share an entry
 *     (CRITICAL: silently dropping businessId from the key would leak one
 *     business's customers into another's 顧客/カルテ page).
 *  5. the cache key carries store_id + enforceStore + sort_by — different
 *     scopes never collide into the same entry.
 *
 * unstable_cache is mocked as a REAL keyed memoizer here (not the plain
 * passthrough the sibling cache suites use — dashboard-cached,
 * customers-list-enrich) because cases 4/5 specifically test the KEY, which a
 * passthrough would trivially "pass" without proving anything.
 */
process.env.SYNQED_CORE_URL = 'http://synqed.test'
process.env.SYNQED_CORE_API_KEY = 'test-key'

// Keyed-memoizing mock of unstable_cache: same arg-tuple → the underlying fn
// runs once (cache HIT on repeat); a different arg-tuple → a separate entry
// (a fresh underlying call). This is what actually lets tests 4/5 prove the
// cache key includes businessId / store_id / enforceStore / sort_by.
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

// The cached path builds its OWN client per businessId (the store-scope.ts
// request-context-escape idiom) instead of any request-bound client — route
// each constructed client's customers.list to a per-business registered mock
// so tests can prove which tenant's data a call actually reached.
const listByBusiness = new Map<string, jest.Mock>()
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(({ businessId }: { businessId: string }) => {
    const list = listByBusiness.get(businessId)
    if (!list) throw new Error(`no mock client registered for business "${businessId}"`)
    return { customers: { list } }
  }),
}))

import { listAllCustomers, listAllCustomersCached } from '@/lib/customers/list-all'

const mk = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `name-${id}`,
  created_at: `2026-01-0${id}T00:00:00Z`,
  updated_at: `2026-02-0${id}T00:00:00Z`,
  ...over,
})

type ListArg = { page: number; search?: string; page_size?: number; store_id?: string }

// Live-path client double (unchanged from the original suite) — used by the
// listAllCustomers tests, which call the caller's own passed-in client directly.
const client = (pages: ReturnType<typeof mk>[][], total: number) => ({
  customers: {
    list: jest.fn(async ({ page }: ListArg) => ({
      customers: pages[page - 1] ?? [],
      total,
    })),
  },
})

// Registers the mock client the CACHED path will construct for this businessId
// (see the @synqed-kk/client mock above).
function registerBusiness(businessId: string, pages: ReturnType<typeof mk>[][], total: number) {
  const list = jest.fn(async ({ page }: ListArg) => ({ customers: pages[page - 1] ?? [], total }))
  listByBusiness.set(businessId, list)
  return list
}

beforeEach(() => {
  mockCacheStore.clear()
  listByBusiness.clear()
})

describe('listAllCustomers (live, untouched)', () => {
  it('assembles every page and re-sorts updated_at DESC (server order discarded by dedupe)', async () => {
    // pages arrive 1,3 then 2 → dedupe insertion order is [1,3,2]; the helper
    // must re-sort to updated_at DESC = [3,2,1].
    const c = client([[mk('1'), mk('3')], [mk('2')]], 3)
    const { customers, total } = await listAllCustomers(c as never, {
      search: 'x',
      sort_by: 'updated_at',
      sort_order: 'desc',
    })
    expect(customers.map((x) => x.id)).toEqual(['3', '2', '1'])
    expect(total).toBe(3)
  })

  it('re-sorts created_at ASC for the karute/profile surfaces', async () => {
    const c = client([[mk('3'), mk('1')], [mk('2')]], 3)
    const { customers } = await listAllCustomers(c as never, {
      search: 'x',
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    expect(customers.map((x) => x.id)).toEqual(['1', '2', '3'])
  })

  it('passes the SAME search + page_size:500 into EVERY page call', async () => {
    const c = client([[mk('1')], [mk('2')]], 2)
    await listAllCustomers(c as never, { search: 'tan', sort_by: 'name', sort_order: 'asc' })
    const calls = c.customers.list.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const [arg] of calls) {
      expect(arg.search).toBe('tan')
      expect(arg.page_size).toBe(500)
    }
  })

  it('returns the real total for a single under-cap page', async () => {
    const c = client([[mk('1'), mk('2')]], 2)
    const { customers, total } = await listAllCustomers(c as never, { search: 'x' })
    expect(customers.map((x) => x.id)).toEqual(['1', '2'])
    expect(total).toBe(2)
  })

  // ⚖ 2026-08-17 fail-closed backstop. enforceStore is the RBAC clamp; without
  // a store_id the store filter would simply be absent and the read would go
  // BUSINESS-WIDE — the clamp failing open. Production never reaches this (both
  // resolvers guarantee "clamped ⇒ storeId non-null", pinned in
  // store-scope.test.ts + app-api-store-clamp.test.ts), so the guard is
  // deliberately dead code; this is what proves it would catch the fall.
  it('FAIL-CLOSED: enforceStore with no store_id returns empty, never business-wide', async () => {
    const c = client([[mk('1'), mk('2')]], 2)
    await expect(listAllCustomers(c as never, { enforceStore: true })).resolves.toEqual({
      customers: [],
      total: 0,
    })
    // The point is not the empty array — it is that core was never asked.
    expect(c.customers.list).not.toHaveBeenCalled()
  })

  it('…and a null store_id is the same fall (the resolvers hand back null, not undefined)', async () => {
    const c = client([[mk('1')]], 1)
    await expect(
      listAllCustomers(c as never, { store_id: null, enforceStore: true, search: 'あ' }),
    ).resolves.toEqual({ customers: [], total: 0 })
    expect(c.customers.list).not.toHaveBeenCalled()
  })

  it('the guard is inert for every real caller: store_id present, or enforceStore off', async () => {
    const scoped = client([[mk('1')]], 1)
    await listAllCustomers(scoped as never, { store_id: 'store-A', enforceStore: true })
    expect(scoped.customers.list).toHaveBeenCalledTimes(1)
    const wide = client([[mk('1')]], 1)
    await listAllCustomers(wide as never, {})
    expect(wide.customers.list).toHaveBeenCalledTimes(1)
    // A viewAll caller pinned to nothing — enforceStore off, so business-wide
    // stays exactly what it was.
    const viewAll = client([[mk('1')]], 1)
    await listAllCustomers(viewAll as never, { store_id: null, enforceStore: false })
    expect(viewAll.customers.list).toHaveBeenCalledTimes(1)
  })

  it('never memoizes — two identical calls are two live fetches (search + facade path)', async () => {
    const c = client([[mk('1')]], 1)
    await listAllCustomers(c as never, { search: 'tanaka', sort_by: 'name', sort_order: 'asc' })
    await listAllCustomers(c as never, { search: 'tanaka', sort_by: 'name', sort_order: 'asc' })
    expect(c.customers.list).toHaveBeenCalledTimes(2)
  })
})

describe('listAllCustomersCached (web no-search path)', () => {
  it('caches per businessId — a repeat call with the same key hits the cache', async () => {
    const list = registerBusiness('biz-1', [[mk('a1')]], 1)

    await listAllCustomersCached('biz-1', { sort_by: 'created_at', sort_order: 'asc' })
    await listAllCustomersCached('biz-1', { sort_by: 'created_at', sort_order: 'asc' })

    expect(list).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL tenant isolation: two businessIds never share a cache entry', async () => {
    const listA = registerBusiness('biz-a', [[mk('a1')]], 1)
    const listB = registerBusiness('biz-b', [[mk('b1')]], 1)

    const resultA = await listAllCustomersCached('biz-a', {
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    const resultB = await listAllCustomersCached('biz-b', {
      sort_by: 'created_at',
      sort_order: 'asc',
    })

    // Same options, DIFFERENT businessId — each tenant must get its own rows,
    // not the first caller's cached entry.
    expect(resultA.customers.map((x) => x.id)).toEqual(['a1'])
    expect(resultB.customers.map((x) => x.id)).toEqual(['b1'])
    expect(listA).toHaveBeenCalledTimes(1)
    expect(listB).toHaveBeenCalledTimes(1)
  })

  it('parameter isolation: different store_id / enforceStore / sort_by never collide', async () => {
    const list = registerBusiness('biz-scope', [[mk('x1')]], 1)

    await listAllCustomersCached('biz-scope', {
      store_id: 'store-a',
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    // Same key repeated → cache HIT, no new underlying call.
    await listAllCustomersCached('biz-scope', {
      store_id: 'store-a',
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    expect(list).toHaveBeenCalledTimes(1)

    // Different store_id → a distinct cache entry → a 2nd underlying call.
    await listAllCustomersCached('biz-scope', {
      store_id: 'store-b',
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    expect(list).toHaveBeenCalledTimes(2)

    // Same store_id, but enforceStore flips → a distinct entry → a 3rd call.
    await listAllCustomersCached('biz-scope', {
      store_id: 'store-b',
      enforceStore: true,
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    expect(list).toHaveBeenCalledTimes(3)

    // Same store_id + enforceStore, but sort_by flips → a distinct entry → a 4th call.
    await listAllCustomersCached('biz-scope', {
      store_id: 'store-b',
      enforceStore: true,
      sort_by: 'name',
      sort_order: 'asc',
    })
    expect(list).toHaveBeenCalledTimes(4)
  })
})
