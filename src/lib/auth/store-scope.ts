// Store-scoped visibility (RBAC). Resolves WHICH store(s) the signed-in user may
// see, clamping regular staff to their `staff_stores` assignment while letting
// cross-store roles (owner / manager / SV via `stores.viewAll`) range freely.
//
// This is the read-side enforcement for the multi-store backlog: the active-store
// cookie is a VIEW preference, but a practitioner must not be able to see another
// branch's karute + customers just by pointing the cookie elsewhere. Pair it with
// the setActiveStore guard (a clamped user can't pin a store they're not in) so
// the clamp can't be bypassed from the switcher.
//
// Server-only — it reads capabilities + staff_stores via the service/SDK clients.

import { getMyCapabilities } from './require-permission'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getActiveStoreId, getPrimaryStoreId, getStaffStores } from '@/actions/stores'

export interface StoreScope {
  /** The store_id to filter store-scoped reads by. null = no store filter
   *  (only when the business has no stores at all / the lookup failed —
   *  an unset cookie resolves to the primary store, matching the switcher). */
  storeId: string | null
  /** True when the viewer may see every store (owner / manager / SV). */
  viewAll: boolean
  /** The stores the viewer is RESTRICTED to, or null when unrestricted
   *  (viewAll, or a floating staff with an empty staff_stores set). A non-null
   *  array means reads + search MUST stay within it. */
  allowedStoreIds: string[] | null
}

/**
 * Resolve the signed-in user's store scope.
 *
 *   - viewAll capability        → the active-store cookie is the lens; unset
 *                                  cookie falls back to the primary store.
 *   - no viewAll + no stores    → floating staff: works in every store (the
 *                                  documented empty-set convention) → no clamp,
 *                                  same primary-store default.
 *   - no viewAll + has stores   → clamped: the cookie picks among the user's own
 *                                  stores; an out-of-scope / unset cookie falls
 *                                  back to their first assigned store.
 */
export async function resolveStoreScope(): Promise<StoreScope> {
  const [caps, activeStore, staffId] = await Promise.all([
    getMyCapabilities(),
    getActiveStoreId(),
    getCurrentUserStaffId(),
  ])

  if (caps.has('stores.viewAll')) {
    // Unset cookie defaults to the PRIMARY store, not "all stores": the
    // StoreSwitcher has no all-stores option and displays the primary as
    // active when nothing is pinned, so the data must follow the same lens.
    return {
      storeId: activeStore ?? (await getPrimaryStoreId()),
      viewAll: true,
      allowedStoreIds: null,
    }
  }

  const allowed = staffId ? await getStaffStores(staffId) : []
  if (allowed.length === 0) {
    // Floating staff (assigned to no specific store) = works in every store,
    // per the staff_stores convention. Same unset-cookie default as above.
    return {
      storeId: activeStore ?? (await getPrimaryStoreId()),
      viewAll: false,
      allowedStoreIds: null,
    }
  }

  const storeId =
    activeStore && allowed.includes(activeStore) ? activeStore : allowed[0]
  return { storeId, viewAll: false, allowedStoreIds: allowed }
}
