// Appointments (予約) screen facade GET (design-parity P-B). The web page's
// cookie fan-out reproduced on the business-scoped Bearer client, assembled by
// the SAME buildAppointmentsScreen the page renders from — ONE implementation
// for the Stage-2 derivation (新規 inference, karute numbers, pack pills,
// no-show counts, week/month projections).
//
// FAILURE CONTRACT: the store clamp throws 403 OUTSIDE the 502 catch; the
// load-bearing reads (staff roster, customers, org settings, the day/range
// appointment windows) throw → classified 502 — a failed bookings read must
// surface as an error screen, never as a silently-empty agenda (the web
// action's legacy catch→[] shows empty; for the binary, "no bookings" when
// the read failed is the dangerous lie, so the facade fails loudly). Pack
// usage keeps the page's graceful catch — the 残N/M pills just don't render.
// The menu union degrades the same way: a failed read yields [] and the
// booking picker simply doesn't render, never a 502 on the whole agenda.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { AppointmentsScreenDTO } from '@/lib/app-api/appointments-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { getCachedMenuOptionsFor, scopeMenuOptions } from '@/lib/menus/cached'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { enrichCustomers, type CustomerEnrichment } from '@/lib/customers/list-enrich'
import { listAllPackUsageWithClient, type CustomerPackUsage } from '@/lib/packs/store'
import { customerLensFor, storeStaffIdSetForBusiness } from '@/lib/auth/store-scope'
import {
  getAppointmentsByDateWithClient,
  getAppointmentsInRangeWithClient,
} from '@/lib/appointments/by-date'
import {
  buildAppointmentsScreen,
  parseDateParam,
  parseStaffParam,
  parseViewParam,
} from '@/lib/appointments/screen'
import { computeMonthRange, computeWeekRange } from '@/lib/date/calendar-range'
import { ymdInJst } from '@/lib/date/jst'

export const runtime = 'nodejs'

