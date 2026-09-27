// ⚖ §v11 V11-1…V11-3 (the board fix, PR-A) — a practice store's OWN 営業時間 · 定休日, read off core's
// `weekly_hours`. Territory-local and pure: the fence denies territory `src/lib/operating-hours.ts`, so this
// restates the one reading door.ts needs from its `resolveDayHours` (no 臨時休業 dates, no org blob):
// `source: 'store'` there is 'core' here, anything else is 'sample'.

import type { CoreReads } from './core-reach'

export type WeeklyHours = Awaited<ReturnType<CoreReads['storePolicyGet']>>['weekly_hours']
/** What a practice plane serves for 営業時間 · 定休日 (null = no weekly closed day), and where it came from. */
export type StoreHours = { operatingHours: { open: number; close: number }; closedWeekday: number | null; hoursSource: 'core' | 'sample' }
export type StoreDay = { source: 'sample' } | { source: 'core'; closed: true } | { source: 'core'; closed: false; open: number; close: number }

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
 *  → sample · the day null or absent → 定休日 · a well-formed window → its minutes · a malformed one
 *  vouches for nothing → sample. */
export function resolveStoreDay(weekly: WeeklyHours | undefined, weekday: number): StoreDay {
  if (weekly == null || Object.keys(weekly).length === 0) return { source: 'sample' }
  const day = weekly[KEYS[weekday]]
  if (day == null) return { source: 'core', closed: true }
  const [open, close] = [minuteOf(day.open), minuteOf(day.close)]
  return open !== null && close !== null && open < close ? { source: 'core', closed: false, open, close } : { source: 'sample' }
}

/** 定休日 on the plane: the LOWEST weekday the store leaves null or absent; null = open every day. */
export function closedWeekdayOf(weekly: WeeklyHours | undefined): number | null {
  const wd = KEYS.findIndex((_, i) => {
    const d = resolveStoreDay(weekly, i)
    return d.source === 'core' && d.closed
  })
  return wd === -1 ? null : wd
}

/** The store's USUAL window: the most frequent (open, close) across its open weekdays; a tie → the earliest
 *  weekday's (日 = 0 first). null when no weekday opens. */
export function usualPairOf(weekly: WeeklyHours | undefined): { open: number; close: number } | null {
  const pairs = KEYS.flatMap((_, i) => {
    const d = resolveStoreDay(weekly, i)
    return d.source === 'core' && !d.closed ? [{ open: d.open, close: d.close }] : []
  })
  const count = (p: { open: number; close: number }) => pairs.filter((q) => q.open === p.open && q.close === p.close).length
  return pairs.reduce<{ open: number; close: number } | null>((best, p) => (best === null || count(p) > count(best) ? p : best), null)
}
