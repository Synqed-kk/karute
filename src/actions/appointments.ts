'use server'

import { revalidatePath, updateTag } from 'next/cache'
import type { Appointment, AppointmentSource } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { getActiveStoreId } from '@/actions/stores'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { reachesNoStore, UNASSIGNED_STORE_DENIAL } from '@/lib/auth/store-gate'
import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'
import { getCurrentUserStaffId } from '@/lib/staff'
import { resolveWebAuditContext } from '@/lib/audit-web'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getOrgSettings } from '@/actions/org-settings'
import { isTerminalStatus, type AppStatus } from '@/lib/appointments/status'
import { listCustomerPacks } from '@/lib/packs/store'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import {
  validateAppointmentTime,
  type AppointmentInput,
} from '@/lib/appointments'
import { appointmentsToMonthCells, monthCellsToDTO } from '@/lib/adapters/reservation'
import { newCountByDay } from '@/lib/appointments/first-visit'
import { enrichCustomers } from '@/lib/customers/list-enrich'
import { getBusinessId } from '@/lib/staff'
import { listAllPackUsage } from '@/lib/packs/store'
import { customerLensFor } from '@/lib/auth/store-scope'
import { computeMonthRange } from '@/lib/date/calendar-range'
import { jstStartOfToday } from '@/lib/date/jst'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'
import {
  cancelAppointmentCore,
  createAppointmentCore,
  deleteAppointmentCore,
  markNoShowAppointmentCore,
  restoreAppointmentCore,
  updateAppointmentCore,
} from '@/lib/appointments/mutations'

export { validateAppointmentTime, type AppointmentInput }

export interface AppointmentRow {
  id: string
  staff_profile_id: string
  client_id: string
  start_time: string
  duration_minutes: number
  title: string | null
  notes: string | null
  karute_record_id: string | null
  created_at: string
  customers: { name: string } | null
  // AppStatus (not AppointmentStatus) — core can return NO_SHOW (synqed-core
  // #39) even though the installed SDK's type doesn't declare it yet.
  synqed_status: AppStatus
  /**
   * Origin of the booking. Bookings imported from external systems
   * (QUICKRESERVE, SALON_BOARD, etc.) start as "pending" in the UI until a
   * staff member confirms them; manually entered bookings skip that state.
   */
  source: AppointmentSource
  /** status_reason from core (audit trail for CANCELLED/NO_SHOW). SDK-skew:
   *  the installed client type doesn't declare this field yet — read via a
   *  narrow cast at the call site. null when absent or not terminal. */
  status_reason: string | null
  /** Display name of the staff who set the current status (resolved from
   *  core's status_set_by — a staff id — via the staff list already fetched
   *  at the call site). null when absent (sync-set rows carry no
   *  status_set_by) or not yet resolvable. */
  status_set_by_name: string | null
  /** status_set_at from core (audit trail timestamp for CANCELLED/NO_SHOW/
   *  restore). SDK-skew: same narrow-cast pattern as status_reason. null
   *  when absent or not terminal. */
  status_set_at: string | null
}

