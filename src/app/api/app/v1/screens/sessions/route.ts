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
import {
  SessionsScreenDTO,
  SessionsScreenWindowedDTO,
} from '@/lib/app-api/sessions-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { storeStaffIdSetForBusiness } from '@/lib/auth/store-scope'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { listSynqedKaruteRowsWithTotalOrThrow } from '@/lib/karute/synqed-records'
import { loadKaruteWindowRows, type KaruteWindow } from '@/lib/karute/karute-window'
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

  // VERSION NEGOTIATION (PR-2a 日付チャンク読み込み): the opt-in param IS the
  // negotiation — no server-side version inference, no guessing from a
  // User-Agent. A bare call is a release-17 bundle and gets today's legacy
  // shape byte-for-byte (newest-200 rows, SessionsScreenDTO, no window keys);
  // `?window=1` is the release-18 bundle asking for the windowed read. The
  // legacy branch is scheduled for retirement once 17 ages out of the field —
  // named follow-up in the lane queue, tracked, never silently dropped.
  const windowed = new URL(ctx.req.url).searchParams.get('window') === '1'

  let screen: ReturnType<typeof buildSessionsListScreen>
  let windowRead: KaruteWindow | null = null
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
      karuteRead,
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
      // Throwing variants — a synqed outage is a 502, never an empty karute
      // list. Legacy (bare call): the newest-200 slab, unchanged since PR-1b,
      // WithTotal so the store-wide total rides along. Windowed (?window=1):
      // the first date window of the backward walk, same shared loader the web
      // page and the append action use.
      windowed
        ? loadKaruteWindowRows(synqed, { storeId: activeStore })
        : listSynqedKaruteRowsWithTotalOrThrow(synqed, { storeId: activeStore }),
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
    const synqedKaruteRows = karuteRead.rows
    // Both reads carry the store-wide total; only the windowed one carries a
    // boundary. `window` stays null on the legacy path, which is exactly what
    // keeps the legacy response free of the new keys.
    const storeTotal =
      'freshStoreTotal' in karuteRead ? karuteRead.freshStoreTotal : karuteRead.total
    if ('windowStart' in karuteRead) windowRead = karuteRead

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
      total: storeTotal,
    })
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'sessions screen data unavailable')
  }

  // Two schemas, one screen: the bare call parses through the UNCHANGED
  // SessionsScreenDTO so its serialized body stays byte-identical for
  // release-17 phones (zod injects `.default()`s, so a merged schema would
  // have leaked the new keys into it).
  const dto = windowRead
    ? SessionsScreenWindowedDTO.parse({
        ...screen,
        hasMore: windowRead.hasMore,
        windowStart: windowRead.windowStart,
      })
    : SessionsScreenDTO.parse(screen)
  return ok(ctx, dto)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
