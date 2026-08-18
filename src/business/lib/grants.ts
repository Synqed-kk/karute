// Business admission reads — service-role reads of app-owned tables. EVERY
// path is fail-closed: a query error, an absent table (the grants migration is
// a separate PR and has not run everywhere), an absent column, or a thrown
// client all read as "no access". The door opens only on a row that is there.

import { createServiceClient } from '@/lib/supabase/service'
import type { WorkspaceId } from '@/lib/workspaces/types'

const BUSINESS_ADMIN: WorkspaceId = 'business_admin'

/** True only when this tenant holds an explicit `business_admin` grant row —
 *  the release lever: one insert opens a tenant, one delete is the kill
 *  switch. Default (no rows) = OFF everywhere. */
export async function hasBusinessAdminGrant(businessId: string): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient()
      .from('business_workspace_grants')
      .select('workspace_id')
      .eq('business_id', businessId)
      .eq('workspace_id', BUSINESS_ADMIN)
      .maybeSingle()
    return !error && !!data
  } catch {
    return false
  }
}

/** 経営メンバー flag on the app-owned `profiles` row. Owner identity is checked
 *  separately (admission.ts), so this answers only the management half. */
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
