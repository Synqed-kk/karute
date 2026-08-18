/** @jest-environment jsdom */
// F-C (menu-catalog fix round): SettingsShell must thread the ACTOR's own
// menuStores prop into MenusSection — not initialStores, the wider list every
// other tab uses (店舗/自動録音/スタッフ still show a branch-restricted staff
// nothing; メニュー must name only the stores src/actions/menus.ts actually
// lets them write, see SettingsShellProps.menuStores's own doc). A revert to
// initialStores at the render call site would silently widen (or narrow) the
// menu editor's scope pills with no other suite catching it, since every
// other SettingsShell test uses `menuStores === initialStores` fixtures.
//
// Every OTHER section is mocked to isolate this one prop-threading question —
// their own coverage lives elsewhere (settings-shell-pending-tabs.test.tsx's
// mock set, mirrored here). MenusSection's mock captures the `stores` prop it
// actually received, unlike the plain stub the other shell suite uses.
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))

jest.mock('@/components/settings/redesign/sections/OrganizationSection', () => ({
  OrganizationSection: () => <div data-testid="section-organization" />,
}))
jest.mock('@/components/settings/redesign/sections/StoresSection', () => ({
  StoresSection: () => <div data-testid="section-stores" />,
}))
jest.mock('@/components/settings/redesign/sections/ThemeSection', () => ({
  ThemeSection: () => <div data-testid="section-theme" />,
}))
jest.mock('@/components/settings/redesign/sections/AISection', () => ({
  AISection: () => <div data-testid="section-ai" />,
}))
jest.mock('@/components/settings/redesign/sections/CoachingSection', () => ({
  CoachingSection: () => <div data-testid="section-coaching" />,
}))
jest.mock('@/components/settings/redesign/sections/RecordingSection', () => ({
  RecordingSection: () => <div data-testid="section-recording" />,
}))
jest.mock('@/components/settings/redesign/sections/StaffSection', () => ({
  StaffSection: () => <div data-testid="section-staff" />,
}))
jest.mock('@/components/settings/redesign/sections/SyncSection', () => ({
  SyncSection: () => <div data-testid="section-sync" />,
}))
jest.mock('@/components/settings/redesign/sections/SyncStatusCard', () => ({
  SyncStatusCard: () => <div data-testid="section-sync-status-card" />,
}))
jest.mock('@/components/settings/redesign/sections/PacksSection', () => ({
  PacksSection: () => <div data-testid="section-packs" />,
}))
// Captures the `stores` prop it actually received — the point of this file.
jest.mock('@/components/settings/redesign/sections/MenusSection', () => ({
  MenusSection: ({ stores }: { stores: { id: string; name: string }[] }) => (
    <div data-testid="section-menus">
      {stores.map((s) => s.id).join(',') || '(empty)'}
    </div>
  ),
}))
jest.mock('@/components/settings/redesign/sections/AuditLogSection', () => ({
  AuditLogSection: () => <div data-testid="section-audit" />,
}))

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import type { StaffMember } from '@/lib/staff'
import type { StoreRow } from '@/actions/stores'

const store = (id: string, name: string): StoreRow => ({
  id,
  name,
  address: null,
  phone: null,
  isPrimary: false,
  active: true,
  staffCount: 0,
  customerCount: 0,
  businessType: null,
})

// DIFFERENT on purpose — the whole point of this fixture is that a revert to
// initialStores at the render call site must be distinguishable from the
// correct menuStores wiring.
const INITIAL_STORES = [store('store-honten', '本店'), store('store-ekimae', '駅前店')]
const MENU_STORES = [store('store-ekimae', '駅前店')]

const baseProps = {
  orgSettings: null,
  staffList: [] as StaffMember[],
  activeStaffId: null,
  locale: 'ja',
  isOwner: true,
  canViewAllStores: true,
  canManageStaff: true,
  canInviteStaff: true,
  canViewAudit: true,
  canViewSync: true,
  canManageMenus: true,
  initialMenus: [],
  initialStores: INITIAL_STORES,
  menuStores: MENU_STORES,
  initialActiveStoreId: null,
  initialEntitlement: null,
}

describe('SettingsShell — menus tab receives menuStores, not initialStores (F-C)', () => {
  it('MenusSection gets the menuStores prop', () => {
    render(<SettingsShell {...baseProps} initialTab={'menus' as SettingsTabId} />)
    const menus = screen.getAllByTestId('section-menus')
    expect(menus.length).toBeGreaterThan(0)
    for (const el of menus) expect(el.textContent).toBe('store-ekimae')
  })

  it('never receives initialStores\' extra store — the two props are provably different here', () => {
    render(<SettingsShell {...baseProps} initialTab={'menus' as SettingsTabId} />)
    for (const el of screen.getAllByTestId('section-menus')) {
      expect(el.textContent).not.toContain('store-honten')
    }
  })
})
