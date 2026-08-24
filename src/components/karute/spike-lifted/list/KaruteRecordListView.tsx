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
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { NewKaruteDialog } from './NewKaruteDialog'
import type { KaruteListFilter, KaruteListItem } from './types'
import { loadKaruteWindow, revealNoKaruteCustomer } from '@/actions/karute'
import { karuteHasMore } from '@/lib/karute/karute-window'

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
  const [announcement, setAnnouncement] = useState('')
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

  // The full accumulated store rows, id-keyed dedupe then sorted IN-APP —
  // server order is untrusted (core orders by created_at; the list reads by
  // session_date ?? created_at, and offset paging over live data can repeat a
  // row across page boundaries). mergeKaruteRows' idiom, client side.
  const allItems = useMemo(() => {
    const seen = new Set<string>()
    const out: KaruteListItem[] = []
    for (const item of [...items, ...appended]) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
    // Stable sort: same-day rows keep the order the server projected them in.
    return out.sort((a, b) => b.date.localeCompare(a.date))
  }, [items, appended])

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

  // Keep the derived total honest when the server re-renders (QuietRefresh).
  useEffect(() => {
    setStoreTotal(total)
  }, [total])

  async function fetchOlder(announce: boolean) {
    if (!windowStart || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await loadKaruteWindow({ olderThan: windowStart, loadedCount })
      if ('error' in res) return
      const seen = new Set(allItems.map((i) => i.id))
      const fresh = res.items.filter((i) => !seen.has(i.id))
      setAppended((prev) => [...prev, ...fresh])
      setWindowStart(res.windowStart)
      setSinceParam(res.windowStart)
      setStoreTotal(res.freshStoreTotal)
      setServerHasMore(res.hasMore)
      // Focus deliberately stays on the button (nothing is focused here) and
      // scroll is untouched — an append lands BELOW the viewport, so the
      // content-swap scrollTop reset (AuditLogSection's idiom) must NOT fire.
      if (announce) setAnnouncement(t('addedCount', { n: fresh.length }))
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

  // Search-reveal (PR-1b 検索リビール): a customer matching the search term
  // who has no karute yet. EXACTLY ONE row, query stays LOCAL (no URL) —
  // debounced server action (web) / facade call (thin), never a client-side
  // filter over `items` (those customers were never in `items` to begin
  // with — they have no karute record). A monotonic request id discards a
  // stale response that resolves after a newer query already superseded it.
  const [revealCandidate, setRevealCandidate] = useState<NoKaruteCandidate | null>(null)
  const revealRequestId = useRef(0)
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

  const filtered = useMemo(() => {
    let result = allItems

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
  }, [allItems, filter, searchQuery, staffFilter, currentStaffId])

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

  /** 「7月26日」/「Jul 26」 — the さらに表示 label's boundary day. */
  function formatBoundaryDate(date: string): string {
    const dt = new Date(`${date}T00:00:00+09:00`)
    return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      month: locale === 'ja' ? 'long' : 'short',
      day: 'numeric',
    }).format(dt)
  }

  function formatDateHeader(date: string): string {
    const dt = new Date(`${date}T00:00:00+09:00`)
    return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
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
    <main className="mx-auto w-full max-w-6xl flex-col px-4 pb-6 md:px-6">
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
            {storeTotal !== null &&
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
      <div className="flex pt-3">
        <SegmentedFilterBar
          segments={FILTER_KEYS.map((key) => ({
            key,
            label: t(`filters.${key}`),
            count: counts[key],
          }))}
          active={filter}
          onChange={setFilter}
        />
      </div>

      {/* List — date-grouped sections. Sits inside the layout's 16px
       *  horizontal padding so the rounded card has breathing room from
       *  the screen edges, matching the design spike. */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card">
        {grouped.length === 0 && !revealCandidate ? (
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
      {hasMore && windowStart && (
        <div className="flex justify-center pt-3">
          <button
            type="button"
            onClick={() => void fetchOlder(true)}
            disabled={loadingMore}
            aria-busy={loadingMore}
            className="inline-flex h-9 items-center justify-center rounded-full border border-border bg-card px-4 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingMore
              ? tCommon('loading')
              : t('loadMore', { date: formatBoundaryDate(windowStart) })}
          </button>
        </div>
      )}
      {/* Append announcement — the button keeps focus, so a screen reader
       *  needs the row count spoken rather than shown. */}
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
