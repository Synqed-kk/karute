// 予約 date-jump panel — the pure state layer (packet L3).
//
// The panel is a calendar that can show ANY month, but the page only ever
// ships ONE month's cells (the 月 view's `monthData`). Everything else is
// fetched per month and cached here. The rule that makes the cache honest:
//
//   PENDING ≠ EMPTY. A month that has not loaded renders its day numbers with
//   no dots — never zero-count cells, which would read as "that month is
//   completely free". The status a cell's absence of dots means is carried by
//   the entry's `status`, which the panel turns into a visible line.
//
// Month keys are 'YYYY-MM' in JST: the panel is a Japanese business calendar,
// and the Vercel server / a traveler's browser both run elsewhere.

import type { MonthGridCell, MonthDensityBucket } from '@synqed-kk/ui'
import { partsInJst } from '@/lib/date/jst'
import { jstMidnight } from '@/lib/date/calendar-range'

/** 'YYYY-MM' in the JST calendar. */
export type MonthKey = string

/** Wire shape of a month cell — matches MonthCellDTO (app-api) exactly, so the
 *  facade GET's `monthData` needs no translation on the way in. */
export interface MonthCellData {
  id: string
  dateIso: string
  inMonth: boolean
  isToday: boolean
  count: number
  density: MonthDensityBucket
}

export interface MonthEntry {
  status: 'pending' | 'loaded' | 'failed'
  /** The last cells this month actually answered with, kept across a re-read:
   *  a revalidating month keeps showing its real dots rather than blinking
   *  back to bare day numbers. Absent = this month has never answered. */
  cells?: MonthGridCell[]
  /** Set on every open: these cells are still worth showing, but they are old
   *  enough to re-ask for. Cleared the moment the re-read starts. */
  stale?: boolean
}

export interface DateJumpState {
  visibleMonth: MonthKey
  level: 'grid' | 'months'
  /** The year whose twelve chips level 2 is showing. */
  year: number
  cache: ReadonlyMap<MonthKey, MonthEntry>
}

export type DateJumpAction =
  | { type: 'open'; month: MonthKey; seed?: MonthGridCell[] | null }
  | { type: 'shiftMonth'; delta: number }
  | { type: 'setMonth'; month: MonthKey }
  | { type: 'setLevel'; level: 'grid' | 'months' }
  | { type: 'shiftYear'; delta: number }
  | { type: 'pending'; month: MonthKey }
  | { type: 'loaded'; month: MonthKey; cells: MonthGridCell[] }
  | { type: 'failed'; month: MonthKey }

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM' for the JST calendar month containing `d`. */
export function monthKeyInJst(d: Date): MonthKey {
  const p = partsInJst(d)
  return `${p.year}-${pad2(p.month)}`
}

/** 'YYYY-MM' shifted by whole months, either direction. */
export function shiftMonthKey(key: MonthKey, delta: number): MonthKey {
  const [y, m] = splitMonthKey(key)
  const t = y * 12 + (m - 1) + delta
  return `${Math.floor(t / 12)}-${pad2((((t % 12) + 12) % 12) + 1)}`
}

export function monthKeyOf(year: number, month: number): MonthKey {
  return `${year}-${pad2(month)}`
}

export function splitMonthKey(key: MonthKey): [year: number, month: number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7))]
}

/** JST midnight of the 1st of `key` — the anchor every month-range helper and
 *  every month/year formatter takes. */
export function firstDayOfMonthKey(key: MonthKey): Date {
  const [y, m] = splitMonthKey(key)
  return jstMidnight(y, m, 1)
}

/** The facade/action wire shape → what MonthGrid renders. */
export function toMonthGridCells(cells: readonly MonthCellData[]): MonthGridCell[] {
  return cells.map((c) => ({
    id: c.id,
    date: new Date(c.dateIso),
    inMonth: c.inMonth,
    isToday: c.isToday,
    count: c.count,
    density: c.density,
  }))
}

