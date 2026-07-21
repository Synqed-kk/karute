// Facade: live plan entitlement read (design-parity packet 12 §B-3 S2).
// Single-source: calls the SAME loadEntitlementWithClient twin the web
// getEntitlement() action delegates to (src/lib/entitlements.ts).
//
// Gate: 'stores.viewAll' — same deliberate least-privilege divergence as the
// stores GET route (a NEW callable Bearer surface; its only consumer is the
// viewAll-gated 店舗 tab's plan/add-store gating — S1 voice_enrollments
// precedent). loadEntitlementWithClient is fully tolerant (never throws — a
// degraded read still resolves an Entitlement with `degraded: true`), so no
// try/catch is needed around it here.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { loadEntitlementWithClient } from '@/lib/entitlements'
import { EntitlementSchema } from '@/lib/app-api/settings-screen-dto'

export const runtime = 'nodejs'

export const GET = facadeHandler('entitlement.read', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'stores.viewAll')
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const entitlement = await loadEntitlementWithClient(synqed, businessId)
  return ok(ctx, z.object({ entitlement: EntitlementSchema }).parse({ entitlement }))
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
