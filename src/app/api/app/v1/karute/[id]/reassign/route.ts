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
import { resolveWriteStoreScope } from '@/lib/app-api/store-clamp'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
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
  // resolved through the Bearer twin — the SAME resolveWriteStoreScope every
  // other facade write door uses (outcome / summary / entries / cancel / no-show
  // / restore / discard / autostart). It fails closed twice over: on an
  // unreadable assignment, and (⚖ fold round 2, FRESH-EYES-P1 N1) on a caller
  // the ROSTER CANNOT PLACE — core answers `{ store_ids: [] }` for an auth id it
  // holds no staff row for, so calling resolveStoreForRequest directly read such
  // a caller as floating and let them re-point ANY karute in the business. No
  // separate "degraded" arm to thread: the refusal throws before a scope exists.
  // See resolveWriteStoreScope's own header (store-clamp.ts) for exactly which
  // callers that fence does and does not catch — ⚖ FRESH-EYES-P1B F3.
  const { allowedStoreIds } = await resolveWriteStoreScope({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    selfStaffId: await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId),
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
      linked_burn_count: result.linkedBurnCount,
      same_day_burn_count: result.sameDayBurnCount,
      photo_count: result.photoCount,
    })
  }

  ctx.auditTargetId = id
  // R3-2 (fix round 3): audit detail key renamed burn_count →
  // same_day_burn_count (reassignFacts counts same-JST-day redemptions, not
  // every burn against this karute).
  // R11-1 (fix round 11, Greptile round-6 closure): split further into
  // linked_burn_count (provable) + same_day_burn_count (presence-only) —
  // both the audit detail AND the response body now carry both counts, since
  // the confirm panel needs to render the right copy per bucket (packet
  // R11-2). See src/lib/karute/reassign-facts.ts's header comment.
  ctx.auditDetail = {
    from_customer_id: result.fromCustomerId,
    to_customer_id: result.toCustomerId,
    linked_burn_count: result.linkedBurnCount,
    same_day_burn_count: result.sameDayBurnCount,
    photo_count: result.photoCount,
  }
  return ok(ctx, {
    ok: true,
    from_customer_id: result.fromCustomerId,
    to_customer_id: result.toCustomerId,
    linked_burn_count: result.linkedBurnCount,
    same_day_burn_count: result.sameDayBurnCount,
    photo_count: result.photoCount,
  })
})

export const OPTIONS = POST
