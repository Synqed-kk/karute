import { createClient } from '@/lib/supabase/server'

export interface CachedCustomerOption {
  id: string
  name: string
}

/**
 * Get customer list for dropdowns.
 * Called within Promise.all so it runs in parallel with other queries.
 */
export async function getCachedCustomerList(): Promise<CachedCustomerOption[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true })

  return (data ?? []).map((c) => ({ id: c.id, name: c.name }))
}
