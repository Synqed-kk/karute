import { getSynqedClient } from '@/lib/synqed/client'
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

export async function listCustomers({
  query,
  page = 1,
  pageSize = 10,
  sortBy = 'updated_at',
  sortOrder = 'desc',
}: ListCustomersOptions = {}): Promise<ListCustomersResult> {
  const synqed = await getSynqedClient()

  const result = await synqed.customers.list({
    search: query?.trim() || undefined,
    page,
    page_size: pageSize,
    sort_by: sortBy as 'name' | 'created_at' | 'updated_at',
    sort_order: sortOrder,
  })

  // Map synqed-core response to karute's Customer type
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

// ---------------------------------------------------------------------------
// getCustomer
// ---------------------------------------------------------------------------

export async function getCustomer(id: string): Promise<Customer> {
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
