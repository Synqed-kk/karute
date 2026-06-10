'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserStaffId } from '@/lib/staff'
import {
  addRedemption,
  createPack,
  removeRedemption,
  setCustomerLifecycle,
  updatePackStatus,
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
}): Promise<{ ok: boolean; error?: string }> {
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
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export async function undoRedemptionAction(redemptionId: string): Promise<{ ok: boolean }> {
  if (!redemptionId) return { ok: false }
  const result = await removeRedemption(redemptionId)
  if (result.ok) revalidateProfile()
  return result
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
