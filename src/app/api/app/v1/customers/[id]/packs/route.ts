// Facade: create a 回数券 / subscription / single (packet 06 §Build 5). Money
// rules are SERVER-side and single-source (createPackActionWithClient): the
// single⇒packSize 1 clamp, server-derived 購入回数 + 合計金額. Idempotency-Key
// required (effectful POST; at-least-once). Capability: customers-class (the web
// createPackAction enforces login only).

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { createPackActionWithClient } from '@/actions/packs'
import {
  proveCustomerInBusiness,
  requireIdempotencyKey,
  resolveSelfStaffId,
} from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

// packSize>0, unitPrice>=0 and the single⇒packSize 1 money clamp enforced here
// for a clean 400 (the core keeps the same checks as its single-source guard).
const CreatePackSchema = z
  .object({
    kind: z.enum(['pack', 'subscription', 'single']),
    packSize: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
    totalPrice: z.number().nullable().optional(),
    purchaseRound: z.number().int().optional(),
    purchasedAt: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict()
  .refine((d) => d.kind !== 'single' || d.packSize === 1, {
    message: 'single kind must have packSize 1',
  })

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.pack.create', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  requireIdempotencyKey(ctx.req)
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)
  await proveCustomerInBusiness(synqed, id)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = CreatePackSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  // createdBy: the acting staff (null tolerated, mirroring the web action).
  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await createPackActionWithClient(synqed, staffId, { customerId: id, ...parsed.data })
  if (!result.ok) throw new AppApiError('upstream_unavailable', result.error ?? 'pack create failed')
  return ok(ctx, { ok: true }, 201)
})

export const OPTIONS = POST
