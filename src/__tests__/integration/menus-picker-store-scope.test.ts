/**
 * 予約 picker store isolation on the WEB page (⚖ Liam 2026-08-17: a branch's
 * staff must not even know another branch exists). The menu union is a 60s
 * org-keyed cache SHARED across actors, so it stays actor-blind by design and
 * the clamp lands at the consumer — this pins that the page actually applies
 * it, and that a clamped actor's picker carries neither the other branch's
 * menu nor its store NAME. The facade twin of this test lives in
 * app-api-screens-appointments.test.ts.
 *
 * The page is invoked as the plain async function it is and its returned
 * element tree is read — no render, so the client components are stubbed.
 */
import type { ReactElement } from 'react'

// cached.ts is loaded FOR REAL below (scopeMenuOptions is the thing under
// test), and it value-imports the ESM-only SDK client jest can't parse. Only
// the constructor is referenced, and never on this path.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn() }))
jest.mock('@/components/perf/QuietRefresh', () => ({ QuietRefresh: () => null }))
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: () => null,
}))
jest.mock('@/lib/perf/render-stamp', () => ({ renderStamp: () => '2026-08-17T00:00:00.000Z' }))
jest.mock('@/lib/perf/timing', () => ({
  startTiming: () => ({
    phase: (_n: string, run: () => unknown) => run(),
    end: () => {},
  }),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) } }),
}))
jest.mock('@/lib/staff', () => ({
  // F-5/M22 (fix round 2026-09-01): a non-empty roster so colorRosterIds
  // isn't trivially [] either way — the existing menu-scope tests below
  // don't read staffList's content, only `menus`, so this stays safe for them.
  getStaffList: async () => [
    { id: 'staff-1', full_name: 'Staff One', has_pin: false, created_at: '2026-01-01T00:00:00.000Z' },
  ],
  getCurrentUserStaffId: async () => 'staff-1',
  getBusinessId: async () => 'biz-1',
}))
const resolveStoreScope = jest.fn()
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScope(),
  storeStaffIdSet: async () => null,
  // Pure derivation of the faked scope — the REAL one, so the page's customer
  // lens stays the shipped rule.
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: async () => ({ ticket_packs_enabled: false, operating_hours: null }),
}))
jest.mock('@/actions/appointments', () => ({ getAppointmentsInRange: async () => [] }))
jest.mock('@/lib/appointments/day-agenda-cached', () => ({ getCachedDayAgenda: async () => [] }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerList: async () => [] }))
jest.mock('@/lib/customers/list-enrich', () => ({ enrichCustomers: async () => new Map() }))
jest.mock('@/lib/packs/store', () => ({ listAllPackUsage: async () => new Map() }))
// The REAL scopeMenuOptions rides the page — only the cached read is faked, so
// neutering the page's call (or the helper) turns these cases red.
const getCachedMenuOptions = jest.fn()
jest.mock('@/lib/menus/cached', () => ({
  ...jest.requireActual('@/lib/menus/cached'),
  getCachedMenuOptions: () => getCachedMenuOptions(),
}))

import AppointmentsPage from '@/app/[locale]/(app)/appointments/page'
import type { CachedMenuOption } from '@/lib/menus/cached'

const MINE = 'store-ginza'
const OTHER = 'store-daikanyama'
const OTHER_NAME = 'La Estro 代官山'

const menu = (over: Partial<CachedMenuOption>): CachedMenuOption => ({
  id: 'menu-x',
  name: 'カット',
  category: null,
  category_display_order: 0,
  display_order: 0,
  duration_minutes: 60,
  price_list_amount: 5000,
  price_min_amount: null,
  store_id: null,
  storeName: null,
  ...over,
})
const ALL_STORE = menu({ id: 'menu-all' })
const OWN = menu({ id: 'menu-own', store_id: MINE, storeName: 'La Estro 銀座' })
const FOREIGN = menu({ id: 'menu-foreign', store_id: OTHER, storeName: OTHER_NAME })
const CATALOG = [ALL_STORE, OWN, FOREIGN]

/** The menus prop the page hands the picker, read off the element tree. The
 *  view is found by the prop itself, not by identity — the mock factory is
 *  hoisted above every const in this file. */
async function pickerMenus(): Promise<CachedMenuOption[]> {
  const tree = (await AppointmentsPage({
    params: Promise.resolve({ locale: 'ja' }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ children: ReactElement<{ menus?: CachedMenuOption[] }>[] }>
  const view = tree.props.children.find((c) => c?.props && 'menus' in c.props)
  if (!view) throw new Error('AppointmentsView (the menus consumer) is not in the page tree')
  return view.props.menus as CachedMenuOption[]
}

/** F-5/M22: colorRosterIds prop the page hands the grid, same read-the-tree
 *  idiom as pickerMenus() above. */
async function pickerColorRosterIds(): Promise<readonly string[]> {
  const tree = (await AppointmentsPage({
    params: Promise.resolve({ locale: 'ja' }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ children: ReactElement<{ colorRosterIds?: readonly string[] }>[] }>
  const view = tree.props.children.find((c) => c?.props && 'colorRosterIds' in c.props)
  if (!view) throw new Error('AppointmentsView (the colorRosterIds consumer) is not in the page tree')
  return view.props.colorRosterIds ?? []
}

beforeEach(() => {
  jest.clearAllMocks()
  getCachedMenuOptions.mockResolvedValue(CATALOG)
})

describe('予約 picker menu scope (web page)', () => {
  it('a clamped actor gets their own store + 全店舗 — never the other branch’s menu or its NAME', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: [MINE], degraded: false,
    })
    const menus = await pickerMenus()
    expect(menus).toEqual([ALL_STORE, OWN])
    // The chip label rides the row, so dropping the row drops the name — the
    // leak this PR closes is the branch NAME as much as the menu.
    expect(JSON.stringify(menus)).not.toContain(OTHER_NAME)
  })

  it('a multi-store assignment gets every store it covers', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: [MINE, OTHER], degraded: false,
    })
    expect(await pickerMenus()).toEqual(CATALOG)
  })

  it('a stores.viewAll actor is unchanged — the whole union', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: true, allowedStoreIds: null, degraded: false,
    })
    expect(await pickerMenus()).toEqual(CATALOG)
  })

  it('floating staff (no assignment) stay unclamped — the house convention', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: null, degraded: false,
    })
    expect(await pickerMenus()).toEqual(CATALOG)
  })

  it('a degraded assignment lookup shows 全店舗 rows ONLY (fail-closed)', async () => {
    // Indistinguishable from floating on allowedStoreIds alone — the whole
    // point of the flag (F-A, same posture as the write clamp).
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: false, allowedStoreIds: null, degraded: true,
    })
    expect(await pickerMenus()).toEqual([ALL_STORE])
  })
})

describe('予約 day-grid colorRosterIds transport (F-5/M22, web page)', () => {
  it('the page threads the built roster ids to AppointmentsView, not an empty/dropped prop', async () => {
    resolveStoreScope.mockResolvedValue({
      storeId: MINE, viewAll: true, allowedStoreIds: null, degraded: false,
    })
    expect(await pickerColorRosterIds()).toEqual(['staff-1'])
  })
})
