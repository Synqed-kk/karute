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
  /** Creation timestamp — the sort key assignSequentialKaruteNumbers uses to
   *  assign #00139 etc. MUST be carried so the agenda's karute numbers match
   *  the 顧客 page + karute detail (which sort the same raw list by created_at).
   *  Dropping it silently re-sorted the agenda by id → mismatched numbers. */
  created_at: string | null
  /** QR lifetime visit count + 回数券 flag. Part of the single returning-customer
   *  signal (see resolveCustomerStatus) so EVERY surface that reads the cached
   *  list — the 予約 agenda, dropdowns — classifies QR regulars the same as the
   *  顧客 list/profile do, instead of mislabeling 回数券 holders as 新規. */
  visitCount: number
  hasTicketPack: boolean
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
    return result.customers.map((c) => {
      // SDK-skew: the local @synqed-kk/client Customer type lags the API, which
      // returns these QR fields. Cast to read them — Vercel's fresh SDK types them.
      const qr = c as typeof c & {
        is_existing_customer?: boolean
        visit_count?: number
        has_ticket_pack?: boolean
      }
      return {
        id: c.id,
        name: c.name,
        isExistingCustomer: qr.is_existing_customer ?? false,
        created_at: c.created_at,
        visitCount: qr.visit_count ?? 0,
        hasTicketPack: qr.has_ticket_pack ?? false,
      }
    })
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
