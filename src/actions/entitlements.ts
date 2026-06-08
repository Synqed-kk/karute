'use server'

import { getBusinessId } from '@/lib/staff'
import { loadEntitlement, type Entitlement } from '@/lib/entitlements'

/** The caller's live store entitlement (plan limit + live count + can-add).
 *  Callable from client components (StoresSection). Returns a safe, blocked
 *  'free' default when unauthenticated so the UI never throws. */
export async function getEntitlement(): Promise<Entitlement> {
  let businessId: string
  try {
    businessId = await getBusinessId()
  } catch {
    return {
      tier: 'free',
      storeLimit: 1,
      storeCount: 0,
      isUnlimited: false,
      canAddStore: false,
    }
  }
  return loadEntitlement(businessId)
}
