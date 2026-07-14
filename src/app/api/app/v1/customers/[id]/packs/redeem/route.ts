// Facade: redeem (burn) one session off a pack (packet 06 §Build 5). Burn
// pairing is SERVER-enforced: the customerId is the PATH id (never client-
// supplied), and when appointmentId is omitted the core derives the customer's
// booking for the day (findCustomerAppointmentForDateWithClient) — never client-
// derived. Pack tenancy is proven (packId must be one of THIS customer's packs)
// before any write. The over-redeem / double-burn guard maps to 409. Single
// source: redeemSessionActionWithClient. Idempotency-Key required.

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { redeemSessionActionWithClient } from '@/actions/packs'
import {
  proveCustomerInBusiness,
  provePackForCustomer,
  requireIdempotencyKey,
  resolveSelfStaffId,
} from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

const RedeemSchema = z
  .object({
    packId: z.string().min(1),
    redeemedOn: z.string().optional(),
    // Present (incl. null) → accepted as-is; ABSENT → the server derives it.
    appointmentId: z.string().nullable().optional(),
    karuteRecordId: z.string().nullable().optional(),
    source: z.enum(['manual', 'backfill']).optional(),
  })
  .strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.pack.redeem', async (ctx) => {
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
  const parsed = RedeemSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  // Pack tenancy: the packId must belong to THIS customer (in this business).
  await provePackForCustomer(synqed, id, parsed.data.packId)

  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await redeemSessionActionWithClient(synqed, staffId, {
    packId: parsed.data.packId,
    customerId: id, // PATH id — never the client's
    redeemedOn: parsed.data.redeemedOn,
    // Only forward appointmentId when the client SENT it (incl. null); omitting
    // the key lets the core derive the pairing server-side.
    ...('appointmentId' in parsed.data ? { appointmentId: parsed.data.appointmentId } : {}),
    karuteRecordId: parsed.data.karuteRecordId ?? null,
    source: parsed.data.source,
  })
  if (!result.ok) {
    // Over-redeem / double-burn guard (trg_pack_below_zero) → a conflict, not a
    // generic 502.
    if (result.error === 'below_zero') {
      throw new AppApiError('conflict', 'pack has no remaining sessions')
    }
    throw new AppApiError('upstream_unavailable', result.error ?? 'redeem failed')
  }
  return ok(ctx, { ok: true, redemptionId: result.redemptionId }, 201)
})

export const OPTIONS = POST
