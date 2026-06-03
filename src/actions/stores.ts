'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId, getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { storeSchema, type StoreInput } from '@/lib/validations/store'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const select = 'id, name, address, phone, is_primary, active'
  const query = () =>
    service
      .from('stores')
      .select(select)
      .eq('business_id', businessId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

  let { data } = await query()

  if (!data || data.length === 0) {
    const name = await primaryStoreName(service, businessId)
    // Idempotent: the partial unique index blocks a 2nd primary; ignore a race.
    await service.from('stores').insert({ business_id: businessId, name, is_primary: true })
    const reread = await query()
    data = reread.data
  }

  // Real staff counts per store: one read of the business's profiles, tallied by
  // store_id in JS. Wrapped so a pre-migration DB (no store_id column) degrades
  // to 0 rather than throwing. Customer counts still need synqed-core store_id.
  const staffByStore = new Map<string, number>()
  try {
    const { data: profs } = await service
      .from('profiles')
      .select('store_id')
      .eq('customer_id', businessId)
      .not('store_id', 'is', null)
    for (const p of profs ?? []) {
      if (p.store_id) staffByStore.set(p.store_id, (staffByStore.get(p.store_id) ?? 0) + 1)
    }
  } catch {
    /* store_id column not present yet → counts stay 0 */
  }

  return (data ?? []).map(
    (s: {
      id: string
      name: string
      address: string | null
      phone: string | null
      is_primary: boolean
      active: boolean
    }) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      phone: s.phone,
      isPrimary: s.is_primary,
      active: s.active,
      staffCount: staffByStore.get(s.id) ?? 0,
      customerCount: 0, // synqed-core store_id (Anthony)
    }),
  )
}

/** The viewer's active store (a cookie). Null when unset → "all / primary". */
export async function getActiveStoreId(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(ACTIVE_STORE_COOKIE)?.value ?? null
}

/** Switch the active store. Validates the store is in the caller's business
 *  (so the cookie can never point at another tenant's store), then persists it. */
export async function setActiveStore(storeId: string): Promise<{ ok: true } | { error: string }> {
  let businessId: string
  try {
    businessId = await getBusinessId()
  } catch {
    return { error: 'Not authenticated' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data } = await service
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (!data) return { error: 'Store not found.' }

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data, error } = await service
    .from('stores')
    .insert({
      business_id: businessId,
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      is_primary: false,
      active: true,
    })
    .select('id')
    .maybeSingle()
  if (error) return { error: `Could not create store: ${error.message}` }
  revalidatePath('/settings')
  return { id: data.id as string }
}

export async function updateStore(
  id: string,
  input: StoreInput,
): Promise<{ ok: true } | { error: string }> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { error } = await service
    .from('stores')
    .update({
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
    })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) return { error: `Could not update store: ${error.message}` }
  revalidatePath('/settings')
  return { ok: true }
}
