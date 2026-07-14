// Facade: READ recording consent (packet 08 §Smaller pre-rulings). Tenancy-proof
// FIRST (status-aware: cross-tenant/missing → 404, genuine upstream → 502 — the
// must-502 side). The THIN client maps ANY failure → consent-not-granted (a
// fail-closed button block, web-client parity) — both sides tested. Capability
// customers.view.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'

export const runtime = 'nodejs'

type Params = { id: string }

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const GET = facadeHandler<Params>('customer.consent.read', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)

  // Tenancy proof — cross-tenant/missing → 404, genuine upstream → 502.
  await readCustomerRaw(synqed, id)

  try {
    const { consent } = await synqed.customers.getConsent(id)
    return ok(ctx, { consent: consent ?? null })
  } catch {
    // Genuine upstream failure → 502 (the must-502 side). The client fails closed.
    throw new AppApiError('upstream_unavailable', 'consent read failed')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
