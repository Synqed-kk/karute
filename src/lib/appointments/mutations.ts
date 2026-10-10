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
import type { AppointmentInput, BookingTimeRefusal } from '@/lib/appointments'
import {
  bookingLastDay,
  effectiveInterval,
  validateAppointmentInput,
  validateAppointmentTime,
} from '@/lib/appointments'
import {
  CANCEL_REASON_SAME_DAY_CONTACT,
  CANCEL_REASONS,
  isTerminalStatus,
  NO_SHOW_REASON_NO_CONTACT,
} from '@/lib/appointments/status'
import { listCustomerPacksWithClient } from '@/lib/packs/store'
import { attemptIntent, burnWindowSince, defaultLedgerStore, insertP3Intent, systemDepsFor, type IntentRow, type LedgerStore } from '@/lib/packs/use-ledger'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import { fetchBookingDayHours } from '@/lib/appointments/day-hours'
import type { WeekdayKey } from '@/lib/operating-hours'
import { ymdInJst } from '@/lib/date/jst'
import { isCountedBooking } from '@/lib/appointments/by-date'
import { BOOKING_ALREADY_STAFFED } from '@/lib/appointments/assign-refusal'
import { type RecordStoreScope } from '@/lib/auth/store-lock'
import { filterStaffIdsToStore } from '@/lib/auth/store-scope'
import { AppApiError } from '@/lib/app-api/errors'
import { audit, type AuditSeverity } from '@/lib/audit'
import { ensureRecordStoreInScopeAudited } from '@/lib/audit-store-lock'

/** Liam ruling 2026-07-26: every booking mutation writes exactly ONE audit
 *  row, emitted from HERE so the web actions and the facade twins can never
 *  double-log. `actor` has no cookie/Bearer context of its own — same
 *  threading contract as createOrUpdateKaruteRecord (src/lib/karute/karute.core.ts):
 *  facade callers pass their already-resolved identity, web callers resolve
 *  it via resolveWebAuditContext() before calling in. */
type BookingActor = {
  actorId: string | null
  businessId: string | null
  source: 'web' | 'facade' | 'business'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. Optional only because a couple of tests construct a
   *  BookingActor without it — every real caller threads it. */
  requestId?: string
  /** The CLIENT's Idempotency-Key, when there is one — forwarded to core's
   *  redemption dedup (#69) by the ticket burn these two cores share. Set by
   *  the facade twins only (straight off the header); the web actions leave it
   *  unset, since a server-minted key is unique per execution and would dedupe
   *  nothing. Adds no protection HERE today — a booking burn always has an
   *  appointment_id, so the DB's partial unique index (plus the
   *  appointmentAlreadyBurned pre-check) already dedupes it — it is threaded
   *  for consistency with core's design.
   *  NOT requestId: that one is minted per REQUEST on both sides, so it
   *  differs between the two halves of a retried action. */
  idempotencyKey?: string
}

/** THE STORE LOCK'S REFUSAL STRING for every by-id booking write.
 *
 *  It is core's OWN 404 text (synqed-core src/routes/appointments.ts: `{ error:
 *  'Appointment not found' }`), which the SDK re-throws as SynqedError.message
 *  and each core's catch below turns into `{ error: … }`. Using the same string
 *  makes an out-of-store refusal BYTE-IDENTICAL to a genuinely missing id on
 *  BOTH transports (these cores' results ride the facade body verbatim) — no
 *  existence oracle, the R9-2 rule the karute reassign door established.
 *  Pinned by a test against a real SDK-shaped 404. */
const APPOINTMENT_NOT_FOUND = 'Appointment not found'

/** The store lock every by-id booking write runs BEFORE it mutates (⚖ Liam
 *  2026-09-16). Placed right after each core's authoritative
 *  `appointments.get`, so a 銀座-clamped caller handed a 代官山 appointment id —
 *  from a stale screen or a crafted direct call — is refused by the SERVER,
 *  not just hidden by the UI. Throws; each core's own catch maps it to the
 *  house `{ error }` shape, which is also what the facade twins return
 *  verbatim. */
function lockAppointmentStore(
  appt: { store_id?: string | null; customer_id?: string | null } | null | undefined,
  scope: RecordStoreScope,
  actor: BookingActor,
  appointmentId: string,
  /** The door, for the refusal row: 'booking.cancel', 'booking.restore', … */
  door: string,
): void {
  // `appt?.` because the lock runs BEFORE each core's own null check: a row
  // the client could not read is a row whose store cannot be proven, and for a
  // clamped caller that fails closed (sourceStoreOutOfScope's null arm) rather
  // than falling through to a message about a booking they may not have.
  //
  // AUDITED (FRESH-EYES-P1 §5a): a refusal against a PROVEN foreign store
  // files one row — probing another branch's booking ids is exactly what an
  // owner wants to see. An unreadable or legacy store-less booking (store_id
  // null above) refuses the same way but files none: no foreign store was
  // established. The thrown error is unchanged, so the no-oracle guarantee
  // above still holds. Target shape = every other booking row in this file:
  // the CUSTOMER, with the appointment id in detail.
  ensureRecordStoreInScopeAudited({ store_id: appt?.store_id ?? null }, scope, APPOINTMENT_NOT_FOUND, {
    actor,
    category: 'booking',
    targetType: 'customer',
    targetId: appt?.customer_id ?? undefined,
    door,
    detail: { appointment_id: appointmentId },
  })
}

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
  'appointments' | 'packs' | 'staff' | 'staffStores' | 'stores' | 'storePolicies'
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

