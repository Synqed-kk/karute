// THE authorization point for every Business screen. Screens and layouts call
// this and then only render — they never touch a client themselves. Any
// failure (unauthenticated, no membership, no grant, wrong role, a read that
// threw) is notFound(): hide, never show-and-refuse, and never a 500 that
// would confirm Business exists to someone without the door.

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessId } from '@/lib/staff'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { hasBusinessAdminGrant, isManagementMember } from './grants'

export interface BusinessAdmission { userId: string; email: string | null; businessId: string }

/** null = denied, for any reason. Kept apart from the notFound() call below so
 *  the catch-all can never swallow Next's own control-flow throw. */
async function admit(): Promise<BusinessAdmission | null> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) return null
  const businessId = await getBusinessId()
  const [granted, caps, management] = await Promise.all([
    hasBusinessAdminGrant(businessId),
    getMyCapabilities(),
    isManagementMember(user.id),
  ])
  // Owner IDENTITY, not a grantable toggle: `business.manage` is a per-staff
  // capability an owner can tick for a manager, so it is paired with the
  // strip-protected owner-only `recordings.viewAll` — the exact pin
  // src/actions/dev-tools.ts:19-22 adjudicated for the 再学習 dev tools.
  const owner = caps.has('business.manage') && caps.has('recordings.viewAll')
  if (!granted || !(owner || management)) return null
  return { userId: user.id, email: user.email ?? null, businessId }
}

export async function requireBusinessAdmission(): Promise<BusinessAdmission> {
  const admitted = await admit().catch(() => null)
  if (!admitted) notFound()
  return admitted
}
