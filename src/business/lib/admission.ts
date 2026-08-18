// THE authorization point for every Business screen. Screens and layouts call
// this and then only render. Any failure (unauthenticated, no membership, no
// grant, wrong role, a read that threw) is notFound(): hide, never
// show-and-refuse, and never a 500 that would confirm Business exists to
// someone without the door.
//
// PLAY-PHASE SEAL (⚖ Liam 2026-08-19, post-merge audit): the owner-identity
// leg — `business.manage && recordings.viewAll` via getMyCapabilities — is
// DELIBERATELY REMOVED here, not weakened: its resolution chain
// (require-permission → getStaffList → @/lib/staff) reaches synqed-core, and
// territory must be incapable of that, not merely not-doing-it. The role gate
// is therefore 経営メンバー only. Practical effect: until the is_management
// migration (#713) lands, NOBODY passes even holding a grant row — acceptable,
// the grant table is empty by design. The owner leg returns in the DOOR /
// reconnect PR, together with the capability source it needs.

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { businessIdForUser, hasBusinessAdminGrant, isManagementMember } from './grants'

export interface BusinessAdmission { userId: string; email: string | null; businessId: string }

/** null = denied, for any reason. Kept apart from the notFound() call below so
 *  the catch-all can never swallow Next's own control-flow throw. */
async function admit(): Promise<BusinessAdmission | null> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) return null
  const businessId = await businessIdForUser(user.id)
  if (!businessId) return null
  const [granted, management] = await Promise.all([
    hasBusinessAdminGrant(businessId),
    isManagementMember(user.id),
  ])
  if (!granted || !management) return null
  return { userId: user.id, email: user.email ?? null, businessId }
}

export async function requireBusinessAdmission(): Promise<BusinessAdmission> {
  const admitted = await admit().catch(() => null)
  if (!admitted) notFound()
  return admitted
}
