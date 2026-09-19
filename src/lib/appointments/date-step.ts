// The 予約 page's ‹ / › / swipe STEP — one day, one week, one month.
//
// Pure, and in its own file for one reason: the phone's neighbour prefetch
// (thin/data/screen-neighbours.ts) has to warm the EXACT dates this step
// lands on, and a second copy of the arithmetic would warm a cache key the
// page never reads. Importing it from the VIEW instead coupled the prefetch
// to a component every screen test mocks away.
import type { DayWeekMonthView } from '@synqed-kk/ui'
import { firstDayOfMonthKey, monthKeyInJst, shiftMonthKey } from './date-jump'

// Cursor delta for prev/next, tuned to the visible chrome. The week/month
// views advance the full unit; the day view advances one day.
//
// R2-1 (LENS-1 #1, HIGH) — 月 no longer advances via `next.setMonth()`: raw
// Date month arithmetic overflows from a 31st (8/31 › used to land on 10/1,
// skipping September whole; 3/31 ‹ didn't move at all). The month step goes
// through the SAME helpers `onPickMonth` in the view already uses — one home, no
// new date math — landing on the target month's 1st, or on `today` when the
// target IS the current month.
export function shiftAppointmentsDate(
  date: Date,
  view: DayWeekMonthView,
  dir: 1 | -1,
  today: Date,
): Date {
  if (view === 'day') {
    const next = new Date(date)
    next.setDate(next.getDate() + dir)
    return next
  }
  if (view === 'week') {
    const next = new Date(date)
    next.setDate(next.getDate() + dir * 7)
    return next
  }
  const targetKey = shiftMonthKey(monthKeyInJst(date), dir)
  return targetKey === monthKeyInJst(today) ? today : firstDayOfMonthKey(targetKey)
}
