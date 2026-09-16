// Facade: GET /api/app/v1/customers/search?query= (P3 cross-branch search,
// ⚖ Liam 2026-09-16). Thin-bundle twin of src/actions/customers.ts's
// searchCustomersCompanyWide — same business-wide search + karute-number
// merge + honest 他店舗 labelling, over the Bearer identity instead of the
// cookie-bound one.
//
// Shipped ahead of any native wiring (packet P3's own allowance): the current
// thin booking/record pickers still read their customers off the PRELOADED
// store-lensed screens/appointments · screens/record DTOs, not a live query —
// pointing them at this route is a shell change, out of scope here. See
// BUILD-REPORT-P3.md's phone recon.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { newSynqedClient } from '@/lib/synqed/client'
import {
  CUSTOMER_SEARCH_LIMIT,
  matchKaruteNumber,
  foldKaruteNumberQuery,
} from '@/lib/customers/karute-number-match'

export const runtime = 'nodejs'

/** Strict query-string contract: one optional free-text search term (same
 *  shape as screens/customers's own `query` param). */
const QuerySchema = z.string().max(200)

export const GET = facadeHandler('customers.search', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const parsedQuery = QuerySchema.safeParse(
    new URL(ctx.req.url).searchParams.get('query') ?? '',
  )
  if (!parsedQuery.success) {
    throw new AppApiError('validation', 'query must be a string of at most 200 characters')
  }
  const q = parsedQuery.data.trim()
  if (!q) return ok(ctx, { options: [] })

  const synqed = newSynqedClient(ctx.identity.businessId)
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const enforceStore = clamp.allowedStoreIds != null

  // Lazy import (same reason as list-all.ts / actions/customers.ts): cached.ts
  // does a real (non-type) top-level import of @synqed-kk/client, a pure-ESM
  // package Jest can't parse from node_modules by default — keeps that out of
  // any test graph that doesn't explicitly mock it.
  const { getCachedCustomerListFor } = await import('@/lib/customers/cached')

  // Eligibility FIRST (Greptile fold): the business-wide cache scan is only
  // useful for a karute-number term, so an ordinary name search never pays
  // for loading it.
  const karuteQuery = foldKaruteNumberQuery(q)

  // "other_store" = not in the CALLER's own store-lensed cached list — same
  // definition as the web action, no core membership call. Each cache read
  // is settled on its own — a failure here degrades that one signal instead
  // of sinking searchRes, the direct result the whole request is for.
  const [searchRes, ownList, businessWide] = await Promise.all([
    synqed.customers.list({ search: q, page_size: CUSTOMER_SEARCH_LIMIT }),
    enforceStore && clamp.storeId
      ? getCachedCustomerListFor(ctx.identity.businessId, clamp.storeId).catch(() => null)
      : Promise.resolve(null),
    karuteQuery ? getCachedCustomerListFor(ctx.identity.businessId).catch(() => null) : Promise.resolve(null),
  ])
  const ownIds = ownList ? new Set(ownList.map((c) => c.id)) : null

  const rows = searchRes.customers.map((c) => ({
    id: c.id,
    name: c.name,
    furigana: c.furigana,
    phone: c.phone,
  }))
  // Karute number ahead of the name/phone matches, same as list-all.ts.
  const karuteHits = businessWide ? matchKaruteNumber(q, businessWide) : []
  const hitIds = new Set(karuteHits.map((h) => h.id))
  const merged = [
    ...karuteHits.map((h) => ({ id: h.id, name: h.name, furigana: h.furigana, phone: h.phone })),
    ...rows.filter((r) => !hitIds.has(r.id)),
  ]

  const options = merged
    .slice(0, CUSTOMER_SEARCH_LIMIT)
    .map((r) => ({ ...r, other_store: ownIds ? !ownIds.has(r.id) : false }))
  return ok(ctx, { options })
})

export const OPTIONS = GET
