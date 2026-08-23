// Facade: reassign a saved karute record to another customer (F4, packet
// PACKET-F4-REASSIGN-2026-09-02.md §2c). Structurally modeled on
// customer.photo.delete (capability → tenancy proof → the mutation → ok(ctx)),
// running the SAME reassignKaruteCustomerWithClient core the web action uses
// (src/actions/karute.ts) on the business-scoped Bearer client.
//
// TWO-PHASE, stateless: confirmed:false returns the honesty preview with NO
// write and ctx.auditSuppress = 'preview' (success-only audit pin ⚖ HELD —
// same suppress idiom as regenerate/route.ts's 'soft_failure'); confirmed:true
// performs the single-key core update and lets the facade's generic success
// hook auto-emit karute.customer_reassign, enriched via ctx.auditTargetId +
// ctx.auditDetail.

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { reassignKaruteCustomerWithClient } from '@/actions/karute'

export const runtime = 'nodejs'

type Params = { id: string }

const ReassignSchema = z.object({ to_customer_id: z.string().min(1), confirmed: z.boolean() }).strict()

export const POST = facadeHandler<Params>('karute.reassign', async (ctx: FacadeContext<Params>) => {
  ensureCapability(ctx.identity.capabilities, 'records.reassign')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = ReassignSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }
  const { to_customer_id: toCustomerId, confirmed } = parsed.data

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Same clamp rule as the web wrapper (menus.ts's storeScopeError shape),
  // resolved through the Bearer twin — resolveStoreForRequest already fails
  // closed (throws store_forbidden) on an unreadable assignment, so there is
  // no separate "degraded" arm to thread here.
  const { allowedStoreIds } = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: null,
  })

  const result = await reassignKaruteCustomerWithClient(
    synqed,
    id,
    toCustomerId,
    { confirmed },
    { viewAll: ctx.identity.capabilities.has('stores.viewAll'), allowedStoreIds, degraded: false },
  )

  if ('requiresConfirm' in result) {
    // No write happened — never a claimed action (success-only audit law).
    ctx.auditSuppress = 'preview'
    return ok(ctx, {
      requires_confirm: true,
      from_customer_id: result.fromCustomerId,
      from_name: result.fromName,
      to_name: result.toName,
      burn_count: result.burnCount,
      photo_count: result.photoCount,
    })
  }

  ctx.auditTargetId = id
  // R3-2 (fix round 3, Greptile issue 2 — REAL): audit detail key renamed
  // burn_count → same_day_burn_count (reassignFacts counts same-JST-day
  // redemptions, not every burn against this karute — see
  // src/lib/karute/reassign-facts.ts). The response body below keeps
  // burn_count — the UI contract is unchanged, only the audit receipt's key
  // renames to state exactly what it counted.
  ctx.auditDetail = {
    from_customer_id: result.fromCustomerId,
    to_customer_id: result.toCustomerId,
    same_day_burn_count: result.burnCount,
    photo_count: result.photoCount,
  }
  return ok(ctx, {
    ok: true,
    from_customer_id: result.fromCustomerId,
    to_customer_id: result.toCustomerId,
    burn_count: result.burnCount,
    photo_count: result.photoCount,
  })
})

export const OPTIONS = POST
