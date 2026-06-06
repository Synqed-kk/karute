/**
 * JST-anchored week/month range math (src/lib/date/calendar-range.ts).
 *
 * Proves the fix for: the LAST day of the week (today, a Saturday) rendering
 * 予約なし. The old rangeTo used setHours(23,59,59,999) on the UTC runtime, so
 * for a Sun→Sat week it ended at the last JST day's MORNING (~08:59 JST) and
 * excluded every booking after the salon opened.
 *
 * Pinned to TZ=UTC to mirror the Vercel runtime (startOfWeekSun's whole-day
 * setDate math is UTC-runtime-anchored, exactly like production).
 */
process.env.TZ = 'UTC'

import {
  computeWeekRange,
  computeMonthRange,
  jstEndOfDay,
} from '@/lib/date/calendar-range'
import { partsInJst } from '@/lib/date/jst'

describe('computeWeekRange — the empty-today bug', () => {
  // Today = Sat 2026-06-06 JST (the reported case).
  const selected = new Date('2026-06-06T00:00:00+09:00')
  const { weekStart, weekEnd, rangeFrom, rangeTo } = computeWeekRange(selected)

  it('spans Sun 5/31 → Sat 6/6 in JST', () => {
    const s = partsInJst(weekStart)
    const e = partsInJst(weekEnd)
    expect([s.month, s.day, s.weekday]).toEqual([5, 31, 0]) // Sunday May 31
    expect([e.month, e.day, e.weekday]).toEqual([6, 6, 6]) // Saturday June 6
  })

  it('rangeTo covers the FULL last JST day (was truncated to 08:59 JST)', () => {
    expect(rangeFrom.toISOString()).toBe('2026-05-30T15:00:00.000Z') // 5/31 00:00 JST
    expect(rangeTo.toISOString()).toBe('2026-06-06T14:59:59.999Z') // 6/6 23:59:59.999 JST
  })

  it('includes a 10:00-JST booking on the last day — the bug excluded it', () => {
    const booking = new Date('2026-06-06T10:00:00+09:00') // = 2026-06-06T01:00:00Z
    expect(booking >= rangeFrom && booking <= rangeTo).toBe(true)
    // The old UTC setHours boundary ended at 2026-06-05T23:59:59.999Z — BEFORE
    // this booking — which is exactly why today rendered empty.
    const oldBuggyEnd = new Date('2026-06-05T23:59:59.999Z')
    expect(booking.getTime()).toBeGreaterThan(oldBuggyEnd.getTime())
  })
})

describe('computeMonthRange — JST end boundary', () => {
  it('anchors rangeTo to a JST end-of-day (…14:59:59.999Z), not UTC midnight', () => {
    const { rangeTo } = computeMonthRange(new Date('2026-06-15T00:00:00+09:00'))
    expect(rangeTo.toISOString().endsWith('14:59:59.999Z')).toBe(true)
  })
})

describe('jstEndOfDay', () => {
  it('returns 23:59:59.999 JST regardless of the input time-of-day', () => {
    expect(
      jstEndOfDay(new Date('2026-06-06T03:00:00+09:00')).toISOString(),
    ).toBe('2026-06-06T14:59:59.999Z')
  })
})
