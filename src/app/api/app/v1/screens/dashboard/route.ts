// Dashboard screen facade GET (design-parity Gap B-1 PR 2). Mirrors the
// appointments template (#565/#566): facadeHandler + ensureCapability +
// resolveStoreForRequest clamp-before-read, assembled by the SAME
// buildDashboardScreen the web page renders from (PR 1's extraction) — ONE
// implementation for the Stage-2 derivation (hero karute lookups, attention
// summaries, the cached AI attention call).
//
// BINDING CONTRACT (merged PR #570's Greptile threads — this call site IS the
// enforcement point): the synqed client + businessId + storeId passed into
// buildDashboardScreen and every WithClient twin below all derive from ONE
// ctx.identity read + the ONE store clamp result. Never a second client,
// never a second businessId source, never a store read outside the clamp —
// the WithClient twins trust their caller on tenancy.
//
// FAILURE CONTRACT: staff roster / dashboard data / org settings / customer
// list are load-bearing (page parity: a failed read crashes the whole web
// page too) → throw → classified 502. The pack surfaces (packAlerts /
// reconcile / packUsage) fail CLOSED instead: a failed store-lensed read
// degrades to EMPTY, NEVER a business-wide fallback, and never takes the rest
// of the dashboard down with it — same page-parity contract the appointments
// route applies to its pack-pill read.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { DashboardScreenDTO } from '@/lib/app-api/dashboard-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import type { StoreScope } from '@/lib/auth/store-scope'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { getDashboardDataFor } from '@/lib/dashboard/cached'
import { buildDashboardScreen } from '@/lib/dashboard/screen'
import { emptyPackAlerts, getPackAlertsWithClient } from '@/lib/packs/alerts'
import { loadUnprocessedVisitsWithClient } from '@/lib/packs/reconcile'
import { listAllPackUsageWithClient, type CustomerPackUsage } from '@/lib/packs/store'
import { startTiming } from '@/lib/perf/timing'

export const runtime = 'nodejs'

function readLocale(ctx: FacadeContext): string {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler('screens.dashboard', async (ctx) => {
  // Screens-route class gate — the hero + attention cards carry customer
  // names + numbers, same baseline as every other screen GET.
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  // ONE identity read, ONE client, ONE clamp — every downstream call below
  // reuses these three exact values (the binding contract above).
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const locale = readLocale(ctx)

  // Store clamp BEFORE any read — store_forbidden must reach the client as
  // 403, outside the 502 catch below (same clamp-before-read contract as
  // the appointments route).
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const storeId = clamp.storeId
  // StoreScope-shaped view of the SAME clamp result (screen.ts's deps type is
  // the cookie-side StoreScope) — viewAll reads the SAME capabilities set the
  // clamp itself consulted, not a new resolution.
  const scope: StoreScope = {
    storeId,
    viewAll: ctx.identity.capabilities.has('stores.viewAll'),
    allowedStoreIds: clamp.allowedStoreIds,
  }

  const t = startTiming('screens.dashboard')

  try {
    const [staffList, dashboard, orgSettings, customerList, packAlerts, reconcile, packUsage] =
      await Promise.all([
        staffListByBusinessOrThrow(businessId),
        t.phase('dashboardData', () => getDashboardDataFor(businessId, storeId)),
        orgSettingsWithClient(synqed),
        getCachedCustomerListFor(businessId),
        // Pack surfaces: page-parity fail-closed (see file header) — the
        // WithClient twins THROW, so this call site owns the degrade-to-empty
        // decision (mirrors listAllPackUsageWithClient's catch on the
        // appointments route).
        t.phase('packAlerts', () =>
          getPackAlertsWithClient(synqed, businessId, undefined, storeId).catch(
            () => emptyPackAlerts(),
          ),
        ),
        t.phase('reconcile', () =>
          loadUnprocessedVisitsWithClient(synqed, businessId, storeId).catch(() => ({
            entries: [],
            truncated: 0,
          })),
        ),
        t.phase('packUsage', () =>
          listAllPackUsageWithClient(synqed).catch(
            () => new Map<string, CustomerPackUsage>(),
          ),
        ),
      ])

    const screen = await buildDashboardScreen({
      synqed,
      locale,
      staffList,
      // The confirmed auth-user id IS the staff-roster join key (same as the
      // appointments route's selfRow lookup) — buildDashboardScreen does its
      // own staffList.find(...) against this id for isOwner detection.
      activeStaffId: ctx.identity.authUserId,
      dashboard,
      orgSettings,
      customerList,
      packAlerts,
      reconcile,
      // can('alerts.manage') equivalent on the facade side.
      canDismissAlerts: ctx.identity.capabilities.has('alerts.manage'),
      packUsage,
      businessId,
      scope,
      t,
    })

    return ok(ctx, DashboardScreenDTO.parse(screen))
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'dashboard screen data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
