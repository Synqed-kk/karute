// Facade vertical slice (packet 03): customer-profile COARSE read + one MUTATION,
// end-to-end through the Bearer facade. This is the FIRST real endpoint the thin
// target's actions port calls — it proves the whole contract (identity seam,
// tenancy, DTO, error codes, CORS) on one screen. The other ~19 screens'
// endpoints INSTANTIATE this pattern in later Sonnet packets; they are NOT here.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { toCustomerProfileDTO } from '@/lib/app-api/customer-dto'
import { newSynqedClient } from '@/lib/synqed/client'
import { updateCustomerWithClient } from '@/actions/customers'
import { isConsentCurrent } from '@/lib/consent'

// Node runtime: the synqed SDK + node:crypto verifier are server-only.
export const runtime = 'nodejs'

type Params = { id: string }

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

/** Read the customer (tenancy proven by the business-scoped client) + consent,
 *  in one Promise.all wave — mirroring the server page's coarse assembly. */
async function readCustomer(businessId: string, id: string) {
  const synqed = newSynqedClient(businessId)
  let customer: Awaited<ReturnType<typeof synqed.customers.get>>
  try {
    customer = await synqed.customers.get(id)
  } catch {
    // Business-scoped client → a customer in ANOTHER tenant reads as not-found.
    throw new AppApiError('not_found', 'customer not found in this business')
  }
  const consentResult = await synqed.customers.getConsent(id).catch(() => null)
  const consentGranted = isConsentCurrent(consentResult?.consent as { policy_version?: string | null } | null)
  return toCustomerProfileDTO(customer as never, consentGranted)
}

// GET — coarse profile read. 'customer.read' is NOT revocation-sensitive
// (packet 01's set), so it takes the local Bearer fast-path.
export const GET = facadeHandler<Params>('customer.read', async (ctx) => {
  const id = await customerId(ctx)
  const dto = await readCustomer(ctx.identity.businessId, id)
  return ok(ctx, dto)
})

// PATCH — the mutation. Strict-schema validated in the SHARED service
// (updateCustomerWithClient) that the web action also calls, so the authz gap is
// closed at the root. Best-effort If-Match: if the caller sends one, it must
// match the current version (updatedAt) or the write is refused as a conflict.
// TOCTOU window is documented at-least-once (true CAS is a core-side ask, Anthony).
export const PATCH = facadeHandler<Params>('customer.update', async (ctx) => {
  const id = await customerId(ctx)
  const synqed = newSynqedClient(ctx.identity.businessId)

  const ifMatch = ctx.req.headers.get('if-match')
  if (ifMatch) {
    let current: Awaited<ReturnType<typeof synqed.customers.get>>
    try {
      current = await synqed.customers.get(id)
    } catch {
      throw new AppApiError('not_found', 'customer not found in this business')
    }
    if (current.updated_at !== ifMatch) {
      throw new AppApiError('conflict', 'customer was modified; refetch and retry', {
        currentVersion: current.updated_at,
      })
    }
  }

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }

  const result = await updateCustomerWithClient(synqed, id, body as Record<string, unknown>)
  if (!result.success) {
    throw new AppApiError('validation', result.error)
  }
  const dto = await readCustomer(ctx.identity.businessId, id)
  return ok(ctx, dto)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
