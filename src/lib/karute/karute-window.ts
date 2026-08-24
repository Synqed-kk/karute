// カルテ tab 日付チャンク読み込み — the date-window loader (PR-2a).
//
// Replaces the old "fetch the newest 200 and paginate in memory" read with a
// backward walk: probe a 2-week window's `total` with a page_size:1 call, skip
// windows that are empty, and page the first non-empty one to completion. The
// caller (さらに表示) passes the previous window's start as `olderThan` and the
// walk resumes strictly older than that boundary.
//
// ⚠ RUNTIME-PROVEN SEMANTICS (evidence/karute-tab-build-20260825/pr2a/
// NULL-DATE-PROOF.md, source read of synqed-core @ origin/main 0c23db6):
// `karuteRecords.list`'s from/to filter on **created_at**, NOT session_date —
// `sessionDate` appears nowhere in listKaruteRecords' where-clause. created_at
// is NOT NULL (schema default now()) and there is no soft-delete column, so
// every row falls inside some window and `total` counts the same population the
// rows come from: the walk CANNOT strand a record, null-session_date rows
// included. The list still SORTS and buckets by `session_date ?? created_at`,
// so for a backdated karute the window boundary and the displayed date differ —
// the accumulated set is always complete and correctly sorted, but a backdated
// row can surface above a boundary the button already announced. Flagged to
// Liam; windowing on session_date is impossible until core offers that filter.
//
// Both from/to bounds are INCLUSIVE server-side (gte/lte), so every window here
// ends at `boundary − 1ms` — adjacent windows never share an instant.

import type { SynqedClient } from '@synqed-kk/client'
import { jstWallTimeToDate, ymdInJst } from '@/lib/date/jst'
import {
  type KaruteListRow,
  listSynqedKaruteRowsWithTotalOrThrow,
} from '@/lib/karute/synqed-records'

/**
 * Probe floor for the backward walk (JST calendar day, inclusive).
 *
 * session_date only persists on karute written since the 2026-06-11 core
 * migration, so 2026-07-01 is the oldest date the app can reason about as a
 * SESSION date at all — everything older is legacy data whose displayed date is
 * really its insert time. The walk therefore stops probing here instead of
 * marching backward through years of empty two-week windows.
 *
 * The floor is a WALK BOUND, not a completeness fix: since from/to actually
 * filter created_at (NOT NULL — see the file header), no row is unreachable by
 * windows. Completeness past the floor is guaranteed by the one-time legacy
 * sweep below, which fires when the walk reaches the floor with rows still
 * unaccounted for.
 */
export const KARUTE_SESSION_DATE_EPOCH = '2026-07-01'

/** Window width for the backward walk, in JST calendar days. */
export const KARUTE_WINDOW_DAYS = 14

/** Server clamps page_size at 200 (validations/karute.ts). */
export const KARUTE_WINDOW_PAGE_SIZE = 200

/**
 * Empty windows a single call will skip before giving up and handing the
 * boundary back to the caller. One year of two-week windows. The epoch floor is
 * the real terminator; this only bounds how many probes one tap can cost as the
 * epoch recedes into the past. Hitting it is not an error: `windowStart` still
 * advanced, so the next さらに表示 tap resumes exactly where this one stopped.
 */
export const KARUTE_MAX_PROBE_WINDOWS = 26

/** One date-chunk of the カルテ list. */
export interface KaruteWindow {
  /** The window's rows, newest-first. May be empty (the walk hit the probe cap
   *  without finding a non-empty window) while `hasMore` is still true. */
  rows: KaruteListRow[]
  /** YYYY-MM-DD (JST) — the OLDEST day this call reached. Feed it back as
   *  `olderThan` for the next chunk; it is also what ?since persists and what
   *  the さらに表示 label announces. */
  windowStart: string
  /** Store-wide karute total, re-read on THIS call — never a stale snapshot. */
  freshStoreTotal: number
  /** See {@link karuteHasMore}. */
  hasMore: boolean
}

/**
 * THE hasMore formula — one definition, every surface. `loadedCount` is the RAW
 * accumulated store rows fetched so far (unfiltered); it is NEVER the
 * post-filter 表示中 count, which would hide history behind an active filter.
 * The server calls it with `loadedCount + this window's rows` for the DTO field
 * the phone renders; the web view calls it with its own dedupe-map size. Same
 * function, so the two can never drift.
 */
