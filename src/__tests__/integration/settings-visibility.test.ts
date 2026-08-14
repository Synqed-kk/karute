import {
  visibleSettingsTabs,
  visibleStaffRoster,
} from '@/lib/auth/settings-visibility'

// Mirrors the shape SettingsShell's TABS carries (id + ownerOnly).
const TABS = [
  { id: 'organization' },
  { id: 'stores' },
  { id: 'theme' },
  { id: 'staff' },
  { id: 'sync' },
  { id: 'packs', ownerOnly: true },
  { id: 'menus' },
  { id: 'audit' },
] as const

describe('visibleSettingsTabs', () => {
  it('owner sees everything (incl. stores + ownerOnly tabs)', () => {
    const ids = visibleSettingsTabs(TABS, { isOwner: true, canViewAllStores: true, canViewAudit: true, canViewSync: true, canManageMenus: true }).map((t) => t.id)
    expect(ids).toEqual(['organization', 'stores', 'theme', 'staff', 'sync', 'packs', 'menus', 'audit'])
  })

  it('cross-store manager (viewAll, not owner, no grant) sees stores but not sync/packs/audit', () => {
    const ids = visibleSettingsTabs(TABS, { isOwner: false, canViewAllStores: true, canViewAudit: false, canViewSync: false, canManageMenus: false }).map((t) => t.id)
    expect(ids).toContain('stores')
    expect(ids).not.toContain('sync')
    expect(ids).not.toContain('packs')
    expect(ids).not.toContain('audit')
  })

  it('audit.view-granted manager sees 監査ログ but still not owner-only tabs', () => {
    const ids = visibleSettingsTabs(TABS, { isOwner: false, canViewAllStores: true, canViewAudit: true, canViewSync: false, canManageMenus: false }).map((t) => t.id)
    expect(ids).toContain('audit')
    expect(ids).not.toContain('packs')
  })

  it('sync.view-granted manager sees 予約同期 but still not owner-only tabs (PR-M2 fix round)', () => {
    const ids = visibleSettingsTabs(TABS, { isOwner: false, canViewAllStores: true, canViewAudit: false, canViewSync: true, canManageMenus: false }).map((t) => t.id)
    expect(ids).toContain('sync')
    expect(ids).not.toContain('packs')
    expect(ids).not.toContain('audit')
  })

  it('the メニュー tab follows menus.manage alone — no owner/grant shortcut (menu-catalog PR-2)', () => {
    const granted = visibleSettingsTabs(TABS, { isOwner: false, canViewAllStores: false, canViewAudit: false, canViewSync: false, canManageMenus: true }).map((t) => t.id)
    expect(granted).toContain('menus')
    const withoutCap = visibleSettingsTabs(TABS, { isOwner: true, canViewAllStores: true, canViewAudit: true, canViewSync: true, canManageMenus: false }).map((t) => t.id)
    expect(withoutCap).not.toContain('menus')
  })

  it('branch-restricted staff (no viewAll, no sync.view): the 店舗 and 予約同期 tabs are hidden entirely', () => {
    const ids = visibleSettingsTabs(TABS, { isOwner: false, canViewAllStores: false, canViewAudit: false, canViewSync: false, canManageMenus: false }).map((t) => t.id)
    expect(ids).not.toContain('stores')
    expect(ids).not.toContain('sync')
    // ...but still sees the ordinary tabs.
    expect(ids).toEqual(['organization', 'theme', 'staff'])
  })
})

describe('visibleStaffRoster', () => {
  const roster = [
    { id: 'owner-1' },
    { id: 'self-2' },
    { id: 'other-3' },
  ]

  it('manager sees the whole roster', () => {
    expect(visibleStaffRoster(roster, 'self-2', true).map((s) => s.id)).toEqual([
      'owner-1',
      'self-2',
      'other-3',
    ])
  })

  it('non-manager sees ONLY themselves', () => {
    expect(visibleStaffRoster(roster, 'self-2', false).map((s) => s.id)).toEqual(['self-2'])
  })

  it('non-manager with unresolved identity sees nobody (fail closed)', () => {
    expect(visibleStaffRoster(roster, null, false)).toEqual([])
  })

  it('non-manager not present in the roster sees nobody', () => {
    expect(visibleStaffRoster(roster, 'ghost', false)).toEqual([])
  })
})
