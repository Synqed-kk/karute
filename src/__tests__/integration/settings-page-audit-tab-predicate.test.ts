/**
 * settings/page.tsx — WEB 監査ログ tab predicate (PR B2 §4 fix round, F4).
 *
 * LENS-PR-B2-BLIND-2026-09-11.md F4: reverting src/app/[locale]/(app)/
 * settings/page.tsx's `canViewAudit` back to the pre-PR
 * `isOwner || caps.has('audit.view')` left every suite green — the facade
 * twin (screens/settings/route.ts) is pinned by app-api-screens-settings
 * .test.ts, but this WEB door had zero coverage. This test calls the page
 * component directly (it is a plain async function returning a JSX element
 * tree — no renderer needed) and reads the `canViewAudit` prop it hands to
 * SettingsShell, using the REAL canReadAuditLog so a reverted predicate goes
 * red here.
 */
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getMessages: async () => ({}),
}))
jest.mock('next-intl', () => ({
  NextIntlClientProvider: (props: { children: unknown }) => props.children,
}))
jest.mock('@/lib/staff', () => ({
  getStaffList: jest.fn(async () => []),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn(async () => null) }))
jest.mock('@/actions/stores', () => ({
  listStores: jest.fn(async () => []),
  getActiveStoreId: jest.fn(async () => null),
}))
jest.mock('@/actions/menus', () => ({ listMenus: jest.fn(async () => ({ error: 'unavailable' })) }))
jest.mock('@/actions/entitlements', () => ({ getEntitlement: jest.fn(async () => null) }))
const mockCapabilities = jest.fn(async () => new Set<string>())
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: () => mockCapabilities(),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => null),
  menuStoresForScope: jest.fn(() => []),
  viewerStaffRoster: jest.fn(async (staff: unknown[]) => staff),
}))
jest.mock('@/lib/karute/business-ai-tokens', () => ({
  getBusinessAiPersona: jest.fn(() => null),
  resolvePersonaTokens: jest.fn(() => ({ serviceNoun: '施術' })),
}))
jest.mock('@/components/settings/SettingsPageChrome', () => ({
  SettingsPageChrome: (props: { children: unknown }) => props.children,
}))
jest.mock('@/components/settings/redesign/SettingsShell', () => ({
  SettingsShell: () => null,
}))

import SettingsPage from '@/app/[locale]/(app)/settings/page'

interface ElementLike {
  props: { children?: ElementLike; canViewAudit?: boolean }
}

// canReadAuditLog is real (not mocked) — that predicate IS the thing under
// test, wired through the page down to the SettingsShell prop.
async function canViewAuditFor(caps: string[]): Promise<boolean | undefined> {
  mockCapabilities.mockResolvedValue(new Set(caps))
  const result = (await SettingsPage({
    params: Promise.resolve({ locale: 'ja' }),
    searchParams: Promise.resolve({}),
  })) as unknown as ElementLike
  // <NextIntlClientProvider><SettingsPageChrome><SettingsShell/></...></...>
  const shell = result.props.children?.props.children
  return (shell as unknown as ElementLike | undefined)?.props.canViewAudit
}

describe('settings/page.tsx — canViewAudit = canReadAuditLog(caps) (PR B2 §4, F4)', () => {
  it('audit.view alone hides the tab (canViewAudit false)', async () => {
    expect(await canViewAuditFor(['audit.view'])).toBe(false)
  })

  it('audit.view + stores.viewAll shows the tab (canViewAudit true)', async () => {
    expect(await canViewAuditFor(['audit.view', 'stores.viewAll'])).toBe(true)
  })
})
