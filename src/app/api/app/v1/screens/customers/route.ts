// Customers-list screen facade read (packet 04, inventory #2). The page's
// 7-way Promise.all collapsed into one server wave on the business-scoped
// client, rows assembled by the SAME buildCustomersListScreen the web page
// uses. Store scope travels as the explicit `store-id` header per the
// packet-03 contract — never a cookie: resolveStoreForRequest proves tenancy
// FIRST, then staff assignment, and an errored lookup fails CLOSED.
//
// FAILURE CONTRACT: no graceful-empty swallowing on this path (packs/
// lifecycles use the throwing WithClient variants) — any synqed failure is a
// classified 502, never a DTO that freezes an empty salon into a mobile cache.

import { z } from 'zod'
import { getTranslations } from 'next-intl/server'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { CustomersScreenDTO } from '@/lib/app-api/customers-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import { storeStaffIdSetForBusiness } from '@/lib/auth/store-scope'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { enrichCustomers, type LastVisitStrings } from '@/lib/customers/list-enrich'
import { buildCustomersListScreen } from '@/lib/customers/screen-rows'
import {
  listAllLifecyclesWithClient,
  listAllPackUsageWithClient,
  listBurnRedemptionsWithClient,
  warn,
} from '@/lib/packs/store'
import { monthlyBurnByCustomer } from '@/lib/packs/burn'

// Node runtime: the synqed SDK + node:crypto verifier are server-only.
export const runtime = 'nodejs'

// Same clamped shape as the sibling screen routes (dashboard/karute/record/
// appointments) — the shell grew its second locale (2026-08-11 packet).
function readLocale(ctx: { req: Request }): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

/** Strict query-string contract: one optional free-text search term. */
const QuerySchema = z.string().max(200)

export const GET = facadeHandler('customers.list', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const locale = readLocale(ctx)

  const parsedQuery = QuerySchema.safeParse(
    new URL(ctx.req.url).searchParams.get('query') ?? '',
  )
  if (!parsedQuery.success) {
    throw new AppApiError('validation', 'query must be a string of at most 200 characters')
  }
  const query = parsedQuery.data.trim()

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Store clamp BEFORE any data read — its store_forbidden throws must reach
  // the client as 403, so it stays outside the upstream_unavailable catch.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const enforceStore = clamp.allowedStoreIds != null

  const lvT = await getTranslations({ locale, namespace: 'customers.list.lastVisit' })
  const lastVisitStrings: LastVisitStrings = {
    noVisits: lvT('noVisits'),
    yearsAgo: (n) => lvT('yearsAgo', { n }),
    today: lvT('today'),
    oneDayAgo: lvT('oneDayAgo'),
    daysAgo: (n) => lvT('daysAgo', { n }),
    monthsAgo: (n) => lvT('monthsAgo', { n }),
  }

  let screen: ReturnType<typeof buildCustomersListScreen>
  let pickerStaff: ReturnType<typeof buildCustomersListScreen>['staffList']
  let selfStaffId: string | null
  let burnByCustomer: Record<string, { mtd: number; prev: number }> | null
  let burnUnpricedIds: string[]
  try {
    // Wave 1 — rows + roster (mirrors the page's first Promise.all).
    const [list, staffList] = await Promise.all([
      listAllCustomers(synqed, {
        search: query || undefined,
        store_id: clamp.storeId,
        enforceStore,
        sort_by: 'updated_at',
        sort_order: 'desc',
      }),
      // Carry-forward from batch 2 (reviewer F-BATCH1): the graceful
      // staffListByBusiness resolves [] on an internal failure, which would ship
      // a schema-legal 200 with an empty roster / 'Unknown' names — a silently
      // degraded screen. Switched to the throwing variant so a staff read
      // failure lands in the 502 catch below, same contract as the sessions route.
      staffListByBusinessOrThrow(ctx.identity.businessId),
    ])
    // Page parity (getCurrentUserStaffId): the caller's own staff identity is
    // their roster row keyed by the CONFIRMED auth user id — never client input.
    selfStaffId = staffList.some((s) => s.id === ctx.identity.authUserId)
      ? ctx.identity.authUserId
      : null

    // Wave 2 — enrichment + packs + lifecycles + org settings + burn (page
    // parity). Burn is the ONE soft-fail read here (.catch → null): a burn
    // failure hides only the 今月消化 stat (honesty gate), never the whole
    // screen — unlike packUsage/lifecycles above, which throw into the 502
    // catch below.
    const customerIds = list.customers.map((c) => c.id)
    const [enrichment, packUsage, lifecycles, rawSettings, burnRows, storeStaffIds] =
      await Promise.all([
        enrichCustomers(ctx.identity.businessId, customerIds),
        listAllPackUsageWithClient(synqed),
        listAllLifecyclesWithClient(synqed),
        // Only ticket_packs_enabled is needed; the shared cached reader lives in
        // a 'use server' file and must stay unexported (see ask-ai route).
        synqed.orgSettings.get(),
        listBurnRedemptionsWithClient(synqed).catch((err) => {
          warn('screens/customers burn', err)
          return null
        }),
        // Page parity (page.tsx pickerStaff): clamp the 担当 filter pills to
        // the active store's staff — row 担当 names still resolve business-wide.
        storeStaffIdSetForBusiness(staffList, clamp.storeId, ctx.identity.businessId),
      ])
    const settings = (rawSettings?.settings ?? {}) as { ticket_packs_enabled?: boolean }
    // Page parity (page.tsx): same null-coalescing split — byCustomer stays
    // null (hides the stat), unpricedCustomers degrades to [] (nothing to hide).
    const burn = burnRows ? monthlyBurnByCustomer(burnRows) : null
    burnByCustomer = burn?.byCustomer ?? null
    burnUnpricedIds = burn?.unpricedCustomers ?? []

    screen = buildCustomersListScreen({
      list,
      staffList,
      locale,
      lastVisitStrings,
      enrichment,
      packUsage,
      lifecycles,
      ticketPacksEnabled: settings.ticket_packs_enabled === undefined
        ? true
        : Boolean(settings.ticket_packs_enabled),
    })
    pickerStaff = storeStaffIds
      ? screen.staffList.filter((s) => storeStaffIds.has(s.id))
      : screen.staffList
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'customers screen data unavailable')
  }

  const dto = CustomersScreenDTO.parse({
    ...screen,
    staffList: pickerStaff,
    // 指名スタッフ roster stays tenant-wide (P-2, 2026-08-17): screen.staffList
    // is built from the FULL staffList (staffListByBusinessOrThrow), before
    // the store-scope filter above narrows it into pickerStaff.
    assignableStaff: screen.staffList.map((s) => ({ id: s.id, name: s.name })),
    selfStaffId,
    burnByCustomer,
    burnUnpricedIds,
  })
  return ok(ctx, dto)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
