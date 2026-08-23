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
  'menus.manage',      // service-menu catalog (設定→メニュー) — owner/manager/
                       // senior by default (Liam ruling 8/12: SV/senior edits
                       // menus)
  'audit.view',        // audit log
  'sync.view',         // 予約同期 status card (read-only) — owner-only by
                       // default, deliberate per-staff toggle, same posture
                       // as audit.view (Liam ruling 7/24, packet 31)
  'data.export',       // export / import customer + karute data
  'records.delete',    // delete customers / karute (destructive)
  'records.reassign',  // re-point a saved karute to another customer (audited)
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
  // No billing, no delete-the-business. No 監査ログ by default (Liam ruling
  // 7/17: owner-only; a specific manager gets it only as a deliberate per-staff
  // toggle, never as a preset).
  manager: ALL.filter(
    (c) =>
      c !== 'billing.manage' &&
      c !== 'business.manage' &&
      c !== 'recordings.viewAll' &&
      c !== 'audit.view' &&
      c !== 'sync.view',
  ),
  // Lead practitioner / SV (supervisor): does the work + sees whole-salon
  // analytics + exports + cross-store visibility; no settings/staff/billing.
  senior: ['records.write', 'records.delete', 'records.reassign', 'data.export', 'analytics.viewAll', 'stores.viewAll', 'customers.view', 'bookings.manage', 'menus.manage'],
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
  const caps = new Set(source.filter((c): c is Capability => valid.has(c)))
  // recordings.viewAll is owner-only (recorder-private ruling, Liam 7/16) and
  // is enforced HERE, not just in the presets: a per-staff override stored
  // before the ruling still carries it, and this function is the single
  // chokepoint every read path (capabilitiesForUser, cookie + Bearer) and the
  // override WRITE path (setStaffPermissions) pass through. Stripping at
  // resolve time self-heals stale rows with no data migration.
  if (role !== 'owner') caps.delete('recordings.viewAll')
  // audit.view is deliberately NOT stripped here (grant-honoring flow, Liam
  // ruling 7/17): owner-only by default because no non-owner PRESET carries it;
  // a stored override carries it only when the owner ticked the toggle in
  // StaffForm — that explicit per-staff grant is the sanctioned path to 監査ログ.
  // Stale pre-#528 snapshots can't smuggle it in: overrides are stored only
  // when they DIFFER from the preset (setStaffPermissions stores null on
  // preset match) and the toggle UI was feature-flagged off until #528.
  return caps
}

export function can(caps: Set<Capability>, capability: Capability): boolean {
  return caps.has(capability)
}

// ───────────────────────────────────────────────────────────────────────────
// Ask AI access — ONE shared rule for every entry point (H0, 2026-07-30).
//
// The facade chat + facade ask-ai screen have always guarded customers.view;
// the web page and the legacy cookie chat route guarded only session presence,
// so a same-business account with NO capabilities (blank custom preset) could
// still pull karute/customer-derived AI context. All four surfaces now consume
// THIS list so the effective rule can never drift between them.
//
// customers.view is the rule because the AI context is view-shaped data —
// karute content + customer names, the same data customers.view gates
// everywhere else. Tightening the rule (e.g. adding records.write to exclude
// Front Desk) is a product decision: change THIS list and every entry point
// and its tests follow. Do not add Permission-v2 vocabulary here.
// ───────────────────────────────────────────────────────────────────────────
// Non-empty tuple type: emptying this list must FAIL THE BUILD — [].every()
// is vacuously true and an empty ensureCapability loop doesn't iterate, so an
// empty rule would silently admit everyone on all four surfaces at once.
export const ASK_AI_REQUIRED_CAPABILITIES: readonly [Capability, ...Capability[]] = [
  'customers.view',
]

/** True when the resolved capability set satisfies the shared Ask AI rule. */
export function canUseAskAi(caps: Set<Capability>): boolean {
  return ASK_AI_REQUIRED_CAPABILITIES.every((c) => caps.has(c))
}

/**
 * Staff WRITE store clamp — the shared rule, both transports (web:
 * staffWriteInScope in src/lib/auth/store-scope.ts · facade:
 * ensureStaffWriteInScope in src/lib/app-api/store-clamp.ts). It lives HERE,
 * in the pure module, because those two graphs must not meet: store-clamp.ts
 * deliberately keeps the ESM-only SDK out of its imports.
 *
 * It answers ONE question, for an actor already known to be CLAMPED: may they
 * mutate this staff row? The three free passes (`stores.viewAll`, a floating
 * actor, and a SELF-edit) are settled by the callers before they get here, so
 * `allowedStoreIds` is always a real, non-empty assignment.
 *
 *   - `targetStores === null` → the target's assignment LOOKUP failed → refuse.
 *     Fail-closed, the same posture as the menu clamp's `degraded` (F-A): a
 *     write we can't vouch for doesn't happen.
 *   - `[]` → floating target: they appear in EVERY branch's roster, the staff
 *     analogue of a 全店舗 menu — and src/actions/menus.ts:95-98 already ruled
 *     that touching an every-store item takes `stores.viewAll` no matter how
 *     the actor is assigned. Same rule here → refuse. This also closes the
 *     unknown-id corner: if core ever answers `{ store_ids: [] }` for a staff
 *     id that doesn't exist, a clamped actor is refused, not waved through.
 *   - else → pass iff the two assignments overlap.
 */
export function staffStoresOverlap(
  allowedStoreIds: string[],
  targetStores: string[] | null,
): boolean {
  // Both refusals above: a failed lookup (null) and an every-store target ([]).
  if (!targetStores?.length) return false
  return targetStores.some((id) => allowedStoreIds.includes(id))
}
