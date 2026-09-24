/**
 * Coverage for resolveStoreScope (src/lib/auth/store-scope.ts) — the read-side
 * RBAC clamp for multi-store visibility. Verifies:
 *   - stores.viewAll → cookie is the lens, never clamped
 *   - no viewAll + empty staff_stores → floating staff, no clamp
 *   - no viewAll + assigned stores → clamped to that set; the cookie picks among
 *     them, an out-of-scope / unset cookie falls back to the first assigned store
 *   - the assignment LOOKUP failing (getStaffStoresStrict → null), or the
 *     gate's verdict coming back `unknown`, REACHES NO STORE: storeId null,
 *     allowedStoreIds [], degraded:true (Round 2, 2026-09-24, D-S16-4 —
 *     supersedes the F-A "reads ignore degraded" shape)
 *   - resolveShellGate: unassigned / outage / ok, and an outage is never blank
 */
import type { Capability } from '@/lib/auth/permissions'

jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn() }))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(),
  getPrimaryStoreId: jest.fn(),
  getStaffStoresStrict: jest.fn(),
}))
// The gate's ONE resolution, stubbed: its own two core reads are pinned in
// unassigned-gate-matrix.test.ts. Default = floating (a readable single-store
// business), set per test below.
jest.mock('@/lib/auth/store-gate', () => ({
  ...jest.requireActual('@/lib/auth/store-gate'),
  actorStoreVerdict: jest.fn(),
  actorIsUnassigned: jest.fn(),
}))

import {
  resolveStoreScope,
  resolveShellGate,
  viewerScopeForActs,
  menuStoresForScope,
  staffWriteInScope,
  customerLensFor,
} from '@/lib/auth/store-scope'
import { actorIsUnassigned, actorStoreVerdict } from '@/lib/auth/store-gate'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getActiveStoreId, getPrimaryStoreId, getStaffStoresStrict } from '@/actions/stores'

const mockCaps = getMyCapabilities as jest.Mock
const mockStaffId = getCurrentUserStaffId as jest.Mock
const mockActive = getActiveStoreId as jest.Mock
const mockPrimary = getPrimaryStoreId as jest.Mock
const mockStores = getStaffStoresStrict as jest.Mock
const mockVerdict = actorStoreVerdict as jest.Mock
const mockUnassigned = actorIsUnassigned as jest.Mock

const caps = (...c: Capability[]) => new Set<Capability>(c)

beforeEach(() => {
  jest.clearAllMocks()
  mockStaffId.mockResolvedValue('staff-1')
  mockVerdict.mockResolvedValue('unclamped')
  mockUnassigned.mockResolvedValue(false)
})

// The web twin of the facade clamp's invariant, and the thing every
// store-scoped web read leans on: a CLAMPED viewer (allowedStoreIds non-null)
// always resolves to a concrete storeId. The lens is derived everywhere as
// `clamped ? scope.storeId ?? undefined : undefined`, so a clamped viewer with
// a null storeId would silently read business-wide — the RBAC clamp failing
// OPEN. `activeStore && allowed.includes(activeStore) ? activeStore :
// allowed[0]` is the whole guarantee; drop the `allowed[0]` arm and these go red.
describe('resolveStoreScope — clamped ⇒ storeId non-null, EXCEPT degraded (storeId null, reach no store)', () => {
  it('holds when the cookie is UNSET', async () => {
    mockCaps.mockResolvedValue(caps())
    mockActive.mockResolvedValue(null)
    mockStores.mockResolvedValue(['store-A', 'store-B'])
    const scope = await resolveStoreScope()
    expect(scope.allowedStoreIds).not.toBeNull()
    expect(scope.storeId).toBe('store-A')
  })

  it('holds when the cookie points OUTSIDE the assignment', async () => {
    mockCaps.mockResolvedValue(caps())
    mockActive.mockResolvedValue('store-ZZZ')
    mockStores.mockResolvedValue(['store-A'])
    const scope = await resolveStoreScope()
    expect(scope.allowedStoreIds).not.toBeNull()
    expect(scope.storeId).toBe('store-A')
  })

  it('holds when the cookie names an assigned store', async () => {
    mockCaps.mockResolvedValue(caps())
    mockActive.mockResolvedValue('store-B')
    mockStores.mockResolvedValue(['store-A', 'store-B'])
    const scope = await resolveStoreScope()
    expect(scope.allowedStoreIds).not.toBeNull()
    expect(scope.storeId).toBe('store-B')
  })
})

