'use server'

import { revalidatePath } from 'next/cache'
import { auditWeb } from '@/lib/audit-web'
import { getCurrentUserStaffId } from '@/lib/staff'
import { requireCapability } from '@/lib/auth/require-permission'
import {
  listCustomerPacksWithClient,
  addVisitReconcileDismissalWithClient,
  addCustomerContactWithClient,
  addPackAlertDismissalWithClient,
  addRedemptionWithClient,
  createPackWithClient,
  findCustomerAppointmentForDateWithClient,
  removeRedemption,
  setCustomerLifecycleWithClient,
  updatePackStatus,
  type ContactChannel,
  type CreatePackInput,
} from '@/lib/packs/store'
import { ymdInJst } from '@/lib/date/jst'
import type { SynqedClient } from '@synqed-kk/client'
import {
  nextPurchaseRound,
  type LifecycleStatus,
  type PackKind,
  type PackStatus,
} from '@/lib/packs/types'

// 回数券 server actions — the ONLY write path to the pack tables (they're
// RLS-locked; browser clients can't reach them). Each action stamps the acting
// staff id and revalidates the customer profile so the pack card refreshes.

const revalidateProfile = () =>
  revalidatePath('/[locale]/(app)/customers/[id]', 'page')

interface CreatePackActionInput {
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
      ? nextPurchaseRound(await listCustomerPacksWithClient(synqed, input.customerId))
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

export async function createPackAction(
  input: CreatePackActionInput,
): Promise<{ ok: boolean; error?: string }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — RecordPageView's onResolve now runs this
  // and redeemSessionAction as two INDEPENDENT writes (F1, PR-0 fix round);
  // an unguarded throw here would still surface as a rejected promise, and
  // must degrade to the SAME { ok: false } contract every other guarded
  // action in this file uses, not an uncaught rejection.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await createPackActionWithClient(synqed, staffId, input)
  if (result.ok) revalidateProfile()
  return result
}

export async function setPackStatusAction(
  packId: string,
  status: PackStatus,
): Promise<{ ok: boolean }> {
  if (!packId) return { ok: false }
  const result = await updatePackStatus(packId, status)
  if (result.ok) revalidateProfile()
  return result
}

interface RedeemSessionActionInput {
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
  // D5 (R-B6 ⑦) — the customer-day guard, for EVERY recovery burn.
  //
  // The storage layer enforces one booking = max one burn via a partial unique
  // index on pack_redemptions(appointment_id) — but that index only sees rows
  // that HAVE an appointment_id. A prior NULL-appointment burn for the same
  // customer on the same day (the reconcile strip's backfill, an earlier
  // walk-in recovery) is completely invisible to it, so a BOOKED recovery burn
  // can still double-charge one visit. Fix round 1 A-2: the customer+JST-day
  // check the auto-burn cron runs as guard 2 therefore runs for every recovery
  // burn, booked or not — the index stays as the backstop underneath it.
  //   RESIDUAL, documented not fixed (BA-1 class): check-then-write has a race
  //   window — two burns for one customer-day landing between the read and the
  //   write both pass. Closing it for real needs a core-side uniqueness delta
  //   on (customer_id, redeemed_on) — an OPTIONAL Anthony one-liner, not a
  //   blocker: the window is milliseconds wide on a path a single staffer
  //   drives by hand, and the client's own single-flight latch already covers
  //   the double-tap case.
  //   CEILING (money lens #8, recorded not fixed): a visit whose burn was
  //   dated to an ADJACENT JST day is outside this day-keyed check.
  //   CEILING (F-10): keying on the customer-DAY means two genuine same-day
  //   visits by one customer burn ONE ticket. That is parity with the
  //   auto-burn cron's guard 2 ("one customer-day burns ONE ticket EVER"), not
  //   a regression — but the recovery picker deliberately keeps that
  //   customer's OTHER same-day bookings selectable (B-8), so the UI can offer
  //   a destination this guard then refuses with the 消化済み message.
  if (input.recovery) {
    // Floor one JST day back, exactly like the cron's historySince — a `since`
    // equal to the day itself relies on core's comparison being inclusive,
    // which the app repo cannot see.
    const since = ymdInJst(new Date(Date.parse(`${redeemedOn}T00:00:00+09:00`) - 86_400_000))
    const already = await synqed.packs
      .listRecentRedemptions(since)
      .then((rows) =>
        rows.some(
          (r) => r.customer_id === input.customerId && r.redeemed_on.slice(0, 10) === redeemedOn,
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
  })
  return result.ok
    ? { ok: true, redemptionId: result.id }
    : { ok: false, error: result.error }
}

/** Check one session off a pack (manual check-off; date defaults to today JST). */
export async function redeemSessionAction(
  input: RedeemSessionActionInput,
): Promise<{ ok: boolean; redemptionId?: string; error?: string }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — RecordPageView's onResolve now runs this
  // and createPackAction as two INDEPENDENT writes (F1, PR-0 fix round); an
  // unguarded throw here would still surface as a rejected promise, and must
  // degrade to the SAME { ok: false } contract every other guarded action in
  // this file uses, not an uncaught rejection.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await redeemSessionActionWithClient(synqed, staffId, input)
  if (result.ok) revalidateProfile()
  // D7 (⚖ 8/21 ②) — recovery-resolved burns are visible to reconcile. VERIFIED
  // against @synqed-kk/client 1.25.0, the version package.json PINS (re-checked
  // on a clean npm ci — an earlier pass read a stale 1.19.0 tree, so the version
  // is named here on purpose): a `source` surface DOES exist end-to-end
  // (AddRedemptionInput → SDK `source?: string`), but it is a BARE string — no
  // union, no 'recovery' value, no enumeration at all — so the typings say
  // nothing about what the DB accepts, and the package ships compiled .d.ts only
  // (packs/store.ts's own header: assume nothing beyond the error-string
  // contract). Sending an unknown literal on a MONEY write is not a risk worth
  // taking blind, so the tag lives at the audit layer instead — never a
  // client-side shadow ledger.
  // THIS IS THE WEB HALF. The PHONE half rides the facade route's ctx.auditDetail
  // seam (customers/[id]/packs/redeem) — the build round wrongly claimed the
  // facade twin could carry no per-call detail; it can, and now does. What is
  // still missing on BOTH is a queryable source column, which stays the OPTIONAL
  // Anthony one-liner: add 'recovery' to the redemption source enum.
  if (result.ok && input.recovery) {
    await auditWeb({
      category: 'customer',
      action: 'customer.pack_redeem',
      targetType: 'customer',
      targetId: input.customerId,
      severity: 'notice',
      detail: {
        resolved_via: 'recovery',
        pack_id: input.packId,
        appointment_id: input.appointmentId ?? null,
        redemption_id: result.redemptionId ?? null,
        redeemed_on: input.redeemedOn ?? null,
      },
      // B-10: the repo's defensive form — crypto.randomUUID is absent in some
      // runtimes/test envs, and an audit emit must never break the burn.
      requestId: globalThis.crypto?.randomUUID?.(),
    })
  }
  return result
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

/** 来店なし — the visit didn't actually happen; the reconcile row never
 *  re-surfaces. ANY staff (unlike alert dismissal): correcting a record is
 *  not the manager-gated "give up". Audit-trailed via dismissed_by. */
export async function dismissVisitReconcileAction(input: {
  customerId: string
  appointmentId?: string | null
  visitDay: string
}): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — ReconcileStrip awaits with no try/catch
  // (stranded spinner, no toast). Catch to null and degrade to the SAME
  // { ok: false } origin/main produced when the old cookie fn's internal
  // try/catch swallowed this exact failure.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false }
  const result = await dismissVisitReconcileActionWithClient(synqed, staffId, input)
  if (result.ok) revalidatePath('/dashboard')
  return result
}

