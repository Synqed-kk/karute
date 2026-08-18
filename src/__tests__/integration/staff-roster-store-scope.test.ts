/**
 * Coverage for viewerStaffRoster / viewerStaffRosterForBusiness
 * (src/lib/auth/store-scope.ts) — the ROSTER clamp (Liam ruling 8/17).
 *
 * The staff-switch drawer (layout → SessionProvider) and the 設定→スタッフ list
 * shipped the whole business roster to every client, so a 銀座-only staffer saw
 * every 代官山 teammate's name/email. These pin the fix:
 *   - clamped actor → their store(s)' staff only, plus themselves
 *   - two-store actor → the union of both stores
 *   - viewAll / floating actor (allowedStoreIds null) → full roster, unchanged
 *   - self is always present, even when the assignment data disagrees
 *   - the assignment fetch failing degrades to the old full roster (fail open,
 *     same posture as the 担当 picker clamp it composes)
 */
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(),
  getCurrentUserStaffId: jest.fn(),
  getStaffList: jest.fn(),
}))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(),
  getPrimaryStoreId: jest.fn(),
  getStaffStoresStrict: jest.fn(),
  listStores: jest.fn(async () => []),
}))

// ── The two SEAMS under test (the roster the server hands the client). Every
//    other dependency of the layout / settings page is a stub; the store-scope
//    module itself runs FOR REAL so the matrix below is end-to-end.
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
jest.mock('@/components/recording/DiscreetRecordingIndicator', () => ({
  DiscreetRecordingIndicator: 'RecIndicator',
}))
jest.mock('@/components/recording/ProcessingIndicator', () => ({
  ProcessingIndicator: 'ProcessingIndicator',
}))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn(async () => null) }))
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

const mockCoreState = { fails: false }
const mockAssignments: Record<string, string[]> = {
  'profile-ginza': ['store-ginza'],
  'profile-dkny': ['store-daikanyama'],
  'profile-both': ['store-ginza', 'store-daikanyama'],
  'profile-float': [],
  'profile-self': ['store-elsewhere'],
}

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = {
      list: async () => {
        if (mockCoreState.fails) throw new Error('core unavailable')
        return {
          staff: Object.keys(mockAssignments).map((id) => ({ id, email: `${id}@x.jp` })),
        }
      },
    }
    staffStores = {
      get: async (id: string) => ({ store_ids: mockAssignments[id] ?? [] }),
    }
  },
}))

import type { Capability } from '@/lib/auth/permissions'
import {
  viewerStaffRoster,
  viewerStaffRosterForBusiness,
} from '@/lib/auth/store-scope'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getActiveStoreId, getStaffStoresStrict } from '@/actions/stores'
import DashboardLayout from '@/app/[locale]/(app)/layout'
import SettingsPage from '@/app/[locale]/(app)/settings/page'

const GINZA = 'store-ginza'
const DAIKANYAMA = 'store-daikanyama'
const BUSINESS = 'biz-1'

// The roster as the app ships it (profile ids + email fallback link).
const roster = Object.keys(mockAssignments).map((id) => ({
  id,
  email: `${id}@x.jp`,
}))
const ids = (r: { id: string }[]) => r.map((s) => s.id).sort()

beforeEach(() => {
  jest.clearAllMocks()
  mockCoreState.fails = false
  process.env.SYNQED_CORE_URL = 'https://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
  ;(getBusinessId as jest.Mock).mockResolvedValue(BUSINESS)
  ;(getCurrentUserStaffId as jest.Mock).mockResolvedValue('profile-self')
})

