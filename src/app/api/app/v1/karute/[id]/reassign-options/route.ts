// Facade: the reassign picker's customer roster (F4 packet §2g phone path).
// STORE-SCOPED — never the business-wide list: a clamped actor gets the
// SAME scoped set the store-isolation law gives every other picker (hide,
// never filter-after-ship). Current customer excluded server-side. Read-only
// list → 'skip' in FACADE_AUDIT_MAP (list render ≠ a view, same wayfinding
// rule as customers.list).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { listAllCustomers } from '@/lib/customers/list-all'

export const runtime = 'nodejs'

type Params = { id: string }

export const GET = facadeHandler<Params>('karute.reassignOptions', async (ctx: FacadeContext<Params>) => {
  ensureCapability(ctx.identity.capabilities, 'records.reassign')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  const record = await readKaruteRaw(synqed, id)

  const { storeId, allowedStoreIds } = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: null,
  })

  // R3-1 (fix round 3, Greptile issue 1 — REAL): same source-store refusal
  // as src/actions/karute.ts's ensureReassignStoreScope/
  // sourceStoreOutOfScope, run here before any roster is built — a clamped
  // actor must not reach a picker for a karute record that itself sits
  // outside their assignment. allowedStoreIds === null covers BOTH viewAll
  // and a floating actor (resolveStoreForRequest's own convention) —
  // unclamped either way. A NULL-store record keeps today's behavior (the
  // 全店舗/null-store convention).
  if (allowedStoreIds && record.store_id && !allowedStoreIds.includes(record.store_id)) {
    throw new AppApiError('store_forbidden', 'this karute belongs to a store you are not assigned to')
  }

  // Unclamped (viewAll / floating): business-wide. Clamped: enforceStore
  // keeps the filter (never a business-wide leak to a branch-restricted
  // actor) — the exact server-side roster the store clamp on the confirm
  // write will itself accept.
  const list = await listAllCustomers(synqed, {
    store_id: storeId ?? undefined,
    enforceStore: allowedStoreIds != null,
  })

  return ok(ctx, {
    customers: list.customers
      .filter((c) => c.id !== record.customer_id)
      .map((c) => ({ id: c.id, name: c.name, furigana: c.furigana, phone: c.phone })),
  })
})

export const OPTIONS = GET
