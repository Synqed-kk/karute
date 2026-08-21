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
    // Store contract is a real yyyy-mm-dd (Greptile P2: "tomorrow" reached the
    // store and silently broke burn↔appointment pairing).
    redeemedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'redeemedOn must be yyyy-mm-dd')
      .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00+09:00`).getTime()), {
        message: 'redeemedOn must be a real calendar date',
      })
      .optional(),
    // Present (incl. null) → accepted as-is; ABSENT → the server derives it.
    appointmentId: z.string().nullable().optional(),
    karuteRecordId: z.string().nullable().optional(),
    source: z.enum(['manual', 'backfill']).optional(),
    /** PR-B1: the crash-recovery banner's burn. Turns on the unbooked
     *  same-customer/same-day guard (D5) in the shared core. */
    recovery: z.boolean().optional(),
  })
  .strict()

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.pack.redeem', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  // The client's key, now FORWARDED to core's redemption dedup (#69) instead of
  // only being presence-checked: the phone mints one per user action and
  // re-sends it on every retry of that action — including facadeApiFetch's own
  // stranded-pin retry, which copies the headers — so a replayed burn replays
  // the stored row rather than spending a second session.
  const idempotencyKey = requireIdempotencyKey(ctx.req)
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
    recovery: parsed.data.recovery,
    idempotencyKey,
  })
  if (!result.ok) {
    // Over-redeem / double-burn guard (trg_pack_below_zero) → a conflict, not a
    // generic 502.
    if (result.error === 'below_zero') {
      throw new AppApiError('conflict', 'pack has no remaining sessions')
    }
    // B-9: an already-recorded burn is the guard SUCCEEDING (the DB's partial
    // unique index, or D5's customer-day check) — a conflict the client can
    // read as 消化済み, never an upstream failure it should retry.
    // The `reason` detail is the MACHINE-READABLE half (F-8): the phone port
    // branches on it, never on this message string, which a copy edit would
    // otherwise silently regress to a generic 失敗 toast.
    if (result.error === 'already_redeemed') {
      throw new AppApiError('conflict', 'this visit already has a redemption', {
        reason: 'already_redeemed',
      })
    }
    // F-3: the guard could not READ the history. Fail-closed (nothing burned),
    // but retryable and honestly labelled — the client must not certify the
    // answer or tell the staffer the ticket was used.
    if (result.error === 'guard_unavailable') {
      throw new AppApiError('upstream_unavailable', 'could not verify existing redemptions', {
        reason: 'guard_unavailable',
      })
    }
    throw new AppApiError('upstream_unavailable', result.error ?? 'redeem failed')
  }
  // C-2 (D7 on the phone): the recovery-resolved marker rides the handler's own
  // audit hook, which already emits customer.pack_redeem for this route. Same
  // seam karute outcome/entry-edits use — one bounded route key.
  if (parsed.data.recovery) ctx.auditDetail = { resolved_via: 'recovery' }
  return ok(ctx, { ok: true, redemptionId: result.redemptionId }, 201)
})

export const OPTIONS = POST
