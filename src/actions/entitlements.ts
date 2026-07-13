'use server'

import { getBusinessId } from '@/lib/staff'
import { loadEntitlement, type Entitlement } from '@/lib/entitlements'
import { TIER_FEATURES } from '@/lib/subscription/types'

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
      features: TIER_FEATURES.free,
      staffLimit: TIER_FEATURES.free.staff,
      canAddStore: false,
      enforced: false,
      degraded: false,
    }
  }
  return loadEntitlement(businessId)
}
