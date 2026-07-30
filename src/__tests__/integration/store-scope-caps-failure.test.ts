/**
 * Scope-layer absorption of a capability-resolution failure (#652 P1
 * follow-up). The resolver now fails closed by THROWING on post-migration
 * query errors; resolveStoreScope must absorb that as NO capabilities —
 * a strictly narrower scope (viewAll dropped, clamp still derived from
 * staff_stores data) — never a rejection, because ~20 read surfaces consume
 * it bare. Capability GATES keep the throw; that side is pinned in
 * require-permission-fallback.test.ts.
 */

const mockCaps: { current: 'reject' | Set<string> } = { current: 'reject' }

jest.mock('@/lib/auth/require-permission', () => ({
  ...jest.requireActual('@/lib/auth/require-permission'),
  getMyCapabilities: jest.fn(async () => {
    if (mockCaps.current === 'reject') throw new Error('capability resolution failed')
    return mockCaps.current
  }),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  getPrimaryStoreId: jest.fn(async () => 'store-primary'),
  getStaffStoresStrict: jest.fn(async () => ['store-b']),
}))
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getStaffStoresStrict } from '@/actions/stores'

beforeEach(() => {
  jest.clearAllMocks()
  mockCaps.current = 'reject'
  ;(getStaffStoresStrict as jest.Mock).mockResolvedValue(['store-b'])
})

describe('resolveStoreScope — capability-resolution failure absorbed, never rejected', () => {
  it('assigned staff during a resolver failure → clamped to their own stores (narrower, resolves)', async () => {
    const scope = await resolveStoreScope()
    expect(scope).toEqual({ storeId: 'store-b', viewAll: false, allowedStoreIds: ['store-b'] })
  })

  it('floating staff during a resolver failure → no clamp, primary-store lens, resolves', async () => {
    ;(getStaffStoresStrict as jest.Mock).mockResolvedValue([])
    const scope = await resolveStoreScope()
    expect(scope).toEqual({ storeId: 'store-primary', viewAll: false, allowedStoreIds: null })
  })

  it('assignment lookup failure → clamped to the store in view, never read as floating', async () => {
    // An empty list means "works in every store", so a failed lookup must not
    // produce one. Clamping to the current lens keeps the app usable while
    // still being narrower than the old no-clamp result.
    ;(getStaffStoresStrict as jest.Mock).mockRejectedValue(new Error('core unavailable'))
    const scope = await resolveStoreScope()
    expect(scope).toEqual({
      storeId: 'store-primary',
      viewAll: false,
      allowedStoreIds: ['store-primary'],
      // The clamp lens is best-effort (stale/unpinned cookie → primary), so
      // the scope says so — surfaces like the bulk export refuse on it.
      degraded: true,
    })
  })

  it('lookup failure never yields an unclamped scope (the widening case)', async () => {
    mockCaps.current = new Set(['customers.view'])
    ;(getStaffStoresStrict as jest.Mock).mockRejectedValue(new Error('core unavailable'))
    const scope = await resolveStoreScope()
    expect(scope.allowedStoreIds).not.toBeNull()
    expect(scope.viewAll).toBe(false)
  })

  it('sanity: healthy resolve with stores.viewAll keeps the unclamped lens', async () => {
    mockCaps.current = new Set(['stores.viewAll'])
    const scope = await resolveStoreScope()
    expect(scope).toEqual({ storeId: 'store-primary', viewAll: true, allowedStoreIds: null })
  })
})
