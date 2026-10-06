// THE ONE DEFINITION of "which store does a QuickReserve sync run use"
// (Greptile #1135 F3, fix round 1). Both transports call only this:
//   web   src/app/api/sync/quickreserve/route.ts  (requested = active-store cookie)
//   phone src/app/api/app/v1/sync/run/route.ts    (requested = `store-id` header)
// Each route maps the three errors below to ITS transport's established code:
//
// | Case                                                   | Error                    | Web                       | Phone                                          |
// |--------------------------------------------------------|--------------------------|---------------------------|------------------------------------------------|
// | requested store is not this business's (404/403)       | SyncStoreForbidden       | 409 qr_store_not_ready    | 403 store_forbidden (reason store_header)      |
// | requested store outside a clamped caller's assignment  | SyncStoreForbidden       | 409 qr_store_not_ready    | 403 store_forbidden (reason store_header)      |
// | caller reaches no store (unassigned in a ≥2-store      | SyncStoreUnassigned      | 409 qr_store_not_ready    | 403 store_unassigned                           |
// |   business · web: roster cannot place them · business  |                          |                           |                                                |
// |   has no store at all)                                 |                          |                           |                                                |
// | requested-store verify throws (5xx / 429 / network)    | SyncStoreDependencyError | 502 { error: message }    | 502 upstream_unavailable                       |
// | staff-store read throws                                | SyncStoreDependencyError | 502 { error: message }    | 502 upstream_unavailable                       |
// | store-list read throws (store count · primary store)   | SyncStoreDependencyError | 502 { error: message }    | 502 upstream_unavailable                       |
//
// A dependency failure is never swallowed into "no store": it is not the
// caller's fault and not a store verdict, so it is reported as one (502).

import type { SynqedClient } from '@synqed-kk/client'
import type { Capability } from '@/lib/auth/permissions'
import { storeAssignmentVerdict, storeCountForGate } from '@/lib/auth/store-gate'

/** The requested store is not one this caller may run. */
export class SyncStoreForbidden extends Error {}
/** The caller reaches no store at all. */
export class SyncStoreUnassigned extends Error {}
/** A store read THREW; `cause` is the original error. */
export class SyncStoreDependencyError extends Error {
  constructor(cause: unknown) {
    super(`could not resolve the sync store: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

async function read<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    throw new SyncStoreDependencyError(err)
  }
}

/**
 * - requested store → it must belong to this business, and to a clamped
 *   caller's assignment; viewAll and floating callers may run any store.
 * - no request → a clamped caller's first assigned store; anyone else the
 *   primary store.
 * - no store at all → SyncStoreUnassigned.
 *
 * `authUserId` is the roster staff id (one id space with the auth id; see
 * store-clamp.ts step 3). null = the roster cannot place the caller (the web's
 * getCurrentUserStaffId → null): without viewAll they reach no store.
 */
export async function resolveSyncRunStore(args: {
  synqed: Pick<SynqedClient, 'stores' | 'staffStores'>
  authUserId: string | null
  capabilities: Set<Capability>
  requestedStoreId: string | null
}): Promise<{ storeId: string }> {
  const { synqed, authUserId, capabilities, requestedStoreId } = args

  if (requestedStoreId) {
    try {
      await synqed.stores.get(requestedStoreId)
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status
      if (status === 404 || status === 403) throw new SyncStoreForbidden('store-id does not belong to this business')
      throw new SyncStoreDependencyError(err)
    }
  }

  let stores: { id: string; is_primary?: boolean | null; active?: boolean | null }[] | undefined
  const listStores = async () => (stores ??= (await read(() => synqed.stores.list())).stores)

  // null = unrestricted (viewAll, or floating staff).
  let assigned: string[] | null = null
  if (!capabilities.has('stores.viewAll')) {
    if (!authUserId) throw new SyncStoreUnassigned('the roster cannot place this caller')
    const ids = (await read(() => synqed.staffStores.get(authUserId))).store_ids
    if (ids.length > 0) {
      assigned = ids
    } else {
      const storeCount = storeCountForGate(await listStores())
      if (storeAssignmentVerdict({ viewAll: false, assigned: ids, storeCount }) === 'unassigned') {
        throw new SyncStoreUnassigned('no store is assigned to this caller')
      }
    }
  }

  if (requestedStoreId) {
    if (assigned && !assigned.includes(requestedStoreId)) {
      throw new SyncStoreForbidden('store-id outside your assignment')
    }
    return { storeId: requestedStoreId }
  }
  if (assigned) return { storeId: assigned[0] }
  const list = await listStores()
  const primary = list.find((s) => s.is_primary)?.id ?? list[0]?.id
  if (!primary) throw new SyncStoreUnassigned('this business has no store')
  return { storeId: primary }
}
