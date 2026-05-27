import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId } from '@/lib/staff'

export interface CustomerContact {
  phone: string | null
  email: string | null
}

// customerId is the cache key (UUIDs are global). Mutation actions in
// src/actions/customers.ts call updateTag('customers'), which invalidates
// every customer-detail entry regardless of tenant.
const customerContactById = unstable_cache(
  async (customerId: string): Promise<CustomerContact> => {
    const service = createServiceClient()
    const { data } = await service
      .from('customers')
      .select('phone, email')
      .eq('id', customerId)
      .maybeSingle()
    return {
      phone: data?.phone ?? null,
      email: data?.email ?? null,
    }
  },
  ['customer-contact-v1'],
  { revalidate: 300, tags: ['customers'] },
)

export async function getCustomerContact(
  customerId: string,
): Promise<CustomerContact> {
  return customerContactById(customerId)
}

interface ConsentRecord {
  granted_at?: string | null
  [key: string]: unknown
}

// Consent rarely changes after granted; cache per (business, customer).
const consentByCustomer = unstable_cache(
  async (
    businessId: string,
    customerId: string,
  ): Promise<{ consent: ConsentRecord | null }> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return { consent: null }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    try {
      const result = await client.customers.getConsent(customerId)
      return { consent: (result?.consent ?? null) as ConsentRecord | null }
    } catch {
      return { consent: null }
    }
  },
  ['customer-consent-v1'],
  { revalidate: 300, tags: ['customer-consent'] },
)

export async function getCachedCustomerConsent(
  customerId: string,
): Promise<{ consent: ConsentRecord | null }> {
  const businessId = await getBusinessId()
  return consentByCustomer(businessId, customerId)
}