function readLocale(ctx: FacadeContext): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler('screens.appointments', async (ctx) => {
  // Screens-route class gate — the agenda carries customer names + numbers.
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const url = new URL(ctx.req.url)
  const locale = readLocale(ctx)
  const selectedDate = parseDateParam(url.searchParams.get('date') ?? undefined)
  const view = parseViewParam(url.searchParams.get('view') ?? undefined)
  const staffFilter = parseStaffParam(url.searchParams.get('staff') ?? undefined)
  const selectedDateStr = ymdInJst(selectedDate)

  // Store clamp BEFORE any read — store_forbidden must reach the client as
  // 403, outside the 502 catch below. The clamped store is the same lens the
  // web page's resolveStoreScope applies to the day/range fetches + pickers.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const storeId = clamp.storeId ?? undefined
  const customerLens = customerLensFor(clamp)

  try {
    const weekRange = view === 'week' ? computeWeekRange(selectedDate) : null
    const monthRange = view === 'month' ? computeMonthRange(selectedDate) : null

    // Wave 1 — roster, cached customer list, org settings, menu union.
    const [staffList, customers, orgSettings, menus] = await Promise.all([
      staffListByBusinessOrThrow(businessId),
      // ⚖ Liam 2026-08-17: a clamped caller's booking combobox carries ONLY
      // their store's customers (server-filtered, so the client-side search is
      // clamped by construction). viewAll + floating stay business-wide — the
      // same lens the web page's resolveStoreScope applies (#347 semantics).
      // `null` = clamped with no store to name: EMPTY, never business-wide
      // (customerLensFor, lib/auth/store-scope.ts).
      customerLens === null ? [] : getCachedCustomerListFor(businessId, customerLens),
      orgSettingsWithClient(synqed),
      // Degraded-allowed, same shape as the pack-usage read below: a failed
      // menus read must NEVER 502 the agenda — the picker just doesn't render
      // (§6), and the dialog keeps today's free-text service field. Degraded
      // is allowed, silent is not: once PR-4b ships, a dead read is
      // pixel-identical to "this shop has no menus" — the log line below is
      // the only thing separating an outage from an empty catalog.
      getCachedMenuOptionsFor(businessId).catch((err) => {
        console.error('[screens/appointments] menus read degraded:', err)
        return []
      }),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))

    // Wave 2 — the appointment windows + the store's staff lens.
    const [dayAppointments, weekRangeAppts, monthRangeAppts, storeStaffIds] =
      await Promise.all([
        // includeCancelled: the agenda is the ONE consumer that renders
        // terminal rows (キャンセル済み / 無断 tombstones in their slot).
        getAppointmentsByDateWithClient(synqed, selectedDateStr, {
          storeId,
          nameById,
          includeCancelled: true,
        }),
        weekRange
          ? getAppointmentsInRangeWithClient(
              synqed,
              weekRange.rangeFrom.toISOString(),
              weekRange.rangeTo.toISOString(),
              { storeId },
            )
          : Promise.resolve(null),
        monthRange
          ? getAppointmentsInRangeWithClient(
              synqed,
              monthRange.rangeFrom.toISOString(),
              monthRange.rangeTo.toISOString(),
              { storeId },
            )
          : Promise.resolve(null),
        storeStaffIdSetForBusiness(staffList, clamp.storeId, businessId),
      ])

    // Stage 2 — enrichment for today's clients + the pack pills (page parity:
    // pack read is graceful, 回数券 off skips it entirely).
    const clientIdsForDay = Array.from(
      new Set(dayAppointments.map((a) => a.client_id)),
    )
    const ticketsEnabled = orgSettings?.ticket_packs_enabled ?? true
    const [enrichment, packUsage] = await Promise.all([
      clientIdsForDay.length
        ? enrichCustomers(businessId, clientIdsForDay)
        : Promise.resolve(new Map<string, CustomerEnrichment>()),
      ticketsEnabled
        ? listAllPackUsageWithClient(synqed).catch(
            () => new Map<string, CustomerPackUsage>(),
          )
        : Promise.resolve(new Map<string, CustomerPackUsage>()),
    ])

    // The caller's roster row (page's getCurrentUserStaffId) — keyed by the
    // CONFIRMED auth id, same as the record screen.
    const selfRow = staffList.find((s) => s.id === ctx.identity.authUserId) ?? null

    const screen = buildAppointmentsScreen({
      locale,
      now: new Date(),
      selectedDate,
      staffFilter,
      staffList,
      activeStaffId: selfRow?.id ?? null,
      storeStaffIds,
      orgSettings,
      customers,
      dayAppointments,
      weekRange,
      monthRange,
      weekRangeAppts,
      monthRangeAppts,
      enrichment,
      packUsage,
    })

    return ok(
      ctx,
      AppointmentsScreenDTO.parse({
        view,
        selectedDateIso: selectedDate.toISOString(),
        staffFilter,
        staff: screen.staff,
        // Same default the page renders: clamped self, else first visible.
        activeStaffId:
          screen.visibleActiveStaffId ?? screen.staff[0]?.id ?? null,
        authProfileId: ctx.identity.authUserId,
        customers: customers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone ?? null,
          furigana: c.furigana ?? null,
        })),
        // CachedMenuOption is already DTO-shaped — passed through verbatim
        // apart from the store clamp (⚖ Liam 2026-08-17): the cached union is
        // business-wide and actor-blind by design (it must stay so — the entry
        // is shared across Bearer identities), so a clamped caller's isolation
        // lands here, on the scope resolveStoreForRequest already proved. null
        // = viewAll or floating → unfiltered.
        menus: scopeMenuOptions(menus, clamp.allowedStoreIds),
        reservationViews: screen.reservationViews,
        reservationStaff: screen.reservationStaff,
        businessHours: screen.businessHours,
        weekData: screen.weekData,
        weekStartIso: screen.weekStartIso,
        monthData:
          screen.monthData?.map((c) => ({
            id: c.id,
            dateIso: c.date.toISOString(),
            inMonth: c.inMonth,
            isToday: c.isToday,
            count: c.count,
            density: c.density,
          })) ?? null,
      }),
    )
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'appointments screen data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
