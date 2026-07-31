// Facade: burnable-pack summary for the cancel sheet's burn toggles (design-
// parity P-B 2/2). Read-only twin of the web getBurnablePackSummary: the SAME
// FIFO target the burn itself uses (pickRedemptionTarget over the customer's
// packs), gated by bookings.manage like every booking mutation helper — pack
// balances are customer data and must not be probeable without the
// capability. Returns { summary: { packId, remaining } | null }; a foreign
// customer id lists no packs on the business-scoped client → null (no
// tenancy oracle either way, mirroring the web action).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { listCustomerPacksWithClient } from '@/lib/packs/store'
import { pickRedemptionTarget } from '@/lib/packs/resolve'

export const runtime = 'nodejs'

type Params = { id: string }

export const GET = facadeHandler<Params>('customer.pack.burnable', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'bookings.manage')

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  try {
    const target = pickRedemptionTarget(await listCustomerPacksWithClient(synqed, id))
    return ok(ctx, {
      summary: target ? { packId: target.id, remaining: target.remaining } : null,
    })
  } catch {
    // Transient read failure → null, same as the web action's catch: the
    // sheet just doesn't offer the burn toggle; the burn path re-checks.
    return ok(ctx, { summary: null })
  }
})

export const OPTIONS = GET
