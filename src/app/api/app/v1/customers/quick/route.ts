// Facade: 顧客のかんたん作成 (name only) — the phone arm's twin of the web
// createQuickCustomer() action, reached from the booking dialog's and
// NewKaruteDialog's customer picker. Single-source: the SAME shared body that
// action delegates to (createQuickCustomerWithClient, src/actions/customers.ts).
//
// WHY ITS OWN DOOR rather than a flag on the collection POST next door: the two
// web actions are two different bodies — quick-create runs no duplicate check
// and echoes core's stored name back so the picker can select the new customer.
// One endpoint serving both would have to pick one of those behaviours, and
// whichever it picked, one of the two web doors would drift from it. Static
// segment beside `[id]`, the same shape /karute/reveal already ships next to
// /karute/[id] — customer ids are uuids, so nothing is shadowed in practice.
//
// Gate, Idempotency-Key, store isolation, audit and revocation: identical to
// the collection POST (see ../route.ts for each ruling). The audit action is
// 'customer.create' on BOTH — quick-create is the same create pathway under one
// action name (packet 30 §2), which is exactly what the web wrapper emits.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { createQuickCustomerWithClient } from '@/actions/customers'

export const runtime = 'nodejs'

/** Request shape — name only, by design. Parsed HERE (not in the shared body,
 *  whose own guard takes a plain string) so a wrong-typed `name` is a 400 at
 *  the trust boundary rather than a String(undefined) reaching core. */
const QuickCreateRequestDTO = z.object({ name: z.string() })

/** Response shape — pinned for the same reason as the collection POST's, and
 *  deliberately outside any catch (shape drift = our 500, not a 502). */
const QuickCustomerCreatedDTO = z.object({ id: z.string(), name: z.string() })

export const POST = facadeHandler('customer.quickCreate', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = QuickCreateRequestDTO.safeParse(body)
  if (!parsed.success) throw new AppApiError('validation', 'name is required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  const result = await createQuickCustomerWithClient(synqed, parsed.data.name)
  // Same known conflation as the collection POST's mapping — see its comment.
  if (!result.success) throw new AppApiError('validation', result.error)

  ctx.auditTargetId = result.id
  return ok(ctx, QuickCustomerCreatedDTO.parse(result), 201)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