// A-3 (2026-08-28 audit) — the invariant above is what the three cached-list
// call sites (予約 page, 録音 page, screens/appointments route) leaned on when
// each spelled `clamped ? storeId : undefined` inline. They derive the lens
// here now, so the broken case has ONE answer, and it fails CLOSED: blind, not
// business-wide. Same posture as listAllCustomers' guard (list-all.ts:56).
describe('customerLensFor — the cached-customer-list store lens', () => {
  it('unclamped (viewAll / floating) → undefined = business-wide', () => {
    expect(customerLensFor({ storeId: 'store-A', allowedStoreIds: null })).toBeUndefined()
    expect(customerLensFor({ storeId: null, allowedStoreIds: null })).toBeUndefined()
  })

  it('clamped → that store’s server-filtered lens', () => {
    expect(
      customerLensFor({ storeId: 'store-B', allowedStoreIds: ['store-A', 'store-B'] }),
    ).toBe('store-B')
  })

  it('clamped with a NULL storeId → null (BLIND), never business-wide', () => {
    expect(customerLensFor({ storeId: null, allowedStoreIds: ['store-A'] })).toBeNull()
  })

  it('a scope that reaches no store (unassigned, or degraded since Round 2) → null (BLIND)', () => {
    expect(customerLensFor({ storeId: null, allowedStoreIds: [] })).toBeNull()
  })
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

  // Round 2, 2026-09-24, D-S16-4 (discussed, default) — INVERTED from the
  // F-A shape (degraded used to keep the floating, business-wide scope).
  it('the assignment lookup FAILING (null) → degraded, and it reaches NO store', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue(null)
    expect(await resolveStoreScope()).toEqual({
      storeId: null,
      viewAll: false,
      allowedStoreIds: [],
      degraded: true,
    })
    // Unknown is never the unassigned answer: the gate is never even asked.
    expect(mockVerdict).not.toHaveBeenCalled()
  })

  it('a caller the roster cannot place (staffId null) → the same degraded, reach-no-store shape', async () => {
    mockCaps.mockResolvedValue(caps())
    mockStaffId.mockResolvedValue(null)
    mockActive.mockResolvedValue('store-A')
    expect(await resolveStoreScope()).toEqual({
      storeId: null,
      viewAll: false,
      allowedStoreIds: [],
      degraded: true,
    })
    expect(mockStores).not.toHaveBeenCalled()
  })

  it('an empty assignment whose verdict is UNKNOWN (store list unreadable) → degraded, reach no store', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue([])
    mockVerdict.mockResolvedValue('unknown')
    expect(await resolveStoreScope()).toEqual({
      storeId: null,
      viewAll: false,
      allowedStoreIds: [],
      degraded: true,
    })
  })

  it('an empty assignment whose verdict is UNASSIGNED → reach no store, NOT degraded', async () => {
    mockCaps.mockResolvedValue(caps('customers.view'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue([])
    mockVerdict.mockResolvedValue('unassigned')
    expect(await resolveStoreScope()).toEqual({
      storeId: null,
      viewAll: false,
      allowedStoreIds: [],
      degraded: false,
    })
  })

  it('stores.viewAll is untouched by an assignment outage (the assignment is never read)', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue(null)
    expect((await resolveStoreScope()).degraded).toBe(false)
    expect(mockStores).not.toHaveBeenCalled()
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
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: ACTOR })).toBe(true)
    expect(mockStores).not.toHaveBeenCalled()
  })

  it('clamped actor, out-of-scope target → refused', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': ['store-B'] })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: ACTOR })).toBe(false)
  })

  it('clamped actor, target sharing a branch → passes', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A', 'store-B'], 'staff-other': ['store-B'] })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: ACTOR })).toBe(true)
  })

  it('floating TARGET (in every branch = the 全店舗 rule) → refused', async () => {
    // Menus parity (src/actions/menus.ts:95-98): an every-store item takes
    // stores.viewAll, however the actor is assigned.
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': [] })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: ACTOR })).toBe(false)
  })

  it('floating ACTOR → passes for a real-store target, target never looked up', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: [] })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: ACTOR })).toBe(true)
    expect(mockStores).toHaveBeenCalledTimes(1) // the actor's own lookup only
  })

  it("a failed lookup of the ACTOR's assignment (degraded) → refused, fail closed", async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: null })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: ACTOR })).toBe(false)
  })

  it('an actor the roster cannot place (staffId null) → refused for a real-store AND a floating target', async () => {
    // Null staffId = the assignment could not be read at all, so it is the
    // same failed lookup as degraded — never a genuine empty (F-A).
    mockCaps.mockResolvedValue(caps())
    mockStaffId.mockResolvedValue(null)
    assign({ 'staff-other': ['store-B'], 'staff-floating': [] })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: null })).toBe(false)
    expect(await staffWriteInScope({ targetStaffId: 'staff-floating', actorId: null })).toBe(false)
  })

  it('viewAll never consults staffId, so a null one changes nothing', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    mockStaffId.mockResolvedValue(null)
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: null })).toBe(true)
    expect(mockStores).not.toHaveBeenCalled()
  })

  it("a failed lookup of the TARGET's assignment → refused, fail closed", async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': null })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: ACTOR })).toBe(false)
  })

  it('self-edit passes even for a clamped actor, with no target lookup', async () => {
    // The read plane guarantees self-visibility; the write plane must agree.
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'] })
    expect(await staffWriteInScope({ targetStaffId: ACTOR, actorId: ACTOR })).toBe(true)
    expect(mockStores).toHaveBeenCalledTimes(1)
  })

  it('a null actor id never matches a target (no accidental self-pass)', async () => {
    mockCaps.mockResolvedValue(caps())
    assign({ [ACTOR]: ['store-A'], 'staff-other': ['store-B'] })
    expect(await staffWriteInScope({ targetStaffId: 'staff-other', actorId: null })).toBe(false)
  })
})

