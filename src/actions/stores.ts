'use server'

import { cache } from 'react'
import { revalidatePath, updateTag } from 'next/cache'
import { cookies } from 'next/headers'

import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import type { StoreInput } from '@/lib/validations/store'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { audit } from '@/lib/audit'
import {
  actorStoreVerdict,
  STORE_SCOPE_UNVERIFIED_DENIAL,
  STORE_UNASSIGNED_DENIAL,
} from '@/lib/auth/store-gate'
// The six client-threaded cores left this file for a server-only module
// (PKT-SEC-CORES-B2, 2026-09-23): every runtime export here is a
// browser-callable server action with no authentication of its own, and these
// take an already-scoped client. Never re-export them from this file.
import {
  createStoreCore,
  getStaffStoresWithClient,
  listStoresWithClient,
  setStaffStoresCore,
  setStoreHoursCore,
  updateStoreCore,
  type RosterRow,
  type StoreCreateResult,
  type StoresClient,
  type StoreWriteDeps,
} from '@/lib/stores/stores.core'

// Active-store view filter — which location the viewer is looking at. A cookie,
// not a security boundary (RLS/business scope is the boundary); the owner switch
// is a view preference. Reading it back filters store-scoped surfaces.
const ACTIVE_STORE_COOKIE = 'karute_active_store'

// ───────────────────────────────────────────────────────────────────────────
// Stores (locations) CRUD. Service-role-only table (src/.../20260604000000) —
// every read/write goes through here with an explicit business_id scope, so one
// business can't touch another's stores.
//
// Mutations are OWNER-only (display_role === 'owner', mirroring settings/page.tsx).
// When the RBAC stack (#159/#162) lands this upgrades to
// requireCapability('settings.manage') so managers/SVs can manage stores too.
//
// store_id is the LOCATION layer; business_id stays the tenant + coaching scope.
// Staff/customer counts are wired to real data in later phases (profiles.store_id
// = P2; customers/karute store_id = synqed-core, Anthony).
// ───────────────────────────────────────────────────────────────────────────

// Type ALIAS, not an `export type { … } from` re-export: Next's 'use server'
// transform registers every export NAME as a server reference at runtime, and
// a re-exported type name has no runtime binding → ReferenceError at build
// (the same note sits over MarkNoShowResult in src/actions/appointments.ts).
// The row shape lives with listStoresWithClient, its only producer.
export type StoreRow = import('@/lib/stores/stores.core').StoreRow

/** Cookie-session context resolution shared by the two web readers below —
 *  the lazy 本店-create prelude itself lives in the twin (shared with the
 *  facade paths). */
async function listStoresForWeb(withHours: boolean): Promise<StoreRow[]> {
  let businessId: string
  try {
    businessId = await getBusinessId()
  } catch {
    return []
  }
  const synqed = await getSynqedClient()
  return listStoresWithClient(synqed, businessId, { ensurePrimary: true, withHours })
}

/** All stores for the caller's business (anyone in the business can read).
 *  NO hours — this is the app-shell layout's per-render read and StoresSection's
 *  own refresh(); neither renders 営業時間. */
export async function listStores(): Promise<StoreRow[]> {
  return listStoresForWeb(false)
}

/** listStores + each store's own weekly hours (ONE storePolicies.list()). The
 *  設定 page's read: its 店舗 tab is the only web surface that edits them. */
export async function listStoresWithHours(): Promise<StoreRow[]> {
  return listStoresForWeb(true)
}

/** The viewer's active store (a cookie). Null when unset → "all / primary". */
export async function getActiveStoreId(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(ACTIVE_STORE_COOKIE)?.value ?? null
}

// Per-request dedupe (React cache): layout + page + actions each resolve the
// store scope, and a viewer with no pinned cookie (every single-store salon —
// the switcher never renders for them) would otherwise pay one stores.list
// core roundtrip per call site on every request.
const primaryStoreIdOnce = cache(async (): Promise<string | null> => {
  try {
    const synqed = await getSynqedClient()
    const { stores } = await synqed.stores.list()
    return stores.find((s) => s.is_primary)?.id ?? stores[0]?.id ?? null
  } catch {
    return null
  }
})

/** The business's primary store id (?? first store). Null when the business
 *  has no stores yet or the lookup fails. */
export async function getPrimaryStoreId(): Promise<string | null> {
  return primaryStoreIdOnce()
}

/** The store that store-scoped reads/writes default to: the pinned cookie,
 *  else the PRIMARY store. The StoreSwitcher displays the primary as active
 *  when nothing is pinned ("there is always an active store") — data and
 *  display must share that default, otherwise an unpinned cross-store viewer
 *  sees a pill naming one store over a list mixing every store (the カルテ
 *  leak Liam kept hitting). */
export async function getDefaultStoreId(): Promise<string | null> {
  return (await getActiveStoreId()) ?? getPrimaryStoreId()
}

