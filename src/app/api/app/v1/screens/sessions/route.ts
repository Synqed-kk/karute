// Sessions-list (カルテ tab) screen facade read (packet 05, inventory #3). The
// /karute page's Promise.all collapsed into one server wave on the
// business-scoped client, rows assembled by the SAME buildSessionsListScreen the
// web page uses. Store scope travels as the explicit `store-id` header per the
// packet-03 contract — never a cookie: resolveStoreForRequest proves tenancy
// FIRST, then staff assignment, and an errored lookup fails CLOSED.
//
// LENS PARITY: the page's cookie resolveStoreScope maps to the header clamp —
//   clamped (non-viewAll)  → customers + karute all scoped
//   viewAll + store-id      → karute rows scoped; the customer name-map +
//                             customerOptions stay business-wide (walk-in
//                             カルテ creation parity)
//   viewAll + no store-id   → business-wide everything
//
// FAILURE CONTRACT: no graceful-empty swallowing on this path — the karute read
// uses the throwing listSynqedKaruteRowsOrThrow variant, so any synqed failure
// is a classified 502, never a DTO that freezes an empty salon into a cache.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { SessionsScreenDTO } from '@/lib/app-api/sessions-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { storeStaffIdSetForBusiness } from '@/lib/auth/store-scope'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { listSynqedKaruteRowsWithTotalOrThrow } from '@/lib/karute/synqed-records'
import { jstStartOfMonth } from '@/lib/date/jst'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'

// Node runtime: the synqed SDK + node:crypto verifier are server-only.
export const runtime = 'nodejs'

export const GET = facadeHandler('sessions.list', async (ctx) => {
  // Same gate as batch 1 — 'customers.view' is "view customers + karute" in
  // permissions.ts. First body statement so a missing capability is a 403
  // before the clamp is even consulted.
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Store clamp BEFORE any data read — its store_forbidden throws must reach the
  // client as 403, so it stays OUTSIDE the upstream_unavailable catch below.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const activeStore = clamp.storeId
  const clamped = clamp.allowedStoreIds != null

  let screen: ReturnType<typeof buildSessionsListScreen>
  try {
    // JST month bounds for the 今月 status-line probe (PR-1b 正直ヘッダー) —
    // computed once, reused for both reads below; LENS PARITY with the web
    // page's identical computation (page.tsx).
    const now = new Date()
    const monthStartIso = jstStartOfMonth(now).toISOString()
    const nowIso = now.toISOString()

    // One wave mirroring the page's Promise.all (getStaffList →
    // staffListByBusinessOrThrow, getCurrentUserStaffId → the roster-membership
    // check below, cookie scope → the header clamp). EVERY upstream read in the
    // wave throws into the 502 catch — the staff read included (fix round 1:
    // the graceful staffListByBusiness resolves [] on failure, which would ship
    // a schema-legal 200 with an empty roster / 'Unknown' names).
    const [
      staffList,
      allCustomersList,
      karuteRowsWithTotal,
      monthProbe,
      synqedStaff,
    ] = await Promise.all([
      staffListByBusinessOrThrow(ctx.identity.businessId),
      // Clamped (non-viewAll): scoped + enforceStore (RBAC clamp). Otherwise
      // business-wide so names resolve + a walk-in カルテ can be created.
      clamped
        ? listAllCustomers(synqed, {
            store_id: activeStore,
            enforceStore: true,
            sort_by: 'created_at',
            sort_order: 'asc',
          })
        : listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      // Throwing variant — a synqed outage is a 502, never an empty karute list.
      // WithTotal (PR-1b): also hands back the store-wide total, plumbed
      // through for PR-2a's 全件 display.
      listSynqedKaruteRowsWithTotalOrThrow(synqed, { storeId: activeStore }),
      // 今月 probe (PR-1b): lean page_size:1 read over the JST month window —
      // rows discarded, only .total read. Same failure contract (throws into
      // the 502 catch below — never a swallowed stale count).
      listSynqedKaruteRowsWithTotalOrThrow(synqed, {
        storeId: activeStore,
        from: monthStartIso,
        to: nowIso,
        page_size: 1,
      }),
      synqed.staff.list({ page_size: 200 }),
    ])
    const synqedKaruteRows = karuteRowsWithTotal.rows

    // Page parity (getCurrentUserStaffId): the caller's staff identity is their
    // roster row keyed by the CONFIRMED auth user id — never client input.
    const currentStaffId = staffList.some((s) => s.id === ctx.identity.authUserId)
      ? ctx.identity.authUserId
      : null

    // #496 store clamp, facade twin: 担当 pickers offer only the active store's
    // staff. Business id comes from the verified token — never the cookie
    // session (storeStaffIdSet's world). Fail-open to full roster mirrors the
    // web page's posture.
    const storeStaffIds = await storeStaffIdSetForBusiness(
      staffList,
      activeStore,
      ctx.identity.businessId,
    )

    screen = buildSessionsListScreen({
      staffList,
      storeStaffIds,
      allCustomersList,
      currentStaffId,
      synqedKaruteRows,
      synqedStaff,
      monthCount: monthProbe.total,
      total: karuteRowsWithTotal.total,
    })
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'sessions screen data unavailable')
  }

  const dto = SessionsScreenDTO.parse(screen)
  return ok(ctx, dto)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
