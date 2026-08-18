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

import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { getMyCapabilities } from './require-permission'
import { staffStoresOverlap } from './permissions'
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
   *  array means reads + search MUST stay within it. */
  allowedStoreIds: string[] | null
  /** True when a non-viewAll actor's staff_stores assignment LOOKUP FAILED —
   *  never a genuine empty assignment (⚖ Liam 2026-08-17, F-A). Reads ignore
   *  this field entirely (storeId/allowedStoreIds above are computed exactly
   *  as they always were, failure or not); only the menu-write clamp
   *  (storeScopeError, src/actions/menus.ts) fails closed on it, refusing a
   *  write it can't actually vouch for. Always false under viewAll (the
   *  assignment is never consulted) and false for a confirmed floating or
   *  clamped staff. */
  degraded: boolean
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
 *
 * React cache(): layout + page + nested loaders resolve the scope ~5× in one
 * request (measured on the 予約 render, 2026-07-30 speed pass) — for a
 * branch-restricted staff each call was an uncached staffStores.get roundtrip.
 * Same per-request dedupe idiom as getMyCapabilities / primaryStoreIdOnce.
 * setActiveStore never calls this, so the memo can't be primed ahead of its
 * cookie write; every render pass resolves against the cookie it started with.
 */
export const resolveStoreScope = cache(async (): Promise<StoreScope> => {
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
      degraded: false,
    }
  }

  // null = the lookup ITSELF failed (getStaffStoresStrict, F-A) — kept apart
  // from a genuine empty assignment ([]) so the write clamp can fail closed
  // on the former while every value below stays identical to today either
  // way (a failure folds into the same "no stores" branch a real empty
  // assignment already took).
  const lookup = staffId ? await getStaffStoresStrict(staffId) : []
  const degraded = lookup === null
  const allowed = lookup ?? []
  if (allowed.length === 0) {
    // Floating staff (assigned to no specific store) = works in every store,
    // per the staff_stores convention. Same unset-cookie default as above.
    return {
      storeId: activeStore ?? (await getPrimaryStoreId()),
      viewAll: false,
      allowedStoreIds: null,
      degraded,
    }
  }

  const storeId =
    activeStore && allowed.includes(activeStore) ? activeStore : allowed[0]
  return { storeId, viewAll: false, allowedStoreIds: allowed, degraded: false }
})

/**
 * Which stores may the menu UI OFFER this actor (store pills + editable rows)?
 * The server write clamp (storeScopeError, src/actions/menus.ts) is the real
 * enforcement — this only decides what the UI dangles in front of the actor,
 * so it must never show a store the clamp would refuse.
 *
 *   - assigned branch staff (`allowedStoreIds: [...]`) → ONLY those stores
 *   - viewAll (`viewAll: true`)                        → every store
 *   - floating staff (`allowedStoreIds: null`,
 *     `degraded: false`)                                → every store — unclamped,
 *                                                          same as the server
 *   - degraded (`degraded: true`)                       → `[]` — BLIND. The
 *     lookup that would tell us this actor's real stores failed; the server
 *     clamp already fails closed on it (storeScopeError refuses the write),
 *     so the UI must match rather than show every branch's name behind a
 *     doomed edit control (isolation law: hide, never show-and-refuse;
 *     Greptile P1 on #707)
 *   - `scope === null` (resolveStoreScope itself threw)  → today's behaviour,
 *     unchanged: every store if the actor can viewAll, else none
 */
export function menuStoresForScope<T extends { id: string }>(
  scope: StoreScope | null,
  canViewAllStores: boolean,
  stores: T[],
): T[] {
  const allowed = scope?.allowedStoreIds
  if (allowed) return stores.filter((s) => allowed.includes(s.id))
  // Degraded lookup = fail closed, exactly like the server write clamp:
  // offer NOTHING rather than every branch's name + a doomed edit control.
  if (scope?.degraded) return []
  return scope || canViewAllStores ? stores : []
}

/**
 * The staff WRITE clamp for the WEB transport (cookie session) — the twin of
 * ensureStaffWriteInScope (src/lib/app-api/store-clamp.ts). True = the write
 * may proceed; src/actions/staff.ts turns false into the house `{ error }`.
 *
 * Free passes: `stores.viewAll` · a SELF-edit (a staff member changing their
 * own name or avatar is never this clamp's business, and the read plane
 * already guarantees self-visibility) · a floating actor (empty assignment =
 * works in every store, so the target's own assignment can't change the
 * answer — and isn't fetched). `degraded` refuses outright (F-A: the actor's
 * assignment lookup failed, so nothing about them can be vouched for).
 */
export async function staffWriteInScope(
  targetStaffId: string,
  actorId: string | null,
): Promise<boolean> {
  const { viewAll, allowedStoreIds, degraded } = await resolveStoreScope()
  if (viewAll || targetStaffId === actorId) return true
  if (degraded) return false
  if (!allowedStoreIds) return true
  return staffStoresOverlap(allowedStoreIds, await getStaffStoresStrict(targetStaffId))
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

// ─── Store-scoped staff ROSTER (Liam ruling 8/17) ───────────────────────────
// 銀座-only staff see 銀座 staff; 代官山-only see 代官山; assigned to both → both.
// Unlike the picker filter above this narrows the roster the SERVER SHIPS (the
// switch drawer + the 設定→スタッフ list), because a clamped client must never
// receive the other branch's names/emails at all — hide, not filter-after-ship.
// Same fail-open posture as the picker (the roster read itself comes from the
// same core, so an assignment failure means the list is empty anyway).

/**
 * Bearer-safe core: the roster this viewer may SEE — the union of the staff
 * assigned to each store the viewer is clamped to, plus the viewer themselves
 * (a staff missing from their own drawer/settings list is broken). Unclamped
 * viewers (stores.viewAll, or a floating staff with an empty assignment —
 * both `allowedStoreIds: null`) keep the full roster, unchanged.
 */
export async function viewerStaffRosterForBusiness<
  T extends { id: string; email?: string | null },
>(
  staff: readonly T[],
  allowedStoreIds: string[] | null,
  selfId: string | null,
  businessId: string,
): Promise<T[]> {
  if (!allowedStoreIds?.length) return [...staff]
  const sets = await Promise.all(
    allowedStoreIds.map((storeId) =>
      storeStaffIdSetForBusiness(staff, storeId, businessId),
    ),
  )
  if (sets.some((s) => s === null)) return [...staff]
  const visible = new Set<string>(selfId ? [selfId] : [])
  for (const s of sets) s!.forEach((id) => visible.add(id))
  return staff.filter((m) => visible.has(m.id))
}

/** Cookie-session twin of viewerStaffRosterForBusiness (web pages/layouts). */
export async function viewerStaffRoster<
  T extends { id: string; email?: string | null },
>(staff: readonly T[], selfId: string | null): Promise<T[]> {
  try {
    const { allowedStoreIds } = await resolveStoreScope()
    if (!allowedStoreIds?.length) return [...staff]
    return await viewerStaffRosterForBusiness(
      staff,
      allowedStoreIds,
      selfId,
      await getBusinessId(),
    )
  } catch {
    return [...staff]
  }
}
