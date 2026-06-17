import type { SynqedClient } from '@synqed-kk/client'
import { paginateDedupe } from './paginate'

type ListAllOpts = {
  search?: string
  sort_by?: 'name' | 'created_at' | 'updated_at'
  sort_order?: 'asc' | 'desc'
}

/**
 * Page synqed-core's customer list to COMPLETION.
 *
 * synqed-core clamps `page_size` at 500, so a single `customers.list({ page_size:
 * 500 })` silently drops every customer past #500 — a 634-customer tenant loses
 * ~134 rows off the 顧客 list and the カルテ tab. Raising the number does nothing
 * (the clamp is server-side); the ONLY correct fix is to loop every page.
 *
 * This wraps the shared `paginateDedupe` primitive (the exact pattern
 * getCachedCustomerList already ships) so every customer-list surface pages the
 * same way — one place to get it right. paginateDedupe returns rows in by-id
 * insertion order, NOT the server sort, so we RE-SORT in memory afterwards;
 * skipping that would silently reorder the list. Returns the same
 * `{ customers, total }` shape the call sites already consume.
 */
export async function listAllCustomers(
  synqed: SynqedClient,
  { search, sort_by = 'created_at', sort_order = 'asc' }: ListAllOpts = {},
) {
  const customers = await paginateDedupe((page) =>
    synqed.customers
      .list({ search, page, page_size: 500, sort_by, sort_order })
      .then((r) => ({ items: r.customers, total: r.total })),
  )
  const dir = sort_order === 'desc' ? -1 : 1
  const key = (c: (typeof customers)[number]) =>
    sort_by === 'updated_at' ? c.updated_at : sort_by === 'name' ? c.name : c.created_at
  customers.sort((a, b) => {
    const av = key(a) ?? ''
    const bv = key(b) ?? ''
    return av < bv ? -dir : av > bv ? dir : 0
  })
  // total === customers.length once paged to completion (paginateDedupe stops at
  // the server's reported total); the call sites read `.total` for the header.
  return { customers, total: customers.length }
}
