'use server'

import { updateTag } from 'next/cache'

import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { resolveWebActorId } from '@/lib/audit-web'
import { audit } from '@/lib/audit'
import {
  PERMISSION_ROLES,
  presetCapabilities,
  effectiveCapabilities,
  synqedRoleToPreset,
  type Capability,
  type PermissionRole,
} from '@/lib/auth/permissions'

// ───────────────────────────────────────────────────────────────────────────
// Staff role + per-staff capability assignment (the Settings → Staff editor
// "authority" controls). Read/write the profile's permission_role + permissions.
//
// SECURITY
//   - staff.manage gates both (owner + manager).
//   - The account OWNER's permissions can't be changed here.
//   - You can never assign the 'owner' role via this surface (ownership transfer
//     is a separate concern).
//   - No privilege escalation, judged on the DELTA: a caller can only ADD
//     capabilities they hold themselves — so a manager (no billing) can't
//     toggle billing onto anyone. Capabilities the target already holds pass
//     through untouched (keeping an existing grant is not a grant — otherwise
//     one owner-granted capability would lock every other manager out of
//     editing that staff member).
//   - audit.view is owner-granted ONLY (Liam ruling 7/17): holding it never
//     confers the right to spread it.
// ───────────────────────────────────────────────────────────────────────────

export interface StaffPermissions {
  permissionRole: PermissionRole
  capabilities: Capability[]
  /** True for the account owner — the editor shows a read-only "full access". */
  isOwner: boolean
}

/** Client-threaded core of getStaffPermissions (facade Bearer path, design-
 *  parity packet 12 §S4a). No capability gate — the caller enforces
 *  staff.manage BEFORE calling this (getStaffPermissions below, or the
 *  facade GET route via ensureCapability), same split as every other core. */
export async function getStaffPermissionsCore(
  businessId: string,
  staffId: string,
): Promise<StaffPermissions | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  let displayRole: string | null = null
  let role: PermissionRole = 'practitioner'
  let override: string[] | null = null

  // Single query in the steady state; pre-migration the rich columns are absent
  // → the combined select errors → fall back to display_role only.
  const { data, error } = await service
    .from('profiles')
    .select('display_role, permission_role, permissions')
    .eq('id', staffId)
    .eq('customer_id', businessId)
    .maybeSingle()
  if (!error) {
    if (!data) return { error: 'Staff not found' }
    displayRole = data.display_role ?? null
    role = data.permission_role ? (data.permission_role as PermissionRole) : synqedRoleToPreset(displayRole)
    override = (data.permissions as string[] | null) ?? null
  } else {
    const { data: base } = await service
      .from('profiles')
      .select('display_role')
      .eq('id', staffId)
      .eq('customer_id', businessId)
      .maybeSingle()
    if (!base) return { error: 'Staff not found' }
    displayRole = base.display_role ?? null
    role = synqedRoleToPreset(displayRole)
  }

  // Owner detection mirrors the write path: display_role OR permission_role.
  // After the RBAC migration the account owner carries permission_role='owner'
  // even when display_role is null — `role` already holds permission_role
  // (line above), so checking it avoids a false editable-picker render. (#162)
  const isOwner =
    (displayRole ?? '').toLowerCase() === 'owner' || role === 'owner'
  return {
    permissionRole: isOwner ? 'owner' : role,
    capabilities: [...effectiveCapabilities(role, override)],
    isOwner,
  }
}

/** Read a staff member's role + effective capabilities. Graceful pre-migration
 *  (derives the preset from display_role). */
