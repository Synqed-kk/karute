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
// territory must be incapable of that, not merely not-doing-it. The owner leg
// returns in the DOOR / reconnect PR with the capability source it needs.
//
// DOOR-LITE (⚖ Liam 2026-08-19, path B): the play-phase person-leg is
// `user.id === grant.granted_by` — the grants row already carries the uuid, so
// this is per-person-precise with no schema change and no dependency on the
// is_management migration (#713). That 経営メンバー leg stays in the
// composition so #713 landing widens nothing unexpectedly; it is simply inert
// until the column exists. Both legs are fail-closed: a null granted_by
// matches nobody.
//
// Preview-only, machine-checked, and shaped as an ALLOWLIST: a deployment
// admits only when VERCEL_ENV is absent (local dev, jest) or exactly
// 'preview'. Any other value — 'production', a future environment name, a
// typo — denies, so an unexpected value can never read as permission.
// Residual, accepted: a preview build aliased onto a production domain still
// reports 'preview', so the URL is not the thing being checked; the build is.
// REMOVING THIS RESTRICTION IS A NAMED DOOR-PR DELIVERABLE — it is the reason
// real screens are safe to look at while staff are live on the phone app.
//
// Revocation: deleting the grant row closes the door on the next full load.
// An ALREADY-OPEN tab can keep a rendered segment for up to 5 minutes
// (next.config staleTimes.dynamic = 300) before it re-renders and 404s.

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { businessIdForUser, hasBusinessAdminGrant, isManagementMember } from './grants'

export interface BusinessAdmission { userId: string; email: string | null; businessId: string }

/** null = denied, for any reason. Kept apart from the notFound() call below so
 *  the catch-all can never swallow Next's own control-flow throw. */
async function admit(): Promise<BusinessAdmission | null> {
  // FIRST, before any read: production (or any unexpected environment) denies
  // outright, so a non-preview deployment never even queries for a session.
  const env = process.env.VERCEL_ENV
  if (env !== undefined && env !== 'preview') return null

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) return null
  const businessId = await businessIdForUser(user.id)
  if (!businessId) return null
  const [grant, management] = await Promise.all([
    hasBusinessAdminGrant(businessId),
    isManagementMember(user.id),
  ])
  if (!grant.granted) return null
  const isGrantee = grant.grantedBy != null && grant.grantedBy === user.id
  if (!isGrantee && !management) return null
  return { userId: user.id, email: user.email ?? null, businessId }
}

export async function requireBusinessAdmission(): Promise<BusinessAdmission> {
  const admitted = await admit().catch(() => null)
  if (!admitted) notFound()
  return admitted
}
