import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { cookies } from 'next/headers'

export interface StaffMember {
  id: string
  full_name: string | null
  display_role?: string | null
  position?: string | null
  email?: string | null
  phone?: string | null
  avatar_url?: string | null
  has_pin: boolean
  created_at: string
}

export interface StaffMemberBasic {
  id: string
  full_name: string | null
}

// Inside unstable_cache there's no request context (no cookies → no RLS),
// so we use the service-role client and filter by businessId explicitly.
// The cache key includes businessId so tenants never see each other's data.
const staffListByBusiness = unstable_cache(
  async (businessId: string): Promise<StaffMember[]> => {
    const service = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (service as any)
      .from('profiles')
      .select('id, full_name, created_at, display_role, position, email, phone, avatar_url, pin_hash, customer_id')
      .eq('customer_id', businessId)
      .not('full_name', 'is', null)
      .not('full_name', 'ilike', '_system_%')
      .order('full_name', { ascending: true })

    if (error) {
      console.error('[getStaffList] Supabase error:', error.message)
      return []
    }

    return (data ?? []).map(
      ({
        pin_hash,
        customer_id: _customer_id,
        ...rest
      }: { pin_hash?: string | null; customer_id?: string; [key: string]: unknown }) => ({
        ...rest,
        has_pin: !!pin_hash,
      }),
    ) as StaffMember[]
  },
  ['staff-list-v1'],
  { revalidate: 60, tags: ['staff-list'] },
)

/**
 * Returns all staff profiles ordered alphabetically by full_name.
 * Returns an empty array on error (safe to render empty list).
 * Cached for 60s per tenant; mutation actions call updateTag('staff-list').
 */
export async function getStaffList(): Promise<StaffMember[]> {
  try {
    const businessId = await getBusinessId()
    return staffListByBusiness(businessId)
  } catch {
    return []
  }
}

/**
 * Returns a single staff profile by ID, or null if not found.
 */
export async function getStaffById(id: string): Promise<StaffMemberBasic | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

/**
 * Reads the active_staff_id cookie server-side.
 * Returns the cookie value or null if not set.
 *
 * Usage in save actions: always read staff_id from here — never accept it from client.
 * For mutations that record staff_id on a row, prefer `getValidatedActiveStaffId()`
 * so a stale cookie (e.g. for a deleted staff) doesn't poison the data.
 */
export async function getActiveStaffId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get('active_staff_id')?.value ?? null
}

/**
 * Like `getActiveStaffId()` but verifies the id against the current staff list.
 * Returns null if the cookie value doesn't match any active staff member —
 * caller should treat that as "no staff selected" and refuse to save.
 *
 * Avoids saving rows pinned to a deleted-staff id (audit-trail integrity).
 */
export async function getValidatedActiveStaffId(): Promise<string | null> {
  const id = await getActiveStaffId()
  if (!id) return null
  const list = await getStaffList()
  return list.some((s) => s.id === id) ? id : null
}

/**
 * Returns the current authenticated user's business id.
 * Used to scope inserts so RLS allows them. Reads the legacy
 * `profiles.customer_id` column — the legacy schema still names
 * the business column `customer_id` until the legacy-strip lands.
 */
// Memoized for the lifetime of a single request via React cache(). Called from
// many places per page (every Supabase scope check, every synqed client init)
// so deduping the auth + profile lookup is worth the wrapper.
export const getBusinessId = cache(async (): Promise<string> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data } = await supabase
    .from('profiles')
    .select('customer_id')
    .eq('id', user.id)
    .single()

  if (!data?.customer_id) throw new Error('Business profile not found')
  return data.customer_id
})
