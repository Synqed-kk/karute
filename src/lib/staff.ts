import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export interface StaffMember {
  id: string
  full_name: string | null
  display_role?: string | null
  avatar_url?: string | null
  created_at: string
}

export interface StaffMemberBasic {
  id: string
  full_name: string | null
}

/**
 * Returns all staff profiles ordered alphabetically by full_name.
 * Returns an empty array on error (safe to render empty list).
 */
export async function getStaffList(): Promise<StaffMember[]> {
  const supabase = await createClient()
  // display_role not in generated types yet — cast to any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('profiles')
    .select('id, full_name, created_at, display_role, position, email, phone, avatar_url, pin_hash')
    .not('full_name', 'is', null)
    .not('full_name', 'ilike', '_system_%')
    .order('full_name', { ascending: true })

  if (error) {
    console.error('[getStaffList] Supabase error:', error.message)
    return []
  }

  return (data ?? []) as StaffMember[]
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
 */
export async function getActiveStaffId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get('active_staff_id')?.value ?? null
}

/**
 * Returns the current authenticated user's customer_id (tenant ID).
 * Used to scope inserts so RLS allows them.
 */
export async function getTenantId(): Promise<string> {
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
}
