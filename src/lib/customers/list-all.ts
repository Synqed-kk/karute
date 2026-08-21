import { unstable_cache } from 'next/cache'
import type { SynqedClient } from '@synqed-kk/client'
import { paginateDedupe } from './paginate'

type ListAllOpts = {
  search?: string
  sort_by?: 'name' | 'created_at' | 'updated_at'
  sort_order?: 'asc' | 'desc'
  /**
   * Active store — a VIEW filter on the LIST only. Derived server-side from
   * events (a customer "belongs to" a store iff they have a visit/appointment
   * there; customers have no store_id — identity is business-wide). null /
   * undefined = all stores. Automatically DROPPED when `search` is present so
   * name/phone search stays business-wide (a 代官山 walk-in must be findable at
   * 銀座). Additive to the business scope; never replaces it.
   */
  store_id?: string | null
  /**
   * RBAC clamp: when true, the store filter is KEPT even while searching, so a
   * regular staff member restricted to their branch can't pull another store's
   * customers via search. Cross-store viewers (owner/manager/SV) leave this
   * false → the documented business-wide search. See lib/auth/store-scope.
   */
  enforceStore?: boolean
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
  { search, sort_by = 'created_at', sort_order = 'asc', store_id, enforceStore }: ListAllOpts = {},
) {
  // ponytail: dead code in production, and it must stay that way — the guard
  // backstops an invariant the two resolvers hold today ("clamped ⇒ storeId
  // non-null": resolveStoreScope returns `activeStore ?? allowed[0]`,
  // resolveStoreForRequest returns `requestedStoreId ?? assigned[0]`; both
  // pinned by tests). If that ever breaks, enforceStore alone would silently
  // collapse to a business-wide read — the RBAC clamp failing OPEN, which is
  // the one direction it must never fail. An empty list is wrong-but-safe;
  // another branch's customers are not. Upgrade path if a legitimate
  // "enforce with no store" case ever appears: it doesn't — that combination
  // means the caller asked for a clamp it could not name.
  if (enforceStore && !store_id) return { customers: [], total: 0 }

  // Search is business-wide by default: drop the store lens whenever a term is
  // present so a customer from any store is findable. With no search, the active
  // store scopes the LIST (derived from events, server-side). enforceStore (RBAC
  // clamp) overrides this — a branch-restricted staff keeps the store filter
  // even while searching, so search can't leak another store's customers.
  const storeFilter = search && !enforceStore ? undefined : store_id ?? undefined
  const customers = await paginateDedupe((page) =>
    synqed.customers
      .list({ search, store_id: storeFilter, page, page_size: 500, sort_by, sort_order })
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

/**
 * 60s-cached twin of listAllCustomers for the WEB pages' no-search path — the
 * 顧客 + カルテ pages re-run the full sequential page-sweep on EVERY click
 * (2.6s on prod, 2026-07-30 speed pass) even though a search-less list is
 * identical for every viewer sharing the same business/store/sort lens. Same
 * 60s + 'customers'-tag precedent as customerListByBusiness (cached.ts). The
 * web customer CRUD actions bump updateTag('customers') → instant; everything
 * else rides the 60s TTL: facade (app) mutations (updateTag is banned there —
 * Server-Action-only, see facade-core-updatetag-ban), packs/appointments/
 * karute writes that reorder or re-badge the list (they bump 'dashboard'
 * only), and core-side writers (QR sync cron). Same staleness envelope the
 * shipped 60s caches already have. WEB-ONLY by design: the
 * mobile-facade routes keep calling the live listAllCustomers — caching the
 * installed app's packets is an app-behavior change this lever must not make.
 *
 * unstable_cache keys on the callback's EXPLICIT args, so every
 * result-affecting input — businessId (tenant isolation!), store_id,
 * enforceStore, sort_by, sort_order — is a positional arg; two tenants/lenses
 * can never collide on one entry. No `search` parameter on purpose: search is
 * viewer-interactive, always live.
 *
 * unstable_cache callbacks run OUTSIDE request scope, so the request-bound
 * synqed client can't be closed over — the callback builds its own from env +
 * the explicit businessId, same idiom as staffStoreAssignmentsByBusiness
 * (lib/auth/store-scope.ts).
 */
const cachedCustomerList = unstable_cache(
  async (
    businessId: string,
    storeId: string | null,
    enforceStore: boolean,
    sortBy: NonNullable<ListAllOpts['sort_by']>,
    sortOrder: NonNullable<ListAllOpts['sort_order']>,
  ) => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) throw new Error('synqed-core env not configured')
    // Lazy import for the same reason as store-scope.ts — keep the ESM client
    // out of graphs (and tests) that never reach this path.
    const { SynqedClient } = await import('@synqed-kk/client')
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    return listAllCustomers(client, {
      store_id: storeId ?? undefined,
      enforceStore,
      sort_by: sortBy,
      sort_order: sortOrder,
    })
  },
  ['list-all-customers-v1'],
  { revalidate: 60, tags: ['customers'] },
)

/**
 * businessId is REQUIRED (not optional): it is the tenant-isolation half of
 * the cache key, so every caller must resolve it explicitly rather than risk
 * an undefined value silently sharing one cache entry across tenants.
 */
export async function listAllCustomersCached(
  businessId: string,
  {
    sort_by = 'created_at',
    sort_order = 'asc',
    store_id,
    enforceStore,
  }: Omit<ListAllOpts, 'search'> = {},
) {
  return cachedCustomerList(businessId, store_id ?? null, enforceStore ?? false, sort_by, sort_order)
}
