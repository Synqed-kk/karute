// Pure visibility decisions for the Settings surface, driven by CAPABILITIES
// (never role names). Kept separate from the React shell so the RBAC gating is
// unit-testable without rendering 12 section components, and so the same rules
// can be reused server-side if a section ever needs a hard redirect.
//
// These gate what the UI OFFERS. They are NOT the security boundary — the
// server actions (setActiveStore's store clamp, requireCapability on every
// mutation, resolveStoreScope on every read) enforce access regardless of what
// the client renders. This layer stops a restricted user from SEEING another
// branch's existence / customer counts and from being handed controls that
// would only fail.

export interface SettingsCaps {
  isOwner: boolean
  canViewAllStores: boolean
  /** owner OR an explicit per-staff audit.view grant (Liam ruling 7/17). */
  canViewAudit: boolean
  /** owner OR an explicit per-staff sync.view grant — same posture as
   *  canViewAudit (Liam ruling 7/24, packet 31; PR-M2 fix round). */
  canViewSync: boolean
  /** the menus.manage capability (PR-1a #696). Unlike audit/sync this is NOT
   *  an owner-plus-grant flag: owner (ALL), manager (ALL minus billing/
   *  business/recordings.viewAll/audit.view/sync.view) and senior (explicit
   *  member) all hold menus.manage through their CAPABILITIES preset, so the
   *  capability alone is the whole rule (verified in lib/auth/permissions.ts). */
  canManageMenus: boolean
  /** the staff.manage capability — gates the 破棄の記録 tab (packet P5-A A-6).
   *  This is the codebase's EXISTING owner/manager line: owner holds ALL and
   *  manager holds ALL minus billing/business/recordings.viewAll/audit.view/
   *  sync.view, so both carry it while senior/practitioner/frontdesk do not
   *  (verified in lib/auth/permissions.ts). A bare capability read like
   *  canManageMenus, not the `isOwner ||` grant idiom audit/sync use. */
  canManageStaff: boolean
}

/**
 * Filter the settings tab list for the viewer.
 *   - `ownerOnly` tabs (packs / subscription) stay owner-only.
 *   - The 監査ログ (audit) tab follows the grant AND stores.viewAll: owner
 *     always, a manager only when the owner ticked audit.view onto them in
 *     StaffForm — audit.view alone isn't enough because the audit read has
 *     no store filter yet, so a store-clamped grantee would see every
 *     branch's log (parity packet, 2026-08-17).
 *   - The 予約同期 (sync) tab follows the sync.view grant, same rule as audit —
 *     without it every non-owner staff could open the tab and hit a 403 from
 *     the now-gated sync routes (PR-M2 fix round).
 *   - The メニュー (menus) tab requires menus.manage — the same capability
 *     listMenus itself enforces, so a viewer without it would only ever get a
 *     denied read.
 *   - The 店舗 (stores) tab requires stores.viewAll: a branch-restricted staff
 *     can't switch stores (the switch is server-clamped) and the section
 *     otherwise leaks the other branch + its customer counts.
 *   - The 破棄の記録 (discards) tab requires staff.manage — the existing
 *     owner/manager line. The reasons staff write about their own recordings
 *     are a manager read, and listDiscardReasons enforces the same capability
 *     server-side, so a viewer without it would only ever get a denied read.
 */
export function visibleSettingsTabs<T extends { id: string; ownerOnly?: boolean }>(
  tabs: readonly T[],
  caps: SettingsCaps,
): T[] {
  return tabs.filter((tab) => {
    if (tab.id === 'stores' && !caps.canViewAllStores) return false
    if (tab.id === 'audit' && !(caps.canViewAudit && caps.canViewAllStores)) return false
    if (tab.id === 'sync' && !caps.canViewSync) return false
    if (tab.id === 'menus' && !caps.canManageMenus) return false
    if (tab.id === 'discards' && !caps.canManageStaff) return false
    return !tab.ownerOnly || caps.isOwner
  })
}

/**
 * The staff rows a viewer may see in the staff section. Without staff.manage a
 * staff member sees only THEMSELVES (their own PIN / voice self-service); the
 * full roster — names, emails, join dates — is a manage surface. activeStaffId
 * null (unresolved) → empty, never the full list (fail closed).
 */
export function visibleStaffRoster<T extends { id: string }>(
  staff: readonly T[],
  activeStaffId: string | null,
  canManageStaff: boolean,
): T[] {
  if (canManageStaff) return [...staff]
  if (!activeStaffId) return []
  return staff.filter((s) => s.id === activeStaffId)
}
