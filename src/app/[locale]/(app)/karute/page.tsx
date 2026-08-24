import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { startTiming } from '@/lib/perf/timing'
import { getBusinessId, getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { listSynqedKaruteRowsWithMonthProbe } from '@/lib/karute/synqed-records'
import { jstStartOfMonth } from '@/lib/date/jst'
import { listAllCustomersCached } from '@/lib/customers/list-all'
import { resolveStoreScope, storeStaffIdSet } from '@/lib/auth/store-scope'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'

/**
 * カルテ tab — RECORD-CENTRIC list of karute sessions.
 *
 * One row per karute record, date-grouped, AI status badges,
 * karute-specific filters. Matches the design spike's KaruteList
 * structure end-to-end. (PR-1a 未作成ブロック廃止: the placeholder
 * section for customers with no karute yet — briefly shipped — was
 * removed; a brand-new customer with no session doesn't get a row
 * here. The customer-centric chip-row view is still reachable via
 * the 顧客 tab → tap a customer → karute detail page.)
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

  // JST month bounds for the 今月 status-line probe (PR-1b 正直ヘッダー) —
  // computed once and reused for both reads in the wave below so they agree
  // on "now" to the millisecond.
  const now = new Date()
  const monthStartIso = jstStartOfMonth(now).toISOString()
  const nowIso = now.toISOString()

  const [
    staffList,
    allCustomersList,
    currentStaffId,
    karuteData,
    synqedStaff,
  ] = await Promise.all([
      t.phase('staffList', () => getStaffList()),
      // Page to completion so every customer resolves, not just the first 500
      // (server clamps page_size at 500). This backs record-name enrichment
      // AND the New カルテ dialog's customer picker. Cross-store viewers load
      // it BUSINESS-WIDE (so names resolve + a karute can be created for
      // another store's walk-in); a branch-restricted staff loads it SCOPED
      // to their store (no cross-store names/customers leak).
      t.phase('customers.all', () =>
        clamped
        ? listAllCustomersCached(businessId, {
            store_id: activeStore,
            enforceStore: true,
            sort_by: 'created_at',
            sort_order: 'asc',
          })
        : listAllCustomersCached(businessId, { sort_by: 'created_at', sort_order: 'asc' })),
      t.phase('activeStaffId', () => getCurrentUserStaffId()),
      // synqed-core is the sole karute store (the Supabase karute_records table
      // is empty and being dropped). Scoped to the active branch so 代官山
      // karute don't surface under 銀座; the customer PROFILE stays unscoped.
      // ONE combined phase (Greptile PR #775 fix): the main row read (store-
      // wide total, plumbed through for PR-2a's 全件 display) and the 今月
      // probe (JST month window, page_size:1) used to run as two INDEPENDENT
      // degrade-wrapped calls — one transiently failing while the other
      // succeeded could make the header contradict the visible list.
      // listSynqedKaruteRowsWithMonthProbe shares ONE try/catch so both
      // always come from the same success or the same failure. LENS PARITY
      // with screens/sessions/route.ts's identical from/to computation.
      t.phase('karuteData', () =>
        listSynqedKaruteRowsWithMonthProbe(synqed, {
          storeId: activeStore,
          monthFrom: monthStartIso,
          monthTo: nowIso,
        }),
      ),
      // Synqed staff roster — translates a record's synqed staff id into the
      // profile id the color/name maps key on (boundary translation mirrored
      // in getAppointmentsByDate).
      t.phase('synqedStaff', () => synqed.staff.list({ page_size: 200 })),
    ])
  const synqedKaruteRows = karuteData.data.rows

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
    currentStaffId,
    synqedKaruteRows,
    synqedStaff,
    monthCount: karuteData.monthProbe.total,
    total: karuteData.data.total,
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
        total={screen.total}
        staffList={screen.staffList}
        currentStaffId={screen.currentStaffId}
        customerOptions={screen.customerOptions}
      />
    </>
  )
}
