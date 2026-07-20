// Store clamp — proves TENANCY first, then applies staff-assignment restriction
// (PLAN §5, packet point 4). The #441 cross-tenant/cross-store leak class lives
// here: on the Bearer path there is NO active-store cookie, so a store-id must
// travel as an EXPLICIT request field and be PROVEN to belong to the caller's
// business before any staff-assignment logic runs. Otherwise the old cookie
// fallback would silently resolve to the primary store — a wrong-store leak.

import type { SynqedClient } from '@synqed-kk/client'
import type { Capability } from '@/lib/auth/permissions'
import { AppApiError } from './errors'

export interface ClampedStore {
  /** The store to scope this request to. null = unrestricted WITHIN the verified
   *  tenant (cross-store viewer, or floating staff). Never null-means-all-tenants. */
  storeId: string | null
  /** The stores the caller is restricted to, or null when unrestricted. A
   *  non-null array means store-scoped reads MUST stay within it. */
  allowedStoreIds: string[] | null
}

/**
 * Resolve the effective store scope for a facade request.
 *
 * @param synqed  a business-scoped client (built from the Bearer-resolved
 *                businessId) — so `stores.get` failing means "not this tenant".
 * @param authUserId  the confirmed profile/staff id (the store-assignment key).
 * @param capabilities  the caller's RBAC set (`stores.viewAll` = cross-store).
 * @param requestedStoreId  the explicit `store-id` request header, or null.
 *
 * The two VERDICT throws here (wrong-tenant, outside-assignment) carry
 * `reason: 'store_header'` — the client contract that "the store-id you sent
 * is un-servable for YOU", the only 403 the thin shell's stranded-pin
 * self-heal may act on. Two store_forbidden classes must NOT carry it:
 * resource ownership (karute route's "this booking belongs to a store you
 * are not assigned to" — the pin is fine, the resource isn't) and the
 * fail-CLOSED lookup error below (verdict UNKNOWN — a transient blip must
 * not wipe a good pin, and an unlensed retry re-hits the same lookup anyway,
 * so healing there could never help).
 */
export async function resolveStoreForRequest(args: {
  synqed: Pick<SynqedClient, 'stores' | 'staffStores'>
  authUserId: string
  capabilities: Set<Capability>
  requestedStoreId: string | null
}): Promise<ClampedStore> {
  const { synqed, authUserId, capabilities, requestedStoreId } = args

  // 1. TENANCY FIRST: a supplied store-id must belong to THIS business. The
  //    client is business-scoped, so stores.get throwing = it's not this tenant's
  //    store (or does not exist) → reject before any assignment logic.
  if (requestedStoreId) {
    try {
      await synqed.stores.get(requestedStoreId)
    } catch {
      throw new AppApiError('store_forbidden', 'store-id does not belong to this business', { reason: 'store_header' })
    }
  }

  // 2. Cross-store viewers (owner / manager / SV) range freely within the tenant.
  if (capabilities.has('stores.viewAll')) {
    return { storeId: requestedStoreId, allowedStoreIds: null }
  }

  // 3. Resolve the caller's assignment. A THROWN lookup is UNKNOWN, not floating:
  //    fail closed rather than fall through to "works everywhere" (the old
  //    fail-OPEN bug where missing/errored read as every-store).
  let assigned: string[]
  try {
    assigned = (await synqed.staffStores.get(authUserId)).store_ids
  } catch {
    throw new AppApiError('store_forbidden', 'could not resolve store assignment (fail-closed)')
  }

  // 4. DELIBERATE empty set = floating staff (works in every store) — unrestricted
  //    within the verified tenant. This is the one legitimate "no clamp" case,
  //    and it is distinguished from the errored case above by construction.
  if (assigned.length === 0) {
    return { storeId: requestedStoreId, allowedStoreIds: null }
  }

  // 5. Clamped staff: a supplied store must be one they're assigned to.
  if (requestedStoreId && !assigned.includes(requestedStoreId)) {
    throw new AppApiError('store_forbidden', 'store-id outside your assignment', { reason: 'store_header' })
  }
  return { storeId: requestedStoreId ?? assigned[0], allowedStoreIds: assigned }
}
