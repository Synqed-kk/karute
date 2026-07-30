'use server'

import { cache } from 'react'
import { revalidatePath, updateTag } from 'next/cache'
import { cookies } from 'next/headers'
import type { SynqedClient } from '@synqed-kk/client'

import { getSynqedClient } from '@/lib/synqed/client'
import { businessDisplayName } from '@/lib/business-name'
import { getBusinessId, getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { storeSchema, type StoreInput, STORE_OWNER_DENIAL } from '@/lib/validations/store'
import { loadEntitlementWithClient } from '@/lib/entitlements'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import type { Capability } from '@/lib/auth/permissions'
import { audit } from '@/lib/audit'

// Explicit-client seam (design-parity packet 12 §B-3 S2 — the P-B pattern):
// every twin below takes this instead of resolving getSynqedClient() from the
// cookie session, so the facade (Bearer path, business resolved from the
// verified token) and the web actions run the IDENTICAL write/read logic.
type StoresClient = Pick<SynqedClient, 'stores' | 'staffStores' | 'customers' | 'entitlements' | 'orgSettings'>

/** Roster row shape the owner gate needs — a subset of StaffMember so the
 *  twin doesn't import the whole staff module's type surface. */
type RosterRow = { id: string; display_role?: string | null }

/** Pure owner-roster check — the ONE place "is this caller the salon owner"
 *  is decided, shared by every write core below (fed the same roster +
 *  resolved auth id via deps, cookie-resolved on web / Bearer-resolved on
 *  the facade). */
function isRosterOwner(staffList: RosterRow[], selfUserId: string | null): boolean {
  return (
    !!selfUserId &&
    staffList.some((s) => s.id === selfUserId && (s.display_role ?? '').toLowerCase() === 'owner')
  )
}

/** Identity + provenance a Bearer/cookie caller feeds the write cores: the
 *  roster (for the owner check), the resolved caller id (owner check +
 *  audit actor), and which path is calling (the audit event's `source`). */
type StoreWriteDeps = {
  staffList: RosterRow[]
  selfUserId: string | null
  source: 'web' | 'facade'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
}

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

export interface StoreRow {
  id: string
  name: string
  address: string | null
  phone: string | null
  isPrimary: boolean
  active: boolean
  staffCount: number
  customerCount: number
  /** This location's vertical (BUSINESS_TYPES value). Null until core's
   *  stores.business_type column exists / backfills (brief 2026-07-08). */
  businessType: string | null
}

/** Read business_type off a core store row tolerantly — the SDK types gain the
 *  field with Anthony's core change; until then it's simply absent. */
function coreBusinessType(row: unknown): string | null {
  const v = (row as { business_type?: unknown }).business_type
  return typeof v === 'string' && v.length > 0 ? v : null
}

// Primary-store name = the shared truth chain (business-name.ts). This write
// is PERMANENT (the provisioned 本店 keeps it, nothing re-syncs it later) and
// fires on the FIRST authenticated render — usually BEFORE /welcome writes
// org settings — so the signup-captured tier is the one most new tenants
// actually hit. 'Main store' only when both sources are empty.

/** Client-threaded core of listStores (facade Bearer path, design-parity
 *  packet 12 §B-3 S2 — same WithClient split as orgSettingsWithClient).
 *  BYTE-PARITY with the pre-S2 web-only listStores body (810e4b6d): list +
 *  BOTH per-store count maps, merged, AND (when `opts.ensurePrimary`) the
 *  lazy 本店-create — web always performed this write, and callers that opt
 *  in provision a brand-new tenant's primary store the same way. Race-
 *  tolerant: the unique index in core blocks a 2nd primary, so a losing
 *  create is ignored and the caller still gets the winner's row.
 *
 *  `ensurePrimary` is explicit at every call site (no default) — this write
 *  is reachable via GET-classified facade keys, so which keys can trigger it
 *  must stay visible at the call site, not buried in a default. Any facade
 *  GET that passes `true` MUST carry its endpoint key in
 *  REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts) — the method-
 *  scan coverage test can't see a write hidden under a GET, so
 *  GET_ENDPOINTS_WITH_WRITE_SIDE_EFFECTS in
 *  app-api-revocation-coverage.test.ts is the maintained registry for it. */
export async function listStoresWithClient(
  synqed: StoresClient,
  businessId: string,
  opts: { ensurePrimary: boolean },
): Promise<StoreRow[]> {
  // Fetch the store list AND both per-store count maps in one parallel batch —
  // they're independent reads, so there's no reason to await them in series
  // (3 back-to-back round-trips → 1; the settings 店舗 list felt this as a
  // visible lag before the second store appeared). Each count map stays
  // resilient: a core that can't serve it degrades to an empty map (→ 0)
  // instead of throwing.
  //   - staff counts: core's staff_stores link table.
  //   - customer counts: distinct customers with >=1 event at the store, derived
  //     server-side (customers stay business-wide). The heaviest of the three.
  const [storesRes, staffByStore, customersByStore] = await Promise.all([
    synqed.stores.list(),
    synqed.staffStores
      .counts()
      .then((r) => new Map<string, number>(Object.entries(r.counts)))
      .catch(() => new Map<string, number>()),
    synqed.customers
      .countsByStore()
      .then((r) => new Map<string, number>(Object.entries(r.counts)))
      .catch(() => new Map<string, number>()),
  ])

  // Lazily create the 本店 primary store so every business ends up with one —
  // EVENTUALLY, not synchronously: a core outage skips this render (failure
  // contract below) and a later zero-store render provisions instead.
  // Only hit on a brand-new business (no stores yet) — its counts are empty
  // anyway, so the parallel fetch above isn't wasted. Re-lists (not a second
  // full twin call) so the count maps from the first pass — both correctly
  // empty for a business that had zero stores — merge with the fresh row.
  let stores = storesRes.stores
  if (opts.ensurePrimary && stores.length === 0) {
    // Outage posture (the chain's failure contract): if core can't answer the
    // name question, SKIP provisioning this render — the store name is a
    // permanent write, and the lazy create retries on every zero-store
    // render, so deferring costs one render and can never bake a wrong name.
    let name: string | null = null
    try {
      name = await businessDisplayName(synqed, businessId, 'Main store')
    } catch {
      /* core unreachable — no permanent write off a failed read */
    }
    if (name !== null) {
      try {
        await synqed.stores.create({ name, is_primary: true })
      } catch {
        /* race: another request created the primary — ignore */
      }
      stores = (await synqed.stores.list()).stores
    }
  }

  return stores.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    phone: s.phone,
    isPrimary: s.is_primary,
    active: s.active,
    staffCount: staffByStore.get(s.id) ?? 0,
    customerCount: customersByStore.get(s.id) ?? 0,
    businessType: coreBusinessType(s),
  }))
}

