// Welcome screen facade GET (design-parity packet 21). The Bearer-path twin
// of the web page's server-side assembly (src/app/[locale]/(app)/welcome/
// page.tsx): 3 prefill fields off getOrgSettings(), threaded onto
// orgSettingsWithClient's Bearer-scoped read instead of the cookie session.
//
// Standing recipe (mirrors screens/profile/route.ts): facadeHandler +
// ensureCapability + a zod DTO in src/lib/app-api/. NO store clamp here
// (unlike screens/profile, screens/settings) — /welcome is the FIRST screen
// a brand-new salon hits, before any store/staff-assignment exists to clamp
// against; org settings is business-wide, not store-scoped, so there is
// nothing the clamp would gate.
//
// ensureCapability('customers.view') is the facade screens floor
// (screens.profile:49 precedent). Web's getOrgSettings() is auth-only (no
// capability check) — STATED DIVERGENCE, same family rule as every other
// screens/* route requiring a capability the web page itself doesn't check.
//
// FAILURE CONTRACT: an org-settings read failure PROPAGATES → classified 502
// (packet 06 family contract). NOT page parity — the web page's
// getOrgSettings() catches its own read error and degrades to null (a facade
// read failing here does NOT mean the web page would have crashed too), same
// deliberate facade-family rule as screens/settings.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { WelcomeScreenDTO } from '@/lib/app-api/welcome-screen-dto'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { orgSettingsWithClient } from '@/actions/org-settings'

export const runtime = 'nodejs'

export const GET = facadeHandler('screens.welcome', async (ctx: FacadeContext) => {
  // Screens-route class gate — same baseline every screens/* GET applies.
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  try {
    const s = await orgSettingsWithClient(newSynqedClient(ctx.identity.businessId))

    // Mirrors page.tsx's derivation byte-for-byte.
    return ok(
      ctx,
      WelcomeScreenDTO.parse({
        salon_name: s?.salon_name ?? '',
        business_type: s?.business_type ?? '',
        recording_disclosure_mode: s?.recording_disclosure_mode ?? null,
      }),
    )
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'welcome screen data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
