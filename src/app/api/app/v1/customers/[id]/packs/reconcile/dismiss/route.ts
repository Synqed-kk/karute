// Facade: 来店なし answer for a flagged 未処理来店 (design-parity Gap B-1 PR
// 2). ANY staff (no capability gate beyond baseline customers.view — unlike
// the alert-dismiss route below, correcting a record is not the
// manager-gated "give up", web parity). RPC-style response:
// dismissVisitReconcileActionWithClient's { ok } rides the 200 body VERBATIM
// (ReconcileStrip branches on it directly, same class as the appointments
// mutations). No Idempotency-Key: a dismissal is an idempotent set, not an
// effectful create/redeem — a retried dismiss just re-writes the same row,
// harmless (parity with the lifecycle-set route; web sends none either).

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { dismissVisitReconcileActionWithClient } from '@/actions/packs'
import { proveCustomerInBusiness, resolveSelfStaffId } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

const DismissReconcileSchema = z
  .object({
    appointmentId: z.string().nullable().optional(),
    // Store contract is a real yyyy-mm-dd (same rule the redeem route's
    // redeemedOn enforces).
    visitDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'visitDay must be yyyy-mm-dd'),
  })
  .strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.pack.reconcile.dismiss', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveCustomerInBusiness(synqed, id)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = DismissReconcileSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await dismissVisitReconcileActionWithClient(synqed, staffId, {
    customerId: id, // PATH id — never the client's
    appointmentId: parsed.data.appointmentId,
    visitDay: parsed.data.visitDay,
  })
  return ok(ctx, result)
})

export const OPTIONS = POST
