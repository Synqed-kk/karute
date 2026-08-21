// Record-home (/sessions, inventory #6) screen facade read (packet 08 §Build 2).
// The page's wave-1 fan-out collapsed onto the business-scoped Bearer client,
// assembled by the SAME buildRecordScreen the web page renders from (minus the
// streamed AI brief — Decision 1 gives it a dedicated endpoint).
//
// FAILURE CONTRACT (§Build 2): explicit appointmentId/customerId not found /
// cross-tenant → not_found; wave-1 upstream reads → classified 502. The NAMED
// page-parity grace reads (target customer, consent, karute history, packs) keep
// their null/[] inside buildRecordScreen; lifecycle failure → segment/rhythm
// null (fail-closed coaching). RECORDING-PRIVACY: recentRecordings is transcript-
// free by construction (the DTO has no transcript field).

import { getTranslations } from 'next-intl/server'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { RecordScreenDTO } from '@/lib/app-api/record-screen-dto'
import { buildRecordScreen } from '@/lib/karute/record-screen'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAllCustomers } from '@/lib/customers/list-all'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { getAppointmentsByDateWithClient } from '@/lib/appointments/by-date'
import { getCustomerWithClient } from '@/lib/customers/queries'
import { getCustomerKaruteRecordsWithClient } from '@/actions/karute'
import {
  listCustomerPacksWithClient,
  getCustomerLifecycleCheckedWithClient,
  listAllPackUsageWithClient,
  type CustomerPackUsage,
} from '@/lib/packs/store'
import { enrichCustomers, type CustomerEnrichment } from '@/lib/customers/list-enrich'
import { isTerminalStatus } from '@/lib/appointments/status'
import type { AppointmentRow } from '@/actions/appointments'
import type { CustomerWithStaff } from '@/lib/customers/queries'
import type { SynqedClient } from '@synqed-kk/client'

export const runtime = 'nodejs'

function readLocale(ctx: FacadeContext): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

/** Resolve an EXPLICIT non-today appointmentId → AppointmentRow on the business
 *  client (mirrors getAppointmentById's mapping). Cross-tenant/missing → the
 *  status-aware 404/502 split; a terminal booking → null (the web falls through
 *  to the default target — never a recording target).
 *
 *  `allowedStoreIds` is the clamp the ROUTE already resolved (never a second
 *  resolution): null = viewAll or floating, unchanged. */
async function resolveExplicitAppointmentForClient(
  synqed: Pick<SynqedClient, 'appointments' | 'staff' | 'customers'>,
  id: string,
  nameById: Map<string, string>,
  allowedStoreIds: string[] | null,
): Promise<AppointmentRow | null> {
  let a: Awaited<ReturnType<SynqedClient['appointments']['get']>>
  try {
    a = await synqed.appointments.get(id)
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status === 404) throw new AppApiError('not_found', 'appointment not found in this business')
    throw new AppApiError('upstream_unavailable', 'appointment read failed')
  }
  if (!a) throw new AppApiError('not_found', 'appointment not found in this business')
  if (isTerminalStatus(a.status)) return null
  // Store clamp, the Bearer twin of getAppointmentById's (actions/appointments.ts):
  // the list reads are store-filtered, but this per-id read would otherwise let a
  // branch-restricted caller resolve ANY booking by deep link. Fail closed on a
  // storeless row (a handful of pre-repair imports have no store) — hidden for
  // clamped callers, still visible in cross-store views. Same NULL as a terminal
  // booking, not a 403: the screen falls through to its default target, so the
  // caller never learns the id exists (hide, never show-and-refuse).
  if (allowedStoreIds) {
    const rowStore = (a as { store_id?: string | null }).store_id ?? null
    if (!rowStore || !allowedStoreIds.includes(rowStore)) return null
  }

  const staffList = await synqed.staff.list({ page_size: 200 })
  const profileByStaffId = new Map(
    staffList.staff
      .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
      .map((s) => [s.id, s.user_id]),
  )
  // Name fill for a row the clamp ADMITS. The clamp above passes any store in
  // `allowedStoreIds`, but `nameById` is the PICKER map, narrowed to the single
  // active store — so a two-store staff pinned to 銀座 deep-linking their 代官山
  // booking used to render 'Unknown' (record-screen.ts:269) and lose the
  // returning/回数券 signals with it. The web twin resolves the same name
  // business-wide (actions/appointments.ts, getAppointmentById), and the shipped
  // convention is the same: business-wide maps are fine for .get(id), never for
  // lists (store-scope.ts, picker-filter header). ONE per-id read, only on a
  // miss, only for the already-admitted row — never the roster. Display-only, so
  // a failed read degrades to today's null rather than 502-ing the screen.
  const name =
    nameById.get(a.customer_id) ??
    (await synqed.customers
      .get(a.customer_id)
      .then((c) => c.name)
      .catch(() => null))
  return {
    id: a.id,
    staff_profile_id: profileByStaffId.get(a.staff_id) ?? a.staff_id,
    client_id: a.customer_id,
    start_time: a.starts_at,
    duration_minutes: a.duration_minutes ?? 0,
    title: a.title,
    notes: a.notes,
    karute_record_id: null,
    created_at: a.created_at,
    customers: name == null ? null : { name },
    synqed_status: a.status,
    source: a.source,
    status_reason: null,
    status_set_by_name: null,
    status_set_at: null,
  }
}

