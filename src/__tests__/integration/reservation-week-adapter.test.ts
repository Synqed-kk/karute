/**
 * Coverage for appointmentsToWeekData — the week-overview adapter that feeds
 * @synqed-kk/ui's WeekDayCard.
 *
 * Proves the two fixes in fix/calendar-i18n-and-signals:
 *  1. weekdayLabel is localized via the new `locale` param (was a hardcoded
 *     English ['Sun'..'Sat'] array, so the JA calendar read "Sun/Mon").
 *  2. `unconfirmed` is always 0 — synqed has no unconfirmed/pending status
 *     (SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED); the old code mislabeled
 *     CANCELLED as "unconfirmed", surfacing cancelled bookings under a
 *     pending chip.
 */
import { appointmentsToWeekData } from '@/lib/adapters/reservation'
import { ymdInJst } from '@/lib/date/jst'
import type { Appointment } from '@synqed-kk/client'

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: '2024-06-03T01:00:00Z', // 10:00 JST, Mon Jun 3 2024
    ends_at: '2024-06-03T02:00:00Z',
    duration_minutes: 60,
    title: 'Cut',
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2024-05-01T00:00:00Z',
    updated_at: '2024-05-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

// Mon Jun 3 → Sun Jun 9 2024, framed at JST midnight boundaries.
const WEEK_START = new Date('2024-06-03T00:00:00+09:00')
const WEEK_END = new Date('2024-06-09T23:59:59+09:00')
const TODAY = new Date('2024-06-05T05:00:00Z')

describe('appointmentsToWeekData — locale-aware weekday (was hardcoded English)', () => {
  it('renders Japanese short weekdays for locale "ja"', () => {
    const days = appointmentsToWeekData([], WEEK_START, WEEK_END, 480, TODAY, 'ja')
    expect(days.map((d) => d.weekdayLabel)).toEqual([
      '月', '火', '水', '木', '金', '土', '日',
    ])
  })

  it('renders English short weekdays for locale "en"', () => {
    const days = appointmentsToWeekData([], WEEK_START, WEEK_END, 480, TODAY, 'en')
    expect(days.map((d) => d.weekdayLabel)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ])
  })
})

describe('appointmentsToWeekData — the fallback denominator counts COUNTED rows', () => {
  it("a BLOCK under another staffer no longer makes them 'working' (600, not 1200)", () => {
    // ⚠ DECLARED CHANGE (L4-2). availableMinutes on a NON-defensible day uses
    // the same arithmetic as before — businessHoursMinutes × max(1, staff who
    // worked) — but it now sees only the counted rows. On main this day handed
    // the adapter the BLOCK too, counted two staffers and answered 1200; 稼働%
    // therefore halved. A bed hold is not a second chair, so 600 is the truer
    // number. Pinned so the shift has a home instead of surprising 1b.
    const days = appointmentsToWeekData(
      [
        appt({ id: 'booking-1', staff_id: 'sA' }),
        appt({
          id: 'block-1',
          kind: 'BLOCK',
          customer_id: null,
          staff_id: 'sB',
          starts_at: '2024-06-03T04:00:00Z',
        } as Partial<Appointment>),
      ],
      WEEK_START,
      WEEK_END,
      600,
      TODAY,
      'ja',
    )
    expect(days[0].count).toBe(1)
    expect(days[0].availableMinutes).toBe(600)
    expect(days[0].capacityDefensible).toBe(false)
  })
})

describe('appointmentsToWeekData — unconfirmed is never the cancelled count', () => {
  it('keeps unconfirmed at 0 even with CANCELLED appointments', () => {
    const days = appointmentsToWeekData(
      [appt({ status: 'CANCELLED' }), appt({ id: 'a2', status: 'CANCELLED' })],
      WEEK_START,
      WEEK_END,
      480,
      TODAY,
      'ja',
    )
    const monday = days[0]
    // RE-PINNED (PKT-1a): this used to assert `count: 2`, i.e. the 件 number
    // counting two CANCELLED rows as bookings. That was the lie the 予約 numbers
    // foundation exists to end — a cancelled booking is a tombstone, not a
    // visit. The count is now 0; the cancellations are reported separately
    // through `cancelledCount` (see booking-count-parity.test.ts).
    expect(monday.count).toBe(0)
    expect(monday.unconfirmed).toBe(0) // was 2 (mislabeled) before the fix
  })
})

describe('appointmentsToWeekData — new-customer count (⚖ PKT-2: the day map)', () => {
  it('reads the day it is given out of the window map, never a customer set', () => {
    const days = appointmentsToWeekData(
      [appt({ customer_id: 'new1' }), appt({ id: 'a2', customer_id: 'reg1' })],
      WEEK_START,
      WEEK_END,
      480,
      TODAY,
      'ja',
      { byDay: new Map([[ymdInJst(WEEK_START), 1]]), known: true },
    )
    expect(days[0].newCustomerCount).toBe(1)
  })

  it('defaults to 0 when no new-count map is passed', () => {
    const days = appointmentsToWeekData([appt()], WEEK_START, WEEK_END, 480, TODAY, 'ja')
    expect(days[0].newCustomerCount).toBe(0)
  })
})

describe('appointmentsToWeekData — utilization capacity (was single-chair >100%)', () => {
  it('scales available minutes by the distinct staff working that day', () => {
    const days = appointmentsToWeekData(
      [appt({ staff_id: 's1' }), appt({ id: 'a2', staff_id: 's2' })],
      WEEK_START,
      WEEK_END,
      480,
      TODAY,
      'ja',
    )
    expect(days[0].availableMinutes).toBe(960) // 480 × 2 staff (was 480 → >100%)
  })

  it('treats an empty day as one staffer of capacity (no divide-by-zero)', () => {
    const days = appointmentsToWeekData([], WEEK_START, WEEK_END, 480, TODAY, 'ja')
    expect(days[0].availableMinutes).toBe(480)
  })
})
