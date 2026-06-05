import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'

// Per-tenant map of customerId -> sequential karute number ("#00001"), computed
// with the SAME source + ordering the karute LIST page uses (customers.list
// sorted by created_at, then assignSequentialKaruteNumbers). The detail page was
// deriving a hex slice of the karute id ("#49C6E") which (a) used letters and
// (b) didn't match the list. This makes both pages agree.
//
// Cached 60s per tenant and invalidated by the shared 'customers' tag (the same
// tag customer mutations already revalidate), so the detail page does NOT pay a
// full customer-list fetch on every view.
//
// ANTHONY: the real fix is a `customers.karute_number` text column backed by a
// per-tenant Postgres sequence (see assignSequentialKaruteNumbers' note); once
// that lands, both pages read the field directly and this helper is deleted.
const karuteNumberMapByBusiness = unstable_cache(
  async (businessId: string): Promise<Record<string, string>> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return {}
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    const result = await client.customers.list({
      page_size: 500,
      sort_by: 'created_at',
      sort_order: 'asc',
    })
    return Object.fromEntries(assignSequentialKaruteNumbers(result.customers))
  },
  ['karute-number-map-v1'],
  { revalidate: 60, tags: ['customers'] },
)

/**
 * The sequential per-customer karute number ("#00001"), matching the karute list
 * page. Returns null when the customer isn't found (caller falls back).
 */
export async function getKaruteNumber(
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null
  try {
    const businessId = await getBusinessId()
    const map = await karuteNumberMapByBusiness(businessId)
    return map[customerId] ?? null
  } catch {
    return null
  }
}
