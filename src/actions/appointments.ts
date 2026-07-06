'use server'

import { revalidatePath, updateTag } from 'next/cache'
import {
  SynqedError,
  type Appointment,
  type AppointmentSource,
  type AppointmentStatus,
} from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { getActiveStoreId } from '@/actions/stores'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getOrgSettings } from '@/actions/org-settings'
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
  synqed_status: AppointmentStatus
  /**
   * Origin of the booking. Bookings imported from external systems
   * (QUICKRESERVE, SALON_BOARD, etc.) start as "pending" in the UI until a
   * staff member confirms them; manually entered bookings skip that state.
   */
  source: AppointmentSource
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

export async function getAppointmentsByDate(dateStr: string, _tzOffsetMinutes: number = 540): Promise<AppointmentRow[]> {
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

    return list.appointments
      // Hide cancelled bookings — the QR sync marks a reservation CANCELLED when
      // it's removed/cancelled upstream ("just don't show it"). This feeds BOTH
      // the 予約 agenda AND the /sessions recording-target picker, so a cancelled
      // slot can never be auto-selected as a recording target. (The week-overview
      // count uses getAppointmentsInRange, which applies the same store view
      // filter but intentionally keeps CANCELLED rows in its totals.)
      .filter((a) => a.status !== 'CANCELLED')
      .map((a) => ({
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
      }))
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
    // A cancelled booking must never resolve as a recording target (the record
    // page falls back to the next candidate instead). Mirrors the by-date hide.
    if (a.status === 'CANCELLED') return null
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
    return list.appointments
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
export async function cancelAppointment(
  appointmentId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    // Cancelling a booking = bookings.manage. can()-style contract: callers
    // await without a try/catch and toast the { error } shape.
    await requireCapability('bookings.manage')
    const synqed = await getSynqedClient()
    await synqed.appointments.update(appointmentId, { status: 'CANCELLED' })
    revalidatePath('/appointments')
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
