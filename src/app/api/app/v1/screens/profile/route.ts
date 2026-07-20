// Profile screen facade GET (design-parity packet 12 §B-2). The Bearer-path
// twin of the web page's server-side assembly (src/app/[locale]/(app)/profile/
// page.tsx): the SELF staff row (keyed by the CONFIRMED auth-user id, never
// the first roster row) + org settings + the Bearer token's own email claim.
// NOT a live read: the claim is whatever was true when the token was minted
// (a same-session email change wouldn't show here until the next token
// refresh) — display-only, same as every other field on this DTO; no
// getUser() round-trip is spent on it.
//
// Standing recipe (#565/#566/#570/#571, mirrored from the dashboard/
// appointments routes): facadeHandler + ensureCapability + the store clamp
// BEFORE any read + a zod DTO in src/lib/app-api/. Profile data itself is
// store-agnostic (Layer-1 staff-private, no store-scoped reads) — the clamp
// still runs so a bogus store-id header is rejected 403 like every other
// screens route, not silently ignored.
//
// FAILURE CONTRACT: staff roster / org settings read failures → 502. NOT
// page parity — the web page's getStaffList() catches its own read error and
// degrades to [] (a facade read failing here does NOT mean the web page
// would have crashed too). This is the deliberate facade-family rule
// instead, same as every other screens/* route (dashboard/appointments/
// record/etc.): a load-bearing screen read that silently degraded to an
// empty/wrong roster would be a worse failure for a Bearer client with no
// user watching a partial page render — throw → classified 502.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ProfileScreenDTO } from '@/lib/app-api/profile-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { orgSettingsWithClient } from '@/actions/org-settings'

export const runtime = 'nodejs'

/** Mirrors the web page's local helper (src/app/[locale]/(app)/profile/
 *  page.tsx deriveInitials) byte-for-byte — same initials rule regardless of
 *  which identity source (cookie vs Bearer) produced the display name. */
function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const GET = facadeHandler('screens.profile', async (ctx: FacadeContext) => {
  // Screens-route class gate — same baseline every screens/* GET applies.
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Store clamp BEFORE any read — store_forbidden must reach the client as
  // 403, outside the 502 catch below. The resolved storeId itself is unused
  // below (this screen has no store-scoped data); the clamp's tenancy +
  // assignment checks are what matter here.
  await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  try {
    const [staffList, orgSettings] = await Promise.all([
      staffListByBusinessOrThrow(businessId),
      orgSettingsWithClient(synqed),
    ])

    // The caller's roster row — keyed by the CONFIRMED auth id, same as the
    // record/appointments routes (never the first row in the list).
    const selfRow = staffList.find((s) => s.id === ctx.identity.authUserId) ?? null

    const isOwner = (selfRow?.display_role ?? '').toLowerCase() === 'owner'
    const name = selfRow?.full_name ?? ctx.identity.email?.split('@')[0] ?? 'Unknown'
    const orgName = orgSettings?.salon_name ?? '—'

    return ok(
      ctx,
      ProfileScreenDTO.parse({
        name,
        initials: deriveInitials(name),
        email: ctx.identity.email ?? '—',
        role: isOwner ? 'owner' : 'staff',
        roleLabel: isOwner
          ? { ja: 'オーナー', en: 'Owner' }
          : { ja: 'スタッフ', en: 'Stylist' },
        storeName: { ja: orgName, en: orgName },
      }),
    )
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'profile screen data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
