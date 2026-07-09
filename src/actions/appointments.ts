'use server'

import { revalidatePath, updateTag } from 'next/cache'
import {
  SynqedError,
  type Appointment,
  type AppointmentSource,
} from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { getActiveStoreId } from '@/actions/stores'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getOrgSettings } from '@/actions/org-settings'
import {
  CANCEL_REASON_SAME_DAY_CONTACT,
  CANCEL_REASONS,
  isTerminalStatus,
  NO_SHOW_REASON_NO_CONTACT,
  type AppStatus,
} from '@/lib/appointments/status'
import { listCustomerPacks, addRedemption } from '@/lib/packs/store'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import { ymdInJst } from '@/lib/date/jst'
import {
  validateAppointmentTime,
  type AppointmentInput,
} from '@/lib/appointments'

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

/** Store for a booking made from the all-stores view: the booked staff member's
 *  own store when they belong to exactly one, else the business's primary store
 *  (every business has one — listStores lazily creates it). Both lookups degrade
 *  to undefined so a store hiccup can never block taking a booking. */
async function defaultBookingStore(
  synqed: Awaited<ReturnType<typeof getSynqedClient>>,
  synqedStaffId: string,
): Promise<string | undefined> {
  try {
    const assigned = (await synqed.staffStores.get(synqedStaffId)).store_ids
    if (assigned.length === 1) return assigned[0]
  } catch {
    /* fall through to primary store */
  }
  try {
    const { stores } = await synqed.stores.list()
    return stores.find((s) => s.is_primary)?.id ?? stores[0]?.id
  } catch {
    return undefined
  }
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

  const orgSettings = await getOrgSettings()
  const hoursError = await validateAppointmentTime(input, orgSettings?.operating_hours)
  if (hoursError) return { error: hoursError }

  const startTime = new Date(input.startTime)
  const endTime = new Date(startTime.getTime() + input.durationMinutes * 60000)

  try {
    // All three are independent → resolve in parallel (resolveSynqedStaffId may
    // hit the DB; getActiveStoreId is a cookie read). The active store is a
    // server-side view label, never client-supplied. Business scope (x-business-id)
    // is untouched; store is only a view/default-booking label, never isolation.
    const [synqed, synqedStaffId, activeStore] = await Promise.all([
      getSynqedClient(),
      resolveSynqedStaffId(input.staffProfileId),
      getActiveStoreId(),
    ])
    // A booking always lands at a real store. The all-stores view (the default)
    // would save store_id NULL here — same hole the June core-side import hit
    // (28 QR-origin rows landed storeless and fell out of every per-store
    // calendar). Closing it app-side before staff get the app; the extra
    // lookups only run in that view, so a pinned-store booking costs nothing.
    const storeId = activeStore ?? (await defaultBookingStore(synqed, synqedStaffId))
    const appt = await synqed.appointments.create({
      customer_id: input.clientId,
      staff_id: synqedStaffId,
      starts_at: startTime.toISOString(),
      ends_at: endTime.toISOString(),
      duration_minutes: input.durationMinutes,
      title: input.title ?? null,
      notes: input.notes ?? null,
      store_id: storeId ?? undefined,
    })
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return { id: appt.id }
  } catch (err) {
    if (err instanceof SynqedError && err.status === 409) {
      return { error: 'This time slot overlaps with an existing booking.' }
    }
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
  // dateStr is a JST calendar day (YYYY-MM-DD). Frame the fetch window as
  // JST midnight → next-day JST midnight by appending the +09:00 offset
  // directly; the runtime then converts to the correct UTC instants for
  // synqed-core's `from`/`to` filter. The legacy tzOffsetMinutes parameter
  // is kept for call-site compatibility but ignored — karute is JST-only.
  const dayStartUTC = new Date(`${dateStr}T00:00:00+09:00`)
  const dayEndUTC = new Date(`${dateStr}T23:59:59.999+09:00`)

  try {
    // Store filter: resolveStoreScope, NOT the raw active-store cookie. For a
    // branch-restricted staff (no stores.viewAll) scope.storeId is ALWAYS one of
    // their assigned stores — the raw cookie is absent on a fresh login, and
    // `store_id: undefined` meant "every store's bookings", which is exactly the
    // cross-store leak the Apple-review account exposed. For cross-store viewers
    // scope.storeId IS the cookie, so their behavior is unchanged. synqed-core
    // always applies the business scope regardless; this filter is additive.
    const [synqed, scope] = await Promise.all([
      getSynqedClient(),
      resolveStoreScope(),
    ])
    const list = await synqed.appointments.list({
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 200,
      store_id: scope.storeId ?? undefined,
    })

    // Customer names come from the already-cached tenant customer list (60s
    // TTL per tenant), so on warm requests there's no extra HTTP roundtrip.
    // Previously this fanned out N parallel customers.get(id) calls per page
    // load — visibly slow once the day had a handful of unique customers.
    const [cachedCustomers, karuteList, staffList] = await Promise.all([
      getCachedCustomerList(),
      synqed.karuteRecords.list({
        from: dayStartUTC.toISOString(),
        to: dayEndUTC.toISOString(),
        page_size: 200,
      }),
      synqed.staff.list({ page_size: 200 }),
    ])
    const nameById = new Map(cachedCustomers.map((c) => [c.id, c.name]))
    const karuteByAppointment = new Map<string, string>()
    for (const k of karuteList.karute_records) {
      if (k.appointment_id) karuteByAppointment.set(k.appointment_id, k.id)
    }
    // synqed staff id → supabase profile id (which equals synqed staff.user_id).
    // Appointments arrive keyed by synqed staff id; the rest of the app keys
    // staff off the supabase profile id, so we translate at the boundary.
    const profileByStaffId = new Map(
      staffList.staff
        .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
        .map((s) => [s.id, s.user_id]),
    )
    // status_set_by (core staff id) -> display name, resolved here since this
    // is the one place that already has the full staff list in hand.
    const nameByStaffId = new Map(staffList.staff.map((s) => [s.id, s.name]))

    return list.appointments
      // Terminal (CANCELLED/NO_SHOW) bookings are hidden by DEFAULT — the QR
      // sync marks a reservation CANCELLED when it vanishes upstream, and this
      // list feeds the /sessions recording-target picker, so a terminal slot
      // must never be auto-selected as a recording target. The 予約 agenda
      // alone passes includeCancelled to render them as thin tombstone rows
      // (grey キャンセル済み / warning-tinted 無断キャンセル) in their original
      // time slot (the freed slot stays visible to staff).
      .filter((a) => (opts?.includeCancelled ? true : !isTerminalStatus(a.status)))
      .map((a) => {
        // SDK-skew: status_reason/status_set_by/status_set_at aren't in the
        // installed client's Appointment type yet (synqed-core #39); cast to
        // read them.
        const statusSetBy = (a as typeof a & { status_set_by?: string | null }).status_set_by ?? null
        return {
          id: a.id,
          staff_profile_id: profileByStaffId.get(a.staff_id) ?? a.staff_id,
          client_id: a.customer_id,
          start_time: a.starts_at,
          duration_minutes: a.duration_minutes ?? 0,
          title: a.title,
          notes: a.notes,
          karute_record_id: karuteByAppointment.get(a.id) ?? null,
          created_at: a.created_at,
          customers: nameById.has(a.customer_id) ? { name: nameById.get(a.customer_id)! } : null,
          synqed_status: a.status,
          source: a.source,
          status_reason: (a as typeof a & { status_reason?: string | null }).status_reason ?? null,
          status_set_by_name: statusSetBy ? nameByStaffId.get(statusSetBy) ?? null : null,
          status_set_at: (a as typeof a & { status_set_at?: string | null }).status_set_at ?? null,
        }
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
      staff_profile_id: profileByStaffId.get(a.staff_id) ?? a.staff_id,
      client_id: a.customer_id,
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
    // can never include another branch for a store-restricted staff.
    const [synqed, scope] = await Promise.all([
      getSynqedClient(),
      resolveStoreScope(),
    ])
    const list = await synqed.appointments.list({
      from: fromIso,
      to: toIso,
      page_size: 500,
      store_id: scope.storeId ?? undefined,
    })
    // Terminal (CANCELLED/NO_SHOW) bookings must not inflate the week/month
    // overview counts, utilization, or density — same invariant the day view
    // enforces ("a no-show is not a visit", AppointmentsView). The week/month
    // card shapes carry no terminal flag, so filtering here is the only gate.
    return list.appointments.filter((a) => !isTerminalStatus(a.status))
  } catch {
    return []
  }
}

export async function deleteAppointment(appointmentId: string) {
  try {
    // Cancelling / deleting a booking = bookings.manage. Thrown here → caught
    // below → house { error } shape the caller already toasts.
    await requireCapability('bookings.manage')

    const synqed = await getSynqedClient()
    await synqed.appointments.delete(appointmentId)
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateAppointment(
  appointmentId: string,
  updates: { staffProfileId?: string; startTime?: string; durationMinutes?: number },
) {
  try {
    // Rescheduling / reassigning a booking = bookings.manage. Thrown here →
    // caught below → house { error } shape the caller already toasts.
    await requireCapability('bookings.manage')

    const synqed = await getSynqedClient()
    const patch: {
      staff_id?: string
      starts_at?: string
      ends_at?: string
      duration_minutes?: number
    } = {}

    if (updates.staffProfileId) {
      patch.staff_id = await resolveSynqedStaffId(updates.staffProfileId)
    }
    if (updates.startTime) patch.starts_at = updates.startTime
    if (updates.durationMinutes) patch.duration_minutes = updates.durationMinutes

    // If start + duration change, server needs both starts_at and ends_at
    if (updates.startTime && updates.durationMinutes) {
      const start = new Date(updates.startTime)
      patch.ends_at = new Date(start.getTime() + updates.durationMinutes * 60000).toISOString()
    }

    await synqed.appointments.update(appointmentId, patch)
    revalidatePath('/appointments')
    updateTag('dashboard')
    return { success: true }
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
    // Optional reason chip (taxonomy fix 2026-07-10): a cancel implies the
    // customer/salon COMMUNICATED — the chips record how (advance contact /
    // same-day contact / salon-initiated). Fixed vocabulary only; the audit
    // trail is not a free-text field (same rule the no-show path has).
    if (input?.reason && !(CANCEL_REASONS as readonly string[]).includes(input.reason)) {
      return { error: 'Invalid cancel reason.' }
    }
    // Burn-on-cancel (Liam 2026-07-10: "give the staff a choice"): ONLY a
    // same-day-contact cancel may consume a ticket — the server enforces the
    // pairing so the audit trail can never show a burned 事前連絡 cancel.
    const burnPack = !!input?.burnPack
    if (burnPack && input?.reason !== CANCEL_REASON_SAME_DAY_CONTACT) {
      return { error: 'A ticket can only be consumed on a same-day-contact cancel.' }
    }
    const synqed = await getSynqedClient()

    // The burn path needs the appointment row + the money guards the no-show
    // burn has always had. The PLAIN path stays get-free and idempotent
    // (re-cancelling a cancelled row is harmless; a second burn is not).
    let burnAppt: { customer_id: string; starts_at: string } | null = null
    let burnTarget: { id: string } | null = null
    if (burnPack) {
      const appt = await synqed.appointments.get(appointmentId)
      if (!appt) return { error: 'Booking not found.' }
      if (isTerminalStatus(appt.status)) {
        return { error: 'This booking is already cancelled or marked as a no-show.', code: 'already_terminal' }
      }
      const target = pickRedemptionTarget(await listCustomerPacks(appt.customer_id))
      if (!target) {
        return { error: 'This customer has no burnable pack.', code: 'no_burnable_pack' }
      }
      burnAppt = appt
      burnTarget = target
    }

    // Best-effort audit stamp in core's staff-id space (see
    // resolveActingStaffId). Omitted when unresolvable rather than blocking.
    const actingStaffId = await resolveActingStaffId()
    const patch: { status: 'CANCELLED'; status_reason?: string; acting_staff_id?: string } = {
      status: 'CANCELLED',
      ...(input?.reason ? { status_reason: input.reason } : {}),
      ...(actingStaffId ? { acting_staff_id: actingStaffId } : {}),
    }
    // SDK-skew cast: @synqed-kk/client 1.11.0's update() types don't declare
    // acting_staff_id yet (synqed-core #39) — the client JSON-stringifies the
    // input verbatim, so the field flows through at runtime.
    await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )
    revalidatePath('/appointments')
    revalidatePath('/dashboard')
    updateTag('dashboard')

    if (burnPack && burnAppt && burnTarget) {
      // Same ordering contract as the no-show burn: status FIRST, burn LAST —
      // a failed burn can never strand a spent ticket, and the partial
      // outcome (cancel recorded, ticket not consumed) reaches the staff.
      const burnError = await executeGuardedBurn(synqed, burnAppt, appointmentId, burnTarget)
      if (burnError) return { success: true, burnError }
    }
    return { success: true }
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

    // Precondition: only a terminal booking can be restored. Without this, a
    // stale tombstone sheet on a second device could clobber a booking another
    // staff already restored and started (SCHEDULED → IN_PROGRESS) back to
    // SCHEDULED with no error. Mirrors markNoShowAppointment's read-check.
    const appt = await synqed.appointments.get(appointmentId)
    if (!appt) return { error: 'Booking not found.' }
    if (!isTerminalStatus(appt.status)) {
      return { error: 'This booking is already active.' }
    }

    // Best-effort audit stamp in core's staff-id space (see
    // resolveActingStaffId). Omitted when unresolvable rather than blocking.
    const actingStaffId = await resolveActingStaffId()
    const patch: { status: 'SCHEDULED'; acting_staff_id?: string } = {
      status: 'SCHEDULED',
      ...(actingStaffId ? { acting_staff_id: actingStaffId } : {}),
    }
    // SDK-skew cast: @synqed-kk/client 1.11.0's update() types don't declare
    // acting_staff_id yet (synqed-core #39) — the client JSON-stringifies the
    // input verbatim, so the field flows through at runtime.
    await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )
    revalidatePath('/appointments')
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export type MarkNoShowError = { error: string; code?: 'no_burnable_pack' | 'already_terminal' }
export type MarkNoShowResult =
  | { success: true; burnError?: 'below_zero' | 'burn_failed' | 'already_burned' }
  | MarkNoShowError

/**
 * The ONE guarded ticket burn — shared by the no-show and the
 * same-day-cancel paths so the money rules can never diverge:
 *   • one appointment burns ONE ticket EVER (the terminal → restore →
 *     re-terminal cycle must not double-burn; the burn-history read is
 *     tri-state and an ERRORED read fails CLOSED — skip + tell staff,
 *     never risk a second charge because the check couldn't run);
 *   • counts_as_visit: false — the customer did not visit;
 *   • always called AFTER the status update (a failed burn can never
 *     strand a spent ticket on a still-active booking).
 * Returns null on success, else the burnError code for the partial-outcome
 * toast (the terminal status IS recorded either way).
 */
async function executeGuardedBurn(
  synqed: Awaited<ReturnType<typeof getSynqedClient>>,
  appt: { customer_id: string; starts_at: string },
  appointmentId: string,
  target: { id: string },
): Promise<'below_zero' | 'burn_failed' | 'already_burned' | null> {
  // The window starts a day before the booking so an earlier burn (stamped
  // with the booking's JST date) is always inside it.
  const since = ymdInJst(new Date(new Date(appt.starts_at).getTime() - 86_400_000))
  const alreadyBurned: boolean | 'unknown' = await synqed.packs
    .listRecentRedemptions(since)
    .then((rows) => rows.some((r) => r.appointment_id === appointmentId))
    .catch(() => 'unknown' as const)
  if (alreadyBurned === 'unknown') return 'burn_failed'
  if (alreadyBurned) return 'already_burned'
  const burn = await addRedemption({
    packId: target.id,
    customerId: appt.customer_id,
    redeemedOn: ymdInJst(new Date(appt.starts_at)),
    appointmentId,
    source: 'manual',
    countsAsVisit: false,
  })
  if (!burn.ok) return burn.error === 'below_zero' ? 'below_zero' : 'burn_failed'
  return null
}

/**
 * Marks a booking NO_SHOW (synqed-core #39), optionally burning one session
 * off the customer's oldest active pack (ticket-neutral is the CANCELLED
 * path's contract, not this one — a no-show is the explicit staff choice to
 * charge a session). `counts_as_visit: false` is sent on the burn so
 * visit-count-driven surfaces (lifecycle, dormancy) don't treat the no-show
 * as a completed visit.
 *
 * Ordering is load-bearing: every precondition is checked FIRST (nothing
 * happened yet if one fails), then the status is marked, then the ticket is
 * burned. The burn goes LAST so its failure can never strand a spent ticket
 * on a still-active booking (and a staff retry can never double-burn) — the
 * partial outcome is `success + burnError`: the no-show IS recorded, the
 * ticket was NOT consumed, and the UI must say both.
 */
export async function markNoShowAppointment(
  appointmentId: string,
  input: { burnPack: boolean },
): Promise<MarkNoShowResult> {
  try {
    await requireCapability('bookings.manage')
    const synqed = await getSynqedClient()

    const appt = await synqed.appointments.get(appointmentId)
    if (!appt) return { error: 'Booking not found.' }
    // Already CANCELLED/NO_SHOW (double-open race, stale agenda): refuse
    // rather than re-mark — re-marking is harmless but a second burn is not.
    if (isTerminalStatus(appt.status)) {
      return { error: 'This booking is already cancelled or marked as a no-show.', code: 'already_terminal' }
    }

    const target = input.burnPack
      ? pickRedemptionTarget(await listCustomerPacks(appt.customer_id))
      : null
    if (input.burnPack && !target) {
      return { error: 'This customer has no burnable pack.', code: 'no_burnable_pack' }
    }

    // Best-effort audit stamp in core's staff-id space (see
    // resolveActingStaffId — fixes the profile-id-space stamp this action
    // originally shipped with). Omitted when unresolvable, never blocking.
    const actingStaffId = await resolveActingStaffId()
    // 無断 = no contact + no arrival, by definition — so the reason is the ONE
    // fixed code, never a staff choice (taxonomy fix 2026-07-10; the old
    // same-day-contacted / first-time chips are legacy-display-only now:
    // contacted cancels belong to cancelAppointment, first-time is DERIVED
    // from no_show_count).
    const patch: { status: 'NO_SHOW'; status_reason: string; acting_staff_id?: string } = {
      status: 'NO_SHOW',
      status_reason: NO_SHOW_REASON_NO_CONTACT,
      ...(actingStaffId ? { acting_staff_id: actingStaffId } : {}),
    }
    // SDK-skew cast: @synqed-kk/client 1.11.0's update() types don't declare
    // NO_SHOW / status_reason / acting_staff_id yet (synqed-core #39) — the
    // client JSON-stringifies the input verbatim, so the fields flow through
    // at runtime.
    await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )
    revalidatePath('/appointments')
    revalidatePath('/dashboard')
    updateTag('dashboard')

    if (target) {
      const burnError = await executeGuardedBurn(synqed, appt, appointmentId, target)
      if (burnError) return { success: true, burnError }
    }
    return { success: true }
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
