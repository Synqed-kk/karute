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
 * Failure posture (#652): the ONLY graceful degradation is the genuine
 * pre-RBAC-migration schema (42703 undefined_column, with a successful
 * display_role follow-up read) — there, the preset derives from the
 * authoritative pre-migration row and no override can exist to drop. EVERY
 * other failure (transient errors, PGRST204 cache misses, a failing follow-up
 * read, a missing profile row) THROWS — deriving a preset there would either
 * drop an explicit per-staff override or synthesize access with no
 * authoritative data. Callers either surface the failure (gates → 403/500) or
 * absorb it as zero capabilities where a page/scope must keep working.
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
 * profile read; same fail-closed posture (see getMyCapabilities above).
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
    // where the permission_role/permissions columns don't exist yet — Postgres
    // 42703 undefined_column, the one unambiguous "schema really lacks the
    // column" code. PGRST204 (PostgREST schema-CACHE miss) is deliberately
    // NOT accepted: a stale cache can fire it post-migration, and honoring it
    // would re-open the exact hole this guard closes (Greptile #652 round 2).
    // Every other combined-select failure — transient DB errors included —
    // fails CLOSED: deriving a preset from display_role would DROP an explicit
    // per-staff override and could re-grant a capability the owner
    // deliberately removed (Greptile #652 P1). A missing row without an error
    // keeps the pre-existing preset path (no override exists to drop).
    if (error && error.code !== '42703') {
      throw new Error('capability resolution failed')
    }
    const { data: base, error: baseError } = await service
      .from('profiles')
      .select('display_role')
      .eq('id', uid)
      .maybeSingle()
    // The fallback must never SYNTHESIZE access: if its own query fails, or
    // the profile row is missing entirely, there is no authoritative
    // permission data at all — fail closed rather than defaulting to the
    // practitioner preset (Greptile #652 r3). A row whose display_role is
    // null/unset stays on the preset default: the row itself is authoritative,
    // the column just predates RBAC.
    if (baseError || !base) {
      throw new Error('capability resolution failed')
    }
    role = synqedRoleToPreset(base.display_role)
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
