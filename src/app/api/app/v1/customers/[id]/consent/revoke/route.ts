// Facade: revoke recording consent (packet 06 §Build 4). Grant is NOT here
// (recording flow, batch 5). The #452 posture is enforced: an unresolvable
// acting-staff id FAILS CLOSED — never a write. Single-source: the write runs
// through revokeCustomerConsentWithClient (the web action calls the same core).
//
// Capability: the web action enforces login + a resolved staff id only (no
// requireCapability), so the facade gates at the customers-class capability
// (customers.view) — recorded as a deliberate discrepancy in the batch report.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { revokeCustomerConsentWithClient } from '@/actions/customers'
import {
  proveCustomerInBusiness,
  resolveSelfStaffId,
} from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

type Params = { id: string }

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

export const POST = facadeHandler<Params>('customer.consent.revoke', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)

  // Tenancy FIRST → 404 before any write.
  await proveCustomerInBusiness(synqed, id)

  // Fail closed: no acting staff id ⇒ no write (the #452 posture).
  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  if (!staffId) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; consent not revoked')
  }

  try {
    await revokeCustomerConsentWithClient(synqed, id, staffId)
  } catch {
    throw new AppApiError('upstream_unavailable', 'consent revoke failed')
  }
  return ok(ctx, { ok: true })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
