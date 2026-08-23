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
   *  never a genuine empty assignment (⚖ Liam 2026-08-17, F-A). An auth id the
   *  roster can't place at all (getCurrentUserStaffId → null) is the same
   *  failed lookup: there is no assignment to read, so nothing is vouched for.
   *  Reads ignore
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
  // assignment already took). An unresolvable staffId is that same failure,
  // one step earlier: the auth id was never placed in the roster, so no
  // assignment was read — never a genuine empty.
  const lookup = staffId ? await getStaffStoresStrict(staffId) : null
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
 * The customer-list STORE LENS for a resolved scope — one home for the rule the
 * three cached-list call sites (予約 page, 録音 page, screens/appointments route)
 * each spelled inline as `clamped ? storeId : undefined`:
 *
 *   `undefined` → business-wide (viewAll / floating / degraded — the read plane
 *                 ignores `degraded` by the shipped F-A convention)
 *   a store id  → that store's server-filtered lens
 *   `null`      → BLIND: the caller ships an EMPTY list.
 *
 * Structural argument so both resolvers fit: web's StoreScope above and the
 * facade's ClampedStore (src/lib/app-api/store-clamp.ts).
 *
 * ponytail: the `null` arm is dead code in production and must stay that way —
 * it backstops the invariant "clamped ⇒ storeId non-null" (resolveStoreScope
 * returns `activeStore ?? allowed[0]`, resolveStoreForRequest returns
 * `requestedStoreId ?? assigned[0]`; both pinned by tests). If that ever broke,
 * the old inline shape collapsed to the BUSINESS-WIDE list — the RBAC clamp
 * failing OPEN, the one direction it must never fail. An empty list is
 * wrong-but-safe; another branch's customers are not. Same posture as
 * listAllCustomers' guard (src/lib/customers/list-all.ts:56), and `null` is not
 * assignable to the cached readers' `storeId?: string`, so tsc makes every call
 * site answer for it. Upgrade path if a legitimate "clamped with no store" case
 * ever appears: it doesn't — that combination is a clamp the caller could not
 * name.
 */
/**
 * Does a store-scoped RECORD (its own `store_id`, not a roster the actor is
 * picking from) fall outside the actor's clamp? Same predicate class as
 * customerLensFor/menuStoresForScope above — pure, no I/O. Born as karute
 * reassign's R3-1 source-store clamp (src/actions/karute.ts,
 * PACKET-F4-FIXROUND3-2026-09-02.md): a clamped actor must be refused a
 * WRITE (or a roster/picker) keyed off a record that itself sits in a store
 * they're not assigned to, independent of whatever destination the caller
 * supplied. Reused by that reassign core + roster AND the reassign-options
 * facade route (both need the identical refusal).
 *
 *   - `viewAll: true`          → false (never clamped). ponytail: dead in
 *     practice — every caller's scope already carries `allowedStoreIds:
 *     null` whenever `viewAll` is true (resolveStoreScope's own contract;
 *     callers that hand-build the scope object, e.g. the facade route,
 *     preserve it), so the `!allowedStoreIds` arm below already returns
 *     false first. Kept anyway as an invariant backstop — same house
 *     pattern as customerLensFor's dead `null` arm just above: if that
 *     pairing ever broke, this is the line that keeps a viewAll actor from
 *     being wrongly clamped.
 *   - `allowedStoreIds: null`  → false — floating actor, unclamped.
 *   - `record.store_id: null`  → false — the 全店舗/null-store convention
 *     (resolveKaruteStoreId's appointment clamp, src/actions/karute.ts,
 *     mirrors this arm 1:1).
 *   - otherwise                → true iff the record's store isn't in
 *     `allowedStoreIds`.
 *
 * A `degraded` scope is NOT handled here — every caller refuses on
 * `degraded` before ever reaching this predicate, so it takes only the two
 * fields it needs.
 */
export function sourceStoreOutOfScope(
  record: { store_id: string | null },
  scope: { viewAll: boolean; allowedStoreIds: string[] | null },
): boolean {
  if (scope.viewAll) return false
  if (!scope.allowedStoreIds) return false // floating — unclamped
  return record.store_id !== null && !scope.allowedStoreIds.includes(record.store_id)
}

export function customerLensFor(scope: {
  storeId: string | null
  allowedStoreIds: string[] | null
}): string | null | undefined {
  if (!scope.allowedStoreIds) return undefined
  return scope.storeId ?? null
}

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
 *
 * The self-pass covers DELETE as well as name/avatar: a clamped actor may
 * still remove their own row, unchanged from main — core's last-member guard
 * is the backstop there.
 */
export async function staffWriteInScope(args: {
  targetStaffId: string
  actorId: string | null
}): Promise<boolean> {
  const { targetStaffId, actorId } = args
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
