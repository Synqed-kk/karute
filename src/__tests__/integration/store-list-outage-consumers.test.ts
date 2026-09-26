/**
 * The two SERVER consumers of the store-list door pass "could not read" down
 * instead of folding it into [] (Round 3 leg 8a, 2026-09-26, D-S31-4).
 *
 * settings/page.tsx and (app)/layout.tsx used `.catch(() => [])`, so a store
 * list that could not be read reached StoresSection and the header switcher as
 * an empty list. Now: the door's `null` (and a thrown promise, caught to null)
 * becomes `storesUnavailable` — for the 設定 page ONLY when the viewer holds
 * stores.viewAll (a viewer without it gets [] and no line, byte-for-byte), and
 * for the header switcher always; every existing use of the rows keeps
 * `stores ?? []` (initialStores, menuStores / assignableStores, the switcher).
 *
 * Harness: staff-roster-store-scope.test.ts's shape — the page and the layout
 * are CALLED as async server components and the props they hand SettingsShell /
 * MobileHeader are read off the returned element tree. The door itself is a
 * per-row stub here (its own real chain is pinned in
 * store-list-outage-null.test.ts); store-scope runs for real except the three
 * reads the gate needs.
 *
 * RED on main: all eight — storesUnavailable is never passed there. q, r, r″
 * also fail on the rows themselves (null reaches initialStores / stores);
 * q-denial, q-rows, r-rows fail ONLY on the flag being undefined (their row
 * assertions hold on main), and q′, r′ only on the flag (main's catch gave []).
 */
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => 'profile-self'),
  getStaffList: jest.fn(async () => [{ id: 'profile-self', display_role: 'owner' }]),
}))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
  listStores: jest.fn(),
  listStoresWithHours: jest.fn(),
}))
const mockScope = {
  scope: { storeId: 'store-a', viewAll: true, allowedStoreIds: null as string[] | null, degraded: false },
}
jest.mock('@/lib/auth/store-scope', () => {
  const actual = jest.requireActual('@/lib/auth/store-scope')
  return {
    ...actual,
    resolveShellGate: jest.fn(async () => 'ok'),
    resolveStoreScope: jest.fn(async () => mockScope.scope),
    viewerStaffRoster: jest.fn(async (staff: unknown[]) => staff),
  }
})
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'profile-self' } }, error: null }) },
  })),
}))
jest.mock('@/providers/session-provider', () => ({ SessionProvider: 'SessionProvider' }))
jest.mock('@/lib/notifications/context', () => ({ NotificationsProvider: 'Notifications' }))
jest.mock('@/lib/notifications/derive', () => ({ buildNotificationFeed: jest.fn(async () => []) }))
jest.mock('@/lib/appointments/next-customer', () => ({ getNextCustomer: jest.fn(async () => null) }))
jest.mock('@/components/layout/bottom-nav', () => ({ BottomNav: 'BottomNav' }))
jest.mock('@/components/layout/MobileHeader', () => ({ MobileHeader: 'MobileHeader' }))
jest.mock('@/components/layout/sidebar', () => ({ Sidebar: 'Sidebar' }))
jest.mock('@/components/recording/DiscreetRecordingIndicator', () => ({ DiscreetRecordingIndicator: 'RecIndicator' }))
jest.mock('@/components/recording/ProcessingIndicator', () => ({ ProcessingIndicator: 'ProcessingIndicator' }))
jest.mock('@/components/layout/UnassignedStoreScreen', () => ({ UnassignedStoreScreen: 'Unassigned' }))
jest.mock('@/components/layout/StoreOutageScreen', () => ({ StoreOutageScreen: 'StoreOutage' }))
jest.mock('@/components/layout/RemovedStaffScreen', () => ({ RemovedStaffScreen: 'Removed' }))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ salon_name: 'ラ・エストロ', business_type: 'hair_salon' })),
}))
jest.mock('@/actions/menus', () => ({ listMenus: jest.fn(async () => ({ menus: [] })) }))
jest.mock('@/actions/entitlements', () => ({ getEntitlement: jest.fn(async () => null) }))
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async () => (k: string) => k),
  getMessages: jest.fn(async () => ({})),
}))
jest.mock('next-intl', () => ({ NextIntlClientProvider: 'IntlProvider' }))
jest.mock('@/i18n/client-messages', () => ({ PAGE_PICKS: { settings: [] }, pickMessages: () => ({}) }))
jest.mock('@/lib/karute/business-ai-tokens', () => ({
  getBusinessAiPersona: jest.fn(() => null),
  resolvePersonaTokens: jest.fn(() => ({ serviceNoun: '施術' })),
}))
jest.mock('@/components/settings/redesign/SettingsShell', () => ({ SettingsShell: 'SettingsShell' }))
jest.mock('@/components/settings/SettingsPageChrome', () => ({ SettingsPageChrome: 'Chrome' }))

