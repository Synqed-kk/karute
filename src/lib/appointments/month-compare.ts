// 先月同期間比 — the month line's comparison clause (spec §8, packet PKT-1b-month
// PIECE 4c C1).
//
// The rule is SAME ELAPSED WINDOW, both months, and nothing else: on the 15th
// of a month you are comparing the 1st–15th against last month's 1st–15th, so
// the number answers "are we ahead of last month" instead of "is this month
// finished yet". A whole month against a part month was the one arithmetic the
// stress round killed outright (STRESS-D2 C1) — a 20th-of-the-month reader
// would have seen −40% every single month.
//
// The clause is an ANNOTATION, not an alarm (spec §v10): when the number cannot
// be honest it is ABSENT. Three ways that happens, all of them null here:
//   1. a month that has not happened yet (no elapsed window to compare),
//   2. either read truncated (a low number is the one lie a booking screen must
//      never tell — the same rule the counts themselves follow),
//   3. no honest BASE: last month has nothing in the compared window AND the
//      data shows no booking before that window at all, so "0" cannot be told
//      apart from "the shop was not taking bookings yet".

import type { Appointment } from '@synqed-kk/client'
import { isCountedBooking, type AppointmentWindow } from '@/lib/appointments/by-date'
import { jstEndOfDay, jstMidnight } from '@/lib/date/calendar-range'
import { partsInJst, ymdInJst } from '@/lib/date/jst'

export interface MonthCompareWindow {
  /** The extra read's boundaries. It starts SEVEN DAYS before the previous
   *  month — the same leading pad the month grid's own range carries — because
   *  a booking in those days is what separates an honest zero from a shop that
   *  was not open yet. It ends on the previous month's cut day: the compare
   *  never needs a row after that. */
  fromIso: string
  toIso: string
  /** The displayed month's compared span, JST YYYY-MM-DD, both ends inclusive. */
  currentFromYmd: string
  currentToYmd: string
  /** The previous month's compared span — the SAME number of elapsed days. */
  previousFromYmd: string
  previousToYmd: string
}

/** Days in a JST calendar month (1-12) — day 0 of the next month, the idiom
 *  computeMonthRange already uses (zone-independent: the same local calendar
 *  builds it and reads it). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

const ymd = (year: number, month: number, day: number): string =>
  ymdInJst(jstMidnight(year, month, day))

/**
 * The window the 先月同期間比 read needs for the month starting at `monthStart`,
 * or NULL when the clause cannot exist for that month at all — a future month
 * has no elapsed days to compare, so neither door fetches anything for it.
 *
 * Both doors call this: the fetch range and the counted spans are one answer to
 * one question, and a door that computed its own range could read a window the
 * arithmetic below then counts differently.
 */
export function monthCompareWindow(
  monthStart: Date,
  now: Date,
): MonthCompareWindow | null {
  const m = partsInJst(monthStart)
  const n = partsInJst(now)
  if (m.year > n.year || (m.year === n.year && m.month > n.month)) return null

  // The current month is compared only as far as TODAY; a month already over is
  // compared whole against whole.
  const isCurrentMonth = m.year === n.year && m.month === n.month
  const cutDay = isCurrentMonth ? n.day : daysInMonth(m.year, m.month)

  const prevYear = m.month === 1 ? m.year - 1 : m.year
  const prevMonth = m.month === 1 ? 12 : m.month - 1
  // A 31st has no twin in a 30-day month: the previous window ends on that
  // month's own last day, never on a date it does not have.
  const prevCutDay = Math.min(cutDay, daysInMonth(prevYear, prevMonth))

  const readFrom = jstMidnight(prevYear, prevMonth, 1)
  readFrom.setDate(readFrom.getDate() - 7)

  return {
    fromIso: readFrom.toISOString(),
    toIso: jstEndOfDay(jstMidnight(prevYear, prevMonth, prevCutDay)).toISOString(),
    currentFromYmd: ymd(m.year, m.month, 1),
    currentToYmd: ymd(m.year, m.month, cutDay),
    previousFromYmd: ymd(prevYear, prevMonth, 1),
    previousToYmd: ymd(prevYear, prevMonth, prevCutDay),
  }
}

/** Counted bookings whose JST day falls inside the span. `isCountedBooking` is
 *  re-applied rather than trusted — the SAME guard the month/week adapters put
 *  on rows a window already partitioned, so one 件 definition holds even if a
 *  caller ever hands over an unpartitioned array. */
function countBetween(
  rows: readonly Appointment[],
  fromYmd: string,
  toYmd: string,
): number {
  let n = 0
  for (const a of rows) {
    if (!isCountedBooking(a)) continue
    const day = ymdInJst(new Date(a.starts_at))
    if (day >= fromYmd && day <= toYmd) n += 1
  }
  return n
}

/** The earliest counted booking either read saw, as a JST YYYY-MM-DD, or null.
 *  The proxy for the shop's own age — the app has no "opened on" date. */
function earliestCountedYmd(...windows: readonly Appointment[][]): string | null {
  let earliest: string | null = null
  for (const rows of windows) {
    for (const a of rows) {
      if (!isCountedBooking(a)) continue
      const day = ymdInJst(new Date(a.starts_at))
      if (earliest === null || day < earliest) earliest = day
    }
  }
  return earliest
}

/**
 * 先月同期間比 as a signed 件 delta, or NULL when the clause must be absent.
 *
 * `current` is the displayed month's own window (the one the grid is drawn
 * from, so the clause and 「予約 N件」 can never disagree about a day);
 * `previous` is the extra read `monthCompareWindow` asked for.
 */
export function monthCompareDeltaFrom(
  window: MonthCompareWindow | null,
  current: AppointmentWindow | null | undefined,
  previous: AppointmentWindow | null | undefined,
): number | null {
  if (!window || !current || !previous) return null
  if (current.truncated || previous.truncated) return null

  const cur = countBetween(current.counted, window.currentFromYmd, window.currentToYmd)
  const prev = countBetween(previous.counted, window.previousFromYmd, window.previousToYmd)

  if (prev === 0) {
    // Zero last month is a real zero only if the shop was already taking
    // bookings BEFORE the compared window. Otherwise the honest answer is
    // "there is nothing to compare against", and 「+12件」 against a shop that
    // did not exist would be a made-up fact.
    const earliest = earliestCountedYmd(previous.counted, current.counted)
    if (earliest === null || earliest >= window.previousFromYmd) return null
  }

  return cur - prev
}
