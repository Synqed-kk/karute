// Facade: dismiss a customer's 要連絡 pack alert (design-parity Gap B-1 PR
// 2). MANAGER+ ONLY (Kitano's rule: staff show the manager they contacted
// the customer; the manager silences the alert) — capability = alerts.manage
// (web parity: dismissPackAlertAction's requireCapability). A missing
// capability is a real 403 here (the standard facade gate, ensureCapability),
// NOT the web action's tolerant { ok:false, error:'forbidden' } 2xx body —
// deliberate deviation: every other facade route in this codebase treats a
// missing capability as an HTTP-level 403, and PackAlertsCard's forbidden
// branch is unreachable in the shell anyway (canDismissAlerts already hides
// the button for non-managers). RPC-style response otherwise:
// dismissPackAlertActionWithClient's { ok, error? } rides the 200 body
// VERBATIM. No Idempotency-Key: idempotent dismiss, not an effectful
// create/redeem (parity with lifecycle-set / reconcile-dismiss).

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { dismissPackAlertActionWithClient } from '@/actions/packs'
import { proveCustomerInBusiness, resolveSelfStaffId } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

const DismissAlertSchema = z.object({ reason: z.string().optional() }).strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.pack.alert.dismiss', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'alerts.manage')
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveCustomerInBusiness(synqed, id)

  // Body is optional (a plain dismiss sends none) — absent parses as {}.
  const raw = await ctx.req.text()
  let body: unknown = {}
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new AppApiError('validation', 'request body must be JSON')
    }
  }
  const parsed = DismissAlertSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await dismissPackAlertActionWithClient(synqed, staffId, {
    customerId: id, // PATH id — never the client's
    reason: parsed.data.reason,
  })
  return ok(ctx, result)
})

export const OPTIONS = POST