/** Switch the active store. Validates the store is in the caller's business
 *  (so the cookie can never point at another tenant's store), then persists it. */
export async function setActiveStore(storeId: string): Promise<{ ok: true } | { error: string }> {
  // getSynqedClient resolves the business from the session, so it doubles as the
  // auth check. Validate the store belongs to the caller's business via core
  // (the client is business-scoped, so a 404 means it's not this tenant's store).
  let synqed
  try {
    synqed = await getSynqedClient()
  } catch {
    return { error: 'Not authenticated' }
  }
  try {
    await synqed.stores.get(storeId)
  } catch {
    return { error: 'Store not found.' }
  }

  // RBAC clamp: a branch-restricted staff (no stores.viewAll) may only pin a
  // store they're assigned to — otherwise the cookie would be a back door around
  // the store-scoped reads (lib/auth/store-scope). Cross-store roles and floating
  // staff (empty staff_stores = works everywhere) are unaffected.
  //
  // Round 2, 2026-09-24, D-S16-4 (discussed, default): anything that could not
  // be READ — the capability or roster read (an outage), the assignment lookup,
  // or a caller the roster cannot place — pins nothing, with the unverified
  // answer (never a silent rejection: both switchers show `error` inline). It
  // used to fall through and set the cookie to ANY store; the read plane now
  // reaches no store in the same case, and the pin must not disagree with it.
  const caps = await getMyCapabilities().catch(() => null)
  if (!caps) return { error: STORE_SCOPE_UNVERIFIED_DENIAL }
  if (!caps.has('stores.viewAll')) {
    const uid = await getCurrentUserStaffId().catch(() => null)
    const allowed = uid ? await getStaffStoresStrict(uid) : null
    if (!uid || allowed === null) return { error: STORE_SCOPE_UNVERIFIED_DENIAL }
    if (allowed && allowed.length > 0 && !allowed.includes(storeId)) {
      return { error: 'You can only view a store you are assigned to.' }
    }
    // ⚖ Liam 2026-09-16, the third flip point: an UNASSIGNED actor may pin no
    // store at all. `getStaffStores` swallowed a failed lookup to `[]`, which
    // read as "floating, pin anything" — the strict twin keeps the failure
    // apart (null above) so only a GENUINE empty assignment reaches the gate,
    // which is then answered by the gate's ONE resolution, memoized alongside
    // the capability seam's; `unknown` pins nothing (Round 2 fold, Greptile G1).
    if (allowed && allowed.length === 0 && uid) {
      const verdict = await actorStoreVerdict(uid)
      if (verdict === 'unassigned') return { error: STORE_UNASSIGNED_DENIAL }
      // `unknown` (or two reads that disagree) never pins: the read plane reaches
      // no store in this state (store-scope.ts), and the pin must not disagree.
      if (verdict !== 'unclamped') return { error: STORE_SCOPE_UNVERIFIED_DENIAL }
    }
  }

  const jar = await cookies()
  jar.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Clear the active store → the 全店舗 (all-stores) cross-store view. Same
 *  validation-free safety as reading: an absent cookie just means "all stores". */
export async function clearActiveStore(): Promise<{ ok: true }> {
  const jar = await cookies()
  jar.delete(ACTIVE_STORE_COOKIE)
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function createStore(
  input: StoreInput,
): Promise<StoreCreateResult> {
  // No pre-gate: resolve context tolerantly and let the core decide
  // everything (validation, THEN the owner check — web parity, #578 audit
  // finding). A requireOwnerBusiness() pre-gate here would short-circuit
  // before the core's zod parse, so a non-owner submitting an invalid body
  // would see the ownership denial instead of the validation message the
  // action always returned.
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const result = await createStoreCore(
    synqed,
    businessId,
    { staffList, selfUserId, source: 'web', requestId: crypto.randomUUID() },
    input,
  )
  if ('id' in result) revalidatePath('/settings')
  return result
}

export async function updateStore(
  id: string,
  input: StoreInput,
): Promise<{ ok: true } | { error: string }> {
  // No pre-gate — same reasoning as createStore above: the core decides
  // validation before ownership, so a non-owner's invalid body still gets
  // the validation message.
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const result = await updateStoreCore(
    synqed,
    businessId,
    { staffList, selfUserId, source: 'web', requestId: crypto.randomUUID() },
    id,
    input,
  )
  if ('ok' in result) revalidatePath('/settings')
  return result
}

/** Save one store's weekly 営業時間 (web door). Owner-only, seven weekdays
 *  always — see setStoreHoursCore. */
export async function setStoreHours(
  storeId: string,
  weeklyHours: unknown,
): Promise<{ ok: true } | { error: string }> {
  // No pre-gate — same reasoning as createStore/updateStore above.
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  // The canonical profile-id → CORE staff-id translation — the SAME
  // non-creating lookup the facade uses (R3-1: a settings save must never
  // mint a core staff record on a miss; only the booking flow's
  // resolveSynqedStaffId is allowed to create). `null` refuses the save
  // inside the core rather than stamping core's `updated_by` with a profile
  // id (see StoreHoursWriteDeps).
  // Deferred (the house idiom in this dir): staff-map pulls the SDK, and
  // listStores() — the app-shell layout's per-render read — has no business
  // dragging that in for a write path only this action reaches.
  let actingStaffId: string | null = null
  if (selfUserId) {
    const { lookupSynqedStaffIdForBusiness } = await import('@/lib/synqed/staff-map')
    actingStaffId = await lookupSynqedStaffIdForBusiness(selfUserId, businessId).catch(() => null)
  }
  const result = await setStoreHoursCore(
    synqed,
    businessId,
    { staffList, selfUserId, actingStaffId, source: 'web', requestId: crypto.randomUUID() },
    storeId,
    weeklyHours,
  )
  // Same revalidation updateStore does — and the same NOTHING else: no cache
  // tag exists for these numbers (both readers call storePolicies.get uncached).
  if ('ok' in result) revalidatePath('/settings')
  return result
}

/** The stores a staff member belongs to (empty = works in every store). Graceful
 *  pre-migration (no profile_stores table → []). */
export async function getStaffStores(staffId: string): Promise<string[]> {
  try {
    const synqed = await getSynqedClient()
    return getStaffStoresWithClient(synqed, staffId)
  } catch {
    return []
  }
}

/** Strict twin of getStaffStores for resolveStoreScope's fail-closed write
 *  clamp (⚖ Liam 2026-08-17, menu-catalog fix round F-A): null signals the
 *  assignment LOOKUP ITSELF failed — distinct from a genuine empty assignment
 *  ([]), which the floating-staff convention already treats as "works
 *  everywhere". getStaffStores (and every existing caller of it) keeps
 *  swallowing failures to [] exactly as before; only resolveStoreScope needs
 *  the distinction, to refuse writes it can't actually vouch for. */
export async function getStaffStoresStrict(staffId: string): Promise<string[] | null> {
  try {
    const synqed = await getSynqedClient()
    return (await synqed.staffStores.get(staffId)).store_ids
  } catch {
    return null
  }
}

/**
 * STORES AT CREATION — the second entry into `staffStores.set` (⚖ Liam's pick
 * 2026-09-16).
 *
 * `setStaffStoresCore` above stays literal-OWNER-only: CHANGING an existing
 * card's stores is an ownership act, and nothing here loosens `isRosterOwner`.
 * But a manager who may CREATE staff (`staff.invite`) must be able to place the
 * new hire, or every new card is born unassigned — the exact hole this whole
 * change closes. So creation gets its own door with its own, narrower rule:
 *
 *   the creator may set the NEW card's stores WITHIN their own allowed stores.
 *
 * `creatorAllowedStoreIds: null` = unclamped (stores.viewAll, or a floating
 * creator in a one-store salon) — any store of the business, which core
 * validates on its side. A non-null array is a real clamp and the requested set
 * must be a SUBSET of it: a 銀座-only manager cannot mint a 代官山 colleague.
 * Enforced HERE, so both transports inherit it from one place rather than each
 * route remembering to check.
 */
export async function setStaffStoresAtCreationCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreWriteDeps,
  staffId: string,
  storeIds: string[],
  creatorAllowedStoreIds: readonly string[] | null,
): Promise<{ ok: true } | { error: string }> {
  if (creatorAllowedStoreIds !== null) {
    const outside = storeIds.filter((id) => !creatorAllowedStoreIds.includes(id))
    // The literal every other door in this codebase already spells (⚖ fold
    // round 3, N1): a second NAME for one code reads as two codes.
    if (outside.length > 0) return { error: 'STORE_SCOPE_DENIED' }
  }
  try {
    await synqed.staffStores.set(staffId, storeIds)
    audit({
      category: 'settings',
      action: 'settings.staff_stores_change',
      severity: 'notice',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      detail: { store_ids: storeIds.join(','), count: storeIds.length, at_creation: true },
      requestId: deps.requestId,
      source: deps.source,
    })
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not set stores' }
  }
}

/** Set the stores a staff member belongs to (empty array = works in every store).
 *  Owner-only; validates the staff and every store are in the caller's business,
 *  then REPLACES the full assignment set. business-scoped at every step so a link
 *  can never reference another tenant's staff or store. */
export async function setStaffStores(
  staffId: string,
  storeIds: string[],
): Promise<{ ok: true } | { error: string }> {
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const result = await setStaffStoresCore(
    synqed,
    businessId,
    { staffList, selfUserId, source: 'web', requestId: crypto.randomUUID() },
    staffId,
    storeIds,
  )
  if ('ok' in result) {
    // updateTag is Server-Action-only (throws from a Route Handler) — stays
    // here, not in the core the facade route also calls.
    updateTag('staff-list')
    revalidatePath('/settings')
  }
  return result
}
