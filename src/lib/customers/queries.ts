import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId } from '@/lib/staff'
import type { Customer } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListCustomersOptions {
  query?: string
  page?: number
  pageSize?: number
  sortBy?: keyof Pick<Customer, 'name' | 'updated_at' | 'created_at'>
  sortOrder?: 'asc' | 'desc'
  staffId?: string
  customerType?: string
}

export interface ListCustomersResult {
  customers: Customer[]
  totalCount: number
  totalPages: number
}

// ---------------------------------------------------------------------------
// listCustomers
// ---------------------------------------------------------------------------

interface FetchArgs {
  search?: string
  page: number
  pageSize: number
  sortBy: 'name' | 'created_at' | 'updated_at'
  sortOrder: 'asc' | 'desc'
}

async function fetchCustomers(
  businessId: string,
  args: FetchArgs,
): Promise<ListCustomersResult> {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
  }
  const client = new SynqedClient({ baseUrl, apiKey, businessId })
  const result = await client.customers.list({
    search: args.search,
    page: args.page,
    page_size: args.pageSize,
    sort_by: args.sortBy,
    sort_order: args.sortOrder,
  })
  const customers: Customer[] = result.customers.map((c) => ({
    id: c.id,
    name: c.name,
    furigana: c.furigana,
    phone: c.phone,
    email: c.email,
    contact_info: c.contact_info,
    notes: c.notes,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }))
  return {
    customers,
    totalCount: result.total,
    totalPages: result.total_pages,
  }
}

// Cache only the default landing-page params — that's the hot path everyone
// hits when they click "Customers" in the nav. Search/sort/page combinations
// have too much cardinality to cache effectively.
const cachedLandingPage = unstable_cache(
  async (
    businessId: string,
    pageSize: number,
  ): Promise<ListCustomersResult> =>
    fetchCustomers(businessId, {
      page: 1,
      pageSize,
      sortBy: 'updated_at',
      sortOrder: 'desc',
    }),
  ['customers-landing-v1'],
  { revalidate: 60, tags: ['customers'] },
)

export async function listCustomers({
  query,
  page = 1,
  pageSize = 10,
  sortBy = 'updated_at',
  sortOrder = 'desc',
}: ListCustomersOptions = {}): Promise<ListCustomersResult> {
  const isLanding =
    !query?.trim() &&
    page === 1 &&
    sortBy === 'updated_at' &&
    sortOrder === 'desc'

  if (isLanding) {
    const businessId = await getBusinessId()
    return cachedLandingPage(businessId, pageSize)
  }

  // Non-default views (search, deep pagination, alternate sort) skip the cache
  // and go straight to synqed-core. These have too many parameter combinations
  // to cache without blowing up the cache size.
  const businessId = await getBusinessId()
  return fetchCustomers(businessId, {
    search: query?.trim() || undefined,
    page,
    pageSize,
    sortBy: sortBy as 'name' | 'created_at' | 'updated_at',
    sortOrder,
  })
}

// ---------------------------------------------------------------------------
// getCustomer
// ---------------------------------------------------------------------------

export interface CustomerWithStaff extends Customer {
  assigned_staff_id: string | null
  is_existing_customer: boolean
  visit_count: number
  /** Deep-crawl demographics (QuickReserve → synqed-core). DOB is 'YYYY-MM-DD';
   *  age is derived at render (demographics.ts), never stored. gender is
   *  'male' | 'female' | null. */
  date_of_birth: string | null
  gender: string | null
  /** Deep-crawl profile signals (operational/PII — not financial; safe for the
   *  identity strip). occupation/member_number nullable; has_ticket_pack bool;
   *  last_visit_at ISO datetime (QR cache). */
  occupation: string | null
  member_number: string | null
  has_ticket_pack: boolean
  last_visit_at: string | null
}

export async function getCustomer(id: string): Promise<CustomerWithStaff> {
  const synqed = await getSynqedClient()
  const c = await synqed.customers.get(id)

  return {
    id: c.id,
    name: c.name,
    furigana: c.furigana,
    phone: c.phone,
    email: c.email,
    contact_info: c.contact_info,
    notes: c.notes,
    created_at: c.created_at,
    updated_at: c.updated_at,
    assigned_staff_id: c.assigned_staff_id ?? null,
    is_existing_customer: c.is_existing_customer,
    visit_count: c.visit_count,
    date_of_birth: c.date_of_birth ?? null,
    gender: c.gender ?? null,
    occupation: c.occupation ?? null,
    member_number: c.member_number ?? null,
    has_ticket_pack: c.has_ticket_pack ?? false,
    last_visit_at: c.last_visit_at ?? null,
  }
}

// ---------------------------------------------------------------------------
// checkDuplicateName
// ---------------------------------------------------------------------------

export async function checkDuplicateName(
  name: string
): Promise<{ exists: boolean; existingName?: string }> {
  try {
    const synqed = await getSynqedClient()
    const result = await synqed.customers.checkDuplicate(name)
    return { exists: result.exists, existingName: result.existing_name }
  } catch {
    return { exists: false }
  }
}
