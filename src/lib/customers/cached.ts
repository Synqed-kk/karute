import { getSynqedClient } from '@/lib/synqed/client'

export interface CachedCustomerOption {
  id: string
  name: string
}

/**
 * Get customer list for dropdowns.
 * Called within Promise.all so it runs in parallel with other queries.
 */
export async function getCachedCustomerList(): Promise<CachedCustomerOption[]> {
  const synqed = await getSynqedClient()
  const result = await synqed.customers.list({
    page_size: 100,
    sort_by: 'name',
    sort_order: 'asc',
  })

  return result.customers.map((c) => ({ id: c.id, name: c.name }))
}
