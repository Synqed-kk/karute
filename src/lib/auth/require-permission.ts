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
import { actorIsUnassigned } from './store-gate'

/**
 * Resolve the signed-in user's effective capabilities, tenant-scoped (the
 * profile id is auth.uid()).
 *
 * Degrades gracefully across the rollout:
 *   - After the RBAC migration: use the rich `permission_role` + `permissions`
 *     (per-staff overrides) columns.
 *   - Before it (those columns missing — Postgres 42703 only): derive the preset
 *     from the existing `display_role` (which mirrors the synqed role). The
 *     owner therefore keeps full power either way.
 * Any OTHER read failure REJECTS (Round 2) — an outage, never a permission.
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
 *
 * ⚖ Liam 2026-09-16: it is ALSO the single place the unassigned gate is
 * enforced. An unassigned actor gets an EMPTY capability set, so every
 * capability-gated action and facade route refuses BY CONSTRUCTION rather than
 * by each door remembering to ask. `businessId` rides in from the facade's
 * verified token; the cookie path omits it (see actorIsUnassigned).
 */
export async function capabilitiesForUser(
  uid: string,
  opts: { businessId?: string } = {},
): Promise<Set<Capability>> {
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

  // Round 2, 2026-09-24, D-S16-4 / D-S17-2 (discussed, default): only the
  // missing pre-migration columns (42703) take the display_role preset. Any
  // other error THROWS — the stale role re-armed a demoted ex-ADMIN (S15 C3b),
  // and an empty set would send an owner to the unassigned screen.
  if (error && error.code !== '42703') {
    throw new AppApiError('upstream_unavailable', 'Permission lookup failed')
  }
  if (error) {
    const { data: base, error: baseError } = await service
      .from('profiles')
      .select('display_role')
      .eq('id', uid)
      .maybeSingle()
    if (baseError) throw new AppApiError('upstream_unavailable', 'Permission lookup failed')
    role = synqedRoleToPreset(base?.display_role)
  } else if (!data) {
    // No row: nothing is vouched for (was the preset of undefined: practitioner).
    return new Set<Capability>()
  } else {
    role = data.permission_role
      ? (data.permission_role as PermissionRole)
      : synqedRoleToPreset(data.display_role)
    override = (data.permissions as string[] | null) ?? null
  }

  const caps = effectiveCapabilities(role, override)
  // A cross-store role never consults an assignment — and asking would cost a
  // round trip on the owner's every request.
  if (caps.has('stores.viewAll')) return caps
  return (await actorIsUnassigned(uid, opts.businessId)) ? new Set<Capability>() : caps
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
