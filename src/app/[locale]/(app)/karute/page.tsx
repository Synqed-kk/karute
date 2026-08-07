import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { startTiming } from '@/lib/perf/timing'
import { getBusinessId, getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { listSynqedKaruteRows } from '@/lib/karute/synqed-records'
import { listAllCustomersCached } from '@/lib/customers/list-all'
import { resolveStoreScope, storeStaffIdSet } from '@/lib/auth/store-scope'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'

/**
 * カルテ tab — RECORD-CENTRIC list of karute sessions.
 *
 * Phase A (this commit): one row per karute record, date-grouped,
 * AI status badges, karute-specific filters. Matches the design
 * spike's KaruteList structure end-to-end.
 *
 * Phase B (next): append placeholder rows for customers with NO
 * karute records yet so brand-new customers still appear (Liam's
 * earlier ask). Today they're invisible on this tab; the customer-
 * centric chip-row view we shipped previously is still reachable
 * via the 顧客 tab → tap a customer → karute detail page.
 *
 * ANTHONY: karute_records currently lacks `service` (text) and
 * `duration_minutes` (int) columns. The row renderer expects both;
 * for now we fall back to "施術" + 0 minutes. Adding those columns
 * (+ a brief service-type config UI) makes the row read with real
 * salon-treatment context.
 */
export default async function KaruteRecordsListPage() {
  // Store scope = the view lens for the カルテ list. A cross-store viewer gets
  // their pinned store (null = all); a branch-restricted staff is clamped to
  // their own store (RBAC). `clamped` = the viewer may see ONLY their store, so
  // the customer name-map + picker are scoped too (no cross-store name leak);
  // cross-store viewers keep them business-wide for walk-in karute creation.
  // Per-phase server timing. カルテ was the one heavy screen with NO timer at
  // all, so the 2026-07-30 speed pass could only measure it from the outside
  // (1.68s hard load) and had to infer the culprit from source. One [perf] line
  // per request in the Vercel logs makes the next round aim at a measurement.
  // businessId rides along (React cache — free) as the listAllCustomersCached
  // calls' tenant-isolation cache key below.
  const t = startTiming('karute')
  const [synqed, scope, businessId] = await Promise.all([
    t.phase('synqedClient', () => getSynqedClient()),
    t.phase('storeScope', () => resolveStoreScope()),
    t.phase('businessId', () => getBusinessId()),
  ])
  const activeStore = scope.storeId
  const clamped = scope.allowedStoreIds != null

  const [
    staffList,
    allCustomersList,
    storeCustomerList,
    currentStaffId,
    synqedKaruteRows,
    apptList,
    synqedStaff,
  ] = await Promise.all([
      t.phase('staffList', () => getStaffList()),
      // Page to completion so カルテ rows + placeholder rows resolve for every
      // customer, not just the first 500 (server clamps page_size at 500). This
      // backs record-name enrichment AND the New カルテ dialog's customer picker.
      // Cross-store viewers load it BUSINESS-WIDE (so names resolve + a karute
      // can be created for another store's walk-in); a branch-restricted staff
      // loads it SCOPED to their store (no cross-store names/customers leak).
      t.phase('customers.all', () =>
        clamped
        ? listAllCustomersCached(businessId, {
            store_id: activeStore,
            enforceStore: true,
            sort_by: 'created_at',
            sort_order: 'asc',
          })
        : listAllCustomersCached(businessId, { sort_by: 'created_at', sort_order: 'asc' })),
      // Store-scoped customer roster — ONLY to scope the "新規のお客様"
      // placeholder section to the active branch for a CROSS-STORE viewer who
      // has pinned a store (a customer "belongs to" a store via events; see
      // listAllCustomers). null when unpinned, or when clamped (the list above
      // is already store-scoped, so its customers ARE the placeholder roster).
      t.phase('customers.store', () =>
        !clamped && activeStore
        ? listAllCustomersCached(businessId, {
            store_id: activeStore,
            sort_by: 'created_at',
            sort_order: 'asc',
          })
        : Promise.resolve(null)),
      t.phase('activeStaffId', () => getCurrentUserStaffId()),
      // synqed-core is the sole karute store (the Supabase karute_records table
      // is empty and being dropped). Scoped to the active branch so 代官山
      // karute don't surface under 銀座; the customer PROFILE stays unscoped.
      t.phase('karuteRows', () => listSynqedKaruteRows(synqed, { storeId: activeStore })),
      // Recent appointments (UNWINDOWED, like enrichCustomers) + the synqed
      // staff roster — resolve each placeholder customer's 担当 from their
      // booking, translating the synqed staff id into the profile id the
      // color/name maps key on (same boundary translation getAppointmentsByDate
      // does). No from/to filter on purpose: a window keyed on today drops a
      // customer's already-past booking and the stripe goes blank again.
      t.phase('appointments', () => synqed.appointments.list({ page_size: 200 })),
      t.phase('synqedStaff', () => synqed.staff.list({ page_size: 200 })),
    ])

  // #496 store clamp: the 担当 picker only offers staff assigned to the active
  // store (or floating staff) — the full roster was leaking every branch's
  // staff names into every store's dropdown. Name resolution on rows stays
  // business-wide inside the builder.
  const storeStaffIds = await t.phase('storeStaffIds', () =>
    storeStaffIdSet(staffList, activeStore),
  )
  t.end()

  const screen = buildSessionsListScreen({
    staffList,
    storeStaffIds,
    allCustomersList,
    storeCustomerList,
    currentStaffId,
    synqedKaruteRows,
    apptList,
    synqedStaff,
  })

  return (
    <>
      {/* SWR delivery: this screen may have been served from the
          router cache — stamp when the SERVER built it so a stale
          copy refreshes itself behind the paint. */}
      <QuietRefresh renderedAt={renderStamp()} />
      <KaruteRecordListView
        items={screen.items}
        monthCount={screen.monthCount}
        placeholders={screen.placeholders}
        staffList={screen.staffList}
        currentStaffId={screen.currentStaffId}
        customerOptions={screen.customerOptions}
      />
    </>
  )
}
