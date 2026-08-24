// Facade: カルテ tab search-reveal (PR-1b 検索リビール, packet karute-tab
// restructure). Web twin of src/actions/karute.ts's revealNoKaruteCustomer —
// same store-scoping rules, mirrored via resolveStoreForRequest ('store-id'
// header, fail-closed) instead of the cookie-bound resolveStoreScope. The
// zero-karute check is ALWAYS store-scoped (never enrichment(), which is
// business-wide by declaration). Read-only → 'skip' in FACADE_AUDIT_MAP
// (list render ≠ a view, same wayfinding rule as customers.list /
// reassign-options).

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { newSynqedClient } from '@/lib/synqed/client'

export const runtime = 'nodejs'

/** Strict query-string contract: one optional free-text search term (same
 *  shape as screens/customers's own `query` param). */
const QuerySchema = z.string().max(200)

export const GET = facadeHandler('karute.reveal', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const parsedQuery = QuerySchema.safeParse(
    new URL(ctx.req.url).searchParams.get('q') ?? '',
  )
  if (!parsedQuery.success) {
    throw new AppApiError('validation', 'q must be a string of at most 200 characters')
  }
  const q = parsedQuery.data.trim()
  if (!q) return ok(ctx, { candidate: null })

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Store clamp BEFORE any data read — its store_forbidden throws must reach
  // the client as 403, same convention as every other facade read.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const enforceStore = clamp.allowedStoreIds != null
  // Defensive, mirrors the web action's own backstop: a clamp with no
  // resolvable store must never fall through to an unscoped search.
  if (enforceStore && !clamp.storeId) return ok(ctx, { candidate: null })

  const res = await synqed.customers.list({
    search: q,
    store_id: enforceStore ? (clamp.storeId ?? undefined) : undefined,
    page_size: 5,
  })
  for (const c of res.customers) {
    const karute = await synqed.karuteRecords.list({
      customer_id: c.id,
      store_id: clamp.storeId ?? undefined,
      page_size: 1,
    })
    if ((karute.total ?? 0) === 0) {
      const code =
        typeof c.karute_number === 'number' && c.karute_number > 0
          ? `#${String(c.karute_number).padStart(5, '0')}`
          : '#00000'
      return ok(ctx, {
        candidate: { id: c.id, name: c.name, code, registeredDate: c.created_at },
      })
    }
  }
  return ok(ctx, { candidate: null })
})

export const OPTIONS = GET