export function initialDateJumpState(
  month: MonthKey,
  seed?: MonthGridCell[] | null,
): DateJumpState {
  return {
    visibleMonth: month,
    level: 'grid',
    year: splitMonthKey(month)[0],
    cache: seed ? new Map([[month, { status: 'loaded', cells: seed }]]) : new Map(),
  }
}

function withEntry(
  state: DateJumpState,
  month: MonthKey,
  entry: MonthEntry,
): DateJumpState {
  const cache = new Map(state.cache)
  cache.set(month, entry)
  return { ...state, cache }
}

export function dateJumpReducer(
  state: DateJumpState,
  action: DateJumpAction,
): DateJumpState {
  switch (action.type) {
    case 'open': {
      // Re-opening keeps whatever months were already fetched — the cache is
      // the whole point — but every one of them is now STALE: a booking made
      // since the last open must not leave the panel showing yesterday's
      // number. Stale is not empty: the cells stay on screen while the re-read
      // runs (no shimmer, no loading line), and only a month that has never
      // answered shows a status line at all.
      const cache = new Map<MonthKey, MonthEntry>()
      for (const [key, entry] of state.cache) cache.set(key, { ...entry, stale: true })
      // The seed (the page's own 月 data) was just built by the server — it is
      // the freshest truth for its month, so it replaces rather than ages.
      if (action.seed) cache.set(action.month, { status: 'loaded', cells: action.seed })
      return {
        ...state,
        visibleMonth: action.month,
        level: 'grid',
        year: splitMonthKey(action.month)[0],
        cache,
      }
    }
    case 'shiftMonth':
      return setMonth(state, shiftMonthKey(state.visibleMonth, action.delta))
    case 'setMonth':
      return setMonth(state, action.month)
    case 'setLevel':
      // Entering level 2 always starts on the visible month's year, so the
      // chips open where the user is rather than where they last paged to.
      return action.level === 'months'
        ? { ...state, level: 'months', year: splitMonthKey(state.visibleMonth)[0] }
        : { ...state, level: 'grid' }
    case 'shiftYear':
      return { ...state, year: state.year + action.delta }
    case 'pending':
      // Keeps whatever this month last answered with (and drops `stale`, so
      // the re-read is not offered a second time while it is running).
      return withEntry(state, action.month, {
        status: 'pending',
        cells: state.cache.get(action.month)?.cells,
      })
    case 'loaded':
      return withEntry(state, action.month, { status: 'loaded', cells: action.cells })
    case 'failed':
      // Same: a failed REFRESH leaves the real (if older) counts on screen
      // rather than blanking a month the staff member could already read.
      return withEntry(state, action.month, {
        status: 'failed',
        cells: state.cache.get(action.month)?.cells,
      })
  }
}

function setMonth(state: DateJumpState, month: MonthKey): DateJumpState {
  if (month === state.visibleMonth) return state
  return { ...state, visibleMonth: month, level: 'grid' }
}

/** A month is worth asking for when it has never answered, when its last
 *  answer was a failure, or when an open has aged it. */
function wants(entry: MonthEntry | undefined): boolean {
  return !entry || entry.status === 'failed' || entry.stale === true
}

/**
 * Which months to ask the host for RIGHT NOW.
 *
 * The visible month comes first and alone — its neighbours are prefetched only
 * once it has landed, so a slow network spends itself on the month the staff
 * member is looking at. A FAILED month is offered again, which is how a retry
 * happens on the next visit: the panel only re-asks when the visible month
 * changes or when it finishes loading, so a month that just failed is not
 * re-requested in a loop while it is on screen. A STALE month is offered on
 * exactly the same terms — that is what makes the counts refresh instead of
 * living as long as the page does.
 */
export function monthsToLoad(state: DateJumpState): MonthKey[] {
  const visible = state.cache.get(state.visibleMonth)
  if (wants(visible)) return [state.visibleMonth]
  if (visible?.status === 'pending') return []
  return [shiftMonthKey(state.visibleMonth, 1), shiftMonthKey(state.visibleMonth, -1)].filter(
    (key) => wants(state.cache.get(key)),
  )
}