export async function undoRedemptionAction(redemptionId: string): Promise<{ ok: boolean }> {
  if (!redemptionId) return { ok: false }
  // WHO undid the burn — recorded on the redemption row (removed_by) so the
  // undo is auditable without a join.
  const staffId = await getCurrentUserStaffId().catch(() => null)
  const result = await removeRedemption(redemptionId, staffId)
  if (result.ok) revalidateProfile()
  return result
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

/** Log a 連絡済み (win-back contact attempt) — ANY staff, no capability gate.
 *  Snoozes the alert into 対応中 for 7 days; auto-resolves when the customer
 *  books/visits. Also the labeled outcome stream coaching trains on. */
export async function logCustomerContactAction(input: {
  customerId: string
  channel: ContactChannel
  note?: string
}): Promise<{ ok: boolean; error?: string }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — PackAlertsCard awaits with no try/catch
  // (stranded spinner, no toast). Catch to null and degrade to the SAME
  // { ok:false, error:'write failed' } origin/main produced when the old
  // cookie fn's internal try/catch swallowed this exact failure.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await logCustomerContactActionWithClient(synqed, staffId, input)
  if (result.ok) {
    revalidatePath('/[locale]/(app)/dashboard', 'page')
  }
  return result
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

/** Dismiss a customer's 要連絡 alert — MANAGER+ ONLY (Kitano's rule: staff show
 *  the manager they contacted the customer; the manager silences the alert).
 *  Audit-trailed (who/when/why); the alert re-arms automatically after the
 *  customer's next visit resets their absence clock. */
export async function dismissPackAlertAction(input: {
  customerId: string
  reason?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerId) return { ok: false, error: 'customerId required' }
  try {
    await requireCapability('alerts.manage')
  } catch {
    return { ok: false, error: 'forbidden' }
  }
  const { getSynqedClient } = await import('@/lib/synqed/client')
  // getSynqedClient() unguarded here would THROW the whole server action on a
  // transient session/DB failure — PackAlertsCard awaits with no try/catch
  // (stranded spinner, no toast). Catch to null and degrade to the SAME
  // { ok:false, error:'write failed' } origin/main produced when the old
  // cookie fn's internal try/catch swallowed this exact failure.
  const [synqed, staffId] = await Promise.all([
    getSynqedClient().catch((err) => {
      console.warn('[packs] synqed client init failed:', err)
      return null
    }),
    getCurrentUserStaffId().catch(() => null),
  ])
  if (!synqed) return { ok: false, error: 'write failed' }
  const result = await dismissPackAlertActionWithClient(synqed, staffId, input)
  if (result.ok) {
    revalidatePath('/[locale]/(app)/dashboard', 'page')
    revalidatePath('/[locale]/(app)/customers', 'page')
  }
  return result
}

interface SetLifecycleActionInput {
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

export async function setLifecycleAction(
  input: SetLifecycleActionInput,
): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  const [synqed, staffId] = await Promise.all([getSynqedClient(), getCurrentUserStaffId().catch(() => null)])
  const result = await setLifecycleActionWithClient(synqed, staffId, input)
  if (!result.ok) return { ok: false }
  revalidateProfile()
  // Wave W3: the web twin of the facade customer.lifecycle.set row (that side
  // is the generic success hook on the lifecycle route) — success only.
  await auditWeb({
    category: 'customer',
    action: 'customer.lifecycle_set',
    targetType: 'customer',
    targetId: input.customerId,
    requestId: crypto.randomUUID(),
  })
  return result
}
