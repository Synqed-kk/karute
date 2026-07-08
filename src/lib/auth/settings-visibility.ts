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
}

/**
 * Filter the settings tab list for the viewer.
 *   - `ownerOnly` tabs (packs / subscription / audit) stay owner-only.
 *   - The 店舗 (stores) tab requires stores.viewAll: a branch-restricted staff
 *     can't switch stores (the switch is server-clamped) and the section
 *     otherwise leaks the other branch + its customer counts.
 */
export function visibleSettingsTabs<T extends { id: string; ownerOnly?: boolean }>(
  tabs: readonly T[],
  caps: SettingsCaps,
): T[] {
  return tabs.filter((tab) => {
    if (tab.id === 'stores' && !caps.canViewAllStores) return false
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