describe('viewerStaffRosterForBusiness', () => {
  it('銀座-only actor sees 銀座 staff (+ floating) and themselves, never 代官山', async () => {
    const visible = await viewerStaffRosterForBusiness(
      roster,
      [GINZA],
      'profile-self',
      BUSINESS,
    )
    expect(ids(visible)).toEqual([
      'profile-both',
      'profile-float',
      'profile-ginza',
      'profile-self',
    ])
  })

  it('two-store actor sees the UNION of both stores', async () => {
    const visible = await viewerStaffRosterForBusiness(
      roster,
      [GINZA, DAIKANYAMA],
      'profile-self',
      BUSINESS,
    )
    expect(ids(visible)).toEqual([
      'profile-both',
      'profile-dkny',
      'profile-float',
      'profile-ginza',
      'profile-self',
    ])
  })

  it('unclamped viewer (viewAll / floating actor) keeps the full roster', async () => {
    expect(await viewerStaffRosterForBusiness(roster, null, 'profile-self', BUSINESS))
      .toEqual(roster)
    expect(await viewerStaffRosterForBusiness(roster, [], 'profile-self', BUSINESS))
      .toEqual(roster)
  })

  it('self stays visible even when their own assignment sits elsewhere', async () => {
    // profile-self is assigned to store-elsewhere — a staff missing from their
    // own drawer / settings list is broken, so the self pin outranks the data.
    const visible = await viewerStaffRosterForBusiness(
      roster,
      [DAIKANYAMA],
      'profile-self',
      BUSINESS,
    )
    expect(visible.map((s) => s.id)).toContain('profile-self')
    expect(visible.map((s) => s.id)).not.toContain('profile-ginza')
  })

  it('fails OPEN to the full roster when the assignment read is unavailable', async () => {
    mockCoreState.fails = true
    expect(await viewerStaffRosterForBusiness(roster, [GINZA], 'profile-self', BUSINESS))
      .toEqual(roster)
  })
})

describe('viewerStaffRoster (cookie session)', () => {
  const caps = (...c: Capability[]) => new Set<Capability>(c)

  it('clamps a branch-restricted staff to their store', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(caps())
    ;(getStaffStoresStrict as jest.Mock).mockResolvedValue([GINZA])
    ;(getActiveStoreId as jest.Mock).mockResolvedValue(GINZA)
    const visible = await viewerStaffRoster(roster, 'profile-self')
    expect(ids(visible)).toEqual([
      'profile-both',
      'profile-float',
      'profile-ginza',
      'profile-self',
    ])
  })

  it('leaves a stores.viewAll holder on the full roster', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(caps('stores.viewAll'))
    ;(getActiveStoreId as jest.Mock).mockResolvedValue(GINZA)
    expect(await viewerStaffRoster(roster, 'profile-self')).toEqual(roster)
    expect(getStaffStoresStrict as jest.Mock).not.toHaveBeenCalled()
  })
})

// ── The seams: what the SERVER hands the client. Nothing is filtered on the
//    client, so these ids are the whole of what a clamped staffer receives.
/** First props object down the single-child chain carrying `key`. */
function propsWith(node: unknown, key: string): Record<string, unknown> | null {
  const el = node as { props?: Record<string, unknown> } | null
  if (!el || typeof el !== 'object' || !el.props) return null
  return key in el.props ? el.props : propsWith(el.props.children, key)
}

describe('roster seams (server → client)', () => {
  const caps = (...c: Capability[]) => new Set<Capability>(c)
  const clamped = () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(caps('staff.manage'))
    ;(getStaffStoresStrict as jest.Mock).mockResolvedValue([GINZA])
    ;(getActiveStoreId as jest.Mock).mockResolvedValue(GINZA)
    ;(getStaffList as jest.Mock).mockResolvedValue(roster)
  }

  it('staff-switch drawer (layout → SessionProvider): 銀座 only', async () => {
    clamped()
    const el = await DashboardLayout({
      children: null,
      params: Promise.resolve({ locale: 'ja' }),
    })
    const data = propsWith(el, 'data')?.data as { staffList: { id: string }[] }
    expect(ids(data.staffList)).toEqual([
      'profile-both',
      'profile-float',
      'profile-ginza',
      'profile-self',
    ])
  })

  it('staff-switch drawer: a viewAll holder still gets the whole business', async () => {
    clamped()
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(caps('stores.viewAll'))
    const el = await DashboardLayout({
      children: null,
      params: Promise.resolve({ locale: 'ja' }),
    })
    const data = propsWith(el, 'data')?.data as { staffList: { id: string }[] }
    expect(ids(data.staffList)).toEqual(ids(roster))
  })

  it('設定→スタッフ list (settings page → SettingsShell): 銀座 only', async () => {
    clamped()
    const el = await SettingsPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({}),
    })
    const shipped = propsWith(el, 'staffList')?.staffList as { id: string }[]
    expect(ids(shipped)).toEqual([
      'profile-both',
      'profile-float',
      'profile-ginza',
      'profile-self',
    ])
  })
})
