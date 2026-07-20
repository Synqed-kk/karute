// Booking mutation cores (design-parity P-B 2/2). The write logic of the web
// appointment actions — create, cancel, no-show, restore, and the ONE guarded
// ticket burn — factored onto an EXPLICIT business-scoped client so the
// facade twins (Bearer path) and the cookie actions run the identical rules
// (the createPackActionWithClient / karute-chat shape). The actions keep the
// cookie concerns: capability checks, client + acting-staff resolution, store
// cookie clamping, Next cache invalidation.
//
// Money rules live HERE and only here:
//   • one appointment burns ONE ticket EVER (tri-state burn-history check,
//     an errored read fails CLOSED);
//   • burn ordering: status FIRST, burn LAST — a failed burn can never
//     strand a spent ticket, and the partial outcome reaches the staff;
//   • cancel is ticket-neutral except the same-day-contact choice; the
//     server enforces the reason⇄burn pairing;
//   • 無断 (no-show) reason is the ONE fixed code, never a staff choice.

import { SynqedError, type SynqedClient } from '@synqed-kk/client'
import type { AppointmentInput } from '@/lib/appointments'
import { validateAppointmentTime } from '@/lib/appointments'
import {
  CANCEL_REASON_SAME_DAY_CONTACT,
  CANCEL_REASONS,
  isTerminalStatus,
  NO_SHOW_REASON_NO_CONTACT,
} from '@/lib/appointments/status'
import {
  addRedemptionWithClient,
  listCustomerPacksWithClient,
} from '@/lib/packs/store'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import { ymdInJst } from '@/lib/date/jst'

type MutationClient = Pick<
  SynqedClient,
  'appointments' | 'packs' | 'staffStores' | 'stores'
>

export type MarkNoShowError = { error: string; code?: 'no_burnable_pack' | 'already_terminal' }
export type MarkNoShowResult =
  | { success: true; burnError?: 'below_zero' | 'burn_failed' | 'already_burned' }
  | MarkNoShowError

/** Store for a booking made from the all-stores view: the booked staff member's
 *  own store when they belong to exactly one, else the business's primary store
 *  (every business has one — listStores lazily creates it). Both lookups degrade
 *  to undefined so a store hiccup can never block taking a booking. */
