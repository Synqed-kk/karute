// ───────────────────────────────────────────────────────────────────────────
// Permission v2 mapping — Packet 2 (Business Message 2). Types ONLY: this
// module (and its siblings map-legacy-rights.ts / shadow-compare.ts) is a
// PARALLEL vocabulary that lives alongside src/lib/auth/permissions.ts.
// Nothing here is imported by production code in Packet 2 — see the
// migration-report runner (scripts/permissions/migration-report.mjs) and the
// test suite (src/__tests__/integration/permissions-v2-mapping.test.ts) for
// the only two consumers. Runtime shadow enforcement arrives with Packet 3A's
// entry-point guard registry.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Permission v2 vocabulary — the split that makes Front Desk genuinely
 * separable from Karute records. Lives ALONGSIDE the legacy tokens: nothing
 * imports this module in production during Packet 2, no legacy token is
 * removed, and no token below collides with (or is confusable with) a legacy
 * name. Scope is the three domains the plan names — customer, booking,
 * record. Money/staff/settings/audit/sync/analytics/transcript tokens have
 * NO v2 twin yet and pass through the shadow untouched (transcripts stay
 * owner-only legacy, deliberately outside Packet 2).
 */
export const CAPABILITIES_V2 = [
  'customer_identity.view',  // customer list, names, contact, visit schedule — NO treatment content
  'karute_records.view',     // karute/session content incl. AI summaries (split out of customers.view)
  'karute_records.write',    // successor of records.write
  'karute_records.delete',   // successor of records.delete
  'booking_desk.view',       // see the appointment book
  'booking_desk.manage',     // create/move/cancel appointments (successor of bookings.manage)
] as const
export type CapabilityV2 = (typeof CAPABILITIES_V2)[number]

export const STORE_ACCESS_MODES = ['NONE', 'ASSIGNED', 'ALL'] as const
export type StoreAccessMode = (typeof STORE_ACCESS_MODES)[number]

/** Flags the migration report must surface for owner/Liam review. */
export type AmbiguityFlag =
  | { readonly kind: 'floating_staff_empty_assignment' } // today's fail-open convention; ruling owed
  | { readonly kind: 'override_carried_unknown_tokens'; readonly dropped: ReadonlyArray<string> }

/** One staff row as read from the live system — string-typed at this
 *  boundary, parsed fail-closed by the mapper (unknown tokens dropped and
 *  flagged, never guessed). */
export interface LegacyRightsInput {
  readonly subjectId: string
  readonly role: string                                  // parsed → PermissionRole, fail-closed to 'custom'-like empty preset
  readonly storedOverride: ReadonlyArray<string> | null  // profiles.permissions verbatim
  readonly effectiveLegacy: ReadonlyArray<string>        // OUTPUT of effectiveCapabilities() — post-chokepoint
  readonly assignedStoreIds: ReadonlyArray<string>       // staff_stores verbatim
  readonly hasStoresViewAll: boolean                     // from the effective set
}

/**
 * The proposed migrated rights for ONE staff member. Models per-store
 * differences at the type level (plan requirement); the legacy mapper always
 * emits an EMPTY perStore record because the current model has no per-store
 * capabilities — tooling must never invent entries an owner didn't create.
 */
export interface ProposedStaffRights {
  readonly subjectId: string
  readonly provenance: 'preset' | 'override'
  readonly storeAccessMode: StoreAccessMode              // mapper emits ALL or ASSIGNED, never NONE
  readonly assignedStoreIds: ReadonlyArray<string>       // sorted; non-empty iff ASSIGNED
  readonly capabilitiesV2: ReadonlyArray<CapabilityV2>   // uniform baseline, canonical CAPABILITIES_V2 order
  readonly perStoreCapabilitiesV2: Readonly<Record<string, ReadonlyArray<CapabilityV2>>>
  readonly ambiguities: ReadonlyArray<AmbiguityFlag>
}

// ─── Additions beyond the frozen §1 block ───────────────────────────────────
// Everything above this line is the contract's §1 type block, reproduced
// byte-exact. Everything below is new — needed by the mapper/shadow-compare/
// report modules but not itself part of the frozen type spec.

import { PERMISSION_ROLES, type PermissionRole } from '@/lib/auth/permissions'

/**
 * NOT part of the frozen §1 contract — the contract's shadow-compare
 * signatures (assembleMigrationReport) reference `StaffIdentity` without
 * defining it. Minimal by design: display-only fields for a human-reviewable
 * report, no auth semantics, no synqed/profile linkage details.
 */
export interface StaffIdentity {
  readonly subjectId: string
  readonly displayName: string
  readonly email: string
}

/**
 * Fail-closed role parse: LegacyRightsInput.role is a raw string (whatever
 * profiles.permission_role / display_role produced) — an unrecognized value
 * is treated as `'custom'` (which presets to an EMPTY capability set) rather
 * than guessed or thrown. Used by callers that build `effectiveLegacy` (the
 * report runner, and test fixtures) BEFORE calling the real
 * `effectiveCapabilities()` chokepoint; `mapLegacyRights` itself never parses
 * a role — it only consumes the already-resolved `effectiveLegacy` output.
 */
export function parseRoleFailClosed(role: string): PermissionRole {
  return (PERMISSION_ROLES as readonly string[]).includes(role)
    ? (role as PermissionRole)
    : 'custom'
}
