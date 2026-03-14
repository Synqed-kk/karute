import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Test Supabase client using service role key to bypass RLS for setup/teardown.
 * This is intentionally NOT the cookie-based @/lib/supabase/server client —
 * service role gives full table access needed to clean up test data.
 */
export const testSupabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Tracks IDs of test data created during test runs.
 * teardownTestData() uses these arrays to clean up in FK-safe order.
 */
export const created = {
  customerIds: [] as string[],
  karuteRecordIds: [] as string[],
  entryIds: [] as string[],
  profileIds: [] as string[],
}

/**
 * Deletes all test data in FK-safe order (children before parents):
 * entries -> karute_records -> customers -> profiles
 *
 * Call this in afterAll() of each test file.
 */
export async function teardownTestData(): Promise<void> {
  if (created.entryIds.length > 0) {
    await testSupabase.from('entries').delete().in('id', created.entryIds)
    created.entryIds = []
  }

  if (created.karuteRecordIds.length > 0) {
    await testSupabase
      .from('karute_records')
      .delete()
      .in('id', created.karuteRecordIds)
    created.karuteRecordIds = []
  }

  if (created.customerIds.length > 0) {
    await testSupabase.from('customers').delete().in('id', created.customerIds)
    created.customerIds = []
  }

  if (created.profileIds.length > 0) {
    await testSupabase.from('profiles').delete().in('id', created.profileIds)
    created.profileIds = []
  }
}

/**
 * Creates a test profile row directly in the DB (bypassing the auth trigger).
 * Required because saveKaruteRecord requires a valid staff_profile_id FK.
 *
 * The profile is tracked in created.profileIds for automatic teardown.
 */
export async function createTestProfile(
  id: string,
  fullName: string
): Promise<Database['public']['Tables']['profiles']['Row']> {
  const { data, error } = await testSupabase
    .from('profiles')
    .insert({
      id,
      full_name: fullName,
      // customer_id defaults to a test UUID via trigger — supply explicit value
      customer_id: id, // Use the same ID as customer_id for test isolation
      role: 'admin',
    })
    .select()
    .single()

  if (error) throw new Error(`createTestProfile failed: ${error.message}`)

  created.profileIds.push(data.id)
  return data
}
