import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface CachedCustomerOption {
  id: string
  name: string
}

/**
 * Cached customer list for dropdowns.
 * Revalidates every 60 seconds — customers change infrequently.
 */
export const getCachedCustomerList = unstable_cache(
  async (): Promise<CachedCustomerOption[]> => {
    const supabase = await createClient()
    const { data } = await supabase
      .from('customers')
      .select('id, name')
      .order('name', { ascending: true })

    return (data ?? []).map((c) => ({ id: c.id, name: c.name }))
  },
  ['customer-list'],
  { revalidate: 60 }
)
