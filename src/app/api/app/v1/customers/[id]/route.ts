// Facade vertical slice (packet 03): customer-profile COARSE read + one MUTATION,
// end-to-end through the Bearer facade. This is the FIRST real endpoint the thin
// target's actions port calls — it proves the whole contract (identity seam,
// tenancy, DTO, error codes, CORS) on one screen. The other ~19 screens'
// endpoints INSTANTIATE this pattern in later Sonnet packets; they are NOT here.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { toCustomerProfileDTO } from '@/lib/app-api/customer-dto'
import { toCustomerProfileScreenDTO } from '@/lib/app-api/customer-profile-screen-dto'
import { newSynqedClient } from '@/lib/synqed/client'
import { updateCustomerWithClient } from '@/actions/customers'
import { isConsentCurrent } from '@/lib/consent'
import { getCustomerWithClient } from '@/lib/customers/queries'
import { getCustomerContactForBusiness } from '@/lib/customers/customer-detail-cached'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { listSynqedKaruteRowsOrThrow } from '@/lib/karute/synqed-records'
import { enrichCustomers } from '@/lib/customers/list-enrich'
import { getCustomerMemory } from '@/lib/karute/customer-memory'
import { getCachedPassportForBusiness } from '@/lib/karute/ai-passport'
import { orgSettingsWithClient } from '@/actions/org-settings'
import {
  getCustomerLifecycleCheckedWithClient,
  listCustomerPacksWithClient,
} from '@/lib/packs/store'
import { buildCustomerProfileScreen } from '@/lib/customers/profile-screen'

// Node runtime: the synqed SDK + node:crypto verifier are server-only.
export const runtime = 'nodejs'

type Params = { id: string }

async function customerId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'customer id is required')
  return id
}

/** locale query param — validated ja|en, default ja. The builder formats dates
 *  server-side EXACTLY as the web page does, so web and thin agree. */
function readLocale(ctx: FacadeContext<Params>): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

/** Read the customer (tenancy proven by the business-scoped client) + consent,
 *  in one Promise.all wave — mirroring the server page's coarse assembly.
 *  Used by PATCH (which returns the coarse DTO after a write). */
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

/** FULL profile-screen read (packet 06 §Build 2). The page's 12-read wave
 *  collapsed onto the business-scoped Bearer client, assembled by the SAME
 *  buildCustomerProfileScreen the web page renders from. Tenancy proven FIRST
 *  (getCustomerWithClient throws → not_found) OUTSIDE the 502 catch, so a
 *  cross-tenant id is 404 before ANY other read runs. FAILURE CONTRACT: the
 *  page's silent degrades on photos / consent / org-settings throw here → 502
 *  (never an empty-but-200 DTO); lifecycle keeps its checked-read semantics and
 *  packs stay page-parity graceful. */
async function readCustomerProfileScreen(businessId: string, id: string, locale: 'ja' | 'en') {
  const synqed = newSynqedClient(businessId)

  let customer: Awaited<ReturnType<typeof getCustomerWithClient>>
  try {
    customer = await getCustomerWithClient(synqed, id)
  } catch {
    throw new AppApiError('not_found', 'customer not found in this business')
  }

  try {
    // org-settings is read once (throwing per the failure contract); packs +
    // passport chain off it exactly as the page chains them off orgSettingsPromise.
    const orgSettingsPromise = orgSettingsWithClient(synqed)
    const [
      contact,
      staffList,
      photosResult,
      allCustomersList,
      synqedKaruteRows,
      enrichment,
      consentResult,
      memoryItemsRead,
      orgSettingsForPassport,
      lifecycleRead,
      packs,
      aiPassport,
    ] = await Promise.all([
      getCustomerContactForBusiness(businessId, id),
      staffListByBusinessOrThrow(businessId),
      // Throwing (page swallows to []): a photo-store outage is a 502.
      synqed.customers.listPhotos(id),
      listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      listSynqedKaruteRowsOrThrow(synqed, { customerId: id }),
      enrichCustomers(businessId, [id]),
      // Throwing (page swallows to null): a consent-read outage is a 502.
      synqed.customers.getConsent(id).then((r) => ({
        consent: (r?.consent ?? null) as {
          granted_at?: string | null
          policy_version?: string | null
        } | null,
      })),
      // Service-role, keyed by customer_id — safe post-tenancy-proof (a
      // cross-tenant id already 404'd above).
      getCustomerMemory(id),
      orgSettingsPromise,
      getCustomerLifecycleCheckedWithClient(synqed, id),
      orgSettingsPromise.then((s) =>
        (s?.ticket_packs_enabled ?? true)
          ? // Packs stay page-parity graceful (not on the must-throw list).
            listCustomerPacksWithClient(synqed, id).catch(() => [])
          : Promise.resolve([]),
      ),
      orgSettingsPromise.then((s) =>
        getCachedPassportForBusiness(id, s?.business_type ?? null),
      ),
    ])

    const screen = await buildCustomerProfileScreen({
      customer,
      id,
      businessId,
      locale,
      contact,
      staffList,
      photosResult,
      allCustomersList,
      synqedKaruteRows,
      enrichment,
      consentResult,
      memoryItemsRead,
      aiPassport,
      orgSettingsForPassport,
      lifecycleRead,
      packs,
    })
    return toCustomerProfileScreenDTO(customer, screen)
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'customer profile data unavailable')
  }
}

// GET — FULL profile-screen read. 'customer.read' is NOT revocation-sensitive
// (packet 01's set), so it takes the local Bearer fast-path.
export const GET = facadeHandler<Params>('customer.read', async (ctx) => {
  // Same gate as the customers-list + sessions screen routes — 'customers.view'
  // is "view customers + karute" in permissions.ts. First body statement so a
  // missing capability is a 403 before the tenancy proof or any read.
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const id = await customerId(ctx)
  const dto = await readCustomerProfileScreen(ctx.identity.businessId, id, readLocale(ctx))
  return ok(ctx, dto)
})

// PATCH — the mutation. Strict-schema validated in the SHARED service
// (updateCustomerWithClient) that the web action also calls, so the authz gap is
// closed at the root. Best-effort If-Match: if the caller sends one, it must
// match the current version (updatedAt) or the write is refused as a conflict.
// TOCTOU window is documented at-least-once (true CAS is a core-side ask, Anthony).
export const PATCH = facadeHandler<Params>('customer.update', async (ctx) => {
  // Same customers-class gate as every batch-3 write (review F4): PII edits
  // must never be reachable on a capability-less custom role.
  ensureCapability(ctx.identity.capabilities, 'customers.view')
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
