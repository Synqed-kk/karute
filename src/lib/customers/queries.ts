import { createClient } from '@/lib/supabase/server'
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
}

export interface ListCustomersResult {
  customers: Customer[]
  totalCount: number
  totalPages: number
}

// ---------------------------------------------------------------------------
// listCustomers
// ---------------------------------------------------------------------------

/**
 * Returns a paginated list of customers with optional search filtering.
 *
 * Search uses ilike across name, furigana, phone, and email columns.
 * Default sort: updated_at desc (proxy for last visit until karute_records exist).
 * Default page size: 10 (per user decision).
 */
export async function listCustomers({
  query,
  page = 1,
  pageSize = 10,
  sortBy = 'updated_at',
  sortOrder = 'desc',
}: ListCustomersOptions = {}): Promise<ListCustomersResult> {
  const supabase = await createClient()

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let dbQuery = supabase
    .from('customers')
    .select('*', { count: 'exact' })

  if (query && query.trim().length > 0) {
    const q = query.trim()
    dbQuery = dbQuery.or(
      `name.ilike.%${q}%,furigana.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`
    )
  }

  const { data, count, error } = await dbQuery
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(from, to)

  if (error) {
    throw new Error(`[listCustomers] ${error.message}`)
  }

  const totalCount = count ?? 0
  const totalPages = Math.ceil(totalCount / pageSize)

  return {
    customers: (data as Customer[]) ?? [],
    totalCount,
    totalPages,
  }
}

// ---------------------------------------------------------------------------
// getCustomer
// ---------------------------------------------------------------------------

/**
 * Returns a single customer by id.
 * Throws if not found.
 */
export async function getCustomer(id: string): Promise<Customer> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    throw new Error(`[getCustomer] ${error.message}`)
  }

  return data as Customer
}

// ---------------------------------------------------------------------------
// checkDuplicateName
// ---------------------------------------------------------------------------

/**
 * Checks whether a customer with the given name already exists (case-insensitive).
 *
 * Per user decision: duplicate detection warns but does not block creation.
 * Returns { exists: true, existingName } when a match is found.
 */
export async function checkDuplicateName(
  name: string
): Promise<{ exists: boolean; existingName?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .ilike('name', name)
    .limit(1)

  if (error) {
    // Non-fatal — return no match on error so creation is not blocked
    console.error('[checkDuplicateName] Supabase error:', error.message)
    return { exists: false }
  }

  if (data && data.length > 0) {
    return { exists: true, existingName: data[0].name as string }
  }

  return { exists: false }
}
