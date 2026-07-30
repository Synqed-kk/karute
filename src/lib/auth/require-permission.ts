// Server-side capability resolution + enforcement. Never import from a client
// component — it uses the service-role client. The real authorization gate:
// every mutating server action that touches privileged surfaces calls
// requireCapability(...) so the UI is never the thing standing between a user
// and an action.

import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUserStaffId } from '@/lib/staff'
import { AppApiError } from '@/lib/app-api/errors'
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
export const getMyCapabilities = cache(async (): Promise<Set<Capability>> => {
  const uid = await getCurrentUserStaffId()
  if (!uid) return new Set()
  return capabilitiesForUser(uid)
})

/**
 * Effective capabilities for an EXPLICIT staff/profile id — the identity seam
 * shared by the cookie path (getMyCapabilities) and the facade Bearer path,
 * where the id comes from the verified token, not a cookie. Same tenant-scoped
 * profile read; same graceful pre/post-migration fallback.
 */
export async function capabilitiesForUser(uid: string): Promise<Set<Capability>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // Single round-trip in the steady state. Post-migration the combined select
  // succeeds and is the only query. Pre-migration the permission_role/permissions
  // columns don't exist, so the combined select errors → fall back to a
  // display_role-only read (preset derived from the synqed role, owner keeps full
  // power). (Greptile #159: collapses the previous always-two-query path.)
  let role: PermissionRole = 'practitioner'
  let override: string[] | null = null

  const { data, error } = await service
    .from('profiles')
    .select('display_role, permission_role, permissions')
    .eq('id', uid)
    .maybeSingle()

  if (!error && data) {
    role = data.permission_role
      ? (data.permission_role as PermissionRole)
      : synqedRoleToPreset(data.display_role)
    override = (data.permissions as string[] | null) ?? null
  } else {
    // The graceful fallback exists ONLY for the pre-RBAC-migration schema,
    // where the permission_role/permissions columns don't exist yet (Postgres
    // 42703 undefined_column / PostgREST PGRST204 schema-cache miss). Any
    // OTHER combined-select failure — e.g. a transient DB error post-migration
    // — must fail CLOSED instead: deriving a preset from display_role would
    // DROP an explicit per-staff override and could re-grant a capability the
    // owner deliberately removed (Greptile #652 P1). A missing row without an
    // error keeps the pre-existing preset path (no override exists to drop).
    if (error && error.code !== '42703' && error.code !== 'PGRST204') {
      throw new Error('capability resolution failed')
    }
    const { data: base } = await service
      .from('profiles')
      .select('display_role')
      .eq('id', uid)
      .maybeSingle()
    role = synqedRoleToPreset(base?.display_role)
  }

  return effectiveCapabilities(role, override)
}

/** Pure capability guard for a PRE-RESOLVED capability set. The one place the
 *  "has this capability?" decision is expressed, so the web path (caps from
 *  getMyCapabilities) and the facade path (caps from the Bearer identity) can
 *  never drift. Throws so a handler's error mapper turns it into 403. */
export function ensureCapability(caps: Set<Capability>, capability: Capability): void {
  if (!caps.has(capability)) {
    throw new AppApiError('forbidden', `Missing capability: ${capability}`)
  }
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
