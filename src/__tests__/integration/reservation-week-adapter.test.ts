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
    expect(monday.count).toBe(2) // both bucketed on Monday
    expect(monday.unconfirmed).toBe(0) // was 2 (mislabeled) before the fix
  })
})

describe('appointmentsToWeekData — new-customer count (was hardcoded 0)', () => {
  it('counts bookings whose customer is in the new-customer set', () => {
    const days = appointmentsToWeekData(
      [appt({ customer_id: 'new1' }), appt({ id: 'a2', customer_id: 'reg1' })],
      WEEK_START,
      WEEK_END,
      480,
      TODAY,
      'ja',
      new Set(['new1']),
    )
    expect(days[0].newCustomerCount).toBe(1)
  })

  it('defaults to 0 when no new-customer set is passed', () => {
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
