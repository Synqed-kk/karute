/**
 * ⚖ W0.5 (PR A) — bookingsOutsideHours, the read W2 needs before a store
 * shortens a day: which bookings would the proposed hours strand? Pure; no
 * caller in this PR beyond this test.
 *
 * Pinned to TZ=UTC to mirror the deploy runtime.
 */
process.env.TZ = 'UTC'

import { bookingsOutsideHours, type DayHoursFact } from '@/lib/operating-hours'

/** Tomorrow = 2026-09-16 (JST), proposed to close at 17:00. */
const TOMORROW = '2026-09-16'
const CLOSE_1700: DayHoursFact = {
  minutes: 420,
  openMinute: 600,
  closeMinute: 1020,
  saved: true,
  source: 'store',
  closed: false,
}
const row = (id: string, startJst: string, endJst: string) => ({
  id,
  starts_at: new Date(`${startJst}+09:00`).toISOString(),
  ends_at: new Date(`${endJst}+09:00`).toISOString(),
})

const AT_1600 = row('16:00', '2026-09-16T16:00:00', '2026-09-16T17:00:00')
const AT_1800 = row('18:00', '2026-09-16T18:00:00', '2026-09-16T19:00:00')
const STRADDLE = row('16:30', '2026-09-16T16:30:00', '2026-09-16T17:30:00')
const EARLY = row('09:30', '2026-09-16T09:30:00', '2026-09-16T10:30:00')
const OTHER_DAY = row('other', '2026-09-15T18:00:00', '2026-09-15T19:00:00')
const RUN_IN = row('run-in', '2026-09-15T23:30:00', '2026-09-16T00:30:00')

describe('P4 — closing tomorrow at 17:00 when an 18:00 booking exists', () => {
  it('returns the 18:00 booking and NOT the 16:00 one', () => {
    expect(bookingsOutsideHours([AT_1600, AT_1800], CLOSE_1700, TOMORROW)).toEqual([AT_1800])
  })

  it('a booking straddling the new close, or before the open, is stranded too', () => {
    expect(
      bookingsOutsideHours([AT_1600, STRADDLE, EARLY], CLOSE_1700, TOMORROW).map((b) => b.id),
    ).toEqual(['16:30', '09:30'])
  })

  it('another day’s booking is not this day’s question', () => {
    expect(bookingsOutsideHours([OTHER_DAY], CLOSE_1700, TOMORROW)).toEqual([])
  })

  it('a booking running in from last night is judged by its part on this day (00:00–00:30 < 10:00)', () => {
    expect(bookingsOutsideHours([RUN_IN], CLOSE_1700, TOMORROW)).toEqual([RUN_IN])
    // …and on the night it started it fits a day open until 24:00.
    expect(
      bookingsOutsideHours(
        [RUN_IN],
        { ...CLOSE_1700, openMinute: 600, closeMinute: 1440, minutes: 840 },
        '2026-09-15',
      ),
    ).toEqual([])
  })

  it('a CLOSED fact strands every booking that touches the day', () => {
    const closed: DayHoursFact = {
      minutes: 0,
      openMinute: 0,
      closeMinute: 0,
      saved: true,
      source: 'store',
      closed: true,
      kind: 'closed_date',
    }
    expect(
      bookingsOutsideHours([AT_1600, AT_1800, OTHER_DAY, RUN_IN], closed, TOMORROW).map((b) => b.id),
    ).toEqual(['16:00', '18:00', 'run-in'])
  })

  it('rows that do not parse or do not run forwards, and a day that is not a day, strand nothing', () => {
    const junk = [
      { id: 'nan', starts_at: 'x', ends_at: 'y' },
      { id: 'inverted', starts_at: AT_1800.ends_at, ends_at: AT_1800.starts_at },
    ]
    expect(bookingsOutsideHours(junk, CLOSE_1700, TOMORROW)).toEqual([])
    expect(bookingsOutsideHours([AT_1800], CLOSE_1700, '2026-02-30')).toEqual([])
    expect(bookingsOutsideHours([AT_1800], CLOSE_1700, 'tomorrow')).toEqual([])
  })
})