async function defaultBookingStore(
  synqed: MutationClient,
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

/**
 * Create a booking on the given client. The caller has already resolved the
 * CORE staff id (appointments FK to staff.id, not profiles.id) and clamped
 * its preferred store to the viewer's scope — an absent/out-of-scope store
 * falls through to defaultBookingStore, which still lands a REAL store
 * (never NULL — the June import hole where 28 QR rows landed storeless and
 * dropped out of every per-store calendar).
 */
export async function createAppointmentCore(
  synqed: MutationClient,
  input: AppointmentInput,
  deps: {
    synqedStaffId: string
    preferredStoreId: string | null
    operatingHours: unknown
  },
): Promise<{ id: string } | { error: string }> {
  const hoursError = await validateAppointmentTime(input, deps.operatingHours)
  if (hoursError) return { error: hoursError }

  const startTime = new Date(input.startTime)
  const endTime = new Date(startTime.getTime() + input.durationMinutes * 60000)

  try {
    const storeId =
      deps.preferredStoreId ?? (await defaultBookingStore(synqed, deps.synqedStaffId))
    const appt = await synqed.appointments.create({
      customer_id: input.clientId,
      staff_id: deps.synqedStaffId,
      starts_at: startTime.toISOString(),
      ends_at: endTime.toISOString(),
      duration_minutes: input.durationMinutes,
      title: input.title ?? null,
      notes: input.notes ?? null,
      store_id: storeId ?? undefined,
    })
    return { id: appt.id }
  } catch (err) {
    if (err instanceof SynqedError && err.status === 409) {
      return { error: 'This time slot overlaps with an existing booking.' }
    }
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

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
  synqed: MutationClient,
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
  const burn = await addRedemptionWithClient(synqed, {
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
 * Cancels a booking (status → CANCELLED). Burns NO tickets unless the staff
 * explicitly chose the same-day-contact burn — the server enforces the
 * pairing so the audit trail can never show a burned 事前連絡 cancel.
 * `actingStaffId` is the best-effort audit stamp in CORE's staff-id space
 * (null = omitted, never blocking).
 */
export async function cancelAppointmentCore(
  synqed: MutationClient,
  appointmentId: string,
  input: { reason?: string; burnPack?: boolean } | undefined,
  actingStaffId: string | null,
): Promise<MarkNoShowResult> {
  try {
    // Optional reason chip (taxonomy fix 2026-07-10): a cancel implies the
    // customer/salon COMMUNICATED — the chips record how (advance contact /
    // same-day contact / salon-initiated). Fixed vocabulary only; the audit
    // trail is not a free-text field (same rule the no-show path has).
    if (input?.reason && !(CANCEL_REASONS as readonly string[]).includes(input.reason)) {
      return { error: 'Invalid cancel reason.' }
    }
    // Burn-on-cancel (Liam 2026-07-10: "give the staff a choice"): ONLY a
    // same-day-contact cancel may consume a ticket.
    const burnPack = !!input?.burnPack
    if (burnPack && input?.reason !== CANCEL_REASON_SAME_DAY_CONTACT) {
      return { error: 'A ticket can only be consumed on a same-day-contact cancel.' }
    }

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
      // catch→[] mirrors the web listCustomerPacks wrapper (Greptile P1 on
      // #566): a failed pack read reads as "no burnable pack" — the sheet
      // gets its documented `code` discriminator, the cancel is blocked, and
      // the staff can retry; a throw here would strip the code.
      const target = pickRedemptionTarget(
        await listCustomerPacksWithClient(synqed, appt.customer_id).catch(
          () => [],
        ),
      )
      if (!target) {
        return { error: 'This customer has no burnable pack.', code: 'no_burnable_pack' }
      }
      burnAppt = appt
      burnTarget = target
    }

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
 * mis-cancel or mis-marked no-show. Safe by construction: status-only, NEVER
 * sends ticket fields both ways — a no-show restore does NOT auto-unburn a
 * redeemed ticket; unburning is a separate, explicit pack action. NOTE
 * (verified against core #39's sync.service): a restore stamps
 * status_source=STAFF, and the crawl's orphan sweep skips ALL staff-touched
 * rows — restore is a deliberate staff decision that wins over the crawl.
 */
export async function restoreAppointmentCore(
  synqed: MutationClient,
  appointmentId: string,
  actingStaffId: string | null,
): Promise<{ success: true } | { error: string }> {
  try {
    // Precondition: only a terminal booking can be restored. Without this, a
    // stale tombstone sheet on a second device could clobber a booking another
    // staff already restored and started (SCHEDULED → IN_PROGRESS) back to
    // SCHEDULED with no error. Mirrors markNoShowCore's read-check.
    const appt = await synqed.appointments.get(appointmentId)
    if (!appt) return { error: 'Booking not found.' }
    if (!isTerminalStatus(appt.status)) {
      return { error: 'This booking is already active.' }
    }

    const patch: { status: 'SCHEDULED'; acting_staff_id?: string } = {
      status: 'SCHEDULED',
      ...(actingStaffId ? { acting_staff_id: actingStaffId } : {}),
    }
    // SDK-skew cast — see cancelAppointmentCore.
    await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Marks a booking NO_SHOW, optionally burning one session off the customer's
 * oldest active pack (a no-show is the explicit staff choice to charge a
 * session; `counts_as_visit: false` keeps lifecycle/dormancy honest).
 *
 * Ordering is load-bearing: every precondition is checked FIRST (nothing
 * happened yet if one fails), then the status is marked, then the ticket is
 * burned. The burn goes LAST so its failure can never strand a spent ticket
 * on a still-active booking — the partial outcome is `success + burnError`:
 * the no-show IS recorded, the ticket was NOT consumed, and the UI says both.
 */
export async function markNoShowAppointmentCore(
  synqed: MutationClient,
  appointmentId: string,
  input: { burnPack: boolean },
  actingStaffId: string | null,
): Promise<MarkNoShowResult> {
  try {
    const appt = await synqed.appointments.get(appointmentId)
    if (!appt) return { error: 'Booking not found.' }
    // Already CANCELLED/NO_SHOW (double-open race, stale agenda): refuse
    // rather than re-mark — re-marking is harmless but a second burn is not.
    if (isTerminalStatus(appt.status)) {
      return { error: 'This booking is already cancelled or marked as a no-show.', code: 'already_terminal' }
    }

    // catch→[] — same web-parity contract as the cancel path above.
    const target = input.burnPack
      ? pickRedemptionTarget(
          await listCustomerPacksWithClient(synqed, appt.customer_id).catch(() => []),
        )
      : null
    if (input.burnPack && !target) {
      return { error: 'This customer has no burnable pack.', code: 'no_burnable_pack' }
    }

    // 無断 = no contact + no arrival, by definition — so the reason is the ONE
    // fixed code, never a staff choice (taxonomy fix 2026-07-10).
    const patch: { status: 'NO_SHOW'; status_reason: string; acting_staff_id?: string } = {
      status: 'NO_SHOW',
      status_reason: NO_SHOW_REASON_NO_CONTACT,
      ...(actingStaffId ? { acting_staff_id: actingStaffId } : {}),
    }
    // SDK-skew cast — see cancelAppointmentCore.
    await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )

    if (target) {
      const burnError = await executeGuardedBurn(synqed, appt, appointmentId, target)
      if (burnError) return { success: true, burnError }
    }
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