/** The one refusal for a staff who may not take this booking (inactive, of
 *  another business, or not working at the booking's store). The house
 *  `{ error }` shape every booking refusal uses (BookingTimeRefusal). */
export const STAFF_NOT_ELIGIBLE = 'This staff member cannot take this booking.'

/** The create door's refusal of a staff id that is not a bookable member of
 *  this business — the facade create's sentence since #566, and the web
 *  action's since fix round 6 F3. One definition for both doors. */
export const STAFF_NOT_ON_ROSTER = 'staffProfileId is not a staff member of this business'

/**
 * ⚖ Greptile pass 2 P1 (B2 #1143, fix round 7) — the LIVE active + business
 * judgement of a CORE staff id: one read of core's staff row, never a cache.
 * Shared by the assign gate (refuseIneligibleStaff) and the create core, so a
 * card switched off within any roster cache's TTL is refused on both doors.
 * Throws whatever the read throws: each caller decides what a failed read
 * means (assign refuses; create answers upstream_unavailable). No business on
 * the actor = nothing to judge the staff against = false.
 */
async function staffIsActiveInBusiness(
  synqed: MutationClient,
  synqedStaffId: string,
  businessId: string | null,
): Promise<boolean> {
  const staff = await synqed.staff.get(synqedStaffId)
  return !!staff && !!staff.is_active && !!businessId && staff.business_id === businessId
}

/**
 * ⚖ PR-B Q1 — may this CORE staff take a booking in this store? Active, of
 * this business, and working at the store: a staff_stores row for it or no
 * rows at all (floating) — the picker's own rule, `filterStaffIdsToStore`,
 * never a second one. A booking with no store has no store to judge. Every
 * failed read refuses (fail closed): this is a write gate, not a picker.
 */
