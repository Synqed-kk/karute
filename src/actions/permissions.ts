'use server'

import { updateTag } from 'next/cache'

import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { auditWeb } from '@/lib/audit-web'
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
  if (!PERMISSION_ROLES.includes(permissionRole) || permissionRole === 'owner') {
    return { error: 'Invalid role.' }
  }

  const businessId = await getBusinessId()
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
  const myCaps = await getMyCapabilities()
  const added = [...requested].filter((c) => !targetCurrent.has(c))
  for (const c of added) {
    if (!myCaps.has(c)) return { error: 'You can only grant permissions you have yourself.' }
  }
  // 監査ログ spreads only from the owner's hand: a granted manager passes the
  // hold-what-you-grant check above, so gate the ADD on ownership explicitly.
  if (added.includes('audit.view')) {
    const me = await getCurrentUserStaffId()
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
    if (!callerIsOwner) return { error: 'Only the owner can grant audit-log access.' }
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
  await auditWeb({
    category: 'settings',
    action: 'settings.permissions_change',
    severity: 'notice',
    businessId,
    targetType: 'staff',
    targetId: staffId,
    detail: { before_role: beforeRole, after_role: permissionRole, customized: !matchesPreset },
  })

  updateTag('staff-list')
  return { ok: true }
}
