import 'server-only'

// The six client-threaded 回数券 (pack) cores, moved out of src/actions/packs.ts
// (PKT-SEC-CORES-D4, 2026-09-23). Every runtime export of a 'use server' module
// is registered as a browser-callable server action with no authentication of
// its own — and passing a client object as the first argument is no barrier,
// because the reply decoder revives nested references. These six are INTERNAL
// helpers that move MONEY (pack creation with the server-derived 合計金額,
// session burns): they take an already-scoped client + staff id and trust the
// caller to have gated the request. They live here, in a server-only module
// with NO directive, so the only way in is a server-side import — the web
// actions in src/actions/packs.ts and the facade routes under
// src/app/api/app/v1/customers/[id]/ (packs POST, packs/redeem,
// packs/reconcile/dismiss, packs/contact, packs/alerts/dismiss, lifecycle).
//
// The input types and the channel list the six need came with them;
// revalidateProfile (Next cache) is a web-wrapper concern and stayed behind.
// The bodies moved byte-identical, so where a doc comment below points "below"
// at a web action (redeemSessionAction, the cookie-side requireCapability
// try/catch), that action lives in src/actions/packs.ts.

import {
  listCustomerPacksWithClient,
  addVisitReconcileDismissalWithClient,
  addCustomerContactWithClient,
  addPackAlertDismissalWithClient,
  addRedemptionWithClient,
  createPackWithClient,
  findCustomerAppointmentForDateWithClient,
  setCustomerLifecycleWithClient,
  type ContactChannel,
  type CreatePackInput,
} from '@/lib/packs/store'
import { isSameJstDay, ymdInJst } from '@/lib/date/jst'
import type { SynqedClient } from '@synqed-kk/client'
import {
  nextPurchaseRound,
  type LifecycleStatus,
  type PackKind,
} from '@/lib/packs/types'

export interface CreatePackActionInput {
  customerId: string
  kind: PackKind
  packSize: number
  unitPrice: number
  /** ignored — server always derives totalPrice = unitPrice × packSize (see
   *  below). Kept in the shape only so the facade's baked-shell-compat field
   *  still type-checks through untouched. */
  totalPrice?: number | null
  purchasedAt?: string | null
  notes?: string | null
}

/** Create-pack core (SINGLE SOURCE): the money rules (single⇒packSize 1,
 *  server-derived 購入回数 + 合計金額) live HERE, threaded a business-scoped
 *  client + the acting staff id. The web action wraps with the cookie client;
 *  the facade wraps with newSynqedClient + selfStaffId. */
export async function createPackActionWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  staffId: string | null,
  input: CreatePackActionInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerId) return { ok: false, error: 'customerId required' }
  if (!Number.isFinite(input.packSize) || input.packSize <= 0)
    return { ok: false, error: 'packSize must be > 0' }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0)
    return { ok: false, error: 'unitPrice must be >= 0' }
  // A single session is one session — server-enforced so no future caller can
  // send kind:'single' with packSize 10 and inflate the derived total_price.
  if (input.kind === 'single' && input.packSize !== 1)
    return { ok: false, error: 'single kind must have packSize 1' }
  // SERVER-derived 購入回数, no caller override (Greptile P1 on #489: a facade
  // caller could force round 1 and re-trigger 初回 pricing): pack → highest
  // STORED round + 1, never a row count (imports collapsed history to one row
  // per customer; business-wide, store-blind); single/subscription → 0
  // (unnumbered), matching the store convention.
  const purchaseRound =
    input.kind === 'pack'
      ? nextPurchaseRound((await listCustomerPacksWithClient(synqed, input.customerId)).filter(pack => pack.customer_id === input.customerId))
      : 0
  // SERVER-derived 合計金額: unit × size (the app prices per-session), so pack
  // revenue is never zeroed. ALWAYS derived — no caller override (a facade
  // caller could otherwise send a discounted totalPrice and pocket the
  // difference; input.totalPrice is ignored, never read). One rule covers
  // every present + future caller. Belt-and-braces (F6, PR-0 fix round):
  // createPackWithClient (src/lib/packs/store.ts) derives the SAME formula
  // itself now too, so a caller-supplied totalPrice can't reach the DB write
  // even from a future caller that skips this action entirely.
  const totalPrice = input.unitPrice * input.packSize
  const result = await createPackWithClient(synqed, {
    ...(input as CreatePackInput),
    totalPrice,
    purchaseRound,
    source: 'manual',
    createdBy: staffId,
  })
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export interface RedeemSessionActionInput {
  packId: string
  customerId: string
  redeemedOn?: string
  /** The booking this consumption covers — links the redemption to the visit
   *  so the 未処理来店 reconciler can tell covered visits from missed ones. */
  appointmentId?: string | null
  karuteRecordId?: string | null
  /** 'backfill' when the reconcile strip redeems retroactively. */
  source?: 'manual' | 'backfill'
  /** This burn comes from the crash-recovery banner (PR-B1). Two effects, both
   *  scoped to that path so the normal stop flow is untouched:
   *   · D5 — with NO appointment to key on, the DB's partial unique index
   *     (pack_redemptions_active_appointment_unique) cannot protect anything,
   *     so the same-customer/same-JST-day check-then-write guard the auto-burn
   *     cron uses (guard 2) runs here instead;
   *   · D7 — the burn is tagged recovery-resolved for reconcile visibility
   *     (⚖ 8/21 ②). */
  recovery?: boolean
  /** The caller's Idempotency-Key, forwarded to core's redemption dedup (#69).
   *  Set ONLY by the facade route, straight off the request header. Core dedupes
   *  on key EQUALITY, so it bites only once a client sends the SAME key twice —
   *  today's phone mints a fresh one per call (idemPost), so that client half is
   *  QUEUED. The web action leaves it unset on purpose — see redeemSessionAction
   *  below. */
  idempotencyKey?: string
}

