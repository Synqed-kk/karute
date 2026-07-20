'use server'

import { revalidatePath } from 'next/cache'
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
  // revenue is never zeroed. One rule covers every present + future caller.
  const totalPrice = input.totalPrice ?? input.unitPrice * input.packSize
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
  const [synqed, staffId] = await Promise.all([getSynqedClient(), getCurrentUserStaffId().catch(() => null)])
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
  const [synqed, staffId] = await Promise.all([getSynqedClient(), getCurrentUserStaffId().catch(() => null)])
  const result = await redeemSessionActionWithClient(synqed, staffId, input)
  if (result.ok) revalidateProfile()
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
  if (result.ok) revalidateProfile()
  return result
}
