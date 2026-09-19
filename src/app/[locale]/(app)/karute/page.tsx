import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { startTiming } from '@/lib/perf/timing'
import { getBusinessId, getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { loadKaruteWindowWithMonthProbe } from '@/lib/karute/karute-window'
import { jstStartOfMonth } from '@/lib/date/jst'
import { listAllCustomersCached } from '@/lib/customers/list-all'
import { resolveStoreScope, storeStaffIdSet } from '@/lib/auth/store-scope'
import { reachesNoStore } from '@/lib/auth/store-gate'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import { can } from '@/lib/auth/require-permission'

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
    holdsDiscardView,
    holdsViewShared,
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
      // PR-2a 日付チャンク読み込み: the row read is now the FIRST DATE WINDOW
      // (probe-then-fetch, 2 weeks back), not a flat newest-200 — さらに表示
      // walks further back from `windowStart`. It and the 今月 probe (JST month
      // window, page_size:1) degrade INDEPENDENTLY (Greptile PR #775 round 2):
      // the list is primary, the count is auxiliary — a probe failure must
      // never discard already-loaded rows, and a window-read failure must never
      // be masked by a lucky probe success. See
      // loadKaruteWindowWithMonthProbe's doc for the full contract. LENS PARITY
      // (from/to computation only — the facade stays shared-fate) with
      // screens/sessions/route.ts.
      t.phase('karuteData', () =>
        loadKaruteWindowWithMonthProbe(synqed, {
          storeId: activeStore,
          // Same clamp the customer list above carries: a clamped actor with
          // no store reaches NO karute, never the business-wide list.
          enforceStore: clamped,
          monthFrom: monthStartIso,
          monthTo: nowIso,
          now,
        }),
      ),
      // Synqed staff roster — translates a record's synqed staff id into the
      // profile id the color/name maps key on (boundary translation mirrored
      // in getAppointmentsByDate).
      t.phase('synqedStaff', () => synqed.staff.list({ page_size: 200 })),
      // R8 discarded-record door (⚖ Liam 2026-09-13, A8).
      can('records.discardView'),
      // D10 (PR-C, self-lighting): gates the 「共有」 pill together with
      // displaySharedCount below.
      can('recordings.viewShared'),
    ])
  const synqedKaruteRows = karuteData.data?.rows ?? []
  // Nullable display values (Greptile PR #775 round 2): null means that leg
  // failed — the view must render NO number for it, never a fake 0.
  // buildSessionsListScreen's monthCount/total args stay plain numbers (the
  // SAME shared builder the facade route calls with always-real numbers);
  // these are what the view actually renders, bypassing screen.monthCount/
  // screen.total below on purpose.
  const displayMonthCount = karuteData.monthProbe?.total ?? null
  const displayTotal = karuteData.data?.freshStoreTotal ?? null
  const displayDiscardedCount = karuteData.data?.freshDiscardedCount ?? null
  // PR-2a: the loaded boundary + "is there older history" flag the さらに表示
  // button keys on. null boundary = the window read failed (the button hides
  // along with the whole status line).
  const initialWindowStart = karuteData.data?.windowStart ?? null
  const initialHasMore = karuteData.data?.hasMore ?? false
  // D10 (PR-C, self-lighting): undefined (leg failed OR core hasn't shipped
  // shared_count yet) collapses to null here — either way the pill must not
  // exist. NEVER `?? 0` (feature detection: a real 0 is a shown value).
  //
  // F1 fix (PR-C fix round 1, ⚖ "the wire must not tell a colleague a share
  // happened"): core has no concept of recordings.viewShared — it returns
  // shared_count unconditionally to whoever asks — so this line is the ONLY
  // gate for this particular read (loadKaruteWindowWithMonthProbe is a plain
  // server-to-server call with no capability awareness of its own, unlike
  // the loadKaruteWindow action/route F1(b) gates). Without `holdsViewShared
  // ? … : null` here, a non-holder's browser would still receive the real
  // count in this Server Component's RSC payload (inspectable client-side)
  // even though the pill stays hidden — the SAME leak F1 closes for the
  // builder's own sharedCount and for the append/window doors, one hop
  // earlier in this specific read path.
  const displaySharedCount = holdsViewShared
    ? (karuteData.data?.freshSharedCount ?? null)
    : null

  // #496 store clamp: the 担当 picker only offers staff assigned to the active
  // store (or floating staff) — the full roster was leaking every branch's
  // staff names into every store's dropdown. Name resolution on rows stays
  // business-wide inside the builder.
  const storeStaffIds = await t.phase('storeStaffIds', () =>
    // An actor who reaches no store gets an EMPTY picker — storeStaffIdSet's
    // null (= "show everyone") is the documented fail-OPEN for a missing lens,
    // and it must not be the answer for a clamp with no store.
    reachesNoStore(scope)
      ? Promise.resolve(new Set<string>())
      : storeStaffIdSet(staffList, activeStore),
  )
  t.end()

  const screen = buildSessionsListScreen({
    staffList,
    storeStaffIds,
    allCustomersList,
    currentStaffId,
    synqedKaruteRows,
    synqedStaff,
    monthCount: displayMonthCount ?? 0,
    total: displayTotal ?? 0,
    discardedCount: displayDiscardedCount ?? 0,
    // F1 fix (PR-C fix round 1): REQUIRED — gates isShared per row (a
    // colleague's shared row never carries the flag unless she holds the
    // capability or it's her own record) even though this page bypasses
    // screen.sharedCount itself (displaySharedCount below reads the window
    // leg directly, same as displayTotal/displayDiscardedCount).
    viewerHoldsViewShared: holdsViewShared,
  })

  return (
    <>
      {/* SWR delivery: this screen may have been served from the
          router cache — stamp when the SERVER built it so a stale
          copy refreshes itself behind the paint. */}
      <QuietRefresh renderedAt={renderStamp()} />
      <KaruteRecordListView
        items={screen.items}
        monthCount={displayMonthCount}
        total={displayTotal}
        discardedCount={displayDiscardedCount}
        initialWindowStart={initialWindowStart}
        initialHasMore={initialHasMore}
        // The lens these rows were read under. The store switcher's
        // router.refresh() re-PROPS this component rather than remounting it,
        // so this is what tells it to drop the previous store's cached rows.
        storeId={activeStore}
        staffList={screen.staffList}
        currentStaffId={screen.currentStaffId}
        customerOptions={screen.customerOptions}
        viewerCanOpenDiscarded={holdsDiscardView}
        sharedCount={displaySharedCount}
        viewerHoldsViewShared={holdsViewShared}
      />
    </>
  )
}
