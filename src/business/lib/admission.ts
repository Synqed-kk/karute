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
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { businessIdForUser, hasBusinessAdminGrant, isManagementMember } from './grants'
import { recordBusinessAdmissionFailure } from './admission-failure-record'

// ⚖ 9/30 black box lane — a denial that is NOT a plain "no session" leaves ONE
// server-side record (never user text: the answer stays the bare 404), written
// by the one writer in ./admission-failure-record (it records a read failure,
// never a verdict, and never throws).

export interface BusinessAdmission {
  userId: string
  email: string | null
  /** ⚖ R53 — the person's own name for the shell card: auth user_metadata.full_name,
   *  which the invite-accept flow writes (src/actions/invites.ts createUser). Off the
   *  SAME getUser() read; null when absent or blank (the card then shows the e-mail). */
  displayName: string | null
  businessId: string
}

/** null = denied, for any reason. Kept apart from the notFound() call below so
 *  the catch-all can never swallow Next's own control-flow throw. */
async function admit(): Promise<BusinessAdmission | null> {
  // FIRST, before any read: production (or any unexpected environment) denies
  // outright, so a non-preview deployment never even queries for a session.
  const env = process.env.VERCEL_ENV
  if (env !== undefined && env !== 'preview') return null

  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  // Missing = no user and either no error or the SDK's own AuthSessionMissingError
  // (@supabase/auth-js 2.99.1 src/lib/errors.ts:120 — what getUser returns for a
  // signed-out request, GoTrueClient.ts _getUser) → null, no record, as today.
  // Any OTHER auth error (an invalid token, an outage, a rate limit) → null as
  // today, but with a record first, so an outage is no longer silent.
  if (error) {
    const e = error as { name?: unknown; status?: unknown; message?: unknown }
    if (e.name !== 'AuthSessionMissingError') {
      recordBusinessAdmissionFailure('auth-error', { where: 'getUser', status: e.status, message: e.message })
    }
    return null
  }
  if (!user) return null
  const businessId = await businessIdForUser(user.id)
  if (!businessId) return null
  const [grant, management] = await Promise.all([
    hasBusinessAdminGrant(businessId),
    isManagementMember(user.id),
  ])
  if (!grant.granted) return null
  const isGrantee = grant.grantedBy != null && grant.grantedBy === user.id
  if (!isGrantee && !management) return null
  const fullName: unknown = user.user_metadata?.full_name
  const displayName = typeof fullName === 'string' && fullName.trim() !== '' ? fullName.trim() : null
  return { userId: user.id, email: user.email ?? null, displayName, businessId }
}

// ONE admission per request (⚖ S5 fix round, F2 + C4): React cache() memoises
// it for the render, so generateMetadata, the layout and the page share one
// auth round-trip. Outside a render (route handlers, jest) there is no cache
// dispatcher and cache() calls the function directly — uncached, as before.
export const requireBusinessAdmission = cache(async (): Promise<BusinessAdmission> => {
  const admitted = await admit().catch((e: unknown) => {
    recordBusinessAdmissionFailure('threw', { where: 'admit', message: e })
    return null
  })
  if (!admitted) notFound()
  return admitted
})

/** ⚖ R53 — ends this browser's session (the Business shell's ログアウト). Here because this
 *  file is one of the two the play-phase fence lets hold a supabase client; the route
 *  (api/business/sign-out) only calls it. Scope 'local': this device only, never the phone's session (S41 X2).
 *  No admission read — signing out needs none. false = the sign-out did not complete. */
export async function endSession(): Promise<boolean> {
  try {
    const supabase = await createClient()
    // ⚖ S41 X2 (lead) — THIS device only. The default (global) scope also revoked the phone's session.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    return !error
  } catch {
    return false
  }
}
