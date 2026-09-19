/**
 * THE WEB FRONT GATE STANDS ON ITS OWN (⚖ fold round 2 / delta-verify D2).
 *
 * The mirror of the facade's case in app-api-identity.test.ts, and the answer to
 * the fresh-eyes M2 mutant: remove Layer 1's capability-emptying line and the
 * front gates USED to stop firing — 641 of 642 suites stayed green while the
 * honest screen silently disappeared on both transports.
 *
 * So the mutant is the fixture here. `getMyCapabilities` is stubbed to a
 * NON-EMPTY set — exactly what an unassigned actor would get if
 * capabilitiesForUser stopped emptying it — and the gate must still answer
 * true, and the layout must still render the empty state instead of the app.
 *
 * Both halves are driven, not modelled: `viewerIsUnassigned` and the real
 * `(app)/layout.tsx`, with the store-gate verdict running for real underneath.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// LAYER 1, STUBBED — this is the mutant. A non-viewAll actor who IS unassigned,
// whose capability set was never emptied.
const mockCapabilities = jest.fn(async () => new Set<string>(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: () => mockCapabilities(),
}))

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'profile-self'),
  getStaffList: jest.fn(async () => []),
}))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  getPrimaryStoreId: jest.fn(async () => 'store-ginza'),
  getStaffStoresStrict: jest.fn(async () => []),
  listStores: jest.fn(async () => []),
}))

// The verdict's own two reads, live: an EMPTY assignment in a TWO-store
// business is the unassigned shape.
const fixture = { assignment: [] as string[], stores: ['store-ginza', 'store-daikanyama'] }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: async () => ({
    staffStores: { get: async () => ({ store_ids: fixture.assignment }) },
    stores: { list: async () => ({ stores: fixture.stores.map((id) => ({ id, active: true })) }) },
  }),
  newSynqedClient: () => ({
    staffStores: { get: async () => ({ store_ids: fixture.assignment }) },
    stores: { list: async () => ({ stores: fixture.stores.map((id) => ({ id, active: true })) }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {},
}))

// Everything the layout reaches for that is not the gate.
const redirect = jest.fn()
jest.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...a) }))
// G-3 (Greptile, 2026-09-17): mutable so the revoked-session suite below can
// flip it per test — every OTHER test in this file wants the default
// authenticated shape.
const authFixture = {
  user: { id: 'profile-self' } as { id: string } | null,
  error: null as { message: string } | null,
}
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: authFixture.user }, error: authFixture.error }) },
  })),
}))
jest.mock('@/components/layout/UnassignedStoreScreen', () => ({
  UnassignedStoreScreen: 'UnassignedStoreScreen',
}))
jest.mock('@/providers/session-provider', () => ({ SessionProvider: 'SessionProvider' }))
jest.mock('@/lib/notifications/context', () => ({ NotificationsProvider: 'Notifications' }))
jest.mock('@/lib/notifications/derive', () => ({
  buildNotificationFeed: jest.fn(async () => []),
}))
jest.mock('@/lib/appointments/next-customer', () => ({
  getNextCustomer: jest.fn(async () => null),
}))
jest.mock('@/components/layout/bottom-nav', () => ({ BottomNav: 'BottomNav' }))
jest.mock('@/components/layout/MobileHeader', () => ({ MobileHeader: 'MobileHeader' }))
jest.mock('@/components/layout/sidebar', () => ({ Sidebar: 'Sidebar' }))
jest.mock('@/components/recording/DiscreetRecordingIndicator', () => ({
  DiscreetRecordingIndicator: 'RecIndicator',
}))
jest.mock('@/components/recording/ProcessingIndicator', () => ({
  ProcessingIndicator: 'ProcessingIndicator',
}))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn(async () => null) }))

import { viewerIsUnassigned } from '@/lib/auth/store-scope'
import DashboardLayout from '@/app/[locale]/(app)/layout'
import { getStaffList } from '@/lib/staff'
import { buildNotificationFeed } from '@/lib/notifications/derive'

const render = () =>
  DashboardLayout({ children: null, params: Promise.resolve({ locale: 'ja' }) })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  fixture.assignment = []
  fixture.stores = ['store-ginza', 'store-daikanyama']
  authFixture.user = { id: 'profile-self' }
  authFixture.error = null
})

describe('the web gate does not depend on Layer 1 having emptied the capability set', () => {
  it('answers TRUE for an unassigned actor whose capabilities were NEVER emptied', async () => {
    expect((await mockCapabilities()).size).toBeGreaterThan(0)
    expect(await viewerIsUnassigned()).toBe(true)
  })

  it('…and the layout renders the honest screen, not the app shell', async () => {
    const el = (await render()) as { type: unknown }
    expect(el.type).toBe('UnassignedStoreScreen')
  })

  it('…before any store-scoped read is started', async () => {
    await render()
    // The gate resolves above the layout's read wave, so the roster and the
    // notification feed are never fetched at all — that is the difference
    // between "sees an empty app" and "sees nothing".
    expect(getStaffList).not.toHaveBeenCalled()
    expect(buildNotificationFeed).not.toHaveBeenCalled()
  })
})

describe('…and it still refuses to fire on every other shape', () => {
  it('an ASSIGNED actor gets the app shell', async () => {
    fixture.assignment = ['store-ginza']
    expect(await viewerIsUnassigned()).toBe(false)
    expect(((await render()) as { type: unknown }).type).not.toBe('UnassignedStoreScreen')
  })

  it('a floating actor in a ONE-store salon gets the app shell (the carve-out)', async () => {
    fixture.stores = ['store-ginza']
    expect(await viewerIsUnassigned()).toBe(false)
  })

  it('a stores.viewAll holder is never asked — the assignment is an input, not a gate output', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
    expect(await viewerIsUnassigned()).toBe(false)
  })

  it('a thrown capability read never takes the shell down', async () => {
    mockCapabilities.mockRejectedValue(new Error('caps read failed'))
    expect(await viewerIsUnassigned()).toBe(false)
  })
})

// G-3 (Greptile, 2026-09-17): the layout's OWN supabase.auth.getUser() now
// runs (and its existing revoked/no-user redirect fires) BEFORE the gate —
// previously the gate ran first, so a revoked session paid for the gate's own
// reads (and every other read in the wave) before the redirect that should
// have stopped it all.
describe('the authoritative session check runs BEFORE the gate', () => {
  it('no user (revoked session) → redirect fires, and the gate never runs', async () => {
    authFixture.user = null
    authFixture.error = null
    redirect.mockImplementationOnce(() => {
      throw new Error('NEXT_REDIRECT')
    })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/ja/login')
    // Never the honest screen, never the gate, never the wave beneath it.
    expect(mockCapabilities).not.toHaveBeenCalled()
    expect(getStaffList).not.toHaveBeenCalled()
  })

  it('a getUser() error (same shape) → redirect fires, and the gate never runs', async () => {
    authFixture.user = { id: 'profile-self' }
    authFixture.error = { message: 'revoked' }
    redirect.mockImplementationOnce(() => {
      throw new Error('NEXT_REDIRECT')
    })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/ja/login')
    expect(mockCapabilities).not.toHaveBeenCalled()
  })

  it('a valid session still reaches the gate — the reorder changes nothing else', async () => {
    const el = (await render()) as { type: unknown }
    expect(el.type).toBe('UnassignedStoreScreen') // default fixture is unassigned
    expect(redirect).not.toHaveBeenCalled()
    expect(mockCapabilities).toHaveBeenCalled()
  })
})
