// Facade: UNDO a scheduled customer deletion inside the 30-day window
// (PHONEWIRE-2B) — the schedule sibling's twin, one directory over, sharing
// the web action's body (cancelCustomerDeletionWithClient). Until now the
// banner's 元に戻す threw: the take-back for a destructive act was web-only.
//
// EVERY ruling in the schedule route's header applies here unchanged — the
// 'records.delete' gate, the roster gate and its 403, no Idempotency-Key,
// guard answers riding the 2xx body with ctx.auditSuppress, 'failed' leaving
// as a 502. Read that file; it is not repeated here so the two cannot drift
// into two stories. This door's guards are not_scheduled / window_expired, and
// 'window_expired' is a REFUSAL, not a failure: past the deadline the sweep
// may already be at work, and an undo that "succeeded" seconds before it would
// lie to the staffer.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { cancelCustomerDeletionWithClient } from '@/actions/customers'
import { CustomerDeletionResultDTO } from '@/lib/app-api/customer-dto'
import {
  proveCustomerInBusiness,
  resolveSelfStaffId,
} from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

export const POST = facadeHandler<Params>('customer.deletion.cancel', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.delete')

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  const synqed = newSynqedClient(ctx.identity.businessId)

  // Tenancy FIRST → 404 before any write.
  await proveCustomerInBusiness(synqed, id)

  if (!(await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId))) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; deletion not canceled')
  }

  const result = await cancelCustomerDeletionWithClient(synqed, id)
  if (!result.success && result.error === 'failed') {
    throw new AppApiError('upstream_unavailable', 'canceling the deletion failed')
  }
  if (!result.success) ctx.auditSuppress = result.error
  return ok(ctx, CustomerDeletionResultDTO.parse(result))
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
