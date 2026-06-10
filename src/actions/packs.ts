'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserStaffId } from '@/lib/staff'
import { requireCapability } from '@/lib/auth/require-permission'
import {
  addCustomerContact,
  addPackAlertDismissal,
  addRedemption,
  createPack,
  removeRedemption,
  setCustomerLifecycle,
  updatePackStatus,
  type ContactChannel,
  type CreatePackInput,
} from '@/lib/packs/store'
import type { LifecycleStatus, PackKind, PackStatus } from '@/lib/packs/types'

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
  const staffId = await getCurrentUserStaffId().catch(() => null)
  const result = await createPack({
    ...(input as CreatePackInput),
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
}): Promise<{ ok: boolean; redemptionId?: string; error?: string }> {
  if (!input.packId || !input.customerId) return { ok: false, error: 'ids required' }
  const staffId = await getCurrentUserStaffId().catch(() => null)
  const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const result = await addRedemption({
    packId: input.packId,
    customerId: input.customerId,
    redeemedOn: input.redeemedOn ?? jstToday,
    createdBy: staffId,
  })
  if (result.ok) revalidateProfile()
  // redemptionId lets the auto-consume toast offer 取り消す (undoRedemptionAction).
  return result.ok
    ? { ok: true, redemptionId: result.id }
    : { ok: false, error: result.error }
}

export async function undoRedemptionAction(redemptionId: string): Promise<{ ok: boolean }> {
  if (!redemptionId) return { ok: false }
  const result = await removeRedemption(redemptionId)
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