export function karuteHasMore(loadedCount: number, freshStoreTotal: number): boolean {
  return loadedCount < freshStoreTotal
}

/** JST midnight of a YYYY-MM-DD, as a Date. */
function dayStart(ymd: string): Date {
  return jstWallTimeToDate(ymd, '00:00')
}

/** Shift a YYYY-MM-DD by whole JST days (Japan has no DST, so this is exact). */
function shiftYmd(ymd: string, days: number): string {
  return ymdInJst(new Date(dayStart(ymd).getTime() + days * 86_400_000))
}

/**
 * One offset-paged read of a query, restarted ONCE if the underlying row set
 * moves mid-walk.
 *
 * Offset paging over live data does not merely REPEAT rows across a page
 * boundary (the caller's id-keyed dedupe collapses those). A concurrent DELETE
 * of an earlier-ranked row slides every later row one slot forward, so the row
 * that sat at the top of page 2 lands at the bottom of page 1 — which the walk
 * has already read — and is never fetched at all. Dedupe cannot recover a row
 * that never arrived. Every page response carries `total` for the SAME query,
 * so page 1's total is the witness: a later page reporting a different one
 * means the set moved under the offsets, and the whole read restarts from page
 * 1 with fresh accumulation.
 *
 * Ceiling: exactly ONE restart. A second drift inside the same
 * millisecond-scale walk is vanishingly rare, and if it happens the walk
 * returns what it got — the row surfaces on the next refresh or on the epoch
 * sweep. Retrying unbounded against a hot store would cost far more than the
 * gap it closes.
 */
async function pagedReadWithDriftRetry(
  readPage: (page: number) => Promise<{ rows: KaruteListRow[]; total: number }>,
): Promise<KaruteListRow[]> {
  for (let attempt = 1; ; attempt += 1) {
    const rows: KaruteListRow[] = []
    let firstTotal = 0
    // Hard page ceiling derived from the first response's own total, so a
    // shifting live total can't spin the loop.
    let maxPages = 1
    let drifted = false
    for (let page = 1; ; page += 1) {
      const res = await readPage(page)
      if (page === 1) {
        firstTotal = res.total
        maxPages = Math.ceil(res.total / KARUTE_WINDOW_PAGE_SIZE) + 1
      } else if (res.total !== firstTotal && attempt === 1) {
        drifted = true
        break
      }
      rows.push(...res.rows)
      if (page * KARUTE_WINDOW_PAGE_SIZE >= res.total) break
      if (page >= maxPages) break
    }
    if (!drifted) return rows
  }
}

/** Page one from/to window to completion — `page * page_size < total` (the
 *  audit-log idiom), through {@link pagedReadWithDriftRetry} so a concurrent
 *  delete can't slide a live row past the offsets unread. */
async function pageWindowToCompletion(
  synqed: SynqedClient,
  opts: { storeId?: string | null; from: string; to: string },
): Promise<KaruteListRow[]> {
  return pagedReadWithDriftRetry((page) =>
    listSynqedKaruteRowsWithTotalOrThrow(synqed, {
      storeId: opts.storeId,
      from: opts.from,
      to: opts.to,
      page,
      page_size: KARUTE_WINDOW_PAGE_SIZE,
    }),
  )
}

/**
 * ONE-TIME legacy sweep: a date-unfiltered paged read of the whole store,
 * merged as the FINAL window. Fires when the backward walk reaches the epoch
 * floor with `loadedCount < freshStoreTotal` — i.e. records exist that the
 * dated walk will never reach in a sane number of probes.
 *
 * It returns EVERY row, already-loaded ones included: the caller's id-keyed
 * dedupe map (mergeKaruteRows' idiom) collapses the overlap, which is the same
 * outcome as excluding ids server-side without shipping an id list up the wire.
 * Ceiling: one full store read. Acceptable because it happens at most once per
 * viewer per session, at the END of their history, and the store total is
 * already known to be small enough that they scrolled to the bottom of it.
 *
 * Pages through {@link pagedReadWithDriftRetry} for the same reason the window
 * walk does — this is the read that closes out the list, so a row lost to a
 * concurrent delete's offset shift here would never be fetched again.
 */