import type { Capability } from '@/lib/auth/permissions'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { listStores, listStoresWithHours } from '@/actions/stores'
import DashboardLayout from '@/app/[locale]/(app)/layout'
import SettingsPage from '@/app/[locale]/(app)/settings/page'

const caps = (...c: Capability[]) => new Set<Capability>(c)
const rowOf = (id: string, name: string, isPrimary = false) => ({
  id, name, address: null, phone: null, isPrimary, active: true,
  staffCount: 1, customerCount: 5, businessType: null,
})
const ROWS = [rowOf('store-a', '代官山', true), rowOf('store-b', '銀座')]

/** The props of the first element in the tree that carries `key`. */
function propsWith(node: unknown, key: string): Record<string, unknown> | null {
  const el = node as { props?: Record<string, unknown> } | null
  if (!el || typeof el !== 'object' || !el.props) return null
  if (key in el.props) return el.props
  const kids = el.props.children
  for (const child of Array.isArray(kids) ? kids : [kids]) {
    const hit = propsWith(child, key)
    if (hit) return hit
  }
  return null
}

const shellProps = async () =>
  propsWith(
    await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({}) }),
    'initialStores',
  )!
const headerProps = async () =>
  propsWith(await DashboardLayout({ children: null, params: Promise.resolve({ locale: 'ja' }) }), 'activeStoreId')!

beforeEach(() => {
  jest.clearAllMocks()
  mockScope.scope = { storeId: 'store-a', viewAll: true, allowedStoreIds: null, degraded: false }
  ;(getMyCapabilities as jest.Mock).mockResolvedValue(caps('stores.viewAll', 'menus.manage'))
  ;(listStores as jest.Mock).mockResolvedValue(ROWS)
  ;(listStoresWithHours as jest.Mock).mockResolvedValue(ROWS)
})

describe('設定 (settings/page.tsx) → SettingsShell', () => {
  it('(q) the door answers null → initialStores [], storesUnavailable TRUE, menu / assignable stores []', async () => {
    ;(listStoresWithHours as jest.Mock).mockResolvedValue(null)
    const p = await shellProps()
    expect(p.initialStores).toEqual([])
    expect(p.storesUnavailable).toBe(true)
    expect(p.menuStores).toEqual([])
    expect(p.assignableStores).toEqual([])
  })

  it('(q′) the read THROWS → the page still renders (never a 500), storesUnavailable TRUE', async () => {
    ;(listStoresWithHours as jest.Mock).mockRejectedValue(new Error('server action transport failed'))
    const p = await shellProps()
    expect(p.initialStores).toEqual([])
    expect(p.storesUnavailable).toBe(true)
  })

  it('(q-denial) a viewer WITHOUT stores.viewAll never learns of the outage: [] and storesUnavailable false', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(caps('staff.manage'))
    ;(listStoresWithHours as jest.Mock).mockResolvedValue(null)
    const p = await shellProps()
    expect(p.initialStores).toEqual([])
    expect(p.storesUnavailable).toBe(false)
  })

  it('(q-rows) a live read → the rows, storesUnavailable false', async () => {
    const p = await shellProps()
    expect(p.initialStores).toEqual(ROWS)
    expect(p.storesUnavailable).toBe(false)
    expect(p.menuStores).toEqual(ROWS)
  })
})

describe('the (app) layout → MobileHeader (the header switcher)', () => {
  it('(r) the door answers null → stores [], storesUnavailable TRUE (never hidden like a one-store salon)', async () => {
    ;(listStores as jest.Mock).mockResolvedValue(null)
    const p = await headerProps()
    expect(p.stores).toEqual([])
    expect(p.storesUnavailable).toBe(true)
  })

  it('(r′) the read THROWS → the shell still renders, storesUnavailable TRUE', async () => {
    ;(listStores as jest.Mock).mockRejectedValue(new Error('server action transport failed'))
    const p = await headerProps()
    expect(p.stores).toEqual([])
    expect(p.storesUnavailable).toBe(true)
  })

  it('(r″) a branch-restricted viewer + null → no rows to filter, the same honest pill', async () => {
    mockScope.scope = { storeId: 'store-b', viewAll: false, allowedStoreIds: ['store-b'], degraded: false }
    ;(listStores as jest.Mock).mockResolvedValue(null)
    const p = await headerProps()
    expect(p.stores).toEqual([])
    expect(p.storesUnavailable).toBe(true)
  })

  it('(r-rows) a live read → the (clamped) rows, storesUnavailable false', async () => {
    let p = await headerProps()
    expect(p.stores).toEqual(ROWS)
    expect(p.storesUnavailable).toBe(false)
    mockScope.scope = { storeId: 'store-b', viewAll: false, allowedStoreIds: ['store-b'], degraded: false }
    p = await headerProps()
    expect(p.stores).toEqual([ROWS[1]])
    expect(p.storesUnavailable).toBe(false)
  })
})
