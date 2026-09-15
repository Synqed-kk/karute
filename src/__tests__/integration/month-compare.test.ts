/**
 * PIECE 4c C1 — 先月同期間比, the SAME ELAPSED WINDOW on both sides.
 *
 * The clause's whole value is that it is honest on the 5th of the month, which
 * is exactly when the obvious arithmetic lies: a whole previous month against a
 * five-day-old one reads as a collapse every month and a recovery on the last
 * day of it (STRESS-D2 C1, the dead round this file pins shut).
 *
 * Runs under TZ=UTC like the rest of the suite, so every date below is also a
 * check that the JST calendar — not the runtime's — decides which day a booking
 * and a month boundary belong to.
 */
import type { Appointment } from '@synqed-kk/client'
import {
  monthCompareDeltaFrom,
  monthCompareWindow,
} from '@/lib/appointments/month-compare'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { computeMonthRange, computeWeekRange } from '@/lib/date/calendar-range'
import { ymdInJst } from '@/lib/date/jst'

/** A counted booking at 10:00 JST on the given JST day. */
function appt(dayYmd: string, id = dayYmd): Appointment {
  return {
    id,
    kind: 'BOOKING',
    customer_id: `c-${id}`,
    staff_id: 's1',
    starts_at: new Date(`${dayYmd}T10:00:00+09:00`).toISOString(),
    ends_at: new Date(`${dayYmd}T11:00:00+09:00`).toISOString(),
    duration_minutes: 60,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as Appointment
}

/** n counted bookings spread one per day from `fromDay` of `month` (`tag` only
 *  keeps the ids distinct when two batches share days). */
function days(month: string, fromDay: number, n: number, tag = 'a'): Appointment[] {
  return Array.from({ length: n }, (_, i) =>
    appt(`${month}-${String(fromDay + i).padStart(2, '0')}`, `${month}-${tag}${i}`),
  )
}

const win = (counted: Appointment[], truncated = false) => ({
  counted,
  cancelled: [],
  noShow: [],
  truncated,
})

const NOW = new Date('2026-09-15T12:00:00+09:00') // the 15th, JST
const SEP = new Date('2026-09-01T00:00:00+09:00')

describe('monthCompareWindow — the compared spans', () => {
  it('the CURRENT month is compared only as far as today, and so is last month', () => {
    const w = monthCompareWindow(SEP, NOW)!
    expect(w.currentFromYmd).toBe('2026-09-01')
    expect(w.currentToYmd).toBe('2026-09-15')
    expect(w.previousFromYmd).toBe('2026-08-01')
    expect(w.previousToYmd).toBe('2026-08-15')
    // The read stops at last month's cut day and starts seven days early — the
    // pad that lets an empty August be told apart from a shop that opened in
    // August (the honest-base rule below).
    expect(ymdInJst(new Date(w.fromIso))).toBe('2026-07-25')
    expect(ymdInJst(new Date(w.toIso))).toBe('2026-08-15')
  })

  it('a month already over is whole against whole', () => {
    const w = monthCompareWindow(new Date('2026-07-01T00:00:00+09:00'), NOW)!
    expect([w.currentFromYmd, w.currentToYmd]).toEqual(['2026-07-01', '2026-07-31'])
    expect([w.previousFromYmd, w.previousToYmd]).toEqual(['2026-06-01', '2026-06-30'])
  })

  it('DAY 1 of the current month compares one day against one day', () => {
    const w = monthCompareWindow(SEP, new Date('2026-09-01T09:00:00+09:00'))!
    expect([w.currentFromYmd, w.currentToYmd]).toEqual(['2026-09-01', '2026-09-01'])
    expect([w.previousFromYmd, w.previousToYmd]).toEqual(['2026-08-01', '2026-08-01'])
  })

  it('a 31st has no twin in a 30-day month, so the previous span ends on its last day', () => {
    const w = monthCompareWindow(
      new Date('2026-07-01T00:00:00+09:00'),
      new Date('2026-07-31T12:00:00+09:00'),
    )!
    expect([w.currentFromYmd, w.currentToYmd]).toEqual(['2026-07-01', '2026-07-31'])
    expect([w.previousFromYmd, w.previousToYmd]).toEqual(['2026-06-01', '2026-06-30'])
  })

  it('January reaches back into the previous YEAR', () => {
    const w = monthCompareWindow(
      new Date('2026-01-01T00:00:00+09:00'),
      new Date('2026-01-10T12:00:00+09:00'),
    )!
    expect([w.previousFromYmd, w.previousToYmd]).toEqual(['2025-12-01', '2025-12-10'])
  })

  it('a FUTURE month has no elapsed window — null, so neither door fetches', () => {
    expect(monthCompareWindow(new Date('2026-10-01T00:00:00+09:00'), NOW)).toBeNull()
    expect(monthCompareWindow(new Date('2027-01-01T00:00:00+09:00'), NOW)).toBeNull()
  })
})

describe('monthCompareDeltaFrom — the number', () => {
  const w = monthCompareWindow(SEP, NOW)!

  it('compares the same elapsed span, NOT this month against the whole of last', () => {
    // 20 bookings in Sept 1-15; August had 8 in its first 15 days and 16 more
    // after them. The honest answer is +12; whole-against-part would be −4.
    const current = win([...days('2026-09', 1, 15), ...days('2026-09', 1, 5, 'b')])
    const previous = win([...days('2026-08', 1, 8), ...days('2026-08', 16, 16, 'b')])
    expect(monthCompareDeltaFrom(w, current, previous)).toBe(12)
  })

  it('counts nothing outside the compared spans — the month grid s leading days included', () => {
    // The month window deliberately over-reads seven days either side of the
    // month; those days belong to their OWN month, never to this comparison.
    const current = win([...days('2026-08', 26, 5), ...days('2026-09', 1, 3)])
    const previous = win(days('2026-08', 1, 3))
    expect(monthCompareDeltaFrom(w, current, previous)).toBe(0)
  })

  it('a quiet month is a MINUS, and it is still a number', () => {
    expect(
      monthCompareDeltaFrom(w, win(days('2026-09', 1, 2)), win(days('2026-08', 1, 9))),
    ).toBe(-7)
  })

  it('an equal month is ±0, never absent', () => {
    expect(
      monthCompareDeltaFrom(w, win(days('2026-09', 1, 4)), win(days('2026-08', 1, 4))),
    ).toBe(0)
  })

  it('does not count a BLOCK, a customerless row or a tombstone (one 件 definition)', () => {
    const block = { ...appt('2026-08-03'), kind: 'BLOCK' } as Appointment
    const nobody = { ...appt('2026-08-04'), customer_id: null } as unknown as Appointment
    const gone = { ...appt('2026-08-05'), status: 'CANCELLED' } as Appointment
    const previous = win([...days('2026-08', 1, 2), block, nobody, gone])
    expect(monthCompareDeltaFrom(w, win(days('2026-09', 1, 2)), previous)).toBe(0)
  })

  it('EITHER read truncated = absent, never a low number', () => {
    const current = win(days('2026-09', 1, 9))
    const previous = win(days('2026-08', 1, 3))
    expect(monthCompareDeltaFrom(w, win([], true), previous)).toBeNull()
    expect(monthCompareDeltaFrom(w, current, win([], true))).toBeNull()
  })

  it('no window and no previous read = absent', () => {
    expect(monthCompareDeltaFrom(null, win([]), win([]))).toBeNull()
    expect(monthCompareDeltaFrom(w, win(days('2026-09', 1, 3)), null)).toBeNull()
  })

  describe('no honest BASE', () => {
    it('a shop with nothing before the compared window gets NO clause', () => {
      // August empty and the earliest booking anywhere is in September: "0 last
      // month" cannot be told apart from "we were not here yet", and 「+9件」
      // against a shop that did not exist is a made-up fact.
      expect(
        monthCompareDeltaFrom(w, win(days('2026-09', 1, 9)), win([])),
      ).toBeNull()
    })

    it('a first-ever booking AFTER the compared window is still no base', () => {
      // The shop opened on August 20th — after the 1st-15th being compared.
      const previous = win(days('2026-08', 20, 4))
      expect(monthCompareDeltaFrom(w, win(days('2026-09', 1, 9)), previous)).toBeNull()
    })

    it('but a booking BEFORE it proves the zero is real, and the clause appears', () => {
      // July 28th is inside the read's seven-day pad: the shop was taking
      // bookings before August, so an empty August 1-15 is an honest zero.
      const previous = win([appt('2026-07-28')])
      expect(monthCompareDeltaFrom(w, win(days('2026-09', 1, 9)), previous)).toBe(9)
    })
  })
})

describe('buildAppointmentsScreen — monthCompareDelta reaches both doors', () => {
  const base = {
    locale: 'ja',
    now: NOW,
    selectedDate: new Date('2026-09-15T00:00:00+09:00'),
    staffFilter: 'all',
    staffList: [],
    activeStaffId: null,
    storeStaffIds: null,
    orgSettings: null,
    customers: [],
    dayAppointments: [],
    weekRange: null,
    monthRange: null,
    weekRangeAppts: null,
    monthRangeAppts: null,
    enrichment: new Map(),
    packUsage: new Map(),
  } as unknown as Parameters<typeof buildAppointmentsScreen>[0]

  const monthWindow = win([...days('2026-09', 1, 6), appt('2026-08-30')])
  const prevMonthWindow = win([...days('2026-08', 1, 2), appt('2026-07-30')])

  it('is derived in MONTH view from the same window the grid is drawn from', () => {
    const screen = buildAppointmentsScreen({
      ...base,
      monthRange: computeMonthRange(base.selectedDate),
      monthWindow,
      prevMonthWindow,
    })
    expect(screen.monthCompareDelta).toBe(4)
    // …and the clause agrees with the line's own total about which rows count:
    // the August 30th row is in the window and in neither number.
    expect(screen.monthData!.reduce((n, c) => (c.inMonth ? n + c.count : n), 0)).toBe(6)
  })

  it('is null in day and week view — the clause lives on the month line only', () => {
    expect(buildAppointmentsScreen({ ...base }).monthCompareDelta).toBeNull()
    expect(
      buildAppointmentsScreen({
        ...base,
        weekRange: computeWeekRange(base.selectedDate),
        weekWindow: win(days('2026-09', 15, 3)),
        prevMonthWindow,
      }).monthCompareDelta,
    ).toBeNull()
  })

  it('is null when the previous read never happened (switch off / future month)', () => {
    expect(
      buildAppointmentsScreen({
        ...base,
        monthRange: computeMonthRange(base.selectedDate),
        monthWindow,
      }).monthCompareDelta,
    ).toBeNull()
  })

  it('is null on a truncated month read, alongside the nulled grid', () => {
    const screen = buildAppointmentsScreen({
      ...base,
      monthRange: computeMonthRange(base.selectedDate),
      monthWindow: win([], true),
      prevMonthWindow,
    })
    expect(screen.truncated).toBe(true)
    expect(screen.monthData).toBeNull()
    expect(screen.monthCompareDelta).toBeNull()
  })
})