// ── ⚖ THE WEB ACT DOORS' SCOPE — one spelling, and it FAILS CLOSED ──────────
// viewerScopeForActs is what regenerate · 再学習 · the dev tools resolve their
// store reach with (⚖ 8/17). Unit-pinned here, against the REAL resolveStoreScope
// and its real seams, because the doors' own suites mock the helper itself —
// this is the only place its catch and its degraded arm are genuinely exercised.
describe('viewerScopeForActs — the act doors’ scope', () => {
  it('stores.viewAll → null (unrestricted), and no assignment is read', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    mockActive.mockResolvedValue('store-a')
    await expect(viewerScopeForActs()).resolves.toBeNull()
    expect(mockStores).not.toHaveBeenCalled()
  })

  it('floating staff (a genuine empty assignment) → null, the documented convention', async () => {
    mockCaps.mockResolvedValue(caps())
    mockStaffId.mockResolvedValue('staff-1')
    mockStores.mockResolvedValue([])
    mockPrimary.mockResolvedValue('store-a')
    await expect(viewerScopeForActs()).resolves.toBeNull()
  })

  it('clamped staff → exactly their assigned stores', async () => {
    mockCaps.mockResolvedValue(caps())
    mockStaffId.mockResolvedValue('staff-1')
    mockStores.mockResolvedValue(['store-a'])
    mockActive.mockResolvedValue('store-a')
    await expect(viewerScopeForActs()).resolves.toEqual(['store-a'])
  })

  it('a DEGRADED lookup (getStaffStoresStrict → null) → [] , never widened', async () => {
    mockCaps.mockResolvedValue(caps())
    mockStaffId.mockResolvedValue('staff-1')
    mockStores.mockResolvedValue(null)
    mockPrimary.mockResolvedValue('store-a')
    await expect(viewerScopeForActs()).resolves.toEqual([])
  })

  it('a THROWN resolve → [] , never null — the arm M23 mutates', async () => {
    mockCaps.mockRejectedValue(new Error('core down'))
    await expect(viewerScopeForActs()).resolves.toEqual([])
  })
})

// ── THE WEB FRONT GATE, whole (Round 2, 2026-09-24, D-S16-4) ────────────────
// What (app)/layout.tsx renders before any read: the unassigned screen, the
// outage screen, or the shell. An outage is never the shell (no data) and
// never the unassigned screen (a staffing fact is not an outage).
describe('resolveShellGate', () => {
  it('an UNASSIGNED actor → unassigned', async () => {
    mockCaps.mockResolvedValue(caps())
    mockUnassigned.mockResolvedValue(true)
    await expect(resolveShellGate()).resolves.toBe('unassigned')
  })

  it('a DEGRADED scope (assignment unreadable) → outage', async () => {
    mockCaps.mockResolvedValue(caps())
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue(null)
    await expect(resolveShellGate()).resolves.toBe('outage')
  })

  it('a THROWN roster read (getCurrentUserStaffId rejects) → outage, never the shell', async () => {
    mockCaps.mockResolvedValue(caps())
    mockStaffId.mockRejectedValue(new Error('roster read failed'))
    await expect(resolveShellGate()).resolves.toBe('outage')
  })

  it('a healthy clamped actor → ok', async () => {
    mockCaps.mockResolvedValue(caps())
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue(['store-A'])
    await expect(resolveShellGate()).resolves.toBe('ok')
  })

  it('a stores.viewAll holder during an assignment outage → ok (never blanked)', async () => {
    mockCaps.mockResolvedValue(caps('stores.viewAll'))
    mockActive.mockResolvedValue('store-A')
    mockStores.mockResolvedValue(null)
    await expect(resolveShellGate()).resolves.toBe('ok')
  })
})
