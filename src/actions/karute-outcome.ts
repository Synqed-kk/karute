'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserStaffId } from '@/lib/staff'
import { setKaruteOutcome } from '@/lib/karute/outcome'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

/**
 * Change a karute's session outcome AFTER the fact — the customer came back
 * (不成約 → 成約) or wants a refund (成約 → 不成約), or a pending one is decided.
 * Same upsert contract as the save-time capture, so the outcome is never
 * locked: the 14-day auto-decide is just a default, always overridable here.
 */
export async function updateKaruteOutcome(
  karuteRecordId: string,
  customerId: string,
  outcome: SessionOutcome,
): Promise<{ error?: string }> {
  const staffId = await getCurrentUserStaffId()
  const result = await setKaruteOutcome({
    karuteRecordId,
    customerId,
    status: outcome.status,
    reason: outcome.reason,
    isFirstVisit: outcome.isFirstVisit,
    decidedBy: staffId,
  })
  if (result.error) return result
  revalidatePath(`/karute/${karuteRecordId}`)
  revalidatePath(`/customers/${customerId}`)
  return {}
}
