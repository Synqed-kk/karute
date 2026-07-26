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
import { audit, type AuditSeverity } from '@/lib/audit'

/** Liam ruling 2026-07-26: every booking mutation writes exactly ONE audit
 *  row, emitted from HERE so the web actions and the facade twins can never
 *  double-log. `actor` has no cookie/Bearer context of its own — same
 *  threading contract as createOrUpdateKaruteRecord (src/actions/karute.ts):
 *  facade callers pass their already-resolved identity, web callers resolve
 *  it via resolveWebAuditContext() before calling in. */
type BookingActor = { actorId: string | null; businessId: string | null; source: 'web' | 'facade' }

/** A no-show or a same-day-contact cancel is the one shape where a ticket may
 *  burn or a booked slot silently went unused — both land 'notice' (→ CORE
 *  'warn', the viewer's 警告 strip). Every other booking write is routine
 *  'info'. */
function bookingAuditSeverity(kind: 'no_show' | 'cancel', reason?: string): AuditSeverity {
  if (kind === 'no_show') return 'notice'
  return reason === CANCEL_REASON_SAME_DAY_CONTACT ? 'notice' : 'info'
}

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
    actor: BookingActor
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
    audit({
      category: 'booking',
      action: 'booking.create',
      actorId: deps.actor.actorId,
      actorType: 'staff',
      businessId: deps.actor.businessId,
      targetType: 'customer',
      targetId: appt.customer_id,
      detail: { appointment_id: appt.id, customer_id: appt.customer_id, store_id: appt.store_id },
      source: deps.actor.source,
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
  appt: { customer_id: string; starts_at: string; created_at: string },
  appointmentId: string,
  target: { id: string },
): Promise<'below_zero' | 'burn_failed' | 'already_burned' | null> {
  // The window starts a day before the EARLIER of starts_at and created_at —
  // not starts_at alone (Fable fix-round finding, 2026-07-27). starts_at is
  // mutable: burn → restore → reschedule-forward → re-burn would push the
  // window past an earlier real redemption and double-burn. created_at never
  // changes, so anchoring to it whenever it's earlier can only WIDEN the
  // window — the match below is exact on appointment_id, so a wider window
  // catches MORE true burns, never a false positive.
  // Ceiling (out of accident scope, council item): a booking BACKDATED before
  // its own creation date and then cycled could still evade this check —
  // adversarial-staff territory, not a bug in the normal reschedule flow.
  const anchor = Math.min(new Date(appt.starts_at).getTime(), new Date(appt.created_at).getTime())
  const since = ymdInJst(new Date(anchor - 86_400_000))
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
 *
 * CONTRACT CHANGE (Fable fix-round ruling, 2026-07-27): the booking is now
 * read and terminal-checked on EVERY path, not just the burn path. A plain
 * double-tap cancel used to write a second booking.cancel row for a no-op
 * write, and — worse — could silently overwrite an existing NO_SHOW back to
 * CANCELLED with no error. An audit row must mean a state change actually
 * happened; this matches the double-tap contract markNoShowAppointmentCore
 * already has (refuse an already-terminal row with `already_terminal`).
 */
export async function cancelAppointmentCore(
  synqed: MutationClient,
  appointmentId: string,
  input: { reason?: string; burnPack?: boolean } | undefined,
  actingStaffId: string | null,
  actor: BookingActor,
): Promise<MarkNoShowResult> {
  try {
    // Optional reason chip (taxonomy fix 2026-07-10): a cancel implies the
    // customer/salon COMMUNICATED — the chips record how (advance contact /
    // same-day contact / salon-initiated). Fixed vocabulary only; the audit
    // trail is not a free-text field (same rule the no-show path has).
    // Pure input checks stay before any read — fail fast, no I/O yet.
    if (input?.reason && !(CANCEL_REASONS as readonly string[]).includes(input.reason)) {
      return { error: 'Invalid cancel reason.' }
    }
    // Burn-on-cancel (Liam 2026-07-10: "give the staff a choice"): ONLY a
    // same-day-contact cancel may consume a ticket.
    const burnPack = !!input?.burnPack
    if (burnPack && input?.reason !== CANCEL_REASON_SAME_DAY_CONTACT) {
      return { error: 'A ticket can only be consumed on a same-day-contact cancel.' }
    }

    // ONE read, reused by the burn path below (no second get()) — see the
    // contract-change note above.
    const appt = await synqed.appointments.get(appointmentId)
    if (!appt) return { error: 'Booking not found.' }
    if (isTerminalStatus(appt.status)) {
      return { error: 'This booking is already cancelled or marked as a no-show.', code: 'already_terminal' }
    }

    let burnTarget: { id: string } | null = null
    if (burnPack) {
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
    const updated = await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )

    let burnError: 'below_zero' | 'burn_failed' | 'already_burned' | null = null
    if (burnPack && burnTarget) {
      // Same ordering contract as the no-show burn: status FIRST, burn LAST —
      // a failed burn can never strand a spent ticket, and the partial
      // outcome (cancel recorded, ticket not consumed) reaches the staff.
      burnError = await executeGuardedBurn(synqed, appt, appointmentId, burnTarget)
    }

    // Compliance surface (Fable audit finding, 2026-07-27): burn_pack alone is
    // the staff's CHOICE, not the outcome — burn_error completes it. false+null
    // = no attempt; true+null = ticket consumed; true+<code> = chosen but NOT
    // consumed. Without it a failed/already-done burn would log burn_pack:true
    // and imply a ticket was consumed when it wasn't.
    audit({
      category: 'booking',
      action: 'booking.cancel',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: updated.customer_id,
      severity: bookingAuditSeverity('cancel', input?.reason),
      detail: {
        appointment_id: appointmentId,
        customer_id: updated.customer_id,
        store_id: updated.store_id,
        reason: input?.reason ?? null,
        burn_pack: burnPack,
        burn_error: burnError,
      },
      source: actor.source,
    })

    return burnError ? { success: true, burnError } : { success: true }
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
  actor: BookingActor,
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

    audit({
      category: 'booking',
      action: 'booking.restore',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: appt.customer_id,
      detail: { appointment_id: appointmentId, customer_id: appt.customer_id, store_id: appt.store_id },
      source: actor.source,
    })

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
  actor: BookingActor,
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

    const burnError = target ? await executeGuardedBurn(synqed, appt, appointmentId, target) : null

    // burn_pack/burn_error contract — see cancelAppointmentCore.
    audit({
      category: 'booking',
      action: 'booking.no_show',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: appt.customer_id,
      severity: bookingAuditSeverity('no_show'),
      detail: {
        appointment_id: appointmentId,
        customer_id: appt.customer_id,
        store_id: appt.store_id,
        burn_pack: input.burnPack,
        burn_error: burnError,
      },
      source: actor.source,
    })

    return burnError ? { success: true, burnError } : { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Reschedules and/or reassigns a booking (patch-style: only provided fields
 * change; no other appointment field is ever touched). `patch.staffId` is
 * already in CORE's staff.id space — the caller (the web action) does the
 * profiles.id → staff.id translation via resolveSynqedStaffId before calling
 * in, the same contract createAppointmentCore's deps.synqedStaffId has.
 *
 * NOTE (2026-07-27): updateAppointment/deleteAppointment (src/actions/
 * appointments.ts) have no caller anywhere yet — armed deliberately (Liam
 * ruling 2026-07-26: everything gets logged) so a future booking-edit
 * feature that picks them up is audited by default from day one.
 */
export async function updateAppointmentCore(
  synqed: MutationClient,
  appointmentId: string,
  patch: { staffId?: string; startsAt?: string; endsAt?: string; durationMinutes?: number },
  actor: BookingActor,
): Promise<{ success: true } | { error: string }> {
  try {
    // Terminal guard (Fable fix-round finding, 2026-07-27 — this core had NO
    // read-check while every sibling core does): mirrors
    // restoreAppointmentCore's read-check so a stale sheet can't silently
    // reschedule/reassign a booking that's already cancelled or no-show.
    const appt = await synqed.appointments.get(appointmentId)
    if (!appt) return { error: 'Booking not found.' }
    if (isTerminalStatus(appt.status)) {
      return { error: 'A cancelled or no-show booking cannot be edited.' }
    }

    const sdkPatch: {
      staff_id?: string
      starts_at?: string
      ends_at?: string
      duration_minutes?: number
    } = {}
    if (patch.staffId !== undefined) sdkPatch.staff_id = patch.staffId
    if (patch.startsAt !== undefined) sdkPatch.starts_at = patch.startsAt
    if (patch.endsAt !== undefined) sdkPatch.ends_at = patch.endsAt
    if (patch.durationMinutes !== undefined) sdkPatch.duration_minutes = patch.durationMinutes

    // No provided fields → no mutation → no audit row: calling update({})
    // would be a no-op write that still logged a "something changed" row.
    if (Object.keys(sdkPatch).length === 0) return { success: true }

    // update()'s return rides the FULL Appointment row — customer_id/store_id
    // are always present regardless of which fields were patched (verified at
    // synqed-core's appointment.service.ts toPublic()) — so the audit target
    // reads off it directly, no extra fetch (same reasoning as
    // cancelAppointmentCore's `updated`).
    const updated = await synqed.appointments.update(appointmentId, sdkPatch)

    // ids/codes only, never old/new values — same PII rule as every other
    // booking detail.
    const changed: Array<'staff' | 'time' | 'duration'> = []
    if (patch.staffId !== undefined) changed.push('staff')
    if (patch.startsAt !== undefined || patch.endsAt !== undefined) changed.push('time')
    if (patch.durationMinutes !== undefined) changed.push('duration')

    audit({
      category: 'booking',
      action: 'booking.update',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: updated.customer_id,
      detail: {
        appointment_id: appointmentId,
        customer_id: updated.customer_id,
        store_id: updated.store_id,
        // House convention for a list value in a flat detail record
        // (settings.staff_stores_change, src/actions/stores.ts) — AuditEvent's
        // detail values are scalar-only, so a multi-value field joins here.
        changed: changed.join(','),
      },
      source: actor.source,
    })

    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Hard-deletes a booking. synqed.appointments.delete() returns void and core
 * throws on a missing id, so the row is read FIRST — the only way to have
 * customer_id/store_id in hand for the audit detail once the delete has
 * actually removed the row. Mirrors restoreAppointmentCore's read-check.
 */
export async function deleteAppointmentCore(
  synqed: MutationClient,
  appointmentId: string,
  actor: BookingActor,
): Promise<{ success: true } | { error: string }> {
  try {
    const appt = await synqed.appointments.get(appointmentId)
    if (!appt) return { error: 'Booking not found.' }

    await synqed.appointments.delete(appointmentId)

    // Severity 'notice' — the one deliberate exception to "routine booking
    // writes are 'info'": a hard delete erases the booking row itself, so
    // this audit row becomes the only remaining evidence, which is why it
    // lands on the viewer's notice strip.
    audit({
      category: 'booking',
      action: 'booking.delete',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: appt.customer_id,
      severity: 'notice',
      detail: { appointment_id: appointmentId, customer_id: appt.customer_id, store_id: appt.store_id },
      source: actor.source,
    })

    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
