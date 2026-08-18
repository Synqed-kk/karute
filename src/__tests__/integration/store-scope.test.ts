/**
 * Coverage for resolveStoreScope (src/lib/auth/store-scope.ts) — the read-side
 * RBAC clamp for multi-store visibility. Verifies:
 *   - stores.viewAll → cookie is the lens, never clamped
 *   - no viewAll + empty staff_stores → floating staff, no clamp
 *   - no viewAll + assigned stores → clamped to that set; the cookie picks among
 *     them, an out-of-scope / unset cookie falls back to the first assigned store
 *   - the assignment LOOKUP failing (getStaffStoresStrict → null) sets
 *     degraded:true but leaves storeId/viewAll/allowedStoreIds identical to a
 *     genuine empty assignment (F-A) — only the menu-write clamp reads it
 */
import type { Capability } from '@/lib/auth/permissions'

jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn() }))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(),
  getPrimaryStoreId: jest.fn(),
  getStaffStoresStrict: jest.fn(),
}))

import { resolveStoreScope, menuStoresForScope, staffWriteInScope } from '@/lib/auth/store-scope'
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
    expect(scope).toEqual({ storeId: 'store-B', viewAll: true, allowedStoreIds: null, degraded: false })
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
      degraded: false,
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
      degraded: false,
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
      degraded: false,
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

  it('the assignment lookup FAILING (null) sets degraded:true, same storeId/viewAll/allowedStoreIds as a genuine empty assignment', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue(null)
    expect(await resolveStoreScope()).toEqual({
      storeId: 'store-A',
      viewAll: false,
      allowedStoreIds: null,
      degraded: true,
    })
  })

  it('a genuinely empty assignment (floating staff) still resolves degraded:false', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue([])
    expect((await resolveStoreScope()).degraded).toBe(false)
  })
})

describe('menuStoresForScope', () => {
  const allStores = [{ id: 'store-A' }, { id: 'store-B' }]

  it('assigned branch staff (allowedStoreIds set) → filtered to only the assigned stores', () => {
    const scope = { storeId: 'store-A', viewAll: false, allowedStoreIds: ['store-A'], degraded: false }
    expect(menuStoresForScope(scope, false, allStores)).toEqual([{ id: 'store-A' }])
  })

  it('viewAll → every store', () => {
    const scope = { storeId: 'store-A', viewAll: true, allowedStoreIds: null, degraded: false }
    expect(menuStoresForScope(scope, true, allStores)).toEqual(allStores)
  })

  it('floating staff (allowedStoreIds null, degraded false) → every store, unclamped like the server', () => {
    const scope = { storeId: 'store-A', viewAll: false, allowedStoreIds: null, degraded: false }
    expect(menuStoresForScope(scope, false, allStores)).toEqual(allStores)
  })

  it('degraded (degraded: true) → [] — blind, fail closed like the server write clamp', () => {
    const scope = { storeId: 'store-A', viewAll: false, allowedStoreIds: null, degraded: true }
    expect(menuStoresForScope(scope, false, allStores)).toEqual([])
  })

  it('scope === null (resolveStoreScope threw) → today\'s behaviour: canViewAllStores gates the fallback', () => {
    expect(menuStoresForScope(null, true, allStores)).toEqual(allStores)
    expect(menuStoresForScope(null, false, allStores)).toEqual([])
  })
})

// The staff WRITE clamp's rule (the web transport of it; the facade twin
// ensureStaffWriteInScope is pinned in app-api-staff.test.ts). A clamped
// staff.manage holder must not be able to mutate another branch's staff row by
// direct call — the UI already hides it (#709), this is the server door.
describe('staffWriteInScope', () => {
  const ACTOR = 'staff-1' // getCurrentUserStaffId() in this suite's beforeEach
  const assign = (map: Record<string, string[] | null>) =>
    mockStores.mockImplementation(async (id: string) => (id in map ? map[id] : []))

  it('viewAll passes free and never consults an assignment', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    expect(await staffWriteInScope('staff-other', ACTOR)).toBe(true)
    expect(mockStores).not.toHaveBeenCalled()
  })

  it('clamped actor, out-of-scope target → refused', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': ['store-B'] })
    expect(await staffWriteInScope('staff-other', ACTOR)).toBe(false)
  })

  it('clamped actor, target sharing a branch → passes', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A', 'store-B'], 'staff-other': ['store-B'] })
    expect(await staffWriteInScope('staff-other', ACTOR)).toBe(true)
  })

  it('floating TARGET (no assignment = works in every store) → passes', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': [] })
    expect(await staffWriteInScope('staff-other', ACTOR)).toBe(true)
  })

  it('floating ACTOR → passes for a real-store target, target never looked up', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: [] })
    expect(await staffWriteInScope('staff-other', ACTOR)).toBe(true)
    expect(mockStores).toHaveBeenCalledTimes(1) // the actor's own lookup only
  })

  it("a failed lookup of the ACTOR's assignment (degraded) → refused, fail closed", async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: null })
    expect(await staffWriteInScope('staff-other', ACTOR)).toBe(false)
  })

  it("a failed lookup of the TARGET's assignment → refused, fail closed", async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': null })
    expect(await staffWriteInScope('staff-other', ACTOR)).toBe(false)
  })

  it('self-edit passes even for a clamped actor, with no target lookup', async () => {
    // The read plane guarantees self-visibility; the write plane must agree.
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'] })
    expect(await staffWriteInScope(ACTOR, ACTOR)).toBe(true)
    expect(mockStores).toHaveBeenCalledTimes(1)
  })

  it('a null actor id never matches a target (no accidental self-pass)', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': ['store-B'] })
    expect(await staffWriteInScope('staff-other', null)).toBe(false)
  })
})