/** Redeem core (SINGLE SOURCE): burn pairing is SERVER-derived here — when the
 *  caller omits appointmentId the server finds the customer's booking for the
 *  day; an explicit id (incl. null) is accepted as-is (reconcile-strip
 *  semantics), never overridden. Threaded a business-scoped client + staff id.
 *  The below-zero double-burn guard lives in addRedemptionWithClient. */
export async function redeemSessionActionWithClient(
  synqed: Pick<SynqedClient, 'packs' | 'appointments'>,
  staffId: string | null,
  input: RedeemSessionActionInput,
): Promise<{ ok: boolean; redemptionId?: string; error?: string }> {
  if (!input.packId || !input.customerId) return { ok: false, error: 'ids required' }
  const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const redeemedOn = input.redeemedOn ?? jstToday
  const appointmentId =
    input.appointmentId !== undefined
      ? input.appointmentId
      : await findCustomerAppointmentForDateWithClient(synqed, input.customerId, redeemedOn)
  // D5 (R-B6 ⑦) — the customer-day guard, for a WALK-IN recovery burn only.
  //
  // ⚖ 2026-08-21 (Liam): recovery burns are BOOKING-KEYED whenever a booking
  // exists. A customer's second back-to-back same-day BOOKING takes its own
  // ticket — his salons book a double visit as two bookings, never one long
  // one — so a booked recovery burn is guarded by the DB's partial unique
  // index on pack_redemptions(appointment_id) alone: ONE BOOKING = MAX ONE
  // BURN, which is exactly the law and nothing stricter.
  //
  // The customer+JST-day check (the auto-burn cron's guard 2, ported here in
  // fix round 1 as A-2) survives ONLY for a burn with no appointment at all,
  // where it is the sole protection: the index cannot see NULL-appointment
  // rows, the banner can re-offer the same unbooked visit after a second
  // crash, and two takes of one walk-in would otherwise both burn.
  // `appointmentId` here is the RESOLVED one — a caller-supplied id, or the
  // booking the server found for the customer that day — so a recovery burn
  // that merely omitted the id is still treated as booked.
  //   RESIDUAL, documented not fixed (BA-1 class): check-then-write has a race
  //   window — two walk-in burns for one customer-day landing between the read
  //   and the write both pass. Closing it for real needs a core-side
  //   uniqueness delta on (customer_id, redeemed_on) — an OPTIONAL Anthony
  //   one-liner, not a blocker: the window is milliseconds wide on a path a
  //   single staffer drives by hand, and the client's own single-flight latch
  //   already covers the double-tap case.
  //   CEILING (money lens #8, recorded not fixed): a walk-in visit whose burn
  //   was dated to an ADJACENT JST day is outside this day-keyed check.
  //   CEILING (F-10, RE-KEYED by the ⚖ ruling): the old ceiling was the
  //   opposite one — two genuine same-day visits by one customer burned ONE
  //   ticket. That is gone for booked visits. What replaces it: a prior
  //   NULL-appointment burn for the same customer-day no longer blocks a
  //   BOOKED burn, so a walk-in row that was really this booking's burn (a
  //   reconcile-strip backfill, an earlier unbooked recovery of the same
  //   visit) can be followed by a second, booked burn for it. That is a data
  //   MIS-KEYING, not a second visit: manager reconcile (F7) is where it is
  //   corrected, and the recovery banner's 回数券 line is derived from the same
  //   redemption rows, so it still shows what actually happened.
  if (input.recovery && !appointmentId) {
    // Floor one JST day back, exactly like the cron's historySince — a `since`
    // equal to the day itself relies on core's comparison being inclusive,
    // which the app repo cannot see.
    const since = ymdInJst(new Date(Date.parse(`${redeemedOn}T00:00:00+09:00`) - 86_400_000))
    const already = await synqed.packs
      .listRecentRedemptions(since)
      .then((rows) =>
        rows.some(
          (r) => r.customer_id === input.customerId && isSameJstDay(r.redeemed_on, redeemedOn),
        ),
      )
      // Fail CLOSED on an unreadable history — we cannot prove this burn safe.
      // But it gets its OWN discriminator (F-3): reporting it as
      // 'already_redeemed' told the staffer the ticket had been used, and the
      // client then certified the answer, so a transient read blip cost a burn
      // permanently under a message that gave nobody a reason to look. No burn
      // happens either way; only the truth the client is told differs.
      .catch(() => 'unreadable' as const)
    if (already === 'unreadable') return { ok: false, error: 'guard_unavailable' }
    if (already) return { ok: false, error: 'already_redeemed' }
  }
  const result = await addRedemptionWithClient(synqed, {
    packId: input.packId,
    customerId: input.customerId,
    redeemedOn,
    appointmentId,
    karuteRecordId: input.karuteRecordId ?? null,
    source: input.source ?? 'manual',
    createdBy: staffId,
    idempotencyKey: input.idempotencyKey,
  })
  return result.ok
    ? { ok: true, redemptionId: result.id }
    : { ok: false, error: result.error }
}

