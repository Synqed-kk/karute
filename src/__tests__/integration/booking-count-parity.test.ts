/**
 * ⚖ THE 件 NUMBER IS ONE NUMBER (spec §8, PKT-1a).
 *
 * The month cell, the week row and the day line each used to count whatever
 * rows they were handed, so a BLOCK capacity hold (「オーナー業務」) or a
 * customerless row inflated one surface and not another, and CANCELLED rows
 * counted on the month grid. This suite is the parity pin: ONE fixture day, all
 * three surfaces, the same number.
 */
import type { Appointment } from '@synqed-kk/client'
import {
  appointmentsToWeekData,
  appointmentsToMonthCells,
} from '@/lib/adapters/reservation'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { isCountedBooking } from '@/lib/appointments/by-date'

// Tue 2026-09-15 JST.
const DAY = new Date('2026-09-15T00:00:00+09:00')
const TODAY = new Date('2026-09-15T05:00:00+09:00')

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: '2026-09-15T01:00:00Z', // 10:00 JST
    ends_at: '2026-09-15T02:00:00Z',
    duration_minutes: 60,
    title: 'カット',
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

// 2 real bookings · 1 cancelled · 1 no-show · 1 BLOCK (no customer) · 1 booking
// with a customer and NO staff. The 件 number is 3: staff is optional, the two
// tombstones are not visits, and a BLOCK is capacity, not a booking.
const ROWS = [
  appt({ id: 'ok-1' }),
  appt({ id: 'ok-2', customer_id: 'c2', staff_id: 's2', starts_at: '2026-09-15T04:00:00Z' }),
  appt({ id: 'cancelled-1', customer_id: 'c3', status: 'CANCELLED' }),
  appt({ id: 'noshow-1', customer_id: 'c4', status: 'NO_SHOW' }),
  appt({ id: 'block-1', kind: 'BLOCK', customer_id: null, title: 'オーナー業務' }),
  // NOTE: the day LIST drops this unassigned row (it has no lane to draw), which
  // is existing rendering behaviour and out of scope here. The COUNT keeps it.
  appt({ id: 'no-staff-1', customer_id: 'c5', staff_id: null }),
]

const counted = ROWS.filter(isCountedBooking)
const cancelled = ROWS.filter((a) => a.status === 'CANCELLED' && a.customer_id != null)
const noShow = ROWS.filter((a) => a.status === 'NO_SHOW' && a.customer_id != null)

describe('件 parity — month cell, week row and day total are ONE number', () => {
  it('counts 3: tombstones, the BLOCK hold and nothing else are excluded', () => {
    const week = appointmentsToWeekData(counted, DAY, DAY, 480, TODAY, 'ja', new Set(), {
      cancelled,
      noShow,
    })
    expect(week).toHaveLength(1)
    expect(week[0].count).toBe(3)
    expect(week[0].cancelledCount).toBe(1)
    expect(week[0].noShowDayCount).toBe(1)

    const cells = appointmentsToMonthCells(counted, DAY, DAY, TODAY)
    const cell = cells.find((c) => c.id === '2026-09-15')!
    expect(cell.count).toBe(3)

    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: TODAY,
      selectedDate: DAY,
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
      dayWindow: { counted, cancelled, noShow, truncated: false },
      enrichment: new Map(),
      packUsage: new Map(),
    })
    expect(screen.dayTotals?.count).toBe(3)
    expect(screen.dayTotals?.cancelledCount).toBe(1)
    expect(screen.dayTotals?.noShowDayCount).toBe(1)
    expect(screen.dayTotals?.dateIso).toBe('2026-09-15')
  })

  it('a BLOCK row never counts, on any surface (mutant m1)', () => {
    const block = [appt({ id: 'block-only', kind: 'BLOCK', customer_id: null })]
    expect(appointmentsToWeekData(block, DAY, DAY, 480, TODAY, 'ja')[0].count).toBe(0)
    expect(
      appointmentsToMonthCells(block, DAY, DAY, TODAY).find((c) => c.id === '2026-09-15')!
        .count,
    ).toBe(0)
  })

  it('a customerless BOOKING row never counts (mutant m2)', () => {
    const nobody = [appt({ id: 'nobody', customer_id: null })]
    expect(appointmentsToWeekData(nobody, DAY, DAY, 480, TODAY, 'ja')[0].count).toBe(0)
    expect(
      appointmentsToMonthCells(nobody, DAY, DAY, TODAY).find((c) => c.id === '2026-09-15')!
        .count,
    ).toBe(0)
  })

  it('a row with no `kind` at all reads as a BOOKING (pre-kind rows)', () => {
    const legacy = [{ ...appt({ id: 'legacy' }), kind: undefined } as unknown as Appointment]
    expect(isCountedBooking(legacy[0])).toBe(true)
  })
})
