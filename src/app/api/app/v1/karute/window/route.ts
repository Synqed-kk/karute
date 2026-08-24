// Facade: カルテ tab 日付チャンク読み込み (PR-2a). Phone twin of
// src/actions/karute.ts's loadKaruteWindow — same walk, same projection, same
// ONE hasMore formula, scoped through resolveStoreForRequest ('store-id'
// header, fail-closed) instead of the cookie-bound resolveStoreScope. NEVER
// resolveStoreScope on a facade path (packet §Verified facts).
//
// FAILURE CONTRACT: the throwing read variants only — a synqed outage is a
// classified 502, never an empty-but-200 chunk that would freeze a phone's list
// into "that's all there is". Read-only → 'skip' in FACADE_AUDIT_MAP, same
// wayfinding rule as karute/reveal and reassign-options.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { storeStaffIdSetForBusiness } from '@/lib/auth/store-scope'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { loadKaruteWindowRows } from '@/lib/karute/karute-window'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'

export const runtime = 'nodejs'

/** Strict query contract. `olderThan` is a JST calendar day, `month` a JST
 *  calendar month (PR-2b sends it), `loadedCount` the caller's raw accumulated
 *  row count — anything malformed is a 400, never a silently-ignored param
 *  that would hand back the newest window and look like the end of history.
 *
 *  TRUST BOUNDARY: `loadedCount` is client-supplied and trusted for WALK
 *  ECONOMICS only. It gates no data access and no scope — the store clamp
 *  below is what decides which rows this caller may see. An overstated value
 *  can only end THIS caller's own list early (a false `hasMore: false`, the
 *  epoch sweep skipped for themselves); it can never widen the lens or reach
 *  another viewer's history. */
const QuerySchema = z.object({
  olderThan: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  loadedCount: z.coerce.number().int().min(0).optional(),
})

export const GET = facadeHandler('karute.window', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const url = new URL(ctx.req.url)
  const parsed = QuerySchema.safeParse({
    olderThan: url.searchParams.get('olderThan') ?? undefined,
    month: url.searchParams.get('month') ?? undefined,
    loadedCount: url.searchParams.get('loadedCount') ?? undefined,
  })
  if (!parsed.success) {
    throw new AppApiError(
      'validation',
      'olderThan must be YYYY-MM-DD, month YYYY-MM, loadedCount a non-negative integer',
    )
  }

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Store clamp BEFORE any data read — its store_forbidden throws must reach
  // the client as 403, so it stays OUTSIDE the upstream catch below.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const activeStore = clamp.storeId
  const clamped = clamp.allowedStoreIds != null

  try {
    const [staffList, allCustomersList, window, synqedStaff] = await Promise.all([
      staffListByBusinessOrThrow(ctx.identity.businessId),
      clamped
        ? listAllCustomers(synqed, {
            store_id: activeStore,
            enforceStore: true,
            sort_by: 'created_at',
            sort_order: 'asc',
          })
        : listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      loadKaruteWindowRows(synqed, {
        storeId: activeStore,
        olderThan: parsed.data.olderThan,
        month: parsed.data.month,
        loadedCount: parsed.data.loadedCount,
      }),
      synqed.staff.list({ page_size: 200 }),
    ])

    const currentStaffId = staffList.some((s) => s.id === ctx.identity.authUserId)
      ? ctx.identity.authUserId
      : null
    const storeStaffIds = await storeStaffIdSetForBusiness(
      staffList,
      activeStore,
      ctx.identity.businessId,
    )

    const screen = buildSessionsListScreen({
      staffList,
      storeStaffIds,
      allCustomersList,
      currentStaffId,
      synqedKaruteRows: window.rows,
      synqedStaff,
      // Status-line numbers belong to the screen read; an append carries rows.
      monthCount: 0,
      total: window.freshStoreTotal,
    })

    return ok(ctx, {
      items: screen.items,
      windowStart: window.windowStart,
      freshStoreTotal: window.freshStoreTotal,
      hasMore: window.hasMore,
    })
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'karute window unavailable')
  }
})

export const OPTIONS = GET
