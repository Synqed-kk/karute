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

import { unstable_cache } from 'next/cache'
import { getMyCapabilities } from './require-permission'
import type { Capability } from './permissions'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getActiveStoreId, getPrimaryStoreId, getStaffStoresStrict } from '@/actions/stores'

export interface StoreScope {
  /** The store_id to filter store-scoped reads by. null = no store filter
   *  (only when the business has no stores at all / the lookup failed —
   *  an unset cookie resolves to the primary store, matching the switcher). */
  storeId: string | null
  /** True when the viewer may see every store (owner / manager / SV). */
  viewAll: boolean
  /** The stores the viewer is RESTRICTED to, or null when unrestricted
   *  (viewAll, or a floating staff with an empty staff_stores set). A non-null
   *  array means reads + search MUST stay within it. A failed assignment lookup
   *  yields the single store already in view — see resolveStoreScope. */
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
 *   - assignment lookup failed  → clamped to the store already in view (never
 *                                  "floating", never unclamped).
 */
export async function resolveStoreScope(): Promise<StoreScope> {
  // Capability-resolution failure → treat as NO capabilities rather than
  // rejecting (the resolver fails closed on post-migration query errors since
  // Greptile #652 P1). Empty caps only ever NARROW this function's result —
  // viewAll is dropped and the clamp below derives from staff_stores data,
  // never from caps — so the ~20 read surfaces that consume this scope degrade
  // to a tighter lens on a transient blip instead of crashing. Capability
  // GATES (can/requireCapability/route guards) deliberately keep the throw.
  const [caps, activeStore, staffId] = await Promise.all([
    getMyCapabilities().catch(() => new Set<Capability>()),
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

  // Strict lookup here: a FAILED assignment read must not be mistaken for "no
  // assignment". An empty set is the floating-staff convention (works in every
  // store), so degrading a transient failure to [] would show a branch staff
  // more than they normally see. A genuine empty set from a SUCCESSFUL read
  // keeps its meaning.
  const allowed = staffId
    ? await getStaffStoresStrict(staffId).catch(() => null) // null = lookup failed
    : []
  if (allowed === null) {
    // Failure → clamp to the ONE store already in view, not to nothing.
    // "Nothing" is narrower on paper but breaks the app for the duration of the
    // outage: every membership check fails, so an appointment-linked karute
    // save is refused, getAppointmentById returns null for every booking (and
    // the record screen's fallback then picks an unrelated one), and new
    // bookings quietly land in the primary store. One store is still strictly
    // narrower than the previous degraded result (no clamp at all), and the
    // lens itself is already clamped: setActiveStore only pins a store the
    // staff is assigned to (at pin time — a later reassignment can leave a
    // stale pin; still one store, still narrower than the old unclamped
    // result). No stores at all → nothing to scope to.
    const storeId = activeStore ?? (await getPrimaryStoreId())
    return {
      storeId,
      viewAll: false,
      allowedStoreIds: storeId ? [storeId] : [],
    }
  }
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

// ─── Store-scoped staff PICKER filtering ────────────────────────────────────
// The 担当 selectors (予約 / 顧客 / カルテ) must only offer staff who work in
// the active store — the business-wide roster leaked every branch's staff
// names into every store's dropdowns. This filters the PICKER lists only;
// name-lookup maps stay business-wide so records written by another branch's
// staff still render their name instead of "Unknown" (same rule as the
// customer-map audit: business-wide maps are fine for .get(id), never for
// lists).

export interface StaffStoreAssignment {
  /** synqed-core staff id */
  id: string
  /** Supabase profile id link (canonical), when the staff has signed up. */
  user_id: string | null
  /** Lower-cased email fallback link — same two-tier match as staff-map.ts. */
  email: string | null
  /** Assigned stores; empty = floating staff who works in every store. */
  store_ids: string[]
}

// One cached fetch per business: the full staff→stores assignment map.
// staffStores has no bulk read, so this fans out one get() per staff — bounded
// by the roster (≤200) and amortized by the day-long cache. Every staff or
// assignment mutation (src/actions/staff.ts, setStaffStores) already bumps the
// 'staff-list' tag, invalidating this alongside the roster caches.
const staffStoreAssignmentsByBusiness = unstable_cache(
  async (businessId: string): Promise<StaffStoreAssignment[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) throw new Error('synqed-core env not configured')
    // Lazy import for the same reason as src/lib/staff.ts — keep the ESM
    // client out of graphs (and tests) that never reach this path.
    const { SynqedClient } = await import('@synqed-kk/client')
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    const { staff } = await client.staff.list({ page_size: 200 })
    return Promise.all(
      staff.map(async (s) => ({
        id: s.id,
        user_id: (s as { user_id?: string | null }).user_id ?? null,
        email: s.email ? s.email.toLowerCase() : null,
        store_ids: (await client.staffStores.get(s.id)).store_ids,
      })),
    )
  },
  ['staff-store-assignments-v1'],
  { revalidate: 86400, tags: ['staff-list'] },
)

/**
 * Pure core (exported for tests): which of these roster members may appear in
 * this store's pickers? Roster ids are profile ids for signed-up staff and
 * synqed staff ids for profile-less teammates (see staffListByBusiness), so a
 * member links to its assignment by synqed id, then user_id, then email — the
 * same two-tier match staff-map.ts uses.
 *
 * Kept: assigned to this store, floating (no assignment = every store, the
 * documented staff_stores convention), or unlinkable (no synqed record — this
 * is a picker filter, not an auth gate, so unknowns fail open; the read-side
 * clamps on the data itself stay authoritative).
 */
export function filterStaffIdsToStore(
  staff: ReadonlyArray<{ id: string; email?: string | null }>,
  assignments: StaffStoreAssignment[],
  storeId: string,
): Set<string> {
  const bySynqedId = new Map(assignments.map((a) => [a.id, a]))
  const byUserId = new Map(
    assignments.filter((a) => a.user_id).map((a) => [a.user_id as string, a]),
  )
  const byEmail = new Map(
    assignments.filter((a) => a.email).map((a) => [a.email as string, a]),
  )
  const kept = new Set<string>()
  for (const m of staff) {
    const a =
      bySynqedId.get(m.id) ??
      byUserId.get(m.id) ??
      (m.email ? byEmail.get(m.email.toLowerCase()) : undefined)
    if (!a || a.store_ids.length === 0 || a.store_ids.includes(storeId)) {
      kept.add(m.id)
    }
  }
  return kept
}

/**
 * The ids from `staff` that may appear in the active store's 担当 pickers, or
 * null when no filtering applies (no store lens, or the assignment fetch is
 * unavailable) — callers treat null as "show the full list" (fail open, see
 * filterStaffIdsToStore).
 */
export async function storeStaffIdSet(
  staff: ReadonlyArray<{ id: string; email?: string | null }>,
  storeId: string | null,
): Promise<Set<string> | null> {
  if (!storeId) return null
  return storeStaffIdSetForBusiness(staff, storeId, await getBusinessId())
}

/**
 * Bearer-safe twin of storeStaffIdSet for facade routes: the caller supplies
 * businessId from its verified token identity — this path must never touch the
 * cookie session (getBusinessId). Same fail-open posture as the cookie helper.
 */
export async function storeStaffIdSetForBusiness(
  staff: ReadonlyArray<{ id: string; email?: string | null }>,
  storeId: string | null,
  businessId: string,
): Promise<Set<string> | null> {
  if (!storeId) return null
  try {
    const assignments = await staffStoreAssignmentsByBusiness(businessId)
    return filterStaffIdsToStore(staff, assignments, storeId)
  } catch {
    return null
  }
}
