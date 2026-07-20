'use server'

import { revalidatePath, updateTag } from 'next/cache'
import type { Appointment, AppointmentSource } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { getActiveStoreId } from '@/actions/stores'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getOrgSettings } from '@/actions/org-settings'
import { isTerminalStatus, type AppStatus } from '@/lib/appointments/status'
import { listCustomerPacks } from '@/lib/packs/store'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import {
  validateAppointmentTime,
  type AppointmentInput,
} from '@/lib/appointments'
import {
  cancelAppointmentCore,
  createAppointmentCore,
  markNoShowAppointmentCore,
  restoreAppointmentCore,
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
    // All three are independent → resolve in parallel (resolveSynqedStaffId may
    // hit the DB; getActiveStoreId is a cookie read). The active-store cookie is
    // an ISOLATION input, not just a view label: it is clamped below against
    // the viewer's RBAC scope so a stale / out-of-scope cookie can't stamp a
    // booking into another branch. Business scope (x-business-id) is still applied
    // by core regardless; this clamp is additive.
    const [synqed, synqedStaffId, activeStore] = await Promise.all([
      getSynqedClient(),
      resolveSynqedStaffId(input.staffProfileId),
      getActiveStoreId(),
    ])
    // Clamp the cookie. Honor it ONLY when the viewer may act in that store
    // (viewAll → allowedStoreIds null, or it's one of their assigned stores —
    // the same clamp getAppointmentById applies to reads); a branch-restricted
    // staff's stale / out-of-scope cookie is treated as unset. The unset path
    // falls through to the core's defaultBookingStore — NOT
    // resolveStoreScope().storeId, which would regress a viewAll staff's
    // unset-cookie booking from "the booked staff's store" to "primary store".
    // The scope lookup only runs when a cookie is actually set.
    let cookieStore: string | null = null
    if (activeStore) {
      const scope = await resolveStoreScope()
      cookieStore =
        !scope.allowedStoreIds || scope.allowedStoreIds.includes(activeStore)
          ? activeStore
          : null
    }
    const result = await createAppointmentCore(synqed, input, {
      synqedStaffId,
      preferredStoreId: cookieStore,
      operatingHours: orgSettings?.operating_hours,
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
    // can never include another branch for a store-restricted staff. The
    // fetch + terminal filter live in the shared WithClient helper so the
    // facade appointments-screen GET reads the identical window.
    const [synqed, scope] = await Promise.all([
      getSynqedClient(),
      resolveStoreScope(),
    ])
    const { getAppointmentsInRangeWithClient } = await import('@/lib/appointments/by-date')
    // `return await` so a rejection lands in this catch → the []-contract holds.
    return await getAppointmentsInRangeWithClient(synqed, fromIso, toIso, {
      storeId: scope.storeId ?? undefined,
    })
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
    const synqed = await getSynqedClient()
    // Best-effort audit stamp in core's staff-id space (see
    // resolveActingStaffId). Omitted when unresolvable rather than blocking.
    const actingStaffId = await resolveActingStaffId()
    const result = await cancelAppointmentCore(synqed, appointmentId, input, actingStaffId)
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
    const actingStaffId = await resolveActingStaffId()
    const result = await restoreAppointmentCore(synqed, appointmentId, actingStaffId)
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
    const actingStaffId = await resolveActingStaffId()
    const result = await markNoShowAppointmentCore(synqed, appointmentId, input, actingStaffId)
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
