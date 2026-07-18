'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserStaffId } from '@/lib/staff'
import { requireCapability } from '@/lib/auth/require-permission'
import {
  listCustomerPacks,
  addVisitReconcileDismissal,
  addCustomerContact,
  addPackAlertDismissal,
  addRedemption,
  createPack,
  findCustomerAppointmentForDate,
  removeRedemption,
  setCustomerLifecycle,
  updatePackStatus,
  type ContactChannel,
  type CreatePackInput,
} from '@/lib/packs/store'
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

export async function createPackAction(input: {
  customerId: string
  kind: PackKind
  packSize: number
  unitPrice: number
  totalPrice?: number | null
  purchaseRound?: number
  purchasedAt?: string | null
  notes?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerId) return { ok: false, error: 'customerId required' }
  if (!Number.isFinite(input.packSize) || input.packSize <= 0)
    return { ok: false, error: 'packSize must be > 0' }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0)
    return { ok: false, error: 'unitPrice must be >= 0' }
  // A single session is one session — server-enforced so no future caller can
  // send kind:'single' with packSize 10 and inflate the derived total_price
  // (today's forms clamp this client-side; the money rule lives here).
  if (input.kind === 'single' && input.packSize !== 1)
    return { ok: false, error: 'single kind must have packSize 1' }
  const staffId = await getCurrentUserStaffId().catch(() => null)
  // SERVER-derived 購入回数 when the caller doesn't supply one (the stop-dialog
  // picker doesn't): highest STORED round + 1, never a row count — the imports
  // collapsed history to one row per customer, so counting relabels a round-4
  // regular as 初回 (§7.4 — the first-timer nightmare in money clothing).
  // Identical to TicketPackCard's nextRound; business-wide, store-blind.
  const purchaseRound =
    input.purchaseRound ?? nextPurchaseRound(await listCustomerPacks(input.customerId))
  // SERVER-derived 合計金額 when the caller doesn't supply one — NEITHER form
  // does (profile AddPackDialog, stop-dialog picker), which saved every pack
  // with total_price null and zeroed pack revenue. The app prices per-session
  // (単価 field, unconsumedValue = remaining × unit_price), so the amount the
  // customer paid IS unit × size. Defaulted here, not in the forms, so every
  // caller — present and future — is covered by one rule.
  const totalPrice = input.totalPrice ?? input.unitPrice * input.packSize
  const result = await createPack({
    ...(input as CreatePackInput),
    totalPrice,
    purchaseRound,
    source: 'manual',
    createdBy: staffId,
  })
  if (result.ok) revalidateProfile()
  return result.ok ? { ok: true } : { ok: false, error: result.error }
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

/** Check one session off a pack (manual check-off; date defaults to today JST). */
export async function redeemSessionAction(input: {
  packId: string
  customerId: string
  redeemedOn?: string
  /** The booking this consumption covers — links the redemption to the visit
   *  so the 未処理来店 reconciler can tell covered visits from missed ones. */
  appointmentId?: string | null
  karuteRecordId?: string | null
  /** 'backfill' when the reconcile strip redeems retroactively. */
  source?: 'manual' | 'backfill'
}): Promise<{ ok: boolean; redemptionId?: string; error?: string }> {
  if (!input.packId || !input.customerId) return { ok: false, error: 'ids required' }
  const staffId = await getCurrentUserStaffId().catch(() => null)
  const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const redeemedOn = input.redeemedOn ?? jstToday
  // The customer-profile burn button never sends an appointmentId, so those
  // redemptions landed appointment_id NULL even when the customer actually had
  // a booking that day. Only fill in when the caller left it unset — never
  // override an explicit id (e.g. the reconcile strip's specific booking).
  // No match (walk-in / no booking that day) is expected, not an error.
  const appointmentId =
    input.appointmentId !== undefined
      ? input.appointmentId
      : await findCustomerAppointmentForDate(input.customerId, redeemedOn)
  const result = await addRedemption({
    packId: input.packId,
    customerId: input.customerId,
    redeemedOn,
    appointmentId,
    karuteRecordId: input.karuteRecordId ?? null,
    source: input.source ?? 'manual',
    createdBy: staffId,
  })
  if (result.ok) revalidateProfile()
  // redemptionId lets the auto-consume toast offer 取り消す (undoRedemptionAction).
  return result.ok
    ? { ok: true, redemptionId: result.id }
    : { ok: false, error: result.error }
}

/** 来店なし — the visit didn't actually happen; the reconcile row never
 *  re-surfaces. ANY staff (unlike alert dismissal): correcting a record is
 *  not the manager-gated "give up". Audit-trailed via dismissed_by. */
export async function dismissVisitReconcileAction(input: {
  customerId: string
  appointmentId?: string | null
  visitDay: string
}): Promise<{ ok: boolean }> {
  if (!input.customerId || !input.visitDay) return { ok: false }
  const staffId = await getCurrentUserStaffId().catch(() => null)
  const result = await addVisitReconcileDismissal({
    customerId: input.customerId,
    appointmentId: input.appointmentId ?? null,
    visitDay: input.visitDay,
    dismissedBy: staffId ?? 'unknown',
  })
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

/** Log a 連絡済み (win-back contact attempt) — ANY staff, no capability gate.
 *  Snoozes the alert into 対応中 for 7 days; auto-resolves when the customer
 *  books/visits. Also the labeled outcome stream coaching trains on. */
export async function logCustomerContactAction(input: {
  customerId: string
  channel: ContactChannel
  note?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.customerId) return { ok: false, error: 'customerId required' }
  const CHANNELS: ContactChannel[] = ['phone', 'sms', 'email', 'line', 'in_person']
  if (!CHANNELS.includes(input.channel)) return { ok: false, error: 'bad channel' }
  const staffId = await getCurrentUserStaffId().catch(() => null)
  if (!staffId) return { ok: false, error: 'no staff identity' }
  const result = await addCustomerContact({
    customerId: input.customerId,
    channel: input.channel,
    alertKind: 'pack_contact',
    note: input.note?.trim() || null,
    contactedBy: staffId,
  })
  if (result.ok) {
    revalidatePath('/[locale]/(app)/dashboard', 'page')
  }
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
  const staffId = await getCurrentUserStaffId().catch(() => null)
  if (!staffId) return { ok: false, error: 'no staff identity' }
  const result = await addPackAlertDismissal({
    customerId: input.customerId,
    dismissedBy: staffId,
    reason: input.reason?.trim() || null,
  })
  if (result.ok) {
    revalidatePath('/[locale]/(app)/dashboard', 'page')
    revalidatePath('/[locale]/(app)/customers', 'page')
  }
  return result.ok ? { ok: true } : { ok: false, error: 'write failed' }
}

export async function setLifecycleAction(input: {
  customerId: string
  status: LifecycleStatus
  referral: boolean
}): Promise<{ ok: boolean }> {
  if (!input.customerId) return { ok: false }
  const staffId = await getCurrentUserStaffId().catch(() => null)
  const result = await setCustomerLifecycle(
    input.customerId,
    input.status,
    input.referral,
    staffId,
  )
  if (result.ok) revalidateProfile()
  return result
}
