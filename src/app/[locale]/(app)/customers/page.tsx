import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { getLocale, getTranslations } from 'next-intl/server'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { getSynqedClient } from '@/lib/synqed/client'
import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import {
  enrichCustomers,
  type LastVisitStrings,
} from '@/lib/customers/list-enrich'
import { buildCustomersListScreen } from '@/lib/customers/screen-rows'
import { listAllCustomers, listAllCustomersCached } from '@/lib/customers/list-all'
import { resolveStoreScope, storeStaffIdSet } from '@/lib/auth/store-scope'
import { getBusinessId } from '@/lib/staff'
import { startTiming } from '@/lib/perf/timing'
import { listAllLifecycles, listAllPackUsage, listBurnRedemptions } from '@/lib/packs/store'
import { monthlyBurnByCustomer } from '@/lib/packs/burn'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>
}) {
  const { query: rawQuery } = await searchParams
  const query = rawQuery ?? ''

  const t = startTiming(`customers q="${query}"`)
  // All three are independent — getSynqedClient hits the auth layer,
  // resolveStoreScope reads capabilities + the active-store cookie, and
  // getBusinessId is request-memoized (React cache — free here since
  // getSynqedClient already resolved it internally). The scope is the view
  // lens for the 顧客 list: a cross-store viewer gets their pinned store
  // (null = all), a branch-restricted staff is clamped to their own store
  // (and search stays scoped via enforceStore). businessId is pulled up here
  // (rather than in the wave below) so it's ready for the no-search
  // listAllCustomersCached path, which needs it as the tenant-isolation cache key.
  const [synqed, scope, businessId] = await Promise.all([
    getSynqedClient(),
    resolveStoreScope(),
    getBusinessId(),
  ])
  const enforceStore = scope.allowedStoreIds != null

  // Locale + translated relative-time strings, pulled once at page level
  // and threaded into the (synchronous) formatters so JP users see
  // "前回 2026年5月24日 (本日)" instead of "Today" / "May 24, 2026".
  const search = query.trim() || undefined
  const [list, staffList, activeStaffId, locale, lvT] = await Promise.all([
    // Page to completion — a tenant past 500 customers would otherwise drop
    // every row past #500 off the list (the server clamps page_size at 500).
    // Search is viewer-interactive → always the live path; the default
    // no-search list serves from the 60s 'customers'-tagged cache.
    t.phase('customers.list', () =>
      search
        ? listAllCustomers(synqed, {
            search,
            store_id: scope.storeId,
            enforceStore,
            sort_by: 'updated_at',
            sort_order: 'desc',
          })
        : listAllCustomersCached(businessId, {
            store_id: scope.storeId,
            enforceStore,
            sort_by: 'updated_at',
            sort_order: 'desc',
          }),
    ),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    getLocale(),
    getTranslations('customers.list.lastVisit'),
  ])

  const lastVisitStrings: LastVisitStrings = {
    noVisits: lvT('noVisits'),
    yearsAgo: (n) => lvT('yearsAgo', { n }),
    today: lvT('today'),
    oneDayAgo: lvT('oneDayAgo'),
    daysAgo: (n) => lvT('daysAgo', { n }),
    monthsAgo: (n) => lvT('monthsAgo', { n }),
  }

  const customerIds = list.customers.map((c) => c.id)
  // Pack usage + lifecycle load in parallel with the enrichment — both come
  // back as empty maps until the ticket_packs migration applies (graceful).
  const [enrichment, packUsageRaw, lifecycles, orgSettings, burnRows] = await Promise.all([
    t.phase('enrichCustomers', () => enrichCustomers(businessId, customerIds)),
    listAllPackUsage(),
    listAllLifecycles(),
    getOrgSettings(),
    listBurnRedemptions(),
  ])
  t.end()

  // Row adaptation is shared with the facade screen endpoint — moved verbatim
  // to buildCustomersListScreen (packet 04) so web + mobile derive identical
  // rows from one source of truth.
  const screen = buildCustomersListScreen({
    list,
    staffList,
    locale,
    lastVisitStrings,
    enrichment,
    packUsage: packUsageRaw,
    lifecycles,
    ticketPacksEnabled: orgSettings?.ticket_packs_enabled ?? true,
  })

  // Clamp the 担当 filter pills to the active store's staff (floating staff
  // included). Filtered AFTER buildCustomersListScreen so row 担当 names keep
  // resolving business-wide — only the picker narrows.
  const storeStaffIds = await storeStaffIdSet(staffList, scope.storeId)
  const pickerStaff = storeStaffIds
    ? screen.staffList.filter((s) => storeStaffIds.has(s.id))
    : screen.staffList

  // 今月消化 per-customer yen — plain Record (RSC boundary: no Maps). null =
  // core unreachable → hidden everywhere. Unpriceable customers (orphaned
  // packs) hide the stat only in views that contain them — the view stays
  // exact, and one store's data problem can't blank the whole business.
  const burn = burnRows ? monthlyBurnByCustomer(burnRows) : null
  if (burn && burn.unpricedCustomers.length > 0) {
    console.warn(
      `[packs] burn: ${burn.unpricedCustomers.length} customer(s) have unpriceable redemptions (orphaned packs) — 今月消化 hidden where they appear`,
    )
  }
  const burnByCustomer = burn?.byCustomer ?? null
  const burnUnpricedIds = burn?.unpricedCustomers ?? []

  return (
    <>
      {/* SWR delivery: this screen may have been served from the
          router cache — stamp when the SERVER built it so a stale
          copy refreshes itself behind the paint. */}
      <QuietRefresh renderedAt={renderStamp()} />
      <CustomersListView
        rows={screen.rows}
        totalRegistered={screen.totalRegistered}
        query={query}
        selfStaffId={activeStaffId}
        bookingDataAvailable={screen.bookingDataAvailable}
        staffList={pickerStaff}
        assignableStaff={screen.staffList.map((s) => ({ id: s.id, name: s.name }))}
        burnByCustomer={burnByCustomer}
        burnUnpricedIds={burnUnpricedIds}
      />
    </>
  )
}
