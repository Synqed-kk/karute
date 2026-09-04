// Facade: 新規顧客 create — the phone arm's twin of the web createCustomer()
// action. Single-source: calls the SAME shared body that action delegates to
// (createCustomerWithClient, src/actions/customers.ts) — the P-B pattern the
// 破棄の記録 pair standardizes, so phone and web cannot drift into different
// creates. The collection had `[id]/*` subroutes but no create door at all,
// which is why the thin port's createCustomer was a notWired stub.
//
// Gate: 'customers.view' — the SAME predicate the sibling PATCH
// (customers/[id]) and the customers-list screen enforce. A DELIBERATE
// least-privilege divergence from the web action, which is ungated: this is a
// NEW callable Bearer surface (web never exposed a customer-create endpoint
// over HTTP), and the PATCH route's own ruling — PII edits must never be
// reachable on a capability-less custom role — applies at least as hard to a
// create. Same facade-may-gate-tighter precedent as stores.list.
//
// Idempotency-Key required: a durable create, exactly like staff.create /
// invite.create / stores.create / customer.pack.create. A retried POST on a
// flaky phone connection must not mint a second 顧客.
//
// ⚖ STORE ISOLATION LAW: the client is built from the BEARER-resolved business
// and nothing else, and the shared body reads no store — identical scoping to
// web. Neither a body key nor a header can widen it: the shared body parses
// with a z.object AND builds core's payload from an explicit field list, so
// business_id/store_id/visit_count never reach core (pinned in
// app-api-customer-create.test.ts; see that body's own note for which of the
// two guards is load-bearing).
//
// audit: 'customer.create' is a LIVE FACADE_AUDIT_MAP mutation row (the same
// shape as 'customer.update') — the shared body is audit-free and the web
// wrapper owns the web emit, so the generic hook is the facade's one writer.
// The collection POST has no path param, so the row's target comes from
// ctx.auditTargetId — the id core just returned.
//
// revocation: 'customer.create' is a facade WRITE and is registered in
// REVOCATION_SENSITIVE_ENDPOINTS (app-api-revocation-coverage.test.ts fails
// on any write key that isn't).

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { createCustomerWithClient } from '@/actions/customers'

export const runtime = 'nodejs'

/** The wire shape, parsed at the door — the audit-log/破棄の記録 convention: a
 *  rename inside the shared body would otherwise reach a baked phone silently.
 *  Deliberately NOT inside a try/catch: a shape drift here is OUR bug (500),
 *  never an upstream outage (502). */
const CustomerCreatedDTO = z.object({
  id: z.string(),
  duplicateWarning: z.string().optional(),
})

export const POST = facadeHandler('customer.create', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  const result = await createCustomerWithClient(synqed, body)
  if (!result.success) {
    // The PATCH sibling's own mapping. KNOWN CONFLATION, recorded rather than
    // hidden: the shared body answers one { success:false } union for a zod
    // rejection AND for a core write failure it already translated, so a
    // core outage reaches the phone as 400 with a translated message instead
    // of 502. Splitting them is a change to the SHARED contract (both doors),
    // not a facade detail — it belongs with the action, not here.
    throw new AppApiError('validation', result.error)
  }

  ctx.auditTargetId = result.id
  return ok(ctx, CustomerCreatedDTO.parse(result), 201)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
