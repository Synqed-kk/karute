// Facade: GRANT recording consent (packet 08 §Smaller pre-rulings). Single-
// source: the write runs through grantCustomerConsentWithClient (the web action
// calls the same core). policy_version is SERVER-pinned in the core (never
// client-supplied); method is a closed enum. The #452 posture: an unresolvable
// acting-staff id FAILS CLOSED (403 — never a write). Capability customers.view
// (the batch-3-style WIDENING — a capability-less identity must not write consent
// rows). Effectful write → Idempotency-Key + revocation-sensitive (customer.consent.grant).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { grantCustomerConsentWithClient } from '@/actions/customers'
import {
  proveCustomerInBusiness,
  requireIdempotencyKey,
  resolveSelfStaffId,
} from '@/lib/app-api/customer-facade'
import { ConsentGrantSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

type Params = { id: string }

export const POST = facadeHandler<Params>('customer.consent.grant', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  requireIdempotencyKey(ctx.req)

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  const synqed = newSynqedClient(ctx.identity.businessId)

  // Tenancy FIRST → 404 before any write.
  await proveCustomerInBusiness(synqed, id)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = ConsentGrantSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  // Fail closed: no acting staff id ⇒ no write (the #452 posture, grant-side).
  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  if (!staffId) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; consent not granted')
  }

  try {
    const consent = await grantCustomerConsentWithClient(synqed, id, staffId, parsed.data.method)
    return ok(ctx, { ok: true, consent })
  } catch {
    throw new AppApiError('upstream_unavailable', 'consent grant failed')
  }
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
