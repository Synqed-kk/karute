'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { cookies } from 'next/headers'

import { createServiceClient } from '@/lib/supabase/service'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { storeSchema, type StoreInput } from '@/lib/validations/store'
import { loadEntitlement } from '@/lib/entitlements'

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

  // Stores now live in synqed-core (the same DB as the events that key on
  // store_id). Lazily create the 本店 primary store so every business has one;
  // the unique index in core blocks a 2nd primary, so a race is harmless.
  let stores = (await synqed.stores.list()).stores
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

  // Per-store staff counts from the profile_stores link table. NOTE: this still
  // lives in the karute DB — it moves to core next (needs profile→staff id
  // remapping). Wrapped so a pre-migration DB degrades to 0 rather than throwing.
  const staffByStore = new Map<string, number>()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    const { data: links } = await service
      .from('profile_stores')
      .select('store_id')
      .eq('business_id', businessId)
    for (const l of links ?? []) {
      if (l.store_id) staffByStore.set(l.store_id, (staffByStore.get(l.store_id) ?? 0) + 1)
    }
  } catch {
    /* profile_stores table not present yet → counts stay 0 */
  }

  // Real per-store customer counts from synqed-core (distinct customers with ≥1
  // event at the store, derived server-side — customers stay business-wide).
  // Resilient: a core without counts-by-store degrades to 0, never throws.
  const customersByStore = new Map<string, number>()
  try {
    const { counts } = await synqed.customers.countsByStore()
    for (const [storeId, n] of Object.entries(counts)) {
      customersByStore.set(storeId, n)
    }
  } catch {
    /* core without counts-by-store → counts stay 0 */
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

  const synqed = await getSynqedClient()
  try {
    const store = await synqed.stores.create({
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
    })
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
    await synqed.stores.update(id, {
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { error: `Could not update store: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** The stores a staff member belongs to (empty = works in every store). Graceful
 *  pre-migration (no profile_stores table → []). */
export async function getStaffStores(staffId: string): Promise<string[]> {
  let businessId: string
  try {
    businessId = await getBusinessId()
  } catch {
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  try {
    const { data } = await service
      .from('profile_stores')
      .select('store_id')
      .eq('business_id', businessId)
      .eq('profile_id', staffId)
    return (data ?? []).map((r: { store_id: string }) => r.store_id)
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
  let businessId: string
  try {
    businessId = await requireOwnerBusiness()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // Staff must belong to this business.
  const { data: staff } = await service
    .from('profiles')
    .select('id')
    .eq('id', staffId)
    .eq('customer_id', businessId)
    .maybeSingle()
  if (!staff) return { error: 'Staff member not found.' }

  // Every requested store must belong to this business (so a link can never point
  // at another tenant's store). De-dupe first.
  const wanted = Array.from(new Set(storeIds))
  if (wanted.length > 0) {
    const { data: validStores } = await service
      .from('stores')
      .select('id')
      .eq('business_id', businessId)
      .in('id', wanted)
    const validIds = new Set((validStores ?? []).map((s: { id: string }) => s.id))
    if (wanted.some((id) => !validIds.has(id))) return { error: 'Store not found.' }
  }

  // Reconcile the link set WITHOUT an unbounded delete-first window. Upsert the
  // wanted links, THEN drop only the links no longer wanted. A partial failure can
  // at worst over-assign (benign, self-corrects on re-save); it can never pass
  // through a zero-row state and silently flip the staff to "works in every store"
  // (the failure mode of delete-then-insert). Empty `wanted` = remove all =
  // "works in every store" (the intended floating/owner semantic).
  if (wanted.length > 0) {
    const rows = wanted.map((store_id) => ({
      business_id: businessId,
      profile_id: staffId,
      store_id,
    }))
    const { error: upErr } = await service
      .from('profile_stores')
      .upsert(rows, { onConflict: 'profile_id,store_id' })
    if (upErr) return { error: `Could not update stores: ${upErr.message}` }
  }

  let del = service
    .from('profile_stores')
    .delete()
    .eq('business_id', businessId)
    .eq('profile_id', staffId)
  if (wanted.length > 0) del = del.not('store_id', 'in', `(${wanted.join(',')})`)
  const { error: delErr } = await del
  if (delErr) return { error: `Could not update stores: ${delErr.message}` }

  updateTag('staff-list')
  revalidatePath('/settings')
  return { ok: true }
}
