// ───────────────────────────────────────────────────────────────────────────
// RBAC — capabilities, role presets, resolution. PURE (no server imports), so
// it's shared by server-action gates AND client UI gating.
//
// Model: a role is a PRESET that seeds a default set of capabilities. The owner
// can then toggle individual capabilities per staff member; that explicit set is
// stored on the profile (`permissions`) and overrides the preset. This is what
// makes one product serve 整体 / chiropractic / beauty salons whose staff
// structures differ. Enforcement is always server-side and tenant-scoped (the
// caller's businessId is resolved server-side; see require-permission.ts).
// ───────────────────────────────────────────────────────────────────────────

/** Atomic, toggleable units of access. Add here, then reference in actions. */
export const CAPABILITIES = [
  'billing.manage',    // payment methods, subscription  (owner-only by default)
  'business.manage',   // delete / transfer the business (owner-only by default)
  'staff.invite',      // add / invite staff
  'staff.manage',      // remove / demote / change a member's role
  'settings.manage',   // operating hours, services, multi-store, org settings
  'audit.view',        // audit log
  'data.export',       // export / import customer + karute data
  'records.delete',    // delete customers / karute (destructive)
  'records.write',     // record sessions, create / edit karute
  'recordings.viewAll',// read EVERY staff's raw transcript/recording (vs. only
                       // your OWN). OWNER ONLY by default (Liam ruling 7/16:
                       // recordings are private to whoever recorded them —
                       // managers included; the owner keeps it as the dev/
                       // support key). The AI summary + entries stay shared
                       // regardless.
  'analytics.viewAll', // whole-salon analytics / coaching (vs. own-only)
  'stores.viewAll',    // see EVERY store's karute + customers (vs. own store only).
                       // Without it, a staff member is clamped to their
                       // staff_stores assignment (regular staff = own branch; SV
                       // + manager + owner = cross-store). See lib/auth/store-scope.
  'alerts.manage',     // dismiss 離客/pack alerts (Kitano's rule: manager+ only —
                       // staff must show the manager they contacted the customer)
  'customers.view',    // baseline — view customers + karute
  'bookings.manage',   // baseline — manage appointments
] as const
export type Capability = (typeof CAPABILITIES)[number]

/** Role presets (labels shown in the UI). `custom` starts empty — the owner
 *  toggles up an unusual role from scratch. */
export const PERMISSION_ROLES = [
  'owner',
  'manager',
  'senior',
  'practitioner',
  'frontdesk',
  'custom',
] as const
export type PermissionRole = (typeof PERMISSION_ROLES)[number]

const ALL: Capability[] = [...CAPABILITIES]

/** Default capabilities seeded when a role is assigned. */
export const ROLE_PRESETS: Record<PermissionRole, Capability[]> = {
  // Full control.
  owner: ALL,
  // Runs the salon — everything EXCEPT money + existential + other people's
  // raw recordings (Liam ruling 7/16: transcripts are recorder-private; the
  // manager still sees every AI summary/entry). Manages staff (Liam's call).
  // No billing, no delete-the-business.
  manager: ALL.filter(
    (c) => c !== 'billing.manage' && c !== 'business.manage' && c !== 'recordings.viewAll',
  ),
  // Lead practitioner / SV (supervisor): does the work + sees whole-salon
  // analytics + exports + cross-store visibility; no settings/staff/billing.
  senior: ['records.write', 'records.delete', 'data.export', 'analytics.viewAll', 'stores.viewAll', 'customers.view', 'bookings.manage'],
  // Practitioner: the core service provider.
  practitioner: ['records.write', 'customers.view', 'bookings.manage'],
  // Front desk: books + views, no records, nothing destructive.
  frontdesk: ['customers.view', 'bookings.manage'],
  // Custom: blank canvas — toggle up exactly what this business needs.
  custom: [],
}

/** Coarse mirror to synqed-core's StaffRole (which only has 4 values). Used when
 *  writing the synqed staff record; the rich role + toggles live in Karute. */
export const ROLE_TO_SYNQED: Record<PermissionRole, 'OWNER' | 'ADMIN' | 'STYLIST' | 'ASSISTANT'> = {
  owner: 'OWNER',
  manager: 'ADMIN',
  senior: 'STYLIST',
  practitioner: 'STYLIST',
  frontdesk: 'ASSISTANT',
  custom: 'ASSISTANT',
}

/** Map a synqed StaffRole (e.g. from an invite) to a Karute permission preset. */
export function synqedRoleToPreset(role: string | null | undefined): PermissionRole {
  switch ((role ?? '').toUpperCase()) {
    case 'OWNER':
      return 'owner'
    case 'ADMIN':
      return 'manager'
    case 'ASSISTANT':
      return 'frontdesk'
    case 'STYLIST':
    default:
      return 'practitioner'
  }
}

export function presetCapabilities(role: PermissionRole): Capability[] {
  return ROLE_PRESETS[role] ?? []
}

/** Effective capability set: an explicit per-staff override wins; otherwise the
 *  role's preset. Unknown stored capabilities are dropped (forward-compatible). */
export function effectiveCapabilities(
  role: PermissionRole,
  override: readonly string[] | null | undefined,
): Set<Capability> {
  const valid = new Set<string>(CAPABILITIES)
  const source = override ?? presetCapabilities(role)
  return new Set(source.filter((c): c is Capability => valid.has(c)))
}

export function can(caps: Set<Capability>, capability: Capability): boolean {
  return caps.has(capability)
}