export async function createAppointment(input: AppointmentInput) {
  // Server-side gate: booking = bookings.manage (every staff preset holds it;
  // only a custom role with nothing toggled lacks it). Checked with can() — not
  // requireCapability() — because this action returns the house { error } shape
  // and its callers (NewBookingDialog, AppointmentPopout) await it WITHOUT a
  // try/catch, so a thrown error would surface as an unhandled rejection.
  if (!(await can('bookings.manage'))) {
    return { error: 'You do not have permission to manage bookings.' }
  }

  // Validate BEFORE any resolution: resolveSynqedStaffId can CREATE a staff
  // record on miss — invalid input must not leave that side effect behind.
  // (The core re-validates for the facade path; the check is pure.)
  const orgSettings = await getOrgSettings()
  const hoursError = await validateAppointmentTime(input, orgSettings?.operating_hours)
  if (hoursError) return { error: hoursError }

  try {
    // All five are independent → resolve in parallel (resolveSynqedStaffId may
    // hit the DB; getActiveStoreId is a cookie read). The active-store cookie is
    // an ISOLATION input, not just a view label: it is clamped below against
    // the viewer's RBAC scope so a stale / out-of-scope cookie can't stamp a
    // booking into another branch. Business scope (x-business-id) is still applied
    // by core regardless; this clamp is additive.
    // ⚖ Liam 2026-09-16 — an actor who reaches NO store may not CREATE a
    // booking either. `preferredStoreId: null` falls through to core's
    // `defaultBookingStore`, which stamps the booking into whatever store the
    // business defaults to — a WRITE into a branch this person does not belong
    // to. Layers 1–2 refuse them long before this line; the backstop has to
    // hold on its own anyway.
    //
    // ⚠ ORDER IS LOAD-BEARING (Greptile on #948): this sits ABOVE the wave,
    // not inside it, because `resolveSynqedStaffId` CREATES a core staff
    // record on a miss. Resolved together with the wave, a refused booking
    // still wrote that row — a refusal honest about the booking and silent
    // about its side effect. The serial await costs nothing: resolveStoreScope
    // is React-cached and the layout already resolved it this request.
    const scope = await resolveStoreScope()
    if (reachesNoStore(scope)) return { error: UNASSIGNED_STORE_DENIAL }
    const [synqed, synqedStaffId, activeStore, auditActor] = await Promise.all([
      getSynqedClient(),
      resolveSynqedStaffId(input.staffProfileId),
      getActiveStoreId(),
      resolveWebAuditContext(),
    ])
    // A CLAMPED actor (allowedStoreIds set) never sends null: resolveStoreScope
    // already picks the cookie when it's one of their own stores, else their
    // first assigned store — the whole point of the clamp. Sending null here
    // would let a clamped actor's UNSET cookie fall through to the core's
    // defaultBookingStore, which can land on another branch when the booked
    // practitioner works at more than one store (the 銀座 receptionist /
    // multi-store practitioner leak this fixes).
    // viewAll / floating (allowedStoreIds null) keep the OLD behavior: cookie
    // when set, else null → core's defaultBookingStore ("the booked staff's
    // store"). Using scope.storeId here instead would regress that unset-cookie
    // default to the business's PRIMARY store — resolveStoreScope defaults a
    // viewAll actor's own storeId to primary for VIEW purposes, which is the
    // wrong default for a write that should follow the booked staff, not the viewer.
    const cookieStore = scope.allowedStoreIds ? scope.storeId : activeStore
    const result = await createAppointmentCore(synqed, input, {
      synqedStaffId,
      preferredStoreId: cookieStore,
      operatingHours: orgSettings?.operating_hours,
      actor: { ...auditActor, source: 'web', requestId: crypto.randomUUID() },
    })
    if ('id' in result) {
      revalidatePath('/dashboard')
      updateTag('dashboard')
    }
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getAppointmentsByDate(
  dateStr: string,
  _tzOffsetMinutes: number = 540,
  opts?: {
    /** Include CANCELLED + NO_SHOW rows (rendered as tombstones on the 予約
     *  agenda — grey for cancelled, warning-tinted for no-show). Default
     *  false ON PURPOSE: every other consumer — the /sessions recording-target
     *  picker, dashboard today-list, notifications, pack reconcile — relies on
     *  terminal bookings being invisible so one can never become a recording
     *  target or a reconcile candidate. Only the agenda opts in. Kept as
     *  `includeCancelled` (not renamed to something NO_SHOW-neutral) — the name
     *  ripples to every call site for no behavioral gain. */
    includeCancelled?: boolean
  },
): Promise<AppointmentRow[]> {
  // dateStr is a JST calendar day (YYYY-MM-DD). The shared helper frames the
  // fetch window (JST midnight → next-day JST midnight) — karute is JST-only, so
  // the legacy tzOffsetMinutes parameter is kept for call-site compatibility but
  // ignored.
  try {
    // Store filter: resolveStoreScope, NOT the raw active-store cookie. For a
    // branch-restricted staff (no stores.viewAll) scope.storeId is ALWAYS one of
    // their assigned stores — the raw cookie is absent on a fresh login, and
    // `store_id: undefined` meant "every store's bookings", which is exactly the
    // cross-store leak the Apple-review account exposed. For cross-store viewers
    // scope.storeId IS the cookie, so their behavior is unchanged. synqed-core
    // always applies the business scope regardless; this filter is additive.
    // Store filter: resolveStoreScope, NOT the raw active-store cookie (the
    // cross-store leak the Apple-review account exposed). Customer names come
    // from the already-cached tenant list (60s TTL). The fetch + row-mapping now
    // lives in the shared getAppointmentsByDateWithClient (packet 08 §Build 2) so
    // the facade record-screen GET reproduces the same recording-target set;
    // this delegates with the cookie store-scope + cached names.
    const [synqed, scope, cachedCustomers] = await Promise.all([
      getSynqedClient(),
      resolveStoreScope(),
      getCachedCustomerList(),
    ])
    // `storeId ?? undefined` below means "every store's bookings" to core, so
    // an actor who reaches no store must stop here (⚖ Liam 2026-09-16).
    if (reachesNoStore(scope)) return []
    const { getAppointmentsByDateWithClient } = await import('@/lib/appointments/by-date')
    // `return await` (not a bare `return` of the promise) so a rejection lands in
    // this try/catch → the swallowed-[] contract holds.
    return await getAppointmentsByDateWithClient(synqed, dateStr, {
      storeId: scope.storeId ?? undefined,
      nameById: new Map(cachedCustomers.map((c) => [c.id, c.name])),
      includeCancelled: opts?.includeCancelled,
    })
  } catch {
    return []
  }
}

/**
 * Fetch a single appointment by id, resolved to the same AppointmentRow shape as
 * getAppointmentsByDate (customer + staff names resolved). Unlike the by-date
 * read this resolves a booking on ANY day — the record page uses it so a
 * specifically-tapped booking becomes the recording target even when it isn't in
 * today's set, instead of silently falling back to a DIFFERENT customer's
 * session (a treatment-record integrity bug: staff tapped one customer and got
 * another's record).
 *
 * `karute_record_id` is intentionally null: the sole caller uses that field for
 * DEFAULT-target selection over today's list, never for an explicitly-requested
 * row, so a per-id karute lookup here would be wasted work.
 */
export async function getAppointmentById(id: string): Promise<AppointmentRow | null> {
  try {
    const [synqed, scope] = await Promise.all([getSynqedClient(), resolveStoreScope()])
    const a = await synqed.appointments.get(id)
    if (!a) return null
    // A cancelled OR no-show booking must never resolve as a recording target
    // (the record page falls back to the next candidate instead). Mirrors the
    // by-date hide.
    if (isTerminalStatus(a.status)) return null
    if (!a.staff_id || !a.customer_id) return null
    // Store clamp: the list reads are store-filtered, but this per-id read would
    // otherwise let a branch-restricted staff resolve ANY booking by deep link.
    // Fail closed on a storeless row (a handful of pre-repair imports have no
    // store) — hidden for clamped staff, still visible in cross-store views.
    if (scope.allowedStoreIds) {
      const rowStore = (a as { store_id?: string | null }).store_id ?? null
      if (!rowStore || !scope.allowedStoreIds.includes(rowStore)) return null
    }

    const [cachedCustomers, staffList] = await Promise.all([
      getCachedCustomerList(),
      synqed.staff.list({ page_size: 200 }),
    ])
    const customerName =
      cachedCustomers.find((c) => c.id === a.customer_id)?.name ?? null
    const profileByStaffId = new Map(
      staffList.staff
        .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
        .map((s) => [s.id, s.user_id]),
    )
    // status_set_by (core staff id) -> display name, resolved here since this
    // is the one place that already has the full staff list in hand.
    const nameByStaffId = new Map(staffList.staff.map((s) => [s.id, s.name]))
    // SDK-skew: status_reason/status_set_by/status_set_at aren't in the
    // installed client's Appointment type yet (synqed-core #39); cast to
    // read them.
    const statusSetBy = (a as typeof a & { status_set_by?: string | null }).status_set_by ?? null

    return {
      id: a.id,
      staff_profile_id: profileByStaffId.get(a.staff_id!) ?? a.staff_id!,
      client_id: a.customer_id!,
      start_time: a.starts_at,
      duration_minutes: a.duration_minutes ?? 0,
      title: a.title,
      notes: a.notes,
      karute_record_id: null,
      created_at: a.created_at,
      customers: customerName ? { name: customerName } : null,
      synqed_status: a.status,
      source: a.source,
      status_reason: (a as typeof a & { status_reason?: string | null }).status_reason ?? null,
      status_set_by_name: statusSetBy ? nameByStaffId.get(statusSetBy) ?? null : null,
      status_set_at: (a as typeof a & { status_set_at?: string | null }).status_set_at ?? null,
    }
  } catch {
    return null
  }
}

export async function getAppointmentsInRange(
  fromIso: string,
  toIso: string,
): Promise<Appointment[]> {
  try {
    // Same store scoping as the day agenda (see getAppointmentsByDate): the
    // RBAC-resolved store, not the raw cookie, so week/month overview counts
    // can never include another branch for a store-restricted staff. The
    // fetch + terminal filter live in the shared WithClient helper so the
    // facade appointments-screen GET reads the identical window.
    const [synqed, scope] = await Promise.all([
      getSynqedClient(),
      resolveStoreScope(),
    ])
    // Same fail-closed line as the day read above.
    if (reachesNoStore(scope)) return []
    const { getAppointmentsInRangeWithClient } = await import('@/lib/appointments/by-date')
    // `return await` so a rejection lands in this catch → the []-contract holds.
    return await getAppointmentsInRangeWithClient(synqed, fromIso, toIso, {
      storeId: scope.storeId ?? undefined,
    })
  } catch {
    return []
  }
}

/**
 * 月 grid cells for ANY month — the WEB data door of the 予約 date-jump panel.
 *
 * The phone reads months through the facade GET (`/api/app/v1/screens/
 * appointments?view=month&date=…`), which is BEARER-ONLY by construction
 * (lib/app-api/identity.ts: "a cookie present on a facade request is IGNORED,
 * never used as identity"), so the cookie-session page cannot share that door
 * and gets this action instead. Both doors end at the SAME two functions —
 * getAppointmentsInRangeWithClient for the window, appointmentsToMonthCells
 * for the density rule — so a cell can never mean two different things.
 *
 * Deliberately NOT built on getAppointmentsInRange above: that wrapper's
 * catch→[] contract would turn a failed read into a month of zero-count cells,
 * i.e. "next month is completely free" — the exact lie the panel's
 * pending/failed states exist to prevent. A throw here reaches the panel as
 * its 予約状況を取得できませんでした line, and the month is retried on the
 * next visit.
 *
 * Counts are store-wide, exactly as the 月 view renders them today: the page's
 * staff filter touches reservationViews only (lib/appointments/screen.ts), so
 * no staff scope is applied or accepted here.
 *
 * ⚖ R1-3 — and the month's 新規 is computed HERE, through the same producer the
 * facade's month goes through (`newCountByDay`), mapped by the same
 * `monthCellsToDTO`. This door used to hardcode `newCount: 0` on the identical
 * wire type the phone filled honestly — harmless only while nothing renders it.
 * It fails closed with everything else: no business id, no history read, or a
 * window we could not read to exhaustion, and the cells carry 0 with
 * `newCountKnown: false` rather than a number nobody may print.
 *
 * @param monthKey 'YYYY-MM' in the JST calendar.
 */
export async function getMonthCells(monthKey: string): Promise<MonthCellDTOType[]> {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new Error('getMonthCells: monthKey must be YYYY-MM')
  }
  const { monthStart, monthEnd, rangeFrom, rangeTo } = computeMonthRange(
    new Date(`${monthKey}-01T00:00:00+09:00`),
  )
  const [synqed, scope] = await Promise.all([getSynqedClient(), resolveStoreScope()])
  // Same fail-closed line as the day and range reads above: `storeId ??
  // undefined` is "every store" to core, and a month grid built from every
  // branch's bookings is the same leak in a different shape.
  if (reachesNoStore(scope)) return []
  const { fetchAppointmentWindow, countedClientIds } = await import('@/lib/appointments/by-date')
  // The WINDOW, not the counted-rows wrapper: `truncated` is a fact this door
  // has to carry into the 新規 flag — a month read that stopped short would
  // otherwise report a confident 新規 0 for every day in it.
  const window = await fetchAppointmentWindow(
    synqed,
    rangeFrom.toISOString(),
    rangeTo.toISOString(),
    { storeId: scope.storeId ?? undefined },
  )

  // The 新規 rule's inputs, resolved exactly as the page and the facade resolve
  // them: the store-clamped cached customer list, the history aggregate for
  // the ids this window already returned (so the clamp bounds it — no id can
  // enter from the business-wide roster), and the 回数券 ledger unless the org
  // has 回数券 off, in which case both other doors skip that read too.
  const clientIds = countedClientIds(window)
  const [businessId, orgSettings] = await Promise.all([
    getBusinessId().catch(() => null),
    getOrgSettings(),
  ])
  const customerLens = customerLensFor(scope)
  const [enrichment, packUsage, customers] = await Promise.all([
    businessId && clientIds.length
      ? enrichCustomers(businessId, clientIds)
      : Promise.resolve(new Map()),
    (orgSettings?.ticket_packs_enabled ?? true)
      ? listAllPackUsage()
      : Promise.resolve(new Map() as Awaited<ReturnType<typeof listAllPackUsage>>),
    customerLens === null ? [] : getCachedCustomerList(customerLens),
  ])

  const known = !window.truncated && (enrichment.size > 0 || clientIds.length === 0)
  const cells = appointmentsToMonthCells(
    window.counted,
    monthStart,
    monthEnd,
    jstStartOfToday(),
  )
  // The jump panel reads COUNTS only — no hours, no roster, no store type are
  // fetched here, so these months honestly carry no capacity (no `facts`)
  // rather than a percentage computed from inputs this door never read. The
  // dots stay the count buckets, which is what the panel renders today.
  return monthCellsToDTO(cells, {
    newCounts: {
      byDay: known
        ? newCountByDay(window.counted, {
            customers: new Map(customers.map((c) => [c.id, c])),
            enrichment,
            packUsage,
          })
        : new Map(),
      known,
    },
  })
}

// NOTE (2026-07-27): no caller anywhere yet (no UI, no facade twin, no
// dynamic import — verified by exhaustive grep). Armed deliberately (Liam
// ruling 2026-07-26: everything gets logged) so a future booking-edit
// feature that picks this up is audited by default from day one.
export async function deleteAppointment(appointmentId: string) {
  try {
    // Cancelling / deleting a booking = bookings.manage. Thrown here → caught
    // below → house { error } shape the caller already toasts.
    await requireCapability('bookings.manage')

    const [synqed, auditActor, scope] = await Promise.all([
      getSynqedClient(),
      resolveWebAuditContext(),
      resolveStoreScope(), // store lock — see cancelAppointment
    ])
    const result = await deleteAppointmentCore(synqed, appointmentId, {
      ...auditActor,
      source: 'web',
      requestId: crypto.randomUUID(),
    }, scope)
    if ('success' in result) {
      revalidatePath('/dashboard')
      updateTag('dashboard')
    }
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// NOTE (2026-07-27): no caller anywhere yet (no UI, no facade twin, no
// dynamic import — verified by exhaustive grep). Armed deliberately (Liam
// ruling 2026-07-26: everything gets logged) so a future booking-edit
// feature that picks this up is audited by default from day one.
export async function updateAppointment(
  appointmentId: string,
  updates: { staffProfileId?: string; startTime?: string; durationMinutes?: number },
) {
  try {
    // Rescheduling / reassigning a booking = bookings.manage. Thrown here →
    // caught below → house { error } shape the caller already toasts.
    await requireCapability('bookings.manage')

    const [synqed, auditActor, scope] = await Promise.all([
      getSynqedClient(),
      resolveWebAuditContext(),
      resolveStoreScope(), // store lock — see cancelAppointment
    ])
    const patch: {
      staffId?: string
      startsAt?: string
      endsAt?: string
      durationMinutes?: number
    } = {}

    if (updates.staffProfileId) {
      patch.staffId = await resolveSynqedStaffId(updates.staffProfileId)
    }
    if (updates.startTime) patch.startsAt = updates.startTime
    if (updates.durationMinutes) patch.durationMinutes = updates.durationMinutes

    // If start + duration change, server needs both starts_at and ends_at
    if (updates.startTime && updates.durationMinutes) {
      const start = new Date(updates.startTime)
      patch.endsAt = new Date(start.getTime() + updates.durationMinutes * 60000).toISOString()
    }

    const result = await updateAppointmentCore(synqed, appointmentId, patch, {
      ...auditActor,
      source: 'web',
      requestId: crypto.randomUUID(),
    }, scope)
    if ('success' in result) {
      revalidatePath('/appointments')
      updateTag('dashboard')
    }
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Cancels a booking (status → CANCELLED). Burns NO tickets — a cancellation is
 * ticket-neutral by design; a no-show penalty burn is a separate, explicit
 * staff choice made through the pack-redemption flow, and rides the NO_SHOW
 * status once core adds it.
 *
 * Durability: for a QUICKRESERVE booking still live upstream, the 15-min crawl
 * re-forces SCHEDULED, so a staff cancel only sticks permanently once core lets
 * a staff-set terminal status win the sync. It DOES stick today for import /
 * MANUAL rows that carry no reservationId — the crawl can't see them, which is
 * exactly the class of orphaned bookings this unblocks first.
 */
/**
 * The acting staff for the appointment audit trail, in CORE's staff-id
 * space. getCurrentUserStaffId() returns the Supabase profiles.id the app
 * uses everywhere, but appointments-domain staff columns (the staff_id FK,
 * status_set_by) hold synqed-core staff.id — resolveSynqedStaffId is the
 * canonical translation, the same one appointment create/reassign already
 * uses. Null on ANY failure: the audit stamp is best-effort and must never
 * block the staff's action (core accepts the field as optional).
 */
async function resolveActingStaffId(): Promise<string | null> {
  const profileId = await getCurrentUserStaffId()
  if (!profileId) return null
  return resolveSynqedStaffId(profileId).catch(() => null)
}

export async function cancelAppointment(
  appointmentId: string,
  input?: { reason?: string; burnPack?: boolean },
): Promise<MarkNoShowResult> {
  try {
    // Cancelling a booking = bookings.manage. can()-style contract: callers
    // await without a try/catch and toast the { error } shape.
    await requireCapability('bookings.manage')
    const synqed = await getSynqedClient()
    // Best-effort audit stamp in core's staff-id space (see
    // resolveActingStaffId). Omitted when unresolvable rather than blocking.
    const [actingStaffId, auditActor, scope] = await Promise.all([
      resolveActingStaffId(),
      resolveWebAuditContext(),
      // The STORE lock's input (⚖ 9/16): the core refuses a booking outside
      // this actor's assignment before it mutates anything. Same resolved
      // scope the read plane uses, so the screen and the server agree.
      resolveStoreScope(),
    ])
    const result = await cancelAppointmentCore(synqed, appointmentId, input, actingStaffId, {
      ...auditActor,
      source: 'web',
      requestId: crypto.randomUUID(),
    }, scope)
    if ('success' in result) {
      revalidatePath('/appointments')
      revalidatePath('/dashboard')
      updateTag('dashboard')
    }
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Un-cancels a booking (status → SCHEDULED) — the one-tap exit for a staff
 * mis-cancel or mis-marked no-show, offered from the tombstone row's sheet
 * (キャンセル済み AND 無断キャンセル rows both use this). Safe by construction:
 * status-only, NEVER sends ticket fields both ways — a no-show restore does
 * NOT auto-unburn a redeemed ticket; unburning is a separate, explicit pack
 * action. NOTE (verified against core #39's sync.service): a restore stamps
 * status_source=STAFF, and the crawl's orphan sweep (markOrphanedCancelled)
 * skips ALL staff-touched rows — so restoring a booking the customer really
 * cancelled upstream does NOT self-heal; it stays SCHEDULED until staff
 * cancel it again by hand. Restore is a deliberate staff decision that wins
 * over the crawl, same as the cancel itself.
 */
export async function restoreAppointment(
  appointmentId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    await requireCapability('bookings.manage')
    const synqed = await getSynqedClient()
    // Best-effort audit stamp in core's staff-id space (see
    // resolveActingStaffId). Omitted when unresolvable rather than blocking.
    const [actingStaffId, auditActor, scope] = await Promise.all([
      resolveActingStaffId(),
      resolveWebAuditContext(),
      resolveStoreScope(), // store lock — see cancelAppointment
    ])
    const result = await restoreAppointmentCore(synqed, appointmentId, actingStaffId, {
      ...auditActor,
      source: 'web',
      requestId: crypto.randomUUID(),
    }, scope)
    if ('success' in result) {
      revalidatePath('/appointments')
      revalidatePath('/dashboard')
      updateTag('dashboard')
    }
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Type ALIASES, not `export type { … }` re-exports: Next's 'use server'
// transform registers every export NAME as a server reference at runtime, and
// a re-exported type name has no runtime binding → ReferenceError at build
// ("MarkNoShowError is not defined"). Alias declarations erase cleanly.
export type MarkNoShowError = import('@/lib/appointments/mutations').MarkNoShowError
export type MarkNoShowResult = import('@/lib/appointments/mutations').MarkNoShowResult

/**
 * Marks a booking NO_SHOW (synqed-core #39), optionally burning one session
 * off the customer's oldest active pack. Preconditions, the fixed 無断
 * reason, and the status-first/burn-last ordering all live in the shared
 * core (src/lib/appointments/mutations.ts) — one implementation with the
 * facade twin.
 */
export async function markNoShowAppointment(
  appointmentId: string,
  input: { burnPack: boolean },
): Promise<MarkNoShowResult> {
  try {
    await requireCapability('bookings.manage')
    const synqed = await getSynqedClient()
    // Best-effort audit stamp in core's staff-id space (see
    // resolveActingStaffId — fixes the profile-id-space stamp this action
    // originally shipped with). Omitted when unresolvable, never blocking.
    const [actingStaffId, auditActor, scope] = await Promise.all([
      resolveActingStaffId(),
      resolveWebAuditContext(),
      resolveStoreScope(), // store lock — see cancelAppointment
    ])
    const result = await markNoShowAppointmentCore(synqed, appointmentId, input, actingStaffId, {
      ...auditActor,
      source: 'web',
      requestId: crypto.randomUUID(),
    }, scope)
    if ('success' in result) {
      revalidatePath('/appointments')
      revalidatePath('/dashboard')
      updateTag('dashboard')
    }
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Whether the customer has a burnable pack, for BOTH burn toggles in the
 *  cancel sheet (no-show section + the same-day-cancel checkbox) —
 *  lazy-fetched the first time either surface appears. Same FIFO target the
 *  burn itself uses. Gated like every other booking mutation helper — pack
 *  balances are customer data and must not be probeable without the
 *  capability. */
export async function getBurnablePackSummary(
  customerId: string,
): Promise<{ packId: string; remaining: number } | null> {
  try {
    await requireCapability('bookings.manage')
    const target = pickRedemptionTarget(await listCustomerPacks(customerId))
    return target ? { packId: target.id, remaining: target.remaining } : null
  } catch {
    // No capability / transient API failure — the sheet just doesn't offer
    // the burn toggle. The server-side burn path re-checks everything anyway.
    return null
  }
}
