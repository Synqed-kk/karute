'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { cookies } from 'next/headers'

import { createServiceClient } from '@/lib/supabase/service'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { storeSchema, type StoreInput } from '@/lib/validations/store'
import { loadEntitlement } from '@/lib/entitlements'
import { getMyCapabilities } from '@/lib/auth/require-permission'

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

async function requireOwnerBusiness(): Promise<string> {
  const [list, uid] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
  const isOwner =
    !!uid && list.some((s) => s.id === uid && (s.display_role ?? '').toLowerCase() === 'owner')
  if (!isOwner) throw new Error('Only the salon owner can manage stores.')
  return getBusinessId()
}

/** Name for the auto-created primary store — the salon name from the owner's
 *  profile (set at signup), i.e. the first profile in the business. */
async function primaryStoreName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  businessId: string,
): Promise<string> {
  const { data } = await service
    .from('profiles')
    .select('full_name')
    .eq('customer_id', businessId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.full_name || 'Main store'
}

/** All stores for the caller's business (anyone in the business can read).
 *  Lazily creates the 本店 primary store so every business always has one. */
export async function listStores(): Promise<StoreRow[]> {
  let businessId: string
  try {
    businessId = await getBusinessId()
  } catch {
    return []
  }
  const synqed = await getSynqedClient()

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

  // Lazily create the 本店 primary store so every business always has one. Only
  // hit on a brand-new business (no stores yet) — its counts are empty anyway,
  // so the parallel fetch above isn't wasted. The unique index in core blocks a
  // 2nd primary, so a race is harmless.
  let stores = storesRes.stores
  if (stores.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    const name = await primaryStoreName(service, businessId)
    try {
      await synqed.stores.create({ name, is_primary: true })
    } catch {
      /* race: another request created the primary — ignore */
    }
    stores = (await synqed.stores.list()).stores
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

/** The viewer's active store (a cookie). Null when unset → "all / primary". */
export async function getActiveStoreId(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(ACTIVE_STORE_COOKIE)?.value ?? null
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
  const caps = await getMyCapabilities()
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

export async function createStore(
  input: StoreInput,
): Promise<{ id: string } | { error: string }> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  let businessId: string
  try {
    businessId = await requireOwnerBusiness()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
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
  const entitlement = await loadEntitlement(businessId)
  if (!entitlement.canAddStore) return { error: 'STORE_LIMIT_REACHED' }

  // New stores must declare their vertical (edits stay tolerant — see schema).
  if (!parsed.data.business_type) return { error: 'Business type is required' }

  const synqed = await getSynqedClient()
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
    revalidatePath('/settings')
    return { id: store.id }
  } catch (e) {
    return { error: `Could not create store: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

export async function updateStore(
  id: string,
  input: StoreInput,
): Promise<{ ok: true } | { error: string }> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  // Owner-only gate (throws if not the salon owner).
  try {
    await requireOwnerBusiness()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const synqed = await getSynqedClient()
  try {
    // Same passthrough as createStore — see the note there.
    const payload: Parameters<typeof synqed.stores.update>[1] & {
      business_type?: string
    } = {
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      business_type: parsed.data.business_type,
    }
    await synqed.stores.update(id, payload)
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { error: `Could not update store: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** The stores a staff member belongs to (empty = works in every store). Graceful
 *  pre-migration (no profile_stores table → []). */
export async function getStaffStores(staffId: string): Promise<string[]> {
  try {
    const synqed = await getSynqedClient()
    return (await synqed.staffStores.get(staffId)).store_ids
  } catch {
    return []
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
  // Owner-only gate.
  try {
    await requireOwnerBusiness()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  // staff_stores lives in core now; the reconcile (validate + atomic upsert/
  // delete) happens server-side in one transaction.
  const synqed = await getSynqedClient()
  try {
    await synqed.staffStores.set(staffId, storeIds)
    updateTag('staff-list')
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update stores' }
  }
}
