// Facade: START the 30-day customer-deletion window (PHONEWIRE-2B). The phone
// arm's twin of the web scheduleCustomerDeletion action, sharing the SAME body
// (scheduleCustomerDeletionWithClient, src/actions/customers.ts) so the two
// doors cannot answer the same customer differently. ⚖ NO hard delete exists
// anywhere (Liam 2026-07-19): this sets core deleted_at and nothing more.
// Until now the phone's 削除 CTA hit a notWired stub and toasted a bare 失敗.
//
// GATE: 'records.delete' — the predicate the WEB action itself requires
// (owner/manager/senior), NOT the customers.view the consent siblings gate on.
// A destructive act does not inherit a viewing capability; the practitioner
// preset holds records.write and customers.view and must still be refused.
//
// ROSTER GATE (resolveSelfStaffId, the #452 fail-closed posture): a
// records.delete holder who is not on THIS business's roster is refused before
// any write — the hook's row attributes the act to ctx.identity.authUserId, a
// Bearer claim carrying no roster proof, and an audited destruction pinned on
// a non-member is a row nobody can act on later.
//   403, not the 502 its #813 sibling chose. That status was forced by a
//   CONSEQUENCE: that thin port reads 403 as the terminal refusal that deletes
//   the take. THIS port has no terminal branch — every non-2xx becomes the web
//   union's own { success: false, error: 'failed' }, a retryable toast with the
//   customer untouched — so the honest status wins, and null here IS settled:
//   staffListByBusinessOrThrow THROWS on a failed read, so null means the
//   roster answered. Same 403 the consent pair returns for the same predicate.
//
// NO Idempotency-Key — DESIGN RULING (packet PHONEWIRE-2B): an idempotent
// set-op with its own re-invocation guard (already_scheduled), the exact
// profile of the keyless customer.lifecycle.set sibling whose header states
// the rule. A replay cannot double-schedule or restart the clock.
//
// GUARD ANSWERS RIDE THE 2xx BODY, VERBATIM: 'already_scheduled' is a settled
// domain answer the client branches on, not a transport failure — the
// discard-transcript POST's contract with its own relay. Only an upstream
// failure ('failed') becomes an error status. A guarded 2xx is a write that
// DID NOT HAPPEN, so it sets ctx.auditSuppress (success-only audit law) —
// otherwise the hook files a privacy.customer_delete_scheduled row for a no-op.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { scheduleCustomerDeletionWithClient } from '@/actions/customers'
import { CustomerDeletionResultDTO } from '@/lib/app-api/customer-dto'
import {
  proveCustomerInBusiness,
  resolveSelfStaffId,
} from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

export const POST = facadeHandler<Params>('customer.deletion.schedule', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.delete')

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  const synqed = newSynqedClient(ctx.identity.businessId)

  // Tenancy FIRST → 404 before any write.
  await proveCustomerInBusiness(synqed, id)

  if (!(await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId))) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; deletion not scheduled')
  }

  const result = await scheduleCustomerDeletionWithClient(synqed, id)
  if (!result.success && result.error === 'failed') {
    throw new AppApiError('upstream_unavailable', 'scheduling the deletion failed')
  }
  if (!result.success) ctx.auditSuppress = result.error
  return ok(ctx, CustomerDeletionResultDTO.parse(result))
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
