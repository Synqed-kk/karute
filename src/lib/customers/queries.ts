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
  staffId,
  customerType,
}: ListCustomersOptions = {}): Promise<ListCustomersResult> {
  const supabase = await createClient()

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dbQuery = (supabase as any)
    .from('customers')
    .select('*', { count: 'exact' })

  if (query && query.trim().length > 0) {
    const q = query.trim()
    dbQuery = dbQuery.or(
      `name.ilike.%${q}%,furigana.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`
    )
  }

  if (staffId && staffId !== 'all') {
    dbQuery = dbQuery.eq('assigned_staff_id', staffId)
  }

  if (customerType && customerType !== 'all') {
    dbQuery = dbQuery.eq('customer_type', customerType)
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
    console.error('[checkDuplicateName] Supabase error:', error.message)
    return { exists: false }
  }

  if (data && data.length > 0) {
    return { exists: true, existingName: data[0].name as string }
  }

  return { exists: false }
}
