import { partsInJst } from './jst'

// JST-anchored calendar range math for the 予約 week / month views.
//
// The runtime is UTC on Vercel, so any raw Date getter/setter (getDate,
// setHours…) operates on the UTC calendar — NOT JST. The +09:00 offset in a
// date string is the safe way to pin a JST wall-clock instant. Subtracting
// WHOLE days off a JST-midnight instant is safe (it preserves the time-of-day,
// so the JST date shifts correctly); applying setHours is NOT (it rewrites the
// time-of-day in UTC). The old week/month rangeTo used setHours(23,59,59,999),
// which landed the end boundary at the last JST day's *morning* (~08:59 JST) —
// so every booking after the salon opened was excluded and the last day (often
// today) rendered empty. jstEndOfDay fixes that, matching the working day view.

const pad2 = (n: number) => String(n).padStart(2, '0')

/** A Date at JST midnight (00:00:00.000) for the given JST calendar y/m/d (month 1-12). */
export function jstMidnight(year: number, month: number, day: number): Date {
  return new Date(`${year}-${pad2(month)}-${pad2(day)}T00:00:00+09:00`)
}

/** A Date at the JST end-of-day (23:59:59.999) of the given Date's JST day. */
export function jstEndOfDay(d: Date): Date {
  const p = partsInJst(d)
  return new Date(
    `${p.year}-${pad2(p.month)}-${pad2(p.day)}T23:59:59.999+09:00`,
  )
}

export function computeWeekRange(selectedDate: Date): {
  weekStart: Date
  weekEnd: Date
  rangeFrom: Date
  rangeTo: Date
} {
  // Rolling 7-day window STARTING on the selected day (today by default), so
  // today is always first — a salon's week view is "today + the week ahead",
  // not a Sun→Sat grid. The < > arrows page by 7 days (see shiftDate).
  const p = partsInJst(selectedDate)
  const weekStart = jstMidnight(p.year, p.month, p.day)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const rangeFrom = new Date(weekStart)
  // End of the LAST JST day — was setHours(23,59,59,999) in UTC, which
  // truncated the last day to its JST morning and emptied it.
  const rangeTo = jstEndOfDay(weekEnd)
  return { weekStart, weekEnd, rangeFrom, rangeTo }
}

export function computeMonthRange(selectedDate: Date): {
  monthStart: Date
  monthEnd: Date
  rangeFrom: Date
  rangeTo: Date
} {
  const p = partsInJst(selectedDate)
  const monthStart = jstMidnight(p.year, p.month, 1)
  const daysInMonth = new Date(p.year, p.month, 0).getDate()
  const monthEnd = jstMidnight(p.year, p.month, daysInMonth)
  const rangeFrom = new Date(monthStart)
  rangeFrom.setDate(rangeFrom.getDate() - 7) // include leading days
  const rangeToBase = new Date(monthEnd)
  rangeToBase.setDate(rangeToBase.getDate() + 7) // include trailing days
  return { monthStart, monthEnd, rangeFrom, rangeTo: jstEndOfDay(rangeToBase) }
}