/** 来店なし core (SINGLE SOURCE) — ANY staff (unlike alert dismissal):
 *  correcting a record is not the manager-gated "give up". dismissedBy falls
 *  back to 'unknown' — same tolerant contract the cookie action always had
 *  (never blocks on staffId resolution). Web wraps with the cookie client +
 *  getCurrentUserStaffId; facade wraps with newSynqedClient +
 *  resolveSelfStaffId. */
export async function dismissVisitReconcileActionWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  staffId: string | null,
  input: { customerId: string; appointmentId?: string | null; visitDay: string },
): Promise<{ ok: boolean }> {
  if (!input.customerId || !input.visitDay) return { ok: false }
  return addVisitReconcileDismissalWithClient(synqed, {
    customerId: input.customerId,
    appointmentId: input.appointmentId ?? null,
    visitDay: input.visitDay,
    dismissedBy: staffId ?? 'unknown',
  })
}

const CONTACT_CHANNELS: ContactChannel[] = ['phone', 'sms', 'email', 'line', 'in_person']

/** Log-contact core (SINGLE SOURCE) — ANY staff, no capability gate. The
 *  capability check itself is the CALLER's job (this core only needs a
 *  resolved staffId to stamp contacted_by, same split as dismissPackAlert
 *  below). Web wraps with the cookie client + getCurrentUserStaffId; facade
 *  wraps with newSynqedClient + resolveSelfStaffId. */
export async function logCustomerContactActionWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  staffId: string | null,
  input: { customerId: string; channel: ContactChannel; note?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerId) return { ok: false, error: 'customerId required' }
  if (!CONTACT_CHANNELS.includes(input.channel)) return { ok: false, error: 'bad channel' }
  if (!staffId) return { ok: false, error: 'no staff identity' }
  const result = await addCustomerContactWithClient(synqed, {
    customerId: input.customerId,
    channel: input.channel,
    alertKind: 'pack_contact',
    note: input.note?.trim() || null,
    contactedBy: staffId,
  })
  return result.ok ? { ok: true } : { ok: false, error: 'write failed' }
}

/** Dismiss-alert core (SINGLE SOURCE) — MANAGER+ ONLY (Kitano's rule: staff
 *  show the manager they contacted the customer; the manager silences the
 *  alert). The capability check is the CALLER's job (web's cookie-side
 *  requireCapability try/catch below; the facade route's ensureCapability,
 *  which fails the whole request with a real 403 rather than a tolerant
 *  2xx body — see the route's own comment). This core only needs a resolved
 *  staffId to stamp dismissed_by. */
export async function dismissPackAlertActionWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  staffId: string | null,
  input: { customerId: string; reason?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerId) return { ok: false, error: 'customerId required' }
  if (!staffId) return { ok: false, error: 'no staff identity' }
  const result = await addPackAlertDismissalWithClient(synqed, {
    customerId: input.customerId,
    dismissedBy: staffId,
    reason: input.reason?.trim() || null,
  })
  return result.ok ? { ok: true } : { ok: false, error: 'write failed' }
}

export interface SetLifecycleActionInput {
  customerId: string
  status: LifecycleStatus
  referral: boolean
}

/** Lifecycle-set core (SINGLE SOURCE), threaded a business-scoped client + staff
 *  id. Web wraps with the cookie client; facade with newSynqedClient +
 *  selfStaffId. */
export async function setLifecycleActionWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  staffId: string | null,
  input: SetLifecycleActionInput,
): Promise<{ ok: boolean }> {
  if (!input.customerId) return { ok: false }
  return setCustomerLifecycleWithClient(synqed, input.customerId, input.status, input.referral, staffId)
}