async function legacySweep(
  synqed: SynqedClient,
  storeId: string | null | undefined,
): Promise<KaruteListRow[]> {
  return pagedReadWithDriftRetry((page) =>
    listSynqedKaruteRowsWithTotalOrThrow(synqed, {
      storeId,
      page,
      page_size: KARUTE_WINDOW_PAGE_SIZE,
    }),
  )
}

/**
 * Load one date-chunk of the カルテ list.
 *
 * - no `olderThan`, no `month` → the newest window (the initial page load)
 * - `olderThan` → the next non-empty window strictly older than that boundary
 * - `month` ('YYYY-MM') → that JST calendar month, whole (PR-2b 月ジャンプ;
 *   the parameter is part of the signature from PR-2a, nothing sends it yet)
 *
 * `loadedCount` is what the CALLER already holds (0 on a first load) — it feeds
 * the epoch-sweep decision and the returned `hasMore`.
 *
 * TRUST BOUNDARY: `loadedCount` is trusted for WALK ECONOMICS only. It gates no
 * data access, no store scope and no other viewer's view — every row this walk
 * can reach is already clamped by `storeId`. An overstated value can only make
 * the CALLER'S OWN list end early (a false `hasMore: false`, the epoch sweep
 * skipped for itself); it can neither widen a lens nor reach a row the walk
 * would otherwise refuse.
 *
 * Throws on upstream failure (listSynqedKaruteRowsWithTotalOrThrow's contract) —
 * the facade route classifies it as a 502, the web action catches it.
 */
export async function loadKaruteWindowRows(
  synqed: SynqedClient,
  opts: {
    storeId?: string | null
    olderThan?: string
    month?: string
    loadedCount?: number
    /** Injectable clock — tests pin "now" instead of racing the calendar. */
    now?: Date
  },
): Promise<KaruteWindow> {
  const now = opts.now ?? new Date()
  const loadedCount = opts.loadedCount ?? 0
  const storeId = opts.storeId

  // Fresh store total on EVERY call — hasMore must never ride a snapshot taken
  // when the page was first rendered.
  const freshStoreTotal = (
    await listSynqedKaruteRowsWithTotalOrThrow(synqed, { storeId, page_size: 1 })
  ).total

  if (opts.month) {
    // Month mode swaps the list rather than appending to it (PR-2b), so there
    // is nothing "older" to append and さらに表示 hides — hasMore is false by
    // construction here, NOT by the loadedCount<total formula, which describes
    // the default backward walk only.
    const [y, m] = opts.month.split('-').map(Number)
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    const rows = await pageWindowToCompletion(synqed, {
      storeId,
      from: dayStart(`${opts.month}-01`).toISOString(),
      to: new Date(dayStart(`${nextMonth}-01`).getTime() - 1).toISOString(),
    })
    return {
      rows,
      windowStart: `${opts.month}-01`,
      freshStoreTotal,
      hasMore: false,
    }
  }

  const epochStart = dayStart(KARUTE_SESSION_DATE_EPOCH)
  // First call covers [today−13 … now]; a resumed walk covers the 14 days
  // ending one millisecond before the previous window's start.
  let toDate = opts.olderThan ? new Date(dayStart(opts.olderThan).getTime() - 1) : now
  let fromYmd = opts.olderThan
    ? shiftYmd(opts.olderThan, -KARUTE_WINDOW_DAYS)
    : shiftYmd(ymdInJst(now), -(KARUTE_WINDOW_DAYS - 1))

  for (let probe = 0; probe < KARUTE_MAX_PROBE_WINDOWS; probe += 1) {
    // PROBE FLOOR: the whole next window lies before the epoch.
    if (toDate.getTime() < epochStart.getTime()) {
      if (!karuteHasMore(loadedCount, freshStoreTotal)) {
        return { rows: [], windowStart: KARUTE_SESSION_DATE_EPOCH, freshStoreTotal, hasMore: false }
      }
      const rows = await legacySweep(synqed, storeId)
      return {
        rows,
        windowStart: KARUTE_SESSION_DATE_EPOCH,
        freshStoreTotal,
        // Final window by construction: the sweep read the whole store.
        hasMore: false,
      }
    }

    const from = dayStart(fromYmd).toISOString()
    const to = toDate.toISOString()
    const probeRes = await listSynqedKaruteRowsWithTotalOrThrow(synqed, {
      storeId,
      from,
      to,
      page_size: 1,
    })
    if (probeRes.total > 0) {
      const rows = await pageWindowToCompletion(synqed, { storeId, from, to })
      return {
        rows,
        windowStart: fromYmd,
        freshStoreTotal,
        hasMore: karuteHasMore(loadedCount + rows.length, freshStoreTotal),
      }
    }
    // Empty window — skip it and keep walking backward.
    toDate = new Date(dayStart(fromYmd).getTime() - 1)
    fromYmd = shiftYmd(fromYmd, -KARUTE_WINDOW_DAYS)
  }

  // Probe cap hit without a hit. `fromYmd` is the start of the NEXT
  // (unprobed) window here, so return the start of the LAST PROBED window
  // instead — feeding that back as `olderThan` resumes the walk at the first
  // unprobed window rather than skipping it.
  return {
    rows: [],
    windowStart: shiftYmd(fromYmd, KARUTE_WINDOW_DAYS),
    freshStoreTotal,
    hasMore: karuteHasMore(loadedCount, freshStoreTotal),
  }
}