/** All stores for the caller's business (anyone in the business can read).
 *  Thin wrapper — the lazy 本店-create prelude lives in the twin now (shared
 *  with the facade paths), so this just resolves cookie-session context. */
export async function listStores(): Promise<StoreRow[]> {
  let businessId: string
  try {
    businessId = await getBusinessId()
  } catch {
    return []
  }
  const synqed = await getSynqedClient()
  return listStoresWithClient(synqed, businessId, { ensurePrimary: true })
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
  // staff (empty staff_stores = works everywhere) are unaffected. A failed
  // capability resolve (the resolver throws post-#652-P1) counts as no
  // capabilities: the clamp check simply applies — fail closed, never an
  // unhandled server-action rejection.
  const caps = await getMyCapabilities().catch(() => new Set<Capability>())
  if (!caps.has('stores.viewAll')) {
    const uid = await getCurrentUserStaffId()
    const allowed = uid ? await getStaffStores(uid) : []
    if (allowed.length > 0 && !allowed.includes(storeId)) {
      return { error: 'You can only view a store you are assigned to.' }
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

/** Client-threaded core of createStore (facade Bearer path, design-parity
 *  packet 12 §B-3 S2). Carries EVERY rule the write needs so web and facade
 *  can never diverge: zod validation, the owner gate (against the roster/
 *  self-id `deps` supplies — cookie-resolved for web, Bearer-resolved for
 *  the facade), the entitlement cap, and the audit write. `deps.source`
 *  labels the ONE audit row this write ever produces — see the
 *  FACADE_AUDIT_MAP 'skip' rows for stores.create/stores.update
 *  (src/lib/audit.ts): a facade-side audit rule here would double it. */
export async function createStoreCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreWriteDeps,
  input: StoreInput,
): Promise<{ id: string } | { error: string }> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  if (!isRosterOwner(deps.staffList, deps.selfUserId)) {
    return { error: STORE_OWNER_DENIAL }
  }

  // Plan gate (P3): server-side store cap — the authoritative app-level check
  // (the client button is just UX). Dev/owner accounts (Liam) are never capped —
  // is_unlimited / KARUTE_UNLIMITED_BUSINESS_IDS.
  //
  // Soft gate for the payment-later phase: the count read + INSERT below aren't a
  // single transaction, so a rare concurrent double-create by the same owner could
  // slip one store past a finite cap. Accepted for now (store creation is rare +
  // owner-only). Billing-grade atomicity arrives with Stripe seat creation (seats
  // are transactional); a sooner hard floor = a Postgres RPC wrapping count+insert
  // in pg_advisory_xact_lock(hashtext(business_id)).
  const entitlement = await loadEntitlementWithClient(synqed, businessId)
  if (!entitlement.canAddStore) return { error: 'STORE_LIMIT_REACHED' }

  // New stores must declare their vertical (edits stay tolerant — see schema).
  if (!parsed.data.business_type) return { error: 'Business type is required' }

  try {
    // business_type persists in core (stores.business_type — Anthony's column,
    // brief 2026-07-08). Until the column + SDK field land, core's parser strips
    // the key; it starts persisting the moment the column exists. Deliberately
    // NO Karute-side shadow copy — core stays the single source of truth.
    const payload: Parameters<typeof synqed.stores.create>[0] & {
      business_type?: string
    } = {
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      business_type: parsed.data.business_type,
    }
    const store = await synqed.stores.create(payload)
    audit({
      category: 'settings',
      action: 'settings.store_create',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'store',
      targetId: store.id,
      requestId: deps.requestId,
      source: deps.source,
    })
    return { id: store.id }
  } catch (e) {
    return { error: `Could not create store: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

export async function createStore(
  input: StoreInput,
): Promise<{ id: string } | { error: string }> {
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

/** Client-threaded core of updateStore — see createStoreCore's doc comment
 *  for the shared owner-gate + audit-source contract. No entitlement check
 *  (edits never touch the store count). */
export async function updateStoreCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreWriteDeps,
  id: string,
  input: StoreInput,
): Promise<{ ok: true } | { error: string }> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  if (!isRosterOwner(deps.staffList, deps.selfUserId)) {
    return { error: STORE_OWNER_DENIAL }
  }
  try {
    // Same passthrough as createStoreCore — see the note there.
    const payload: Parameters<typeof synqed.stores.update>[1] & {
      business_type?: string
    } = {
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      business_type: parsed.data.business_type,
    }
    await synqed.stores.update(id, payload)
    audit({
      category: 'settings',
      action: 'settings.store_update',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'store',
      targetId: id,
      requestId: deps.requestId,
      source: deps.source,
    })
    return { ok: true }
  } catch (e) {
    return { error: `Could not update store: ${e instanceof Error ? e.message : 'unknown'}` }
  }
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

/** Client-threaded core of getStaffStores (facade Bearer path, design-parity
 *  packet 12 §S4a). Graceful pre-migration (no profile_stores table → []) —
 *  same tolerance as the web wrapper below. */
export async function getStaffStoresWithClient(
  synqed: StoresClient,
  staffId: string,
): Promise<string[]> {
  try {
    return (await synqed.staffStores.get(staffId)).store_ids
  } catch {
    return []
  }
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

/** Client-threaded core of setStaffStores (facade Bearer path, design-parity
 *  packet 12 §S4a — same owner gate + audit-source contract as
 *  createStoreCore/updateStoreCore; STRICTER than staff.manage per the
 *  original requireOwnerBusiness gate, kept as-is here). */
export async function setStaffStoresCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreWriteDeps,
  staffId: string,
  storeIds: string[],
): Promise<{ ok: true } | { error: string }> {
  if (!isRosterOwner(deps.staffList, deps.selfUserId)) {
    return { error: STORE_OWNER_DENIAL }
  }
  // staff_stores lives in core now; the reconcile (validate + atomic upsert/
  // delete) happens server-side in one transaction.
  try {
    await synqed.staffStores.set(staffId, storeIds)
    // Store assignment changes what data a staff member can reach — notice,
    // like permissions_change. count 0 = the "works in every store" state.
    audit({
      category: 'settings',
      action: 'settings.staff_stores_change',
      severity: 'notice',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      detail: { store_ids: storeIds.join(','), count: storeIds.length },
      requestId: deps.requestId,
      source: deps.source,
    })
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update stores' }
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
