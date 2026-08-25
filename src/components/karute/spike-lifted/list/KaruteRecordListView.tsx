'use client'

// LIFTED + ADAPTED FROM SPIKE
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute-list/KaruteList.tsx
//
// Karute records list — record-centric view for the カルテ tab.
// Replaces the customer-centric list that previously rendered here.
//
// Layout (matches spike):
//   - Sticky title bar (カルテ + bell)
//   - Status line + "+ 新規カルテ" button
//   - Search input (filter by customer / service / staff / summary)
//   - Filter chips (すべて / 今週 / AI補完待ち / レビュー要 / 下書き)
//   - Date-grouped records — each date renders a header
//     "YYYY/MM/DD (曜) · 本日/昨日 · N件のカルテ" then the rows
//
// Adaptations from spike:
//   useT()/useTheme()/useRole()/useViewMode()/useShowCrossStaffNames
//                              → useTranslations() + useLocale()
//   Spike's per-staff filter UI → not lifted yet (this commit focuses
//                                  on records + filters; per-staff
//                                  scoping can layer in later)

import { Button } from '@/components/ui/button'
import { FilePlus2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { usePathname, useRouter } from '@/i18n/navigation'

import {
  CustomersStaffFilter,
  type StaffFilterEntry,
  type StaffFilterKey,
} from '@/components/customers/redesign/list/CustomersStaffFilter'
import { SegmentedFilterBar } from '@/components/customers/redesign/list/SegmentedFilterBar'

import { KaruteListRow, NoKaruteRevealRow, type NoKaruteCandidate } from './KaruteListRow'
import { KaruteMonthSelector, shiftMonth } from './KaruteMonthSelector'
import { NewKaruteDialog } from './NewKaruteDialog'
import type { KaruteListFilter, KaruteListItem } from './types'
import { loadKaruteWindow, revealNoKaruteCustomer } from '@/actions/karute'
import { KARUTE_SESSION_DATE_EPOCH, karuteHasMore } from '@/lib/karute/karute-window'
import { ymdInJst } from '@/lib/date/jst'

interface Props {
  items: KaruteListItem[]
  /** Total karute records this month (not filtered) — shown in the status
   *  line independent of the active filter. null = the 今月 probe failed
   *  (Greptile PR #775 round 2): the status line OMITS the count entirely
   *  rather than rendering a fake 0 — a failed count is never shown as a
   *  number. */
  monthCount: number | null
  /** Store-wide karute total, unfiltered by date (PR-1b plumbing — not
   *  rendered until PR-2a's 全件 display). Optional so existing render call
   *  sites (management-flag-wiring.test.tsx) still typecheck without passing
   *  it. null = the main row read failed — doubles as the "did the list
   *  itself load" signal the status line uses to decide whether to render
   *  anything at all (Greptile PR #775 round 2). */
  total?: number | null
  /** PR-2a 日付チャンク読み込み — the oldest day the SERVER-rendered first
   *  window reached. さらに表示 walks backward from here; null = the window
   *  read failed (button hidden, same degraded posture as the status line). */
  initialWindowStart?: string | null
  /** The server's own hasMore for the first window. Only used while the
   *  store total is unknown — otherwise the view derives the identical
   *  formula client-side (karuteHasMore), so the two can never disagree. */
  initialHasMore?: boolean
  /** The store lens these rows were loaded under. A CHANGE resets every
   *  client-held row cache, DURING RENDER — see the store-switch block. Web
   *  only in practice: the phone shell's setActiveStore does a
   *  window.location.reload() (thin/ports/actions.vite.ts), so nothing survives
   *  there to go stale, and thin never passes this. */
  storeId?: string | null
  /** Staff list for the "your customers / all customers" filter. */
  staffList?: StaffFilterEntry[]
  /** The viewer's staff id — drives the "Me" filter pill. Null when
   *  the session has no active staff. */
  currentStaffId?: string | null
  /** All customers for this business — feeds the NewKaruteDialog's
   *  customer combobox so manual karute creation binds to a real
   *  customer_id instead of free text. Page already loads this for
   *  the customer lookup map; we pass it down. Shape matches the
   *  shared CustomerOption type used by the recording flow's
   *  CustomerCombobox / QuickCreateCustomer pair. */
  customerOptions?: Array<{
    id: string
    name: string
    phone?: string | null
    furigana?: string | null
  }>
}

// `needsReview` intentionally omitted from the visible filter row —
// no code path assigns `aiStatus === 'needsReview'` today, so the
// chip would always show "レビュー要 0" and filter to an empty list.
// The union member + i18n key + chip style stay in the codebase so
// the filter lights up automatically once ANTHONY adds a
// `karute_records.review_needed boolean` column and we set the
// status in page.tsx's derivation block (see types.ts ANTHONY note).
const FILTER_KEYS: KaruteListFilter[] = [
  'all',
  'thisWeek',
  'aiPending',
  'draft',
]

export function KaruteRecordListView({
  items,
  monthCount,
  total = null,
  initialWindowStart = null,
  initialHasMore = false,
  storeId = null,
  staffList = [],
  currentStaffId = null,
  customerOptions = [],
}: Props) {
  const t = useTranslations('karute.recordList')
  const tHead = useTranslations('karute')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  // URL-backed list state — back-navigation restores page + filters (same
  // pattern as the 顧客 list; search text deliberately stays local).
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [filter, setFilter] = useState<KaruteListFilter>(
    () => (searchParams.get('f') as KaruteListFilter | null) ?? 'all',
  )
  const [staffFilter, setStaffFilter] = useState<StaffFilterKey>(
    () => (searchParams.get('s') as StaffFilterKey | null) ?? 'all',
  )
  const [searchQuery, setSearchQuery] = useState('')

  // PR-2a 日付チャンク読み込み. `appended` holds ONLY the chunks さらに表示
  // pulled in; `items` stays the server-rendered first window, so a router
  // refresh keeps the newest rows fresh instead of freezing a client snapshot.
  const [appended, setAppended] = useState<KaruteListItem[]>([])
  const [windowStart, setWindowStart] = useState<string | null>(initialWindowStart)
  const [storeTotal, setStoreTotal] = useState<number | null>(total)
  const [serverHasMore, setServerHasMore] = useState(initialHasMore)
  const [loadingMore, setLoadingMore] = useState(false)
  // Generation counter for the purge-vs-in-flight race (fix round 4). The
  // deleted-row purge below bumps it; fetchOlder captures it BEFORE its await
  // and throws the whole response away if it moved. Without this, a request
  // already in flight when the purge fires lands afterwards and re-applies its
  // stale boundary and rows over the freshly rewound state — the middle chunks
  // then vanish until remount, which is precisely what the rewind is there to
  // prevent.
  const fetchGen = useRef(0)
  // Set on a failed fetchOlder (server error or a thrown RPC); cleared at the
  // top of the next attempt. Drives the inline retry message below the
  // さらに表示 button — the button stays enabled, this just makes the
  // failure visible instead of silently doing nothing. Fix round 2: that line
  // is now role="alert", so it is the ONLY place a load failure is reported —
  // the aria-live region below carries the loaded-count string alone.
  const [loadError, setLoadError] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // Search-reveal (PR-1b) state — the fetch itself lives further down with its
  // debounce; the declarations sit up here with the rest of the store-scoped
  // state so the store-switch reset can reach them.
  const [revealCandidate, setRevealCandidate] = useState<NoKaruteCandidate | null>(null)
  const revealRequestId = useRef(0)
  // The loaded boundary persists as ?since=YYYY-MM-DD. Set ON TAP (via this
  // state, written by the URL effect below in the same commit) — never
  // debounced, so the input-sync request-id traps don't apply here.
  const [sinceParam, setSinceParam] = useState<string | null>(() => searchParams.get('since'))
  // A restore in progress: keep loading windows until the boundary reaches the
  // ?since the URL remembers. Seeded on mount and re-seeded by popstate.
  const [restoreTarget, setRestoreTarget] = useState<string | null>(() =>
    searchParams.get('since'),
  )

  useEffect(() => {
    const next = new URLSearchParams(window.location.search)
    // `p` (the old in-memory pager) is gone in PR-2a — actively deleted so a
    // bookmarked ?p=3 from before this ships doesn't linger in the bar.
    next.delete('p')
    if (sinceParam) next.set('since', sinceParam)
    else next.delete('since')
    if (filter !== 'all') next.set('f', String(filter))
    else next.delete('f')
    if (staffFilter !== 'all') next.set('s', String(staffFilter))
    else next.delete('s')
    const qs = next.toString()
    router.replace((pathname + (qs ? `?${qs}` : '')) as never, { scroll: false })
  }, [sinceParam, filter, staffFilter, pathname, router])
  const [newKaruteOpen, setNewKaruteOpen] = useState(false)
  // Which customer the dialog should preselect — null for the top "+ 新規
  // カルテ" CTA, a candidate id when opened from the search-reveal row below.
  const [presetCustomerId, setPresetCustomerId] = useState<string | null>(null)

  // DEGRADED SERVER WINDOW (fix round 2). page.tsx signals a FAILED server-side
  // window read as items=[] + total=null + initialWindowStart=null. Merging that
  // empty `items` with the persisted `appended` chunks would silently VANISH the
  // newest rows while the older chunks stayed on screen — a failed background
  // refresh reading as "those karute were deleted". So the last NON-degraded
  // `items` prop is latched and kept on screen instead, with a visible failure
  // line saying the refresh didn't land.
  //
  // A genuinely empty store (total = 0, a real windowStart) is NOT degraded and
  // renders exactly as before; a first mount that is already degraded has
  // nothing latched and keeps the degraded-empty presentation.
  const serverDegraded = total === null && initialWindowStart === null
  // Render-time ref write, not an effect: the latched value has to be available
  // on THIS render, and it is only ever written from a render whose props came
  // back healthy.
  const lastGoodItems = useRef(items)
  if (!serverDegraded) lastGoodItems.current = items
  const baseItems = serverDegraded ? lastGoodItems.current : items

  // The full accumulated store rows, id-keyed dedupe then sorted IN-APP —
  // server order is untrusted (core orders by created_at; the list reads by
  // session_date ?? created_at, and offset paging over live data can repeat a
  // row across page boundaries). mergeKaruteRows' idiom, client side.
  const allItems = useMemo(() => {
    const seen = new Set<string>()
    const out: KaruteListItem[] = []
    for (const item of [...baseItems, ...appended]) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
    // Stable sort: same-day rows keep the order the server projected them in.
    return out.sort((a, b) => b.date.localeCompare(a.date))
  }, [baseItems, appended])

  // COUNT DEFINITIONS — two names, two meanings. loadedCount = RAW accumulated
  // store rows, unfiltered; showingCount (表示中) = post-filter visible rows,
  // computed further down. さらに表示 keys on loadedCount, NEVER on
  // showingCount: an active filter must not look like the end of history.
  const loadedCount = allItems.length
  // ONE formula (karuteHasMore) — the same function the server calls for the
  // DTO field the phone renders. Only when the store total is unknown does the
  // view fall back to the server's own flag.
  const hasMore =
    storeTotal !== null ? karuteHasMore(loadedCount, storeTotal) : serverHasMore

  // Keep the derived total honest when the server re-renders (QuietRefresh) —
  // and RECONCILE rows that left the store (Greptile PR #779 P1).
  //
  // `appended` is a client-held cache of the older chunks; a healthy refresh
  // only ever replaces `items` (the newest window), so a record DELETED
  // server-side lingers as a ghost row AND keeps inflating loadedCount — which
  // can flip hasMore false and hide さらに表示 while real history is still
  // unloaded. A `total` that came back LOWER than the one we hold is the
  // precise signal that something left the store: drop the cache, rewind the
  // boundary to the server's fresh first window, and re-seed the ?since
  // restore walk so it quietly rebuilds to the remembered depth with fresh
  // data. Rewinding `windowStart` is load-bearing — without it the restore
  // effect sees the boundary already at/past its target and stops without
  // refetching anything, leaving the list SHORTER than the viewer left it.
  //
  // CEILING (deliberate): a delete and a create between the same two refreshes
  // net to no total change and are missed; plain EDITS to already-appended
  // rows stay stale the same way. Both heal on remount. That is the same cache
  // posture the phone screens take — paying a full re-walk on every prop
  // change would undo the point of chunk loading.
  //
  // KNOWN BENIGN CORNER: storeTotal has two writers (this effect and
  // fetchOlder's response), so a refresh whose `total` was computed before an
  // append landed can read as a decrease and trigger a purge + re-walk that
  // wasn't strictly needed. The cost is extra fetches, never a wrong list —
  // and that is true because the `fetchGen` bump below MAKES it true: a
  // response already in flight when the purge fires is discarded wholesale
  // instead of re-applying its stale boundary and rows over the rewound state.
  // Bounded to one purge per refresh, because only a changed `total` PROP
  // re-runs this.
  /**
   * Drop the client-held chunk cache and re-seed the ?since re-walk from the
   * server's fresh first window. Shared by the deleted-row purge below and the
   * store switch further down — both mean "every row this component is holding
   * has stopped being the truth", and both need the SAME rewind.
   */
  function rewindToFirstWindow() {
    // Invalidate anything in flight BEFORE rewinding, so a response that
    // resolves a tick later can't undo the setters that follow.
    fetchGen.current += 1
    setAppended([])
    setWindowStart(initialWindowStart)
    // Back to the SERVER's own flag for the first window. Both callers want it:
    // the purge is re-seeding from fresh props, and a store switch's flag
    // described the previous store. Only used while storeTotal is unknown, but
    // that is exactly the degraded case where a stale value would be trusted.
    setServerHasMore(initialHasMore)
    // KEEP THE DEEPEST GOAL (Greptile PR #779 P1, round 8). `sinceParam` is
    // NOT a stable record of how deep the viewer got: every landed window
    // writes it, so DURING a re-walk it holds an INTERMEDIATE, shallower
    // boundary. Seeding a second purge from it plainly would hand the new
    // walk that intermediate target — the walk would stop there and the
    // viewer's deeper windows would silently stay gone until they tapped
    // again. So the goal only ever gets DEEPER: min of the goal in flight and
    // the live boundary (YYYY-MM-DD sorts lexicographically; smaller = older
    // = deeper). A null `cand` must not null a goal in flight either — that
    // is the popstate-to-a-remembered-?since case, where a re-walk is running
    // with nothing yet committed to `sinceParam`.
    setRestoreTarget((prev) => {
      const cand = sinceParam
      if (!cand) return prev
      if (!prev) return cand
      return prev < cand ? prev : cand
    })
  }

  useEffect(() => {
    if (total !== null && storeTotal !== null && total < storeTotal) {
      rewindToFirstWindow()
    }
    setStoreTotal(total)
    // `total` is the only trigger. storeTotal, sinceParam and
    // initialWindowStart are read as CURRENT values, never as triggers —
    // listing storeTotal would re-run this on our own setStoreTotal, and
    // listing sinceParam would re-run it on every さらに表示 tap, which is how
    // a purge could chase its own re-walk in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  async function fetchOlder(announce: boolean) {
    if (!windowStart || loadingMore) return
    setLoadingMore(true)
    setLoadError(false)
    // Captured BEFORE the await — a purge landing while this is in flight bumps
    // the counter, and everything below is then dropped wholesale.
    const gen = fetchGen.current
    try {
      const res = await loadKaruteWindow({ olderThan: windowStart, loadedCount })
      // SUPERSEDED: a purge rewound the walk under us. Discard the ENTIRE
      // result — no rows, no boundary, no counts, no announcement — because it
      // describes a state that no longer exists.
      //
      // But a discarded request must not become a DEAD TAP. `sinceParam` is
      // only written once a window has actually landed, so a null one on this
      // tap's render means the purge seeded `restoreTarget` with null too, and
      // the restore effect will exit without replaying anything: nothing else
      // is coming. For a user-initiated tap (`announce`) that is exactly the
      // case where the retry line is the honest answer — the request really
      // did not produce the rows they asked for, and tapping again really does
      // work. No new string, no replay machinery.
      //
      // CEILING (deliberate): the sibling case — a superseded tap with
      // `sinceParam` already set — stays silent. The re-walk restores their
      // DEPTH but not the one extra window that tap was reaching for, so
      // strictly they lost something too. It is left unannounced because rows
      // are visibly moving during the re-walk and the button is still there:
      // a failure line mid-restore would read as "this is broken" when it is
      // in fact busy, and the next tap gets them the window. Noted in the lane
      // queue rather than papered over here.
      //
      // Round 8 narrows "null sinceParam means nothing is coming" by exactly
      // one case: a popstate-seeded re-walk survives a null-cand purge, so a
      // tap superseded during THAT walk gets the retry line while rows are in
      // fact still coming. An extra, honest "try again" on a walk the viewer
      // never initiated is the cheap side of that trade; the condition stays.
      if (gen !== fetchGen.current) {
        if (announce && sinceParam === null) setLoadError(true)
        return
      }
      if ('error' in res) {
        // Clear restoreTarget so the restore effect (deps include
        // loadingMore) doesn't re-fire fetchOlder against a persistently
        // failing backend — without this, true→false→true on loadingMore
        // loops the same request forever.
        setLoadError(true)
        setRestoreTarget(null)
        return
      }
      const seen = new Set(allItems.map((i) => i.id))
      const fresh = res.items.filter((i) => !seen.has(i.id))
      setAppended((prev) => [...prev, ...fresh])
      setWindowStart(res.windowStart)
      setSinceParam(res.windowStart)
      setStoreTotal(res.freshStoreTotal)
      setServerHasMore(res.hasMore)
      // Focus stays on the button — nothing is focused here, and the button
      // never carries a native `disabled` attribute for the browser to blur
      // (see the さらに表示 markup below). Scroll is untouched on purpose: an
      // append usually lands BELOW the viewport, and even when it doesn't — a
      // BACKDATED row (created recently, dated older) interleaves ABOVE
      // existing rows, because the merged set re-sorts by DISPLAY date — the
      // content-swap scrollTop reset (AuditLogSection's idiom) must NOT fire.
      // Moving the page under a reader's finger is worse than an off-screen
      // row they can scroll to.
      if (announce) setAnnouncement(t('addedCount', { n: fresh.length }))
    } catch {
      // loadKaruteWindow can THROW on the web (server-action RPC network
      // failure) rather than resolve to { error }. Same recovery as above —
      // and the same staleness rule: a SUPERSEDED request's failure is not
      // this list's failure, and clearing restoreTarget here would strand the
      // purge's re-walk before it ever starts. Same dead-tap rule too — see
      // the result path above for why a null `sinceParam` means nothing is
      // coming to replace this tap.
      if (gen !== fetchGen.current) {
        if (announce && sinceParam === null) setLoadError(true)
        return
      }
      setLoadError(true)
      setRestoreTarget(null)
    } finally {
      setLoadingMore(false)
    }
  }

  // ?since restore: replay さらに表示 through the SAME path until the boundary
  // reaches the remembered day. One window per pass, driven by re-render, so
  // restore and a manual tap can never diverge.
  useEffect(() => {
    if (!restoreTarget) return
    if (loadingMore) return
    if (!windowStart || windowStart <= restoreTarget || !hasMore) {
      setRestoreTarget(null)
      return
    }
    void fetchOlder(false)
    // fetchOlder is recreated every render on purpose (it closes over the
    // current boundary + counts); the guard above is what bounds the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreTarget, windowStart, hasMore, loadingMore])

  // popstate only ever EXTENDS what's loaded — walking back to a shallower
  // ?since can't un-fetch rows, and showing more than the URL remembers is
  // not a lie, just a wider view.
  useEffect(() => {
    const onPop = () => {
      setRestoreTarget(new URLSearchParams(window.location.search).get('since'))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 月ジャンプ (PR-2b). A picked month SWAPS the list rather than appending to
  // it, so its rows live in their own state: exiting a month restores the
  // accumulated default walk instantly, with no refetch and nothing lost.
  const [activeMonth, setActiveMonth] = useState<string | null>(null)
  const [monthItems, setMonthItems] = useState<KaruteListItem[] | null>(null)
  const [monthLoading, setMonthLoading] = useState(false)
  const [monthError, setMonthError] = useState(false)
  // Same generation guard as fetchOlder's: a month fetch still in flight when
  // the user picks a different month (or leaves month view) describes a state
  // that no longer exists, so its whole response is dropped.
  const monthGen = useRef(0)
  const monthMode = activeMonth !== null

  // The JST calendar month containing today — the top of the picker and the
  // chip's label while nothing is picked. JST-explicit for the same reason
  // every other date in this file is (PR-2a fix round 5): a UTC server or a
  // traveller's browser must not name a different month than the business is
  // actually in.
  const currentMonth = useMemo(() => ymdInJst().slice(0, 7), [])
  // How far back the picker may offer. The session-date epoch is the floor the
  // app can reason about unaided; anything OLDER is offered only once rows from
  // it are actually on screen (the さらに表示 walk, or its one-time legacy
  // sweep) — so every month in the list is either inside the reasoned range or
  // provably has karute behind it. Monotonic within the session: a ref, not a
  // plain derivation, because the deleted-row purge above REWINDS `appended` to
  // the first window — a derived floor would snap forward with it and yank
  // months out of an open picker. Render-time write, same posture as
  // lastGoodItems above.
  const monthFloorRef = useRef(KARUTE_SESSION_DATE_EPOCH.slice(0, 7))
  const oldestLoadedMonth = allItems.length
    ? allItems[allItems.length - 1].date.slice(0, 7)
    : null
  if (oldestLoadedMonth && oldestLoadedMonth < monthFloorRef.current) {
    monthFloorRef.current = oldestLoadedMonth
  }
  const monthFloor = monthFloorRef.current

  /** Leave month view — the accumulated default window is still in state, so
   *  this is a pure swap back with no fetch. */
  function exitMonth() {
    monthGen.current += 1
    setActiveMonth(null)
    setMonthItems(null)
    setMonthLoading(false)
    setMonthError(false)
  }

  // STORE SWITCH — every row this component holds belongs to the store that was
  // active when it loaded. The switcher runs setActiveStore() then
  // router.refresh() (StoreSwitcher.tsx), and a refresh is a SERVER RE-RENDER,
  // not a navigation: React reconciles this same element in place instead of
  // remounting it, so the old store's month rows AND appended chunks otherwise
  // stay on screen under the new store's header and totals. Not an isolation
  // leak — the switcher only offers stores the viewer is allowed to see — but
  // the wrong store's karute all the same.
  //
  // exitMonth() first: its monthGen bump is what makes a month read already in
  // flight land into nothing rather than paint the old store's rows over the
  // new store's list.
  //
  // Web-only in practice, by construction: the phone shell's setActiveStore
  // does a window.location.reload() (thin/ports/actions.vite.ts), which
  // remounts everything, and thin never passes this prop.
  //
  // DURING RENDER, not in an effect (Greptile PR #784, round 2). An effect runs
  // AFTER paint, so the render that first carries the new store's props would
  // COMMIT with the previous store's month rows and appended chunks still on
  // screen — a visible frame of the wrong store's karute before the reset
  // caught up. Setting state while rendering makes React discard this render
  // and re-run the component with the reset values BEFORE anything is painted,
  // which is exactly React's documented "adjusting state when a prop changes"
  // recipe.
  //
  // `prevStoreId` is STATE, not a ref, for the same reason: a ref written
  // during render survives a discarded render attempt while the state reset
  // would not, so the two could disagree and the rewind be silently skipped.
  //
  // Guarded on a REAL change, never the mount: rewindToFirstWindow bumps
  // fetchGen, and the ?since restore effect above has already fired its first
  // fetchOlder by mount time — an unconditional run would supersede that
  // in-flight window, the walk would never advance, and the restore would
  // refire the same request forever (caught by karute-chunk-load's restore
  // tests).
  //
  // CEILING: the two generation counters are refs, so they are bumped during
  // render too. If React ever discards this render attempt, those bumps stick
  // while the state reset does not — the cost is an in-flight window dropped
  // that need not have been, which the next tap or the restore walk re-fetches.
  // A conservative failure, never a wrong list.
  const [prevStoreId, setPrevStoreId] = useState(storeId)
  if (storeId !== prevStoreId) {
    setPrevStoreId(storeId)
    exitMonth()
    rewindToFirstWindow()

    // CONTEXT-ONLY resets. These belong HERE and deliberately NOT in the shared
    // rewind, because the two callers mean different things: a purge is a DATA
    // refresh (rows moved under the SAME lens), a store switch is a CONTEXT
    // change (a different location, a different roster, different numbers).
    //
    // The staff roster is per-store (#496 clamps the 担当 picker to the active
    // store), so a staffFilter pinned to store A's stylist matches nobody in
    // store B and silently renders an empty list. It must equally SURVIVE a
    // purge, where the viewer's chosen lens is still perfectly valid — which is
    // why this line cannot move into rewindToFirstWindow().
    setStaffFilter('all')
    // The header numbers describe the STORE. Without this, a committed frame
    // shows store A's 全件 above store B's rows, and hasMore rides that stale
    // total long enough for さらに表示 to flash in and out.
    setStoreTotal(total)
    // Store A's retry line, its last announcement, and its reveal row (which
    // NAMES a store A customer) all stop being true at the switch. The request
    // id bump lands an in-flight reveal into nothing, same as the two
    // generation counters above.
    setLoadError(false)
    setAnnouncement('')
    revealRequestId.current += 1
    setRevealCandidate(null)
    // The picker's floor is store A's deepest loaded month, and it only ever
    // extends BACKWARD by design — so without this it keeps stretching store
    // B's picker on the strength of rows store B never had, offering months
    // that break the very invariant stated where the floor is computed ("every
    // month in the list is either inside the reasoned range or provably has
    // karute behind it"). Back to the epoch; store B's own rows re-deepen it.
    monthFloorRef.current = KARUTE_SESSION_DATE_EPOCH.slice(0, 7)
    // The degraded latch still holds store A's rows. It only matters when store
    // B's very first render is ALSO degraded — without this, that failure would
    // resurrect the previous store's list instead of showing the honest
    // degraded-empty state.
    //
    // ORDERING, and why these two ref writes are safe DOWN HERE even though
    // `baseItems` and `monthFloor` were both computed from them further up:
    // this render pass is about to be THROWN AWAY. `setPrevStoreId` above is a
    // state update during render, so React discards this attempt and re-runs
    // the component from the top, where those derivations read the values just
    // written. Nothing downstream of this point in THIS pass reaches the DOM.
    // A reader hoisting these writes above their derivations would not be
    // making an equivalent change — they would be making the reset depend on
    // statement order instead of on the discard-and-rerun, and the next edit
    // that moves a derivation would silently break it.
    lastGoodItems.current = items
  }

  async function pickMonth(month: string) {
    // Picking the CURRENT month is how you come back (⛔ no 「今月に戻る」
    // button — a v1 invention the mock lacks). The default view already IS this
    // month's newest rows plus さらに表示; re-fetching it as a month would
    // strip the counts and the button off a screen the user thinks they just
    // returned to.
    if (month === currentMonth) {
      exitMonth()
      return
    }
    const gen = ++monthGen.current
    setActiveMonth(month)
    setMonthItems(null)
    setMonthLoading(true)
    setMonthError(false)
    // The month IS the date lens now. すべて/今週 are date lenses too, and
    // 今週 inside a past month is empty by definition — arriving at a blank
    // screen that has rows behind it is exactly the lie the honest-header work
    // set out to kill. The packet already makes the two mutually exclusive in
    // the other direction (any pill tap leaves month view), so resetting here
    // closes the model.
    setFilter('all')
    try {
      // FETCH AXIS ≠ DISPLAY AXIS. The engine's month mode filters
      // **created_at** — core offers no session_date filter, proven in PR-2a —
      // while this list DISPLAYS `session_date ?? created_at`. So a karute
      // written Aug 3 for a July 28 session is FETCHED by the August window but
      // BELONGS in the July view, and one written July 30 for an Aug 2 session
      // is the mirror image. A bare month fetch misses the first and shows the
      // second. The standing "leave it" ruling covers the さらに表示 button,
      // where the axes only shift a boundary label; an explicit month PICK is a
      // claim about a specific month and has to be true.
      //
      // So: fetch the picked month's created-window WIDENED by ±1 month, then
      // keep only the rows whose DISPLAY date lands in the picked month. 表示中
      // counts what survives, so the header agrees with the list.
      //
      // COST, honestly: this is three calls to loadKaruteWindow, and EACH one
      // re-runs the whole screen fan-out — staff roster, the full customer list
      // (会員番号 is assigned by position over it), the synqed staff roster —
      // on top of its own window read. One month pick therefore costs roughly
      // 3× a full screen read, not "one read over three windows". Accepted
      // because a month pick is a deliberate, occasional act rather than a
      // scroll, and because the alternative was a second divergent projection
      // path. QUEUE: a leaner month read — one widened from/to inside the
      // engine plus a SINGLE fan-out — would bring this back to ~1× and is the
      // obvious follow-up if 月ジャンプ proves to be a hot path in the field.
      //
      // CEILING: a row backdated by MORE than one month still surfaces only
      // through the default walk, deliberately. No width is provably enough
      // while core cannot filter on session_date, and each extra month costs
      // another full fan-out; the real fix is that core filter, not a wider net
      // here.
      const chunks = await Promise.all(
        [-1, 0, 1].map((offset) => loadKaruteWindow({ month: shiftMonth(month, offset) })),
      )
      if (gen !== monthGen.current) return
      const seen = new Set<string>()
      const rows: KaruteListItem[] = []
      for (const chunk of chunks) {
        // Any leg failing means an INCOMPLETE month. Reported as a failure —
        // never served as a short list that would read as the truth.
        if ('error' in chunk) {
          setMonthError(true)
          setMonthItems([])
          return
        }
        for (const row of chunk.items) {
          if (row.date.slice(0, 7) !== month) continue
          if (seen.has(row.id)) continue
          seen.add(row.id)
          rows.push(row)
        }
      }
      // Same in-app sort the accumulated set gets — server order is untrusted,
      // and these rows arrive in three separate created-windows.
      rows.sort((a, b) => b.date.localeCompare(a.date))
      setMonthItems(rows)
      // Focus is back on the chip (whose label now names the month), so the
      // swap is silent for a screen reader unless it is spoken. Same string the
      // append uses — a swap really did load N karute.
      setAnnouncement(t('addedCount', { n: rows.length }))
    } catch {
      // Same both-shapes recovery as fetchOlder: the web action can THROW on an
      // RPC network failure instead of resolving to { error }.
      if (gen !== monthGen.current) return
      setMonthError(true)
      setMonthItems([])
    } finally {
      if (gen === monthGen.current) setMonthLoading(false)
    }
  }

  /** Any count-pill tap LEAVES month view, carrying that filter into the
   *  default window (packet §PR-2b). Tapping the already-active pill still
   *  leaves — the tap's meaning is "show me this across the whole list". */
  function pickFilter(key: KaruteListFilter) {
    if (monthMode) exitMonth()
    setFilter(key)
  }

  // Content-swap scroll reset (AuditLogSection's idiom): entering or leaving a
  // month REPLACES the list, and a viewer scrolled deep into August would
  // otherwise land past the bottom of a short July — a blank screen whose taps
  // hit nothing. Deliberately NOT wired to appends (see fetchOlder). The first
  // run is skipped so a back-navigation's restored scroll position survives
  // mount.
  const rootRef = useRef<HTMLElement>(null)
  const monthSwapped = useRef(false)
  useLayoutEffect(() => {
    if (!monthSwapped.current) {
      monthSwapped.current = true
      return
    }
    for (let el = rootRef.current?.parentElement ?? null; el; el = el.parentElement) {
      el.scrollTop = 0
    }
  }, [activeMonth])

  // Search-reveal (PR-1b 検索リビール): a customer matching the search term
  // who has no karute yet. EXACTLY ONE row, query stays LOCAL (no URL) —
  // debounced server action (web) / facade call (thin), never a client-side
  // filter over `items` (those customers were never in `items` to begin
  // with — they have no karute record). A monotonic request id discards a
  // stale response that resolves after a newer query already superseded it.
  // (state + request id declared with the other list state above, so the
  // store-switch reset can clear them — a reveal row names a customer of the
  // store that was active when it was fetched.)
  const fetchReveal = useDebouncedCallback(async (q: string) => {
    const myRequestId = ++revealRequestId.current
    const result = await revealNoKaruteCustomer(q)
    if (myRequestId !== revealRequestId.current) return // superseded — drop it
    setRevealCandidate('candidate' in result ? result.candidate : null)
  }, 300)
  useEffect(() => {
    // Bump + clear on EVERY change, synchronously, BEFORE (re)scheduling the
    // debounce — not just when the query empties (Greptile PR #776: the id
    // used to advance only when the debounced callback FIRED, so query A's
    // in-flight response could still render under query B during B's 300ms
    // debounce window — worst case, カルテを作成 preselects the wrong
    // customer). Invalidating immediately means A's response is already
    // stale the instant the user types past it, whether or not B's own
    // fetch has fired yet.
    revealRequestId.current++
    setRevealCandidate(null)
    const q = searchQuery.trim()
    if (!q) {
      fetchReveal.cancel()
      return
    }
    fetchReveal(q)
  }, [searchQuery, fetchReveal])

  const counts = useMemo(() => {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoff = sevenDaysAgo.toISOString().slice(0, 10)
    return {
      all: allItems.length,
      thisWeek: allItems.filter((i) => i.date >= cutoff).length,
      aiPending: allItems.filter((i) => i.aiStatus === 'pending').length,
      needsReview: allItems.filter((i) => i.aiStatus === 'needsReview').length,
      draft: allItems.filter((i) => i.aiStatus === 'draft').length,
    } satisfies Record<KaruteListFilter, number>
  }, [allItems])

  // Month view SWAPS the row set (PR-2b). The staff scope and the search box
  // still apply INSIDE a month — they answer "whose" and "which words", not
  // "which dates", so a month lens never contradicts them. The count-pill
  // filter is always 'all' in here: pickMonth resets it, and any pill tap
  // leaves.
  const displayItems = useMemo(
    () => (monthMode ? (monthItems ?? []) : allItems),
    [monthMode, monthItems, allItems],
  )

  const filtered = useMemo(() => {
    let result = displayItems

    // Staff scope: 'all' shows every record; 'self' filters to the
    // current viewer's records only; a specific id filters to that
    // staff. Records with no staffId are kept on 'all', dropped
    // on any specific scope.
    if (staffFilter === 'self' && currentStaffId) {
      result = result.filter((i) => i.staffId === currentStaffId)
    } else if (staffFilter !== 'all' && staffFilter !== 'self') {
      result = result.filter((i) => i.staffId === staffFilter)
    }

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoff = sevenDaysAgo.toISOString().slice(0, 10)
    if (filter === 'thisWeek') result = result.filter((i) => i.date >= cutoff)
    else if (filter === 'aiPending')
      result = result.filter((i) => i.aiStatus === 'pending')
    else if (filter === 'needsReview')
      result = result.filter((i) => i.aiStatus === 'needsReview')
    else if (filter === 'draft')
      result = result.filter((i) => i.aiStatus === 'draft')

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter((i) => {
        return (
          i.customerName.toLowerCase().includes(q) ||
          i.service.toLowerCase().includes(q) ||
          i.staffName.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q)
        )
      })
    }
    return result
  }, [displayItems, filter, searchQuery, staffFilter, currentStaffId])

  // Same date-bucketing as before, now over the FULL accumulated row set —
  // the in-memory pager (and its `p` URL param) is gone; さらに表示 is the
  // only way more rows arrive.
  const grouped = useMemo(() => {
    const map = new Map<string, KaruteListItem[]>()
    for (const item of filtered) {
      const arr = map.get(item.date) ?? []
      arr.push(item)
      map.set(item.date, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()

  function dayLabelFor(date: string): string | null {
    if (date === today) return t('dateGroup.today')
    if (date === yesterday) return t('dateGroup.yesterday')
    return null
  }

  /** 「7月26日」/「Jul 26」 — the さらに表示 label's boundary day.
   *
   *  timeZone is EXPLICIT (fix round 5): the instant is anchored to JST
   *  midnight, so formatting it in the viewer's own zone slides it a day for
   *  anyone west of Japan — a manager abroad, and every UTC server. These
   *  dates are JST business facts, not local wall-clock times. */
  function formatBoundaryDate(date: string): string {
    const dt = new Date(`${date}T00:00:00+09:00`)
    return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      timeZone: 'Asia/Tokyo',
      month: locale === 'ja' ? 'long' : 'short',
      day: 'numeric',
    }).format(dt)
  }

  /** Same JST-explicit rule as formatBoundaryDate above — this one predates
   *  PR-2a, and was shifting date-group headers for any non-JST browser. */
  function formatDateHeader(date: string): string {
    const dt = new Date(`${date}T00:00:00+09:00`)
    return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: locale === 'ja' ? 'long' : 'short',
      day: 'numeric',
      weekday: 'short',
    }).format(dt)
  }

  return (
    // Owns its own px-4 md:px-6 — the (app) layout provides no horizontal
    // padding now (system rule). The sticky title bar inside uses
    // `-mx-4 md:-mx-6` to bleed back to viewport edges for the iOS
    // sticky-header pattern (its bg + border line span full-width).
    <main ref={rootRef} className="mx-auto w-full max-w-6xl flex-col px-4 pb-6 md:px-6">
      {/* Title row — h1 visible on desktop only (MobileHeader
       *  handles the mobile title to avoid the duplicate
       *  "カルテ" rendering at top + below). Stats + primary CTA
       *  share a non-wrapping flex row so the button stays
       *  pinned right at every viewport width.
       *
       *  Earlier version used flex-wrap which pushed the button
       *  below the stats column on mobile, making it invisible
       *  inside the viewport. */}
      {/* Header structure contract (Liam 8/7, desktop unified late 8/7):
       *  NO per-page top offset at any width — the layout's py-4/md:py-6
       *  is the one shared offset under the title bar on all three list
       *  pages. (The old mobile mt-3 was the tab-switch jump; the old
       *  md:mt-5 was the same jump on desktop, 44px vs 24px.) */}
      <div>
        <h1 className="hidden text-2xl font-semibold tracking-tight text-foreground md:block md:text-[26px]">
          {tHead('tabHeading')}
        </h1>
        {/* Header structure contract (Liam 8/7): natural-height items-center
         *  row like 顧客/予約; mt-1 is desktop-only (spaces from the md h1
         *  above) so mobile keeps the shared offset. */}
        <div className="flex items-center justify-between gap-3 md:mt-1">
          <p className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">
            {/* Greptile PR #775 round 2: total===null means the main row
             *  read failed — render NO status line at all (the empty/
             *  degraded list below already tells the honest story). Zero
             *  numbers on screen beats a fake one. total!==null but
             *  monthCount===null means only the 今月 probe failed — show
             *  the subset line, never a fake 「今月 0件」. */}
            {/* statusLine v2 (PR-2a): 全{total}件 joins the line now that
             *  chunk loading makes the whole store browsable — PR-1b held it
             *  back on purpose while the list could only ever show 200. */}
            {/* Fix round 2: when the server window read FAILED but latched rows
             *  are still on screen, this slot carries the failure line instead
             *  of the numbers — the rows below are the last good ones, not the
             *  current truth, and saying so beats leaving the header blank.
             *  The two branches are exclusive so the numbers can't flash
             *  alongside the failure line on the render before the storeTotal
             *  effect catches up. role="alert" announces on mount, same as the
             *  さらに表示 failure line: a background refresh that freezes the
             *  newest rows is exactly what a screen-reader user must hear —
             *  nothing on screen moved to tell them. */}
            {serverDegraded
              ? loadedCount > 0 && <span role="alert">{t('loadMoreFailed')}</span>
              : storeTotal !== null &&
                (monthCount !== null
                  ? t('statusLine', {
                      total: storeTotal,
                      monthCount,
                      showingCount: filtered.length,
                    })
                  : t('statusLineNoMonth', {
                      total: storeTotal,
                      showingCount: filtered.length,
                    }))}
          </p>
          {/* + 新規カルテ — primary CTA. Opens the manual-entry dialog
           *  (NewKaruteDialog) so staff can backdate or log a session
           *  without going through the recording flow. The bottom-nav
           *  「録音」 button stays the canonical AI-assisted path —
           *  earlier this CTA routed there too, conflating manual entry
           *  with starting a recording. Two distinct intents now have
           *  two distinct surfaces. */}
          {/* Unified create pill (Liam 8/6 案A + 8/7 responsive ruling):
           *  shared Button default; words only on regular widths, icon
           *  only below 380px — never both. */}
          <Button
            type="button"
            aria-label={t('newKarute')}
            onClick={() => {
              setPresetCustomerId(null)
              setNewKaruteOpen(true)
            }}
          >
            <FilePlus2 className="size-3.5 min-[380px]:hidden" aria-hidden />
            <span className="hidden min-[380px]:inline">{t('newKarute')}</span>
          </Button>
        </div>
      </div>

      {/* Staff-scope filter — "your customers / all / specific staff".
       *  mt-4/pt-4 below: 16px header rhythm (Liam 8/7), matching 顧客/予約. */}
      {staffList.length > 0 && (
        <div className="mt-4">
          <CustomersStaffFilter
            staffList={staffList}
            selfStaffId={currentStaffId ?? null}
            selected={staffFilter}
            onChange={setStaffFilter}
          />
        </div>
      )}

      {/* Search input — reuses the customer search input visually */}
      <div className="pt-4">
        <label className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-card px-3 focus-within:border-sky-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-9 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </label>
      </div>

      {/* Filter bar — 案A (Liam, 7/17): same shared segmented control as the
       *  顧客 list status filter (one design language across list screens).
       *  flex wrapper so md:w-auto shrinks the bar to content on desktop —
       *  in a plain block it would stretch the full ~1100px content width. */}
      {/* 月ジャンプ (PR-2b) rides in THIS row — 「月ジャンプは新しい行を増や
       *  さず、既存のフィルター行に追加」 (mock, 決定済み). flex-wrap is the
       *  narrow-width backstop: the segmented bar is full-width below md, so
       *  the chip drops to a second line rather than squeezing 「AI補完待ち」
       *  into an ellipsis. No overflow container here on purpose — one would
       *  clip the chip's anchored panel. */}
      <div className="flex flex-wrap items-center gap-2 pt-3">
        <SegmentedFilterBar
          segments={FILTER_KEYS.map((key) => ({
            key,
            label: t(`filters.${key}`),
            // LABELS ONLY while a month is picked: these counts are computed
            // over the rows on screen, which in month view is that month
            // alone — 今週 would read 0 inside any past month and すべて would
            // disagree with the 全件 in the header. Dropped, never guessed.
            count: monthMode ? null : counts[key],
          }))}
          active={filter}
          onChange={pickFilter}
        />
        <KaruteMonthSelector
          currentMonth={currentMonth}
          oldestMonth={monthFloor}
          selected={activeMonth}
          onSelect={(month) => void pickMonth(month)}
          busy={monthLoading}
        />
      </div>

      {/* List — date-grouped sections. Sits inside the layout's 16px
       *  horizontal padding so the rounded card has breathing room from
       *  the screen edges, matching the design spike. */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card">
        {/* A month's rows are still coming: say so. The 「カルテはまだ
         *  ありません」 empty state below would name that month as EMPTY while
         *  its rows are in flight — a load reported as a fact. */}
        {monthMode && monthItems === null ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
          </div>
        ) : monthMode && monthError ? (
          <div className="px-6 py-12 text-center">
            <p role="alert" className="text-sm text-muted-foreground">
              {t('loadMoreFailed')}
            </p>
          </div>
        ) : grouped.length === 0 && !revealCandidate ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          </div>
        ) : (
          <>
            {grouped.map(([date, items]) => {
              const dayLabel = dayLabelFor(date)
              return (
                <div key={date}>
                  {/* Date section header */}
                  <div className="border-b border-border/40 bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground md:px-5">
                    <span className="tabular-nums text-foreground">
                      {formatDateHeader(date)}
                    </span>
                    {dayLabel && (
                      <>
                        <span aria-hidden> · </span>
                        <span className="text-muted-foreground">
                          {dayLabel}
                        </span>
                      </>
                    )}
                    <span aria-hidden> · </span>
                    <span>{t('dateGroup.suffix', { n: items.length })}</span>
                  </div>
                  {items.map((item) => (
                    <KaruteListRow key={item.id} item={item} />
                  ))}
                </div>
              )
            })}
            {/* Search-reveal (PR-1b 検索リビール) — EXACTLY ONE row, appended
             *  after the real results. These customers have no karute record
             *  at all, so they were never part of `items`/`grouped` above. */}
            {revealCandidate && (
              <NoKaruteRevealRow
                candidate={revealCandidate}
                onCreateClick={() => {
                  setPresetCustomerId(revealCandidate.id)
                  setNewKaruteOpen(true)
                }}
              />
            )}
          </>
        )}
      </div>

      {/* さらに表示 (PR-2a 日付チャンク読み込み) — replaces the in-memory pager.
       *  Visible iff loadedCount < 全件: the RAW loaded count, never the
       *  filtered 表示中 count, so a narrow filter never masquerades as the
       *  end of the store's history. The label names the boundary the next
       *  chunk starts from. */}
      {/* HIDDEN in month view (PR-2b): a month is fetched whole, so there is
       *  nothing older to walk to — the button would offer history it cannot
       *  reach from here. Come back via the chip's current month. */}
      {!monthMode && hasMore && windowStart && (
        <div className="flex flex-col items-center gap-1 pt-3">
          {/* NO native `disabled` (fix round 2): the browser BLURS a focused
           *  element the instant it becomes disabled, so the tapped button lost
           *  focus mid-fetch and a keyboard/screen-reader user was dropped back
           *  to the top of the document — the exact opposite of the
           *  "focus stays put" intent below. fetchOlder already self-guards
           *  re-entry (its `loadingMore` check), so the attribute bought
           *  nothing. aria-busy carries the state; the classes carry the look
           *  the `disabled:` variants used to. */}
          <button
            type="button"
            onClick={() => void fetchOlder(true)}
            aria-busy={loadingMore}
            className={`inline-flex h-9 items-center justify-center rounded-full border border-border bg-card px-4 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground${
              loadingMore ? ' cursor-not-allowed opacity-40' : ''
            }`}
          >
            {loadingMore
              ? tCommon('loading')
              : t('loadMore', { date: formatBoundaryDate(windowStart) })}
          </button>
          {/* role="alert" (fix round 2): this line IS the failure messaging now
           *  — it announces on mount, which covers the SILENT ?since restore
           *  too. Before, a restore failure was visible but never spoken, and a
           *  manual tap spoke through the aria-live region while also showing
           *  this line: one failure, announced twice. */}
          {loadError && (
            <p role="alert" className="text-xs text-muted-foreground">
              {t('loadMoreFailed')}
            </p>
          )}
        </div>
      )}
      {/* Append announcement — the button keeps focus, so a screen reader
       *  needs the row count spoken rather than shown. Loaded counts ONLY:
       *  failures speak through the role="alert" line above (fix round 2), so
       *  one failed tap can never be announced twice. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Manual-entry dialog for the "+ 新規カルテ" CTA. Renders at
       *  the root of the page so it overlays the whole viewport
       *  cleanly (Portal-mounted via the shadcn Dialog primitive). */}
      <NewKaruteDialog
        open={newKaruteOpen}
        onOpenChange={setNewKaruteOpen}
        staffList={staffList.map((s) => ({
          id: s.id,
          name: s.name,
          isManagement: s.isManagement,
        }))}
        customers={customerOptions}
        defaultStaffId={currentStaffId}
        preselectedCustomerId={presetCustomerId}
      />
    </main>
  )
}
