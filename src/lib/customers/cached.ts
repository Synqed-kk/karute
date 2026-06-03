import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'

export interface CachedCustomerOption {
  id: string
  name: string
  /** QuickReserve "returning customer" flag. Drives the agenda's 新規 badge:
   *  a known existing customer is NEVER 新規, even if we have no karute/past
   *  appointment for them yet (QR-migrated regulars). */
  isExistingCustomer: boolean
}

// businessId is the cache key — Next includes function args in the key automatically,
// so each tenant gets its own entry. The static tag lets mutation actions invalidate
// every tenant's entry with a single revalidateTag('customers') call.
const customerListByBusiness = unstable_cache(
  async (businessId: string): Promise<CachedCustomerOption[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
    }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    // Tenants typically have a few hundred customers; one fetch beats paginating
    // here since the list is read on every page for dropdowns + name lookups.
    const result = await client.customers.list({
      page_size: 500,
      sort_by: 'name',
      sort_order: 'asc',
    })
    return result.customers.map((c) => ({
      id: c.id,
      name: c.name,
      isExistingCustomer: c.is_existing_customer,
    }))
  },
  ['cached-customer-list-v2'],
  { revalidate: 60, tags: ['customers'] },
)

/**
 * Get customer list for dropdowns. Cached for 60s per tenant; mutation actions in
 * `src/actions/customers.ts` call revalidateTag('customers') to invalidate.
 */
export async function getCachedCustomerList(): Promise<CachedCustomerOption[]> {
  const businessId = await getBusinessId()
  return customerListByBusiness(businessId)
}
