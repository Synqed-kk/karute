// Facade: set a customer's 卒業/離客/口コミ lifecycle (packet 06 §Build 5).
// Single source: setLifecycleActionWithClient. Capability: customers-class (the
// web setLifecycleAction enforces login only). No Idempotency-Key (idempotent
// set, not an effectful create/redeem).

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { setLifecycleActionWithClient } from '@/actions/packs'
import {
  proveCustomerInBusiness,
  resolveSelfStaffId,
} from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

const LifecycleSchema = z
  .object({
    status: z.enum(['active', 'graduated', 'lost']),
    referral: z.boolean(),
  })
  .strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.lifecycle.set', async (ctx) => {
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
  const parsed = LifecycleSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await setLifecycleActionWithClient(synqed, staffId, { customerId: id, ...parsed.data })
  if (!result.ok) throw new AppApiError('upstream_unavailable', 'lifecycle set failed')
  return ok(ctx, { ok: true })
})

export const OPTIONS = POST
