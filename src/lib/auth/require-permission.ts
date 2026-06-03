// Server-side capability resolution + enforcement. Never import from a client
// component — it uses the service-role client. The real authorization gate:
// every mutating server action that touches privileged surfaces calls
// requireCapability(...) so the UI is never the thing standing between a user
// and an action.

import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUserStaffId } from '@/lib/staff'
import {
  effectiveCapabilities,
  synqedRoleToPreset,
  type Capability,
  type PermissionRole,
} from './permissions'

/**
 * Resolve the signed-in user's effective capabilities, tenant-scoped (the
 * profile id is auth.uid()).
 *
 * Degrades gracefully across the rollout:
 *   - After the RBAC migration: use the rich `permission_role` + `permissions`
 *     (per-staff overrides) columns.
 *   - Before it (or if those columns aren't present yet): derive the preset from
 *     the existing `display_role` (which mirrors the synqed role). The owner
 *     therefore keeps full power either way — applying the migration changes no
 *     one's effective access until someone is explicitly customized.
 */
export async function getMyCapabilities(): Promise<Set<Capability>> {
  const uid = await getCurrentUserStaffId()
  if (!uid) return new Set()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // display_role always exists → the pre-migration fallback preset.
  const { data: base } = await service
    .from('profiles')
    .select('display_role')
    .eq('id', uid)
    .maybeSingle()
  let role: PermissionRole = synqedRoleToPreset(base?.display_role)
  let override: string[] | null = null

  // Rich RBAC columns (added by the staff-permissions migration). Wrapped so a
  // pre-migration DB (columns absent) silently falls back to the preset above.
  try {
    const { data: rich, error } = await service
      .from('profiles')
      .select('permission_role, permissions')
      .eq('id', uid)
      .maybeSingle()
    if (!error && rich) {
      if (rich.permission_role) role = rich.permission_role as PermissionRole
      override = (rich.permissions as string[] | null) ?? null
    }
  } catch {
    /* columns not present yet — preset from display_role stands */
  }

  return effectiveCapabilities(role, override)
}

export async function can(capability: Capability): Promise<boolean> {
  return (await getMyCapabilities()).has(capability)
}

/** Throw if the caller lacks the capability. Call at the top of privileged
 *  server actions. The thrown message is safe to surface to the user. */
export async function requireCapability(capability: Capability): Promise<void> {
  if (!(await can(capability))) {
    throw new Error('You do not have permission to perform this action.')
  }
}