/** {@link loadKaruteWindowWithMonthProbe}'s return shape: the first date
 *  window paired with the 今月 (JST month) count probe — each leg
 *  INDEPENDENTLY nullable. null = that leg's read failed; the caller must
 *  never coerce it to a fake 0/[] (Greptile PR #775, fix round 2). */
export interface KaruteWindowWithMonthProbe {
  /** null = the window read failed. The caller renders the DEGRADED
   *  presentation (no rows, no status numbers) — never an empty-but-honest
   *  list, which would misreport a real outage as "no karute yet". */
  data: KaruteWindow | null
  /** null = the 今月 probe failed — independently of `data`. The caller
   *  OMITS the 今月 count entirely rather than rendering 0; it never
   *  discards already-successfully-loaded rows just because this leg
   *  failed (fix round 1's shared-try/catch bug — Greptile PR #775 round 2:
   *  a probe failure silently emptied the whole list). */
  monthProbe: { total: number } | null
}

/**
 * Independent pairing of the first date window + the 今月 count probe (PR-1b
 * 正直ヘッダー, rebased onto PR-2a's windowed read). The contract: the LIST is
 * primary, the count is auxiliary. Each read gets its OWN catch
 * (swallow-and-log, same posture as {@link listSynqedKaruteRows}) — a probe
 * failure must never discard already-loaded rows (round 1's shared try/catch
 * did exactly that), and a window-read failure must never be masked by a lucky
 * probe success. null means "this leg failed"; the caller (page.tsx) renders
 * `data` regardless of `monthProbe`'s outcome, and shows NO 今月 number when
 * `monthProbe` is null — a failed count is omitted, never a fake number.
 *
 * The facade route does NOT use this helper: its two reads share ONE
 * throw-into-502 catch (packet 05 failure contract) — a phone screen is never
 * partial, it's either whole or a classified error.
 */
export async function loadKaruteWindowWithMonthProbe(
  synqed: SynqedClient,
  opts: {
    storeId?: string | null
    monthFrom: string
    monthTo: string
    now?: Date
  },
): Promise<KaruteWindowWithMonthProbe> {
  const [data, monthProbe] = await Promise.all([
    loadKaruteWindowRows(synqed, { storeId: opts.storeId, now: opts.now }).catch(
      (err: unknown) => {
        console.error('[loadKaruteWindowWithMonthProbe] window read failed:', err)
        return null
      },
    ),
    listSynqedKaruteRowsWithTotalOrThrow(synqed, {
      storeId: opts.storeId,
      from: opts.monthFrom,
      to: opts.monthTo,
      page_size: 1,
    }).catch((err: unknown) => {
      console.error('[loadKaruteWindowWithMonthProbe] 今月 probe failed:', err)
      return null
    }),
  ])
  return { data, monthProbe: monthProbe ? { total: monthProbe.total } : null }
}
