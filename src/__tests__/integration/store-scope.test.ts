/**
 * Coverage for resolveStoreScope (src/lib/auth/store-scope.ts) — the read-side
 * RBAC clamp for multi-store visibility. Verifies:
 *   - stores.viewAll → cookie is the lens, never clamped
 *   - no viewAll + empty staff_stores → floating staff, no clamp
 *   - no viewAll + assigned stores → clamped to that set; the cookie picks among
 *     them, an out-of-scope / unset cookie falls back to the first assigned store
 */
import type { Capability } from '@/lib/auth/permissions'

jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn() }))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(),
  getPrimaryStoreId: jest.fn(),
  getStaffStoresStrict: jest.fn(),
}))

import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getActiveStoreId, getPrimaryStoreId, getStaffStoresStrict } from '@/actions/stores'

const mockCaps = getMyCapabilities as jest.Mock
const mockStaffId = getCurrentUserStaffId as jest.Mock
const mockActive = getActiveStoreId as jest.Mock
const mockPrimary = getPrimaryStoreId as jest.Mock
const mockStores = getStaffStoresStrict as jest.Mock

const caps = (...c: Capability[]) => new Set<Capability>(c)

beforeEach(() => {
  jest.clearAllMocks()
  mockStaffId.mockResolvedValue('staff-1')
})

describe('resolveStoreScope', () => {
  it('viewAll: the active-store cookie is the lens, never clamped', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    mockActive.mockResolvedValue('store-B')
    // staff_stores must NOT be consulted for a cross-store viewer.
    const scope = await resolveStoreScope()
    expect(scope).toEqual({ storeId: 'store-B', viewAll: true, allowedStoreIds: null })
    expect(mockStores).not.toHaveBeenCalled()
  })

  it('viewAll with no pinned store → the PRIMARY store (the switcher shows it as active)', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    mockActive.mockResolvedValue(null)
    mockPrimary.mockResolvedValue('store-primary')
    expect(await resolveStoreScope()).toEqual({
      storeId: 'store-primary',
      viewAll: true,
      allowedStoreIds: null,
    })
  })

  it('viewAll, no pin, business has no stores → null (no filter)', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    mockActive.mockResolvedValue(null)
    mockPrimary.mockResolvedValue(null)
    expect((await resolveStoreScope()).storeId).toBeNull()
  })

  it('no viewAll + empty staff_stores → floating staff, no clamp', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue([])
    expect(await resolveStoreScope()).toEqual({
      storeId: 'store-A',
      viewAll: false,
      allowedStoreIds: null,
    })
    // Cookie set → the primary lookup must not fire (it costs a core call).
    expect(mockPrimary).not.toHaveBeenCalled()
  })

  it('no viewAll + empty staff_stores + no pin → primary-store default', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue(null)
    mockStores.mockResolvedValue([])
    mockPrimary.mockResolvedValue('store-primary')
    expect((await resolveStoreScope()).storeId).toBe('store-primary')
  })

  it('no viewAll + assigned: cookie inside the set is honored', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-B')
    mockStores.mockResolvedValue(['store-A', 'store-B'])
    expect(await resolveStoreScope()).toEqual({
      storeId: 'store-B',
      viewAll: false,
      allowedStoreIds: ['store-A', 'store-B'],
    })
  })

  it('no viewAll + assigned: an out-of-scope cookie falls back to the first store', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-Z') // a branch the staff is NOT in
    mockStores.mockResolvedValue(['store-A', 'store-B'])
    expect((await resolveStoreScope()).storeId).toBe('store-A')
  })

  it('no viewAll + assigned: an unset cookie falls back to the first store', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue(null)
    mockStores.mockResolvedValue(['store-A'])
    expect((await resolveStoreScope()).storeId).toBe('store-A')
  })
})
