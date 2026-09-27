// ⚖ §v11 V11-1…V11-3 + V11-7 (the board fix, PR-A) — a practice store's OWN 営業時間 · 定休日, read off core's
// `weekly_hours`. Territory-local and pure: the fence denies territory `src/lib/operating-hours.ts`, so this
// restates the one reading door.ts needs from its `resolveDayHours` (no 臨時休業 dates, no org blob):
// `source: 'store'` there is 'core' here, anything else is 'sample'.

import type { CoreReads } from './core-reach'

export type WeeklyHours = Awaited<ReturnType<CoreReads['storePolicyGet']>>['weekly_hours']
export type Window = { open: number; close: number }
/** ⚖ §v11 V11-7 — THE WEEK: seven entries, 0 = 日 … 6 = 土, each window in JST minutes or null (closed). */
export type Week = Array<Window | null>
/** What a practice plane serves for 営業時間 · 定休日, and where it came from: the SHOWN day's pair (a closed day: the
 *  usual pair), the week, and its closed weekdays ascending ([] = open every day). */
export type StoreHours = { operatingHours: Window; weeklyHours: Week; closedWeekdays: number[]; hoursSource: 'core' | 'sample' }
export type StoreDay =
  | { source: 'sample' }
  | { source: 'core'; closed: true }
  | { source: 'core'; closed: false; open: number; close: number }
  | { source: 'core'; malformed: true }

/** `Date#getDay` numbering, 0 = 日 … 6 = 土 — the app's own (operating-hours.ts `JS_DAY_TO_KEY`). */
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
/** The weekday of a JST day index (whole JST days since 1970-01-01, which was a Thursday). */
export const weekdayOfKey = (dayKey: number): number => new Date(dayKey * 86_400_000).getUTCDay()

/** 'HH:MM' → minutes from midnight; core allows 24:00 = 1440. null when malformed. */
function minuteOf(value: unknown): number | null {
  const m = typeof value === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(value) : null
  const total = m && Number(m[2]) <= 59 ? Number(m[1]) * 60 + Number(m[2]) : null
  return total !== null && total <= 1440 ? total : null
}

/** One weekday of a store's week, read as `resolveDayHours` reads it: no hours at all (null, no row, `{}`)
 *  → sample · the day null or absent → 定休日 · a well-formed window → its minutes · a malformed one vouches
 *  for nothing → malformed (there: falls through to the org blob / 10:00–24:00 default, never closed). */
export function resolveStoreDay(weekly: WeeklyHours | undefined, weekday: number): StoreDay {
  if (weekly == null || Object.keys(weekly).length === 0) return { source: 'sample' }
  const day = weekly[KEYS[weekday]]
  if (day == null) return { source: 'core', closed: true }
  const [open, close] = [minuteOf(day.open), minuteOf(day.close)]
  return open !== null && close !== null && open < close ? { source: 'core', closed: false, open, close } : { source: 'core', malformed: true }
}

/** Core's week, normalized — each weekday read as `resolveStoreDay` reads it; a MALFORMED weekday is null here and
 *  named in `malformed` (V11-2a, amended 17:0x: it never takes the other days with it — the door serves it per day).
 *  null = no core week, and the plane serves the sample set: no hours at all, or no well-formed weekday that opens
 *  (V11-2b). */
export function weekOf(weekly: WeeklyHours | undefined): { week: Week; malformed: number[] } | null {
  const days = KEYS.map((_, wd) => resolveStoreDay(weekly, wd))
  const week = days.map((d) => ('open' in d ? { open: d.open, close: d.close } : null))
  const malformed = days.flatMap((d, wd) => ('malformed' in d ? [wd] : []))
  return days[0].source === 'sample' || week.every((d) => d === null) ? null : { week, malformed }
}

/** The sample (and OFF) week: the one pair on every weekday but the closed ones — the week `weeklyHoursFrom` builds. */
export const weekFromPair = (pair: Window, closed: number[]): Week => KEYS.map((_, wd) => (closed.includes(wd) ? null : { open: pair.open, close: pair.close }))

/** 定休日 on the plane: every weekday the week leaves null, ascending; [] = open every day. */
export const closedWeekdaysOf = (week: Week): number[] => week.flatMap((d, wd) => (d === null ? [wd] : []))

/** The store's USUAL window: the most frequent (open, close) across its open weekdays; a tie → the earliest
 *  weekday's (日 = 0 first). null when no weekday opens. */
export function usualPairOf(week: Week): Window | null {
  const pairs = week.filter((d): d is Window => d !== null)
  const count = (p: Window) => pairs.filter((q) => q.open === p.open && q.close === p.close).length
  return pairs.reduce<Window | null>((best, p) => (best === null || count(p) > count(best) ? p : best), null)
}