export async function getStaffPermissions(
  staffId: string,
): Promise<StaffPermissions | { error: string }> {
  try {
    await requireCapability('staff.manage')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const businessId = await getBusinessId()
  return getStaffPermissionsCore(businessId, staffId)
}

/** Identity a permissions-write core needs, explicit instead of cookie-
 *  resolved (design-parity packet 12 §S4a — same P-B pattern as
 *  StoreWriteDeps): callerStaffId + callerCapabilities carry the two
 *  invariants moved in from the web action (no-escalation-by-delta,
 *  audit.view grant = owner only); actorId + source feed the moved-in audit
 *  row. */
export interface PermissionsWriteDeps {
  /** The acting caller's OWN staff/profile id — cookie-resolved
   *  (getCurrentUserStaffId) on web, the confirmed Bearer auth user id on
   *  the facade (profiles.id === auth.users.id, so no extra roster lookup
   *  is needed there). Null never satisfies the owner check below. */
  callerStaffId: string | null
  /** The caller's own effective capabilities — enforces "you can only grant
   *  a capability you hold yourself" (no-escalation-by-delta). */
  callerCapabilities: Set<Capability>
  actorId: string | null
  source: 'web' | 'facade'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
}

/** Client-threaded core of setStaffPermissions (facade Bearer path, design-
 *  parity packet 12 §S4a). Carries all three invariants from the SECURITY
 *  block above (never target owner, no-escalation-by-delta, audit.view
 *  grant = owner only) plus the moved-in audit row, so web and facade can
 *  never diverge. businessId is REQUIRED — every query below is tenant-
 *  scoped by it. */
export async function setStaffPermissionsCore(
  businessId: string,
  deps: PermissionsWriteDeps,
  staffId: string,
  permissionRole: PermissionRole,
  capabilities: Capability[],
): Promise<{ ok: true } | { error: string }> {
  if (!PERMISSION_ROLES.includes(permissionRole) || permissionRole === 'owner') {
    return { error: 'Invalid role.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // Target must be in this business and must not be the account owner.
  const { data: target } = await service
    .from('profiles')
    .select('id, display_role, permission_role, permissions')
    .eq('id', staffId)
    .eq('customer_id', businessId)
    .maybeSingle()
  if (!target) return { error: 'Staff not found.' }
  const targetIsOwner =
    (target.display_role ?? '').toLowerCase() === 'owner' || target.permission_role === 'owner'
  if (targetIsOwner) return { error: "The account owner's permissions can't be changed here." }

  // Captured pre-write for the audit detail; mirrors the read path's derivation.
  const beforeRole: PermissionRole =
    (target.permission_role as PermissionRole | null) ??
    synqedRoleToPreset(target.display_role ?? null)

  // Validate + filter the requested capabilities, then enforce no-escalation
  // on the DELTA: the caller must hold every capability being ADDED relative
  // to the target's current effective set (see the SECURITY block above).
  const targetCurrent = effectiveCapabilities(
    beforeRole,
    (target.permissions as string[] | null) ?? null,
  )
  const requested = effectiveCapabilities(permissionRole, capabilities)
  const added = [...requested].filter((c) => !targetCurrent.has(c))
  for (const c of added) {
    if (!deps.callerCapabilities.has(c)) return { error: 'You can only grant permissions you have yourself.' }
  }
  // 監査ログ and 予約同期 status spread only from the owner's hand: a granted
  // manager passes the hold-what-you-grant check above, so gate the ADD on
  // ownership explicitly (audit.view: Liam ruling 7/17; sync.view mirrors it,
  // Liam ruling 7/24 / packet 31 — Greptile #599 caught the missing twin).
  const ownerGrantedOnlyAdds = added.filter((c) => c === 'audit.view' || c === 'sync.view')
  if (ownerGrantedOnlyAdds.length > 0) {
    const me = deps.callerStaffId
    const { data: caller } = me
      ? await service
          .from('profiles')
          .select('display_role, permission_role')
          .eq('id', me)
          .eq('customer_id', businessId)
          .maybeSingle()
      : { data: null }
    const callerIsOwner =
      (caller?.display_role ?? '').toLowerCase() === 'owner' ||
      caller?.permission_role === 'owner'
    if (!callerIsOwner)
      return {
        error: ownerGrantedOnlyAdds.includes('audit.view')
          ? 'Only the owner can grant audit-log access.'
          : 'Only the owner can grant sync-status access.',
      }
  }

  // Store null when the set matches the role preset (so the staff "follows" the
  // preset); store the explicit array only when customized.
  const presetSet = new Set(presetCapabilities(permissionRole))
  const matchesPreset =
    requested.size === presetSet.size && [...requested].every((c) => presetSet.has(c))

  const { error } = await service
    .from('profiles')
    .update({ permission_role: permissionRole, permissions: matchesPreset ? null : [...requested] })
    .eq('id', staffId)
    .eq('customer_id', businessId)
  if (error) return { error: `Could not save permissions: ${error.message}` }

  // An authority change is consequential (severity notice — same class as the
  // audit.view grant ruling, design §9). Roles in detail; capability sets stay
  // out of the line — `customized` records that an override array was stored.
  audit({
    category: 'settings',
    action: 'settings.permissions_change',
    severity: 'notice',
    actorId: deps.actorId,
    actorType: 'staff',
    businessId,
    targetType: 'staff',
    targetId: staffId,
    detail: { before_role: beforeRole, after_role: permissionRole, customized: !matchesPreset },
    requestId: deps.requestId,
    source: deps.source,
  })

  return { ok: true }
}

/** Assign a role + (optionally customized) capabilities to a staff member. */
export async function setStaffPermissions(
  staffId: string,
  permissionRole: PermissionRole,
  capabilities: Capability[],
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireCapability('staff.manage')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }

  const businessId = await getBusinessId()
  const [callerCapabilities, callerStaffId, actorId] = await Promise.all([
    getMyCapabilities(),
    getCurrentUserStaffId(),
    resolveWebActorId(),
  ])
  const result = await setStaffPermissionsCore(
    businessId,
    { callerCapabilities, callerStaffId, actorId, source: 'web', requestId: crypto.randomUUID() },
    staffId,
    permissionRole,
    capabilities,
  )
  if ('ok' in result) updateTag('staff-list')
  return result
}