async function refuseIneligibleStaff(
  synqed: MutationClient,
  synqedStaffId: string,
  storeId: string | null,
  businessId: string | null,
): Promise<BookingTimeRefusal | null> {
  const refusal = { error: STAFF_NOT_ELIGIBLE }
  // A failed read refuses here (fail closed): this is a write gate.
  const active = await staffIsActiveInBusiness(synqed, synqedStaffId, businessId).catch(() => false)
  if (!active) return refusal
  if (!storeId) return null
  const storeIds = await synqed.staffStores
    .get(synqedStaffId)
    .then((a) => a.store_ids)
    .catch(() => null)
  if (!storeIds) return refusal
  const assignment = { id: synqedStaffId, user_id: null, email: null, store_ids: storeIds }
  const kept = filterStaffIdsToStore([{ id: synqedStaffId }], [assignment], storeId)
  return kept.has(synqedStaffId) ? null : refusal
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
    /** ⚖ R1-2 — the org blob's SAVED weekdays. The store half of the hours
     *  question is read HERE, not handed in: a caller that read it against the
     *  store it happened to be looking at would be asking a different store
     *  than the row lands in. */
    orgSaved: readonly WeekdayKey[] | undefined
    actor: BookingActor
  },
): Promise<{ id: string } | BookingTimeRefusal> {
  // The pure half runs at both doors too, ahead of their side-effecting staff
  // resolver. Repeated here because this core is the LAST wall: a future caller
  // that forgets its own pre-check is still refused.
  const inputError = validateAppointmentInput(input)
  if (inputError) return inputError

  // ⚖ Greptile pass 2 P1 (fix round 7) — the LIVE judgement of the resolved
  // core id, before any read of hours and before any write: an inactive card,
  // or one of another business, is refused with the doors' own roster refusal
  // (a validation AppApiError: the facade's 400, the web action's { error }).
  // The doors' roster gates are cached first checks; this is the authority.
  // OUTSIDE the try below on purpose: that catch flattens every throw into a
  // 200 { error }, and a failed read must stay an outage (facade 502, web
  // failure line), never a refusal and never a booking.
  let staffActive: boolean
  try {
    staffActive = await staffIsActiveInBusiness(synqed, deps.synqedStaffId, deps.actor.businessId)
  } catch (err) {
    throw err instanceof AppApiError
      ? err
      : new AppApiError('upstream_unavailable', 'staff read failed', undefined, err)
  }
  if (!staffActive) throw new AppApiError('validation', STAFF_NOT_ON_ROSTER)

  const startTime = new Date(input.startTime)
  const endTime = new Date(startTime.getTime() + input.durationMinutes * 60000)

  try {
    // ⚖ R1-2 — the door judges the store the row will LAND in. `storeId` is
    // resolved FIRST and then used twice: once to ask that store's own hours,
    // once as the row's store. Before this, the check asked whatever the door's
    // clamp produced — and in a single-store salon that is nothing at all (the
    // store switcher never renders below two stores, so the cookie is never
    // set), while the row still landed in a real store with a real 定休日. The
    // screen painted 休 and the door took the booking.
    const storeId =
      deps.preferredStoreId ?? (await defaultBookingStore(synqed, deps.synqedStaffId))
    // Isolation is unchanged: this id is the door's clamped store, or one
    // derived server-side from the booked staff's own assignment / the tenant
    // primary — never client input, and never another store.
    // ⚖ W0.5 X11 — through the LAST day the booking touches: one running past
    // midnight is judged on both days, so both days' 臨時休業 are read.
    const dayHours = await fetchBookingDayHours(
      synqed,
      storeId,
      startTime,
      deps.orgSaved,
      bookingLastDay(input),
    )
    const hoursError = await validateAppointmentTime(input, deps.operatingHours, dayHours)
    // Refused BEFORE anything reaches core: no appointment row, and no audit row
    // claiming one (⚖ PKT-1c-C S4 — the audit() call below is the only writer in
    // this core and it sits past this return).
    if (hoursError) return hoursError

    const appt = await synqed.appointments.create({
      customer_id: input.clientId,
      staff_id: deps.synqedStaffId,
      starts_at: startTime.toISOString(),
      ends_at: endTime.toISOString(),
      duration_minutes: input.durationMinutes,
      title: input.title ?? null,
      notes: input.notes ?? null,
      store_id: storeId ?? undefined,
      menu_id: input.menuId ?? undefined,
    })
    audit({
      category: 'booking',
      action: 'booking.create',
      actorId: deps.actor.actorId,
      actorType: 'staff',
      businessId: deps.actor.businessId,
      targetType: 'customer',
      targetId: appt.customer_id ?? undefined,
      storeId: appt.store_id ?? undefined,
      detail: { appointment_id: appt.id, customer_id: appt.customer_id, store_id: appt.store_id },
      requestId: deps.actor.requestId,
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

/* burnWindowSince — the burn-dedup window's anchor: a day before the EARLIER
 * of starts_at and created_at — lives in the use ledger now (one definition,
 * read by the P3 attempt's history probe AND deleteAppointmentCore's
 * pre-delete check, so the two windows can never drift apart). Why both
 * anchors (Fable fix-round finding, 2026-07-27): starts_at is mutable; burn →
 * restore → reschedule-forward → re-burn would push a starts_at-only window
 * past an earlier real redemption and double-burn. created_at never changes,
 * so anchoring to it whenever it's earlier can only WIDEN the window — the
 * match is exact on appointment_id, so a wider window catches MORE true burns,
 * never a false positive. Ceiling (council item): a booking BACKDATED before
 * its own creation date and then cycled could still evade this check. */

/** Tri-state "does this booking already hold a live redemption?" — the ONE
 *  burn-history probe, read by the guarded burn, the pre-delete check, and the
 *  NO_SHOW correction below. An errored read is 'unknown' and EVERY caller
 *  fails closed on it; the match is exact on appointment_id, so the window
 *  (burnWindowSince) may only be too WIDE, never too narrow. */
async function appointmentAlreadyBurned(
  synqed: MutationClient,
  appt: { starts_at: string; created_at: string },
  appointmentId: string,
): Promise<boolean | 'unknown'> {
  return synqed.packs
    .listRecentRedemptions(burnWindowSince(appt))
    .then((rows) => rows.some((r) => r.appointment_id === appointmentId))
    .catch(() => 'unknown' as const)
}

/** S125 R1 (P3): the action's loud, actionable failure when the use ledger
 *  cannot take the intent — returned BEFORE any status write (nothing half done). */
export const P3_LEDGER_SAVE_ERROR = '保存できませんでした。もう一度お試しください'

type P3Intent = { store: LedgerStore; row: IntentRow }

/** The P3 pack pick before the intent (design v4.2 § 6a, ruling R-S126-1 f):
 *  a SUCCESSFUL read with no burnable pack → null (today's no_burnable_pack —
 *  staff can act, nothing written); a read ERROR → { id: null }: the intent is
 *  written with pack_id null and the attempt picks inside (§ 2, systemRepick),
 *  a pick error there = pending — never 「no burnable pack」. */
async function pickP3Target(synqed: MutationClient, customerId: string): Promise<{ id: string | null } | null> {
  const packs = await listCustomerPacksWithClient(synqed, customerId).catch(() => null)
  return packs ? pickRedemptionTarget(packs) : { id: null }
}

/**
 * The ONE ticket burn of the no-show and same-day-cancel paths, through the
 * use ledger (design v4.2 § 3 R1/R2, R-S125-9). Step 1 runs BEFORE the status
 * write: the intent row (booking day, booked, system-picked, counts_as_visit
 * false, burn_pack true) — a ledger failure THROWS the loud error and the
 * action stops with nothing written. Step 2 (attemptP3) runs AFTER the status
 * write: R2 inside the attempt re-reads the booking (still NO_SHOW, or
 * CANCELLED same-day-contact + burnPack, else withdrawn 'status_changed'), runs
 * the one-booking-one-burn history probe (burnWindowSince window), and on
 * no_units re-picks the next FIFO pack before refusing (R3-pick).
 * Key: the facade's client Idempotency-Key when there is one (one per
 * gesture); the web action has none, so the intent id is minted here.
 */
async function insertP3IntentOrThrow(
  actor: BookingActor,
  appt: { customer_id: string; starts_at: string },
  appointmentId: string,
  target: { id: string | null },
  source: 'no_show' | 'cancel',
): Promise<P3Intent> {
  try {
    if (!actor.businessId) throw new Error('no business for the ledger')
    const store = await defaultLedgerStore()
    const row = await insertP3Intent(store, {
      businessId: actor.businessId, ownerUserId: actor.actorId, intentId: actor.idempotencyKey, source,
      customerId: appt.customer_id, appointmentId, bookingDay: ymdInJst(new Date(appt.starts_at)),
      packId: target.id, createdBy: null,
    })
    return { store, row }
  } catch {
    throw new Error(P3_LEDGER_SAVE_ERROR)
  }
}

/** The attempt after the status write, and the EXACT burnError map:
 *  settled / pending / withdrawn → null (no amber line for a generic failure —
 *  it is pending, ⚖ 10/3, design § 6a) · refused no_units → 'below_zero' ·
 *  refused already_redeemed → 'already_burned' · any other named final refusal
 *  → 'burn_failed' (staff can act). A throw leaves the written row pending. */
async function attemptP3(synqed: MutationClient, p: P3Intent): Promise<{ burnError: 'below_zero' | 'burn_failed' | 'already_burned' | null; row: IntentRow }> {
  const core = synqed as unknown as Parameters<typeof systemDepsFor>[1]
  const row = await attemptIntent({ store: p.store, synqed: core, ...systemDepsFor(p.row, core) }, p.row).catch(() => p.row)
  if (row.state !== 'refused') return { burnError: null, row }
  return { burnError: row.refused_code === 'no_units' ? 'below_zero' : row.refused_code === 'already_redeemed' ? 'already_burned' : 'burn_failed', row }
}

/** A26: the audit row carries the intent id + its ledger state. */
const ledgerDetail = (row: IntentRow | null): Record<string, string> => (row ? { intent_id: row.id, ledger_state: row.state } : {})

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
  scope: RecordStoreScope,
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
    // Store lock BEFORE every other answer this row could give (terminal
    // state, customer presence): those are facts about a booking the caller
    // may not have, so leaking them is the same oracle the refusal closes.
    lockAppointmentStore(appt, scope, actor, appointmentId, 'booking.cancel')
    if (!appt || !appt.customer_id) return { error: 'Booking not found.' }
    if (isTerminalStatus(appt.status)) {
      return { error: 'This booking is already cancelled or marked as a no-show.', code: 'already_terminal' }
    }

    let burnTarget: { id: string | null } | null = null
    if (burnPack) {
      const target = await pickP3Target(synqed, appt.customer_id)
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
    // R1 (P3): the ledger intent BEFORE the status write; a throw = the loud error, nothing written.
    const intent = burnPack && burnTarget
      ? await insertP3IntentOrThrow(actor, appt as typeof appt & { customer_id: string }, appointmentId, burnTarget, 'cancel')
      : null
    // SDK-skew cast: @synqed-kk/client 1.11.0's update() types don't declare
    // acting_staff_id yet (synqed-core #39) — the client JSON-stringifies the
    // input verbatim, so the field flows through at runtime.
    const updated = await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )

    let burnError: 'below_zero' | 'burn_failed' | 'already_burned' | null = null
    let ledgerRow: IntentRow | null = null
    if (intent) {
      // Same ordering contract as the no-show burn: status FIRST, the core
      // call LAST — a failed burn can never strand a spent ticket.
      ({ burnError, row: ledgerRow } = await attemptP3(synqed, intent))
    }
    // 自動消化 parity (packet 11 fix round, blind-round F4) — the SAME rider the
    // no-show path got at L1#6, and the settings copy is why it matters: it
    // promises a cancel never consumes a ticket, so a plain cancel of a booking
    // the cron already burned looked like a clean success while a ticket was
    // gone. WARN-ONLY: nothing is unburned here (undo is a separate, explicit
    // pack action). Only a definite `true` speaks — an unreadable history
    // changes nothing on this path (it creates no charge either way), so it
    // must not invent a warning.
    // Gated on the ATTEMPT, not the staff's checkbox (round 2 G8): burn_error
    // null under burn_pack:true reads as "ticket consumed" per the contract
    // below, so any path that reaches the audit having burned nothing must run
    // this probe. Today the no-burnable-pack early return above dominates that
    // case; the gate is what keeps it dominated if it ever stops.
    if (!(burnPack && burnTarget)) {
      const prior = await appointmentAlreadyBurned(synqed, appt, appointmentId)
      if (prior === true) burnError = 'already_burned'
    }

    // Compliance surface (Fable audit finding, 2026-07-27): burn_pack alone is
    // the staff's CHOICE, not the outcome — burn_error completes it. false+null
    // = no attempt; true+null = ticket consumed; true+<code> = chosen but NOT
    // consumed; false+already_burned = no attempt AND a ticket was already
    // spent on this booking (the auto-burn case above — same shape the
    // booking.no_show row uses). Without it a failed/already-done burn would
    // log burn_pack:true and imply a ticket was consumed when it wasn't.
    audit({
      category: 'booking',
      action: 'booking.cancel',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: updated.customer_id ?? undefined,
      storeId: updated.store_id ?? undefined,
      severity: bookingAuditSeverity('cancel', input?.reason),
      detail: {
        appointment_id: appointmentId,
        customer_id: updated.customer_id,
        store_id: updated.store_id,
        reason: input?.reason ?? null,
        burn_pack: burnPack,
        burn_error: burnError,
        ...ledgerDetail(ledgerRow),
      },
      requestId: actor.requestId,
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
  scope: RecordStoreScope,
): Promise<{ success: true } | { error: string }> {
  try {
    // Precondition: only a terminal booking can be restored. Without this, a
    // stale tombstone sheet on a second device could clobber a booking another
    // staff already restored and started (SCHEDULED → IN_PROGRESS) back to
    // SCHEDULED with no error. Mirrors markNoShowCore's read-check.
    const appt = await synqed.appointments.get(appointmentId)
    lockAppointmentStore(appt, scope, actor, appointmentId, 'booking.restore') // see cancelAppointmentCore — lock first
    if (!appt || !appt.customer_id) return { error: 'Booking not found.' }
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
      targetId: appt.customer_id ?? undefined,
      storeId: appt.store_id ?? undefined,
      detail: { appointment_id: appointmentId, customer_id: appt.customer_id, store_id: appt.store_id },
      requestId: actor.requestId,
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
  scope: RecordStoreScope,
): Promise<MarkNoShowResult> {
  try {
    const appt = await synqed.appointments.get(appointmentId)
    lockAppointmentStore(appt, scope, actor, appointmentId, 'booking.no_show') // see cancelAppointmentCore — lock first
    if (!appt || !appt.customer_id) return { error: 'Booking not found.' }
    // Already CANCELLED/NO_SHOW (double-open race, stale agenda): refuse
    // rather than re-mark — re-marking is harmless but a second burn is not.
    if (isTerminalStatus(appt.status)) {
      return { error: 'This booking is already cancelled or marked as a no-show.', code: 'already_terminal' }
    }

    // Same pick contract as the cancel path above (pickP3Target).
    const target = input.burnPack ? await pickP3Target(synqed, appt.customer_id) : null
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
    // R1 (P3): the ledger intent BEFORE the status write; a throw = the loud error, nothing written.
    const intent = target
      ? await insertP3IntentOrThrow(actor, appt as typeof appt & { customer_id: string }, appointmentId, target, 'no_show')
      : null
    // SDK-skew cast — see cancelAppointmentCore.
    await synqed.appointments.update(
      appointmentId,
      patch as unknown as Parameters<typeof synqed.appointments.update>[1],
    )

    const attempted = intent ? await attemptP3(synqed, intent) : null
    let burnError = attempted?.burnError ?? null
    // 自動消化 correction (packet 11 rider, L1#6). With auto mode on, a booking
    // the cron already burned can still be corrected to NO_SHOW afterwards. The
    // burn path is already safe (guard 1 → 'already_burned', never a second
    // charge); the NO-burn path was SILENT — staff chose "don't charge" and were
    // never told a ticket had already gone. Surface it. Only a definite `true`
    // speaks: an unreadable history changes nothing here (this path creates no
    // charge either way), so it must not invent a warning.
    // KNOWN GAP — the redemption's counts_as_visit stays true. Flipping it means
    // soft-remove + recreate, which needs the redemption's ID, and core exposes
    // NO read that returns one (listRecentRedemptions / listRedemptions select
    // no id; PacksClient has no getRedemption — same wall documented at
    // audit-policy.ts's customer.pack.undoRedemption entry). Fixing it is a core
    // ask, not an app change. Nothing reads counts_as_visit today, so the stale
    // flag is inert until a lifecycle/dormancy consumer lands.
    if (!target) {
      const prior = await appointmentAlreadyBurned(synqed, appt, appointmentId)
      if (prior === true) burnError = 'already_burned'
    }

    // burn_pack/burn_error contract — see cancelAppointmentCore.
    audit({
      category: 'booking',
      action: 'booking.no_show',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: appt.customer_id ?? undefined,
      storeId: appt.store_id ?? undefined,
      severity: bookingAuditSeverity('no_show'),
      detail: {
        appointment_id: appointmentId,
        customer_id: appt.customer_id,
        store_id: appt.store_id,
        burn_pack: input.burnPack,
        burn_error: burnError,
        ...ledgerDetail(attempted?.row ?? null),
      },
      requestId: actor.requestId,
      source: actor.source,
    })

    return burnError ? { success: true, burnError } : { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// One definition, client-safe (the 担当未定 sheet recognises it): re-exported.
export { BOOKING_ALREADY_STAFFED }

/**
 * ⚖ PR-B — give a booking that has NO staff its staff: the only write the
 * 担当未定 sheet makes, on both transports (the web action
 * assignAppointmentStaff and the facade's POST …/assign-staff). The row is read
 * after the store lock; one that already has a staff is refused (reassignment
 * is out of PR-B); then the shared staff check (active, this business, works at
 * the booking's store) and a staff-only write with its audit row — all inside
 * updateAppointmentCore, so the lock, the guards and the audit stay one path.
 * Core has no compare-and-set, so two taps inside the same read→write gap can
 * still both land; a tap on a booking whose staff is already SAVED cannot.
 *
 * ⚖ FIX ROUND 4 (R3) — each door hands in its OWN resolver (profile id → core
 * staff id; the web's resolveSynqedStaffId, the facade's ForBusiness twin),
 * never a resolved id. The resolver is create-on-miss and self-heals, so it
 * runs only after the store lock and the BLOCK / terminal / already-staffed
 * refusals: a refused assign never reaches it, so it never writes a core
 * staff row on a booking the caller may not touch.
 */
export async function assignStaffToBooking(
  synqed: MutationClient,
  appointmentId: string,
  resolveStaffId: () => Promise<string>,
  actor: BookingActor,
  scope: RecordStoreScope,
): Promise<{ success: true } | BookingTimeRefusal> {
  return updateAppointmentCore(
    synqed,
    appointmentId,
    {},
    actor,
    // A staff-only patch never opens the time gate: no hours are consulted.
    { operatingHours: undefined, orgSaved: undefined },
    scope,
    { unassigned: true, resolveStaffId },
  )
}

/** A throw from a door's staff resolver (R3), carried past
 *  updateAppointmentCore's catch so each door answers it exactly as before the
 *  resolver moved inside (the facade's 400 / 5xx split, the web action's
 *  coreFailureLine) — never turned into a booking `{ error }` here. */
class StaffResolverFailure {
  constructor(readonly cause: unknown) {}
}

/**
 * Reschedules and/or reassigns a booking (patch-style: only what the patch
 * names changes — the staff, the time, or both; no other appointment field is
 * ever touched. A time change always reaches core as the whole judged
 * interval, see ⚖ W0.5 fix 1 below). `patch.staffId` is
 * already in CORE's staff.id space — the caller (the web action) does the
 * profiles.id → staff.id translation via resolveSynqedStaffId before calling
 * in, the same contract createAppointmentCore's deps.synqedStaffId has.
 *
 * NOTE (2026-07-27): updateAppointment/deleteAppointment (src/actions/
 * appointments.ts) have no caller anywhere yet — armed deliberately (Liam
 * ruling 2026-07-26: everything gets logged) so a future booking-edit
 * feature that picks them up is audited by default from day one.
 *
 * D-NOTE (⚖ PKT-1c-C S3, 2026-09-16): this core had NO time validation of any
 * kind — a reschedule could land a booking on a closed day, or outside opening
 * hours, on a path create has always refused. It now runs the SAME
 * `validateAppointmentTime` create runs, so the rule has exactly one home and a
 * reschedule can never be the way around it. Two consequences worth naming:
 *   • the hours WINDOW check is new here too (not just the closed day) — that
 *     is the point of one home, and the path has no caller to regress;
 *   • the day is resolved against the BOOKING'S OWN store (`appt.store_id`,
 *     already read for the terminal guard), which is stricter and more correct
 *     than create's clamp: a reschedule cannot be judged by whichever store the
 *     staffer happens to be looking at.
 * Whatever the patch leaves out falls back to the booking's stored value, so a
 * duration-only edit is still judged against the real start.
 *
 * ⚖ W0.5 X11 (2026-09-28): the gate used to ask only `startsAt` and
 * `durationMinutes`, so a patch carrying `endsAt` ALONE — an end-only stretch
 * past closing — skipped the hours question entirely and went straight to
 * core, which has no time-of-day check. Latent (the one caller always sends
 * endsAt with startsAt), but the contract was open. Any time field now opens
 * the gate, and the patch is normalised to ONE effective interval
 * (effectiveInterval) before it is judged, on every day it touches.
 *
 * ⚖ W0.5 fix 1 (2026-09-28): the payload used to carry only the fields the
 * patch named. Core fills an omitted starts_at/ends_at from the stored row and
 * never derives ends_at from duration_minutes (a label there), so the judged
 * interval and the stored one could differ — a start-only move of 17:00–18:00
 * to 16:00 was judged 16:00–17:00 and stored 16:00–18:00. Whenever the time
 * gate opens, core now gets the WHOLE judged interval: starts_at, ends_at, and
 * duration_minutes as the judged whole minutes. A patch that touches no time
 * field sends exactly what it named.
 */
export async function updateAppointmentCore(
  synqed: MutationClient,
  appointmentId: string,
  patch: { staffId?: string; startsAt?: string; endsAt?: string; durationMinutes?: number },
  actor: BookingActor,
  hours: {
    operatingHours: unknown
    /** The org blob weekdays a human actually saved (org settings'
     *  `operating_hours_saved`). Required, like create's `dayHours`: an
     *  optional one would be a door left open by omission. */
    orgSaved: readonly WeekdayKey[] | undefined
  },
  scope: RecordStoreScope,
  /** PR-B: refuse a booking that already has a staff (assignStaffToBooking).
   *  `resolveStaffId` (R3): the staff is resolved only after the lock and the
   *  refusals below, and becomes the patch's staffId. */
  only: { unassigned?: boolean; resolveStaffId?: () => Promise<string> } = {},
): Promise<{ success: true } | BookingTimeRefusal> {
  try {
    // Terminal guard (Fable fix-round finding, 2026-07-27 — this core had NO
    // read-check while every sibling core does): mirrors
    // restoreAppointmentCore's read-check so a stale sheet can't silently
    // reschedule/reassign a booking that's already cancelled or no-show.
    const appt = await synqed.appointments.get(appointmentId)
    lockAppointmentStore(appt, scope, actor, appointmentId, 'booking.update') // see cancelAppointmentCore — lock first
    if (!appt || !appt.customer_id) return { error: 'Booking not found.' }
    if (isTerminalStatus(appt.status)) {
      return { error: 'A cancelled or no-show booking cannot be edited.' }
    }
    // ⚖ FIX ROUND 3 item 8 (B2-1) — the assign door takes only a counted
    // BOOKING: a BLOCK (オーナー業務, a bed hold) is not a booking, so it reads as
    // "not found", the same shape as the guards above. The kind rule is
    // by-date's isCountedBooking — never a second literal here.
    if (only.unassigned && !isCountedBooking(appt)) return { error: 'Booking not found.' }
    if (only.unassigned && appt.staff_id) return { error: BOOKING_ALREADY_STAFFED }

    // ⚖ FIX ROUND 4 (R3) — only now, past the lock and every refusal above,
    // is the door's staff resolved (it may create or link a core staff row).
    if (only.resolveStaffId) {
      const resolve = only.resolveStaffId
      const staffId = await resolve().catch((err: unknown) => {
        throw new StaffResolverFailure(err)
      })
      patch = { ...patch, staffId }
    }

    // ⚖ PR-B Q1 — the staff written must be able to take THIS booking. Both
    // transports (the web action and the facade's assign-staff) land here,
    // after the staff id is resolved and before anything reaches core.
    if (patch.staffId !== undefined) {
      const staffRefusal = await refuseIneligibleStaff(
        synqed,
        patch.staffId,
        appt.store_id ?? null,
        actor.businessId,
      )
      if (staffRefusal) return staffRefusal
    }

    // ⚖ W0.5 fix 1 — the interval judged below is the interval core stores.
    // Core fills an omitted starts_at/ends_at from the stored row and never
    // derives ends_at from duration_minutes (a label there), so a payload of
    // only the named fields lands a DIFFERENT booking than the one judged
    // (stored 17:00–18:00 + { startsAt: 16:00 } → judged 16:00–17:00, stored
    // 16:00–18:00). Set only when the time gate opens and the door says yes.
    let judged: { starts_at: string; ends_at: string; duration_minutes: number } | null = null

    // ⚖ PKT-1c-C S3 — a reschedule goes through the same door. Only a patch
    // that MOVES the booking in time is judged; a staff-only reassign leaves the
    // time untouched and has no hours question to answer.
    // ⚖ W0.5 X11 — "moves in time" includes the END: an end-only stretch is a
    // time change like any other.
    if (
      patch.startsAt !== undefined ||
      patch.endsAt !== undefined ||
      patch.durationMinutes !== undefined
    ) {
      // ONE interval, whatever shape the patch has. The stored interval is
      // starts_at/ends_at, which core's row always carries (duration_minutes is
      // a nullable label on BLOCK rows and some imports — never the fallback).
      const interval = effectiveInterval(
        { startsAt: appt.starts_at, endsAt: appt.ends_at },
        patch,
      )
      if ('error' in interval) return interval
      const startTime = interval.startsAt.toISOString()
      // Whole minutes, rounded UP — the LABEL (core's duration_minutes). The
      // hours judge never reads it for the end: a legacy row with seconds made
      // start-floor + ceil ≠ the real end (17:30:30 → 18:00:15 was judged as
      // 17:30 + 30 = 18:00), so the exact end rides in as endTime below.
      const durationMinutes = Math.ceil(
        (interval.endsAt.getTime() - interval.startsAt.getTime()) / 60_000,
      )
      // ⚖ R1-2 — the same rule as create: the day is judged against the store
      // the row LANDS in. A row whose store_id is null (BLOCK rows, some
      // imports) used to reach `fetchBookingDayHours(null)`, which asks nobody
      // — so any storeless booking could be rescheduled onto a 定休日 or a
      // 臨時休業 with nothing to refuse it. It resolves the same way create
      // does, off the booking's own staff.
      const landingStaffId = patch.staffId ?? appt.staff_id
      const landingStoreId =
        appt.store_id ??
        (landingStaffId ? await defaultBookingStore(synqed, landingStaffId) : null)
      const timeInput = {
        staffProfileId: patch.staffId ?? '',
        clientId: appt.customer_id,
        startTime,
        durationMinutes,
        // ⚖ W0.5 fix 2 — the judge compares the EXACT end (seconds and all),
        // the instant core receives below; durationMinutes stays the label.
        endTime: interval.endsAt.toISOString(),
        // No offset: the judgement is JST-only for every caller (W0.5 fix 2).
      }
      const dayHours = await fetchBookingDayHours(
        synqed,
        landingStoreId,
        interval.startsAt,
        hours.orgSaved,
        // Every day the interval touches (X11), from the same arithmetic the
        // walk inside validateAppointmentTime uses.
        bookingLastDay(timeInput),
      )
      const timeError = await validateAppointmentTime(timeInput, hours.operatingHours, dayHours)
      // Refused before `appointments.update` — the existing row is not touched
      // and no audit row claims it was.
      if (timeError) return timeError
      // What was judged is what core gets: the whole pair, and the label as
      // the judged whole minutes (an end-only stretch never leaves it stale).
      judged = {
        starts_at: startTime,
        ends_at: interval.endsAt.toISOString(),
        duration_minutes: durationMinutes,
      }
    }

    const sdkPatch: {
      staff_id?: string
      starts_at?: string
      ends_at?: string
      duration_minutes?: number
    } = {}
    if (patch.staffId !== undefined) sdkPatch.staff_id = patch.staffId
    // A time patch sends the WHOLE judged interval, never only the fields it
    // named; a patch that touched no time field adds none.
    if (judged) {
      sdkPatch.starts_at = judged.starts_at
      sdkPatch.ends_at = judged.ends_at
      sdkPatch.duration_minutes = judged.duration_minutes
    }

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
      targetId: updated.customer_id ?? undefined,
      storeId: updated.store_id ?? undefined,
      detail: {
        appointment_id: appointmentId,
        customer_id: updated.customer_id,
        store_id: updated.store_id,
        // House convention for a list value in a flat detail record
        // (settings.staff_stores_change, src/actions/stores.ts) — AuditEvent's
        // detail values are scalar-only, so a multi-value field joins here.
        changed: changed.join(','),
        // The assigned staff's core id (an id, never a name) — only when the
        // staff changed, so an assign row says WHO was assigned.
        ...(changed.includes('staff') ? { staff_id: patch.staffId } : {}),
      },
      requestId: actor.requestId,
      source: actor.source,
    })

    return { success: true }
  } catch (err) {
    if (err instanceof StaffResolverFailure) throw err.cause
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
  scope: RecordStoreScope,
): Promise<{ success: true } | { error: string }> {
  try {
    const appt = await synqed.appointments.get(appointmentId)
    lockAppointmentStore(appt, scope, actor, appointmentId, 'booking.delete') // see cancelAppointmentCore — lock first
    if (!appt || !appt.customer_id) return { error: 'Booking not found.' }

    // Burn-dedup guard (FIX 8, Fable fix-round finding, 2026-07-27): the burn
    // history keys on appointment_id, so a delete-then-recreate would mint a
    // NEW id and sidestep it entirely — orphaning the burned redemption's
    // evidence and letting the recreated booking burn a second ticket. Same
    // tri-state fail-CLOSED rule the P3 history probe has: an errored read must
    // never be silently treated as "never burned" here either. Nothing has
    // mutated yet, so both refusals below carry no audit row. (A deliberate
    // relax of this — e.g. an explicit "delete anyway" override — is a
    // council decision, not made here.)
    const burned = await appointmentAlreadyBurned(synqed, appt, appointmentId)
    if (burned === 'unknown') {
      return { error: "Could not verify this booking's ticket history — try again." }
    }
    if (burned) {
      return { error: 'This booking consumed a ticket — cancel or restore it instead of deleting.' }
    }

    await synqed.appointments.delete(appointmentId)

    // Severity 'notice' — a deliberate exception to routine-info bookings: a
    // hard delete erases the booking row itself, so this audit row becomes
    // the only remaining evidence, which is why it lands on the viewer's
    // notice strip.
    audit({
      category: 'booking',
      action: 'booking.delete',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'customer',
      targetId: appt.customer_id ?? undefined,
      storeId: appt.store_id ?? undefined,
      severity: 'notice',
      detail: { appointment_id: appointmentId, customer_id: appt.customer_id, store_id: appt.store_id },
      requestId: actor.requestId,
      source: actor.source,
    })

    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
