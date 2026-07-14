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
import { listAllCustomers } from '@/lib/customers/list-all'
import { resolveStoreScope, storeStaffIdSet } from '@/lib/auth/store-scope'
import { getBusinessId } from '@/lib/staff'
import { startTiming } from '@/lib/perf/timing'
import { listAllLifecycles, listAllPackUsage } from '@/lib/packs/store'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>
}) {
  const { query: rawQuery } = await searchParams
  const query = rawQuery ?? ''

  const t = startTiming(`customers q="${query}"`)
  // Both are independent — getSynqedClient hits the auth layer while
  // resolveStoreScope reads capabilities + the active-store cookie; resolve in
  // parallel. The scope is the view lens for the 顧客 list: a cross-store viewer
  // gets their pinned store (null = all), a branch-restricted staff is clamped
  // to their own store (and search stays scoped via enforceStore).
  const [synqed, scope] = await Promise.all([
    getSynqedClient(),
    resolveStoreScope(),
  ])
  const enforceStore = scope.allowedStoreIds != null

  // Locale + translated relative-time strings, pulled once at page level
  // and threaded into the (synchronous) formatters so JP users see
  // "前回 2026年5月24日 (本日)" instead of "Today" / "May 24, 2026".
  const [list, staffList, activeStaffId, businessId, locale, lvT] = await Promise.all([
    // Page to completion — a tenant past 500 customers would otherwise drop
    // every row past #500 off the list (the server clamps page_size at 500).
    t.phase('customers.list', () =>
      listAllCustomers(synqed, {
        search: query.trim() || undefined,
        store_id: scope.storeId,
        enforceStore,
        sort_by: 'updated_at',
        sort_order: 'desc',
      }),
    ),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('businessId', () => getBusinessId()),
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
  const [enrichment, packUsageRaw, lifecycles, orgSettings] = await Promise.all([
    t.phase('enrichCustomers', () => enrichCustomers(businessId, customerIds)),
    listAllPackUsage(),
    listAllLifecycles(),
    getOrgSettings(),
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

  return (
    <CustomersListView
      rows={screen.rows}
      totalRegistered={screen.totalRegistered}
      query={query}
      selfStaffId={activeStaffId}
      bookingDataAvailable={screen.bookingDataAvailable}
      staffList={pickerStaff}
    />
  )
}
