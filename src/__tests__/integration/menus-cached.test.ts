/**
 * The 予約 picker's cached menu reader (PR-4a read leg). Runs the REAL cache
 * body — unstable_cache is identity-mocked so every case re-reads its own
 * fixture instead of the first case's entry (sibling cache-test idiom,
 * customers-list-enrich.test.ts). Pins the seams the picker depends on: the
 * active-only filter, the store-name join (including the two null paths), the
 * server-side pre-sort both consumers inherit, and the env guard.
 */

process.env.SYNQED_CORE_URL = 'http://synqed.test'
process.env.SYNQED_CORE_API_KEY = 'test-key'

const mockMenus = { list: jest.fn() }
const mockStores = { list: jest.fn() }
// jest.fn returning an object is constructible — `new SynqedClient(...)` takes
// the returned object as `this`, and the call still records the ctor args.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => ({ menus: mockMenus, stores: mockStores })),
}))
const SynqedClient = jest.requireMock('@synqed-kk/client').SynqedClient as jest.Mock

// Capture the cache wiring (key + options) alongside the identity passthrough
// — sibling pattern, appointments-day-agenda-cached.test.ts. `var`, not
// let/const — the hoisted jest.mock factory runs during the static import
// below, before a let/const would initialize (TDZ).
/* eslint-disable no-var */
var cacheKeys: unknown
var cacheOpts: unknown
/* eslint-enable no-var */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown, keys: unknown, opts: unknown) => {
    cacheKeys = keys
    cacheOpts = opts
    return fn
  },
}))

const getBusinessId = jest.fn(async () => 'biz-1')
jest.mock('@/lib/staff', () => ({ getBusinessId: () => getBusinessId() }))

import { getCachedMenuOptions, getCachedMenuOptionsFor } from '@/lib/menus/cached'

const row = (over: Record<string, unknown>) => ({
  business_id: 'biz-1',
  store_id: null,
  description: null,
  category: 'カット',
  category_display_order: 0,
  display_order: 0,
  duration_minutes: 60,
  price_list_amount: 5000,
  price_min_amount: null,
  currency: 'JPY',
  tax_included: true,
  nomination_allowed: true,
  online_visible: true,
  active: true,
  created_at: '2026-08-13T00:00:00Z',
  updated_at: '2026-08-13T00:00:00Z',
  ...over,
})

// Deliberately shuffled against the expected order, and each row exercises a
// different storeName branch: resolved, unknown id, all-store null.
const MENUS = [
  row({ id: 'm-c', name: 'ボブ', display_order: 1, store_id: null }),
  row({ id: 'm-a', name: 'カラー', category: 'カラー', category_display_order: 1, store_id: 'store-A' }),
  row({ id: 'm-b', name: 'アップ', display_order: 1, store_id: 'store-GONE' }),
  row({ id: 'm-d', name: 'メンズカット', store_id: 'store-B' }),
]
const STORES = [
  { id: 'store-A', name: 'La Estro 代官山' },
  { id: 'store-B', name: 'La Estro 銀座' },
]

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SYNQED_CORE_URL = 'http://synqed.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
  mockMenus.list.mockResolvedValue({ menus: MENUS })
  mockStores.list.mockResolvedValue({ stores: STORES })
})

describe('getCachedMenuOptionsFor', () => {
  it('asks core for ACTIVE menus only and scopes the client to the business', async () => {
    await getCachedMenuOptionsFor('biz-1')
    expect(mockMenus.list).toHaveBeenCalledWith({ active: true })
    expect(SynqedClient).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-1' }),
    )
  })

  it('joins the store name onto a store-scoped menu', async () => {
    const options = await getCachedMenuOptionsFor('biz-1')
    expect(options.find((o) => o.id === 'm-d')).toEqual({
      id: 'm-d',
      name: 'メンズカット',
      category: 'カット',
      category_display_order: 0,
      display_order: 0,
      duration_minutes: 60,
      price_list_amount: 5000,
      price_min_amount: null,
      store_id: 'store-B',
      storeName: 'La Estro 銀座',
    })
  })

  it('an all-store menu (store_id null) carries storeName null', async () => {
    const options = await getCachedMenuOptionsFor('biz-1')
    const allStore = options.find((o) => o.id === 'm-c')!
    expect(allStore.store_id).toBeNull()
    expect(allStore.storeName).toBeNull()
  })

  it('a menu pointing at an UNKNOWN store degrades to storeName null, never a throw', async () => {
    const options = await getCachedMenuOptionsFor('biz-1')
    const orphan = options.find((o) => o.id === 'm-b')!
    expect(orphan.store_id).toBe('store-GONE')
    expect(orphan.storeName).toBeNull()
  })

  it('pre-sorts by category_display_order, then display_order, then name', async () => {
    // m-d/m-b/m-c share band 0: display_order 0 first, then the two order-1
    // rows broken by name (アップ < ボブ). m-a sits in band 1 despite its
    // display_order 0 — the band wins.
    const options = await getCachedMenuOptionsFor('biz-1')
    expect(options.map((o) => o.id)).toEqual(['m-d', 'm-b', 'm-c', 'm-a'])
  })

  it.each(['SYNQED_CORE_URL', 'SYNQED_CORE_API_KEY'])(
    'throws when %s is missing — no half-configured client reaches core',
    async (key) => {
      delete process.env[key]
      await expect(getCachedMenuOptionsFor('biz-1')).rejects.toThrow(
        /SYNQED_CORE_URL or SYNQED_CORE_API_KEY/,
      )
      expect(mockMenus.list).not.toHaveBeenCalled()
    },
  )

  it('pins the invalidation envelope: 60s TTL + the menus tag', () => {
    // The tag string must equal the literal the four writers pass to
    // updateTag (menus-actions.test.ts pins that side) — exact-string
    // matching is Next's contract; a typo on either side silently downgrades
    // invalidation to TTL-only.
    expect(cacheOpts).toEqual({ revalidate: 60, tags: ['menus'] })
    expect(cacheKeys).toEqual(['cached-menu-options-v1'])
  })
})

describe('getCachedMenuOptions (cookie wrapper)', () => {
  it('resolves the business from the session and returns the same rows', async () => {
    getBusinessId.mockResolvedValue('biz-cookie')
    const [viaCookie, viaExplicit] = [
      await getCachedMenuOptions(),
      await getCachedMenuOptionsFor('biz-cookie'),
    ]
    expect(getBusinessId).toHaveBeenCalled()
    expect(viaCookie).toEqual(viaExplicit)
    expect(SynqedClient).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-cookie' }),
    )
  })
})
