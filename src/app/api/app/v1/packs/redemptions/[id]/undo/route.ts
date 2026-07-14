// Facade: UNDO a pack redemption (packet 08 §Smaller pre-rulings). The call site
// has ONLY the redemptionId (RecordPageView), so tenancy is proven from the
// redemption row → pack → business by the business-scoped client itself: a
// cross-tenant/missing redemptionId is not this business's row (→ not_found).
// Capability + semantics mirror the batch-3 redeem route (customers.view — the
// pack-mutation class; redeem and its undo must stay symmetric, and the
// dashboard reconcile surfaces that also call undoRedemptionAction are not
// records.write territory); Idempotency-Key required (effectful reversal);
// revocation-sensitive (customer.pack.undoRedemption). Already-undone → the web
// action's tolerant { ok:false } semantics.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { removeRedemptionWithClient } from '@/lib/packs/store'

export const runtime = 'nodejs'

type Params = { id: string }

export const POST = facadeHandler<Params>('customer.pack.undoRedemption', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  requireIdempotencyKey(ctx.req)

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'redemption id is required')
  const synqed = newSynqedClient(ctx.identity.businessId)

  try {
    const result = await removeRedemptionWithClient(synqed, id)
    return ok(ctx, { ok: result.ok })
  } catch (err) {
    // The business-scoped client rejecting a foreign/missing redemption is the
    // tenancy proof — a 404 → not_found; anything else → 502.
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status === 404) throw new AppApiError('not_found', 'redemption not found in this business')
    throw new AppApiError('upstream_unavailable', 'undo redemption failed')
  }
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