export const GET = facadeHandler('screens.record', async (ctx) => {
  // Screens-route class gate — 'customers.view' is "view customers + karute".
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const url = new URL(ctx.req.url)
  const requestedAppointmentId = url.searchParams.get('appointmentId') ?? undefined
  const requestedCustomerId = url.searchParams.get('customerId') ?? undefined
  const locale = readLocale(ctx)
  const now = new Date()
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const todayStr = jstNow.toISOString().split('T')[0]

  // Store clamp BEFORE any read — a store_forbidden throw must reach the
  // client as 403, so it stays OUTSIDE the 502 catch below. The clamp result
  // scopes the recording-target set below, the explicit-appointmentId deep
  // link (resolveExplicitAppointmentForClient) and, for clamped actors, the
  // customer combobox list; viewAll stays business-wide (#347 semantics).
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })
  const activeStore = clamp.storeId
  const clamped = clamp.allowedStoreIds != null

  try {
    // Wave 1 — staff roster, customer list (the batch-1 helper, NOT
    // getCachedCustomerList): business-wide for viewAll, store-scoped for
    // clamped actors. Org settings. Any throw → 502.
    const [staffList, customerRes, orgSettings] = await Promise.all([
      staffListByBusinessOrThrow(businessId),
      // ⚖ Liam 2026-08-17, sessions-route precedent: enforceStore keeps the
      // clamp on even while searching, so a branch staff's record picker can
      // never reach another store's customers.
      clamped
        ? listAllCustomers(synqed, {
            store_id: activeStore,
            enforceStore: true,
            sort_by: 'created_at',
            sort_order: 'asc',
          })
        : listAllCustomers(synqed, { sort_by: 'created_at', sort_order: 'asc' }),
      orgSettingsWithClient(synqed),
    ])

    // Map the raw customers to the cached-list shape buildRecordScreen consumes
    // (the QR returning-signal fields — same mapping as cached.ts).
    const customers = customerRes.customers.map((c) => {
      const qr = c as typeof c & {
        is_existing_customer?: boolean
        visit_count?: number
        has_ticket_pack?: boolean
        karute_number?: number | null
      }
      return {
        id: c.id,
        name: c.name,
        phone: c.phone ?? null,
        furigana: c.furigana ?? null,
        isExistingCustomer: qr.is_existing_customer ?? false,
        created_at: c.created_at,
        visitCount: qr.visit_count ?? 0,
        hasTicketPack: qr.has_ticket_pack ?? false,
        karute_number: qr.karute_number ?? null,
      }
    })
    const nameById = new Map(customers.map((c) => [c.id, c.name]))

    // Today's recording-target set (store-scoped, same as the web page).
    const todayAppts = await getAppointmentsByDateWithClient(synqed, todayStr, {
      storeId: activeStore ?? undefined,
      nameById,
    })

    // The caller's roster row: staff identity (page's getCurrentUserStaffId) +
    // display role (the SessionProvider seed). Keyed by the CONFIRMED auth id.
    const selfRow = staffList.find((s) => s.id === ctx.identity.authUserId) ?? null
    const activeStaffId = selfRow ? selfRow.id : null
    const viewerRole = (selfRow?.display_role ?? '') as string

    const t = await getTranslations({ locale, namespace: 'reservation.status' })

    const screen = await buildRecordScreen({
      locale,
      now,
      requestedAppointmentId,
      requestedCustomerId,
      activeStaffId,
      staffList,
      customers,
      todayAppts,
      orgSettings,
      statusLabel: (key) => t(key),
      // Picker-dialog facts (v2) — page parity: the same two bulk reads the web
      // sessions page fires, both best-effort (a failure costs the picker rows
      // their detail lines; it must never 502 the screen). LAZY like the web's:
      // buildRecordScreen invokes it only for a no-target screen, so the bound
      // read no longer pays for them — and they no longer sit SERIALIZED behind
      // getAppointmentsByDate as a stage of their own (B-6/B-7). The two reads
      // run in parallel with each other, as before.
      loadPickerFacts: async () => {
        const [enrichment, packUsage] = await Promise.all([
          enrichCustomers(
            businessId,
            customers.map((c) => c.id),
          ).catch(() => new Map<string, CustomerEnrichment>()),
          listAllPackUsageWithClient(synqed).catch(
            () => new Map<string, CustomerPackUsage>(),
          ),
        ])
        return { enrichment, packUsage }
      },
      deps: {
        resolveExplicitAppointment: (id) =>
          resolveExplicitAppointmentForClient(synqed, id, nameById, clamp.allowedStoreIds),
        // Explicit walk-in customer → status-aware 404/502 (never a silent
        // fall-through on a cross-tenant id).
        resolveWalkInCustomer: async (id) =>
          (await readCustomerRaw(synqed, id)) as unknown as CustomerWithStaff,
        // Wave-2 target customer — page-parity graceful (.catch → null).
        getTargetCustomer: (id) => getCustomerWithClient(synqed, id).catch(() => null),
        getConsent: (id) =>
          synqed.customers
            .getConsent(id)
            .then((r) => r.consent as { granted_at?: string | null } | null)
            .catch(() => null),
        getKaruteRecords: (id, limit) => getCustomerKaruteRecordsWithClient(synqed, id, limit),
        listPacks: (id) => listCustomerPacksWithClient(synqed, id).catch(() => []),
        getLifecycle: (id) => getCustomerLifecycleCheckedWithClient(synqed, id),
      },
    })

    const dto = RecordScreenDTO.parse({
      locale,
      customers,
      nextAppointment: screen.nextAppointment,
      nearbyBookings: screen.nearbyBookings,
      brief: screen.brief,
      recentRecordings: screen.recentRecordings,
      consentDate: screen.consentDate,
      visitSegment: screen.visitSegment,
      visitRhythm: screen.visitRhythm,
      targetHasTicketPack: screen.targetHasTicketPack,
      targetPack: screen.targetPack,
      previousPack: screen.previousPack,
      packPresets: screen.packPresets,
      staffCanCustomizePacks: screen.staffCanCustomizePacks,
      // Capability-derived (not an org setting) — the same Bearer-resolved set
      // the photo DELETE route gates on.
      staffCanDeletePhotos: ctx.identity.capabilities.has('records.delete'),
      ticketsEnabled: screen.ticketsEnabled,
      noiseSuppression: screen.noiseSuppression,
      currentStaffName: screen.currentStaffName,
      customerFacts: screen.customerFacts,
      viewerRole,
    })
    return ok(ctx, dto)
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'record screen data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
