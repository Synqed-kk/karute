import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'

export interface CustomerContact {
  phone: string | null
  email: string | null
}

// Keyed on (business, customer); synqed-core is the source of truth for
// contact details. Mutation actions in src/actions/customers.ts call
// updateTag('customers'), which invalidates every customer-detail entry.
const customerContactById = unstable_cache(
  async (businessId: string, customerId: string): Promise<CustomerContact> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return { phone: null, email: null }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    try {
      const customer = await client.customers.get(customerId)
      return {
        phone: customer.phone ?? null,
        email: customer.email ?? null,
      }
    } catch {
      return { phone: null, email: null }
    }
  },
  ['customer-contact-v2'],
  { revalidate: 300, tags: ['customers'] },
)

export async function getCustomerContact(
  customerId: string,
): Promise<CustomerContact> {
  const businessId = await getBusinessId()
  return customerContactById(businessId, customerId)
}

/** Bearer/facade entry point — same cached read, EXPLICIT businessId (from the
 *  verified token, not a cookie). Graceful-empty like the cookie wrapper
 *  (contact is not on packet-06's must-throw list). */
export async function getCustomerContactForBusiness(
  businessId: string,
  customerId: string,
): Promise<CustomerContact> {
  return customerContactById(businessId, customerId)
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
