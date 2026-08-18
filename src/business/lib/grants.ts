// Business admission reads — service-role reads of app-owned tables ONLY.
// EVERY path is fail-closed: a query error, an absent table (the grants
// migration is a separate PR and has not run everywhere), an absent column, or
// a thrown client all read as "no access". The door opens only on a row that
// is there. Nothing here can reach synqed-core: one client, one schema, three
// config reads, zero writes.

import { createServiceClient } from '@/lib/supabase/service'

/** Frozen workspace id from the registry (src/lib/workspaces/types.ts). Spelled
 *  literally rather than imported so territory keeps ZERO app imports beyond
 *  the two supabase factories (play-phase seal); the resolver wiring — and the
 *  typed tie back to the registry — belongs to the DOOR PR. */
const BUSINESS_ADMIN = 'business_admin'

/** The tenant this signed-in user belongs to, read straight off the app-owned
 *  profiles row. Replaces @/lib/staff's getBusinessId, whose own chain is
 *  app-DB-only but whose MODULE carries a dynamic synqed-core import — under
 *  "incapable, not unreachable" that module may not enter the Business graph.
 *  null = no membership OR a failed lookup; the caller 404s on both. */
export async function businessIdForUser(userId: string): Promise<string | null> {
  try {
    const { data, error } = await createServiceClient()
      .from('profiles')
      .select('customer_id')
      .eq('id', userId)
      .maybeSingle()
    return !error && data?.customer_id ? (data.customer_id as string) : null
  } catch {
    return null
  }
}

/** The tenant's `business_admin` grant, or null — the release lever: one insert
 *  opens a tenant, one delete is the kill switch. Default (no rows) = OFF
 *  everywhere. `grantedBy` carries the row's `granted_by` uuid so admission can
 *  run the play-phase person-leg off the SAME single read; null there is a
 *  legal state (a grant nobody is pinned to) and denies that leg. */
export async function hasBusinessAdminGrant(
  businessId: string,
): Promise<{ granted: boolean; grantedBy: string | null }> {
  const DENIED = { granted: false, grantedBy: null }
  try {
    const { data, error } = await createServiceClient()
      .from('business_workspace_grants')
      .select('workspace_id, granted_by')
      .eq('business_id', businessId)
      .eq('workspace_id', BUSINESS_ADMIN)
      .maybeSingle()
    if (error || !data) return DENIED
    return { granted: true, grantedBy: (data.granted_by as string | null) ?? null }
  } catch {
    return DENIED
  }
}

/** 経営メンバー flag on the app-owned `profiles` row — the whole role gate for
 *  the play phase (see admission.ts on the removed owner-capability leg). */
export async function isManagementMember(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient()
      .from('profiles')
      .select('is_management')
      .eq('id', userId)
      .maybeSingle()
    return !error && data?.is_management === true
  } catch {
    return false
  }
}
