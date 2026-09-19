/**
 * ⚖ THE 件 NUMBER IS ONE NUMBER (spec §8, PKT-1a).
 *
 * The month cell, the week row and the day line each used to count whatever
 * rows they were handed, so a BLOCK capacity hold (「オーナー業務」) or a
 * customerless row inflated one surface and not another, and CANCELLED rows
 * counted on the month grid. This suite is the parity pin: ONE fixture day, all
 * three surfaces, the same number.
 */
import { weekStartFor } from '@/lib/date/week-start'
import type { Appointment } from '@synqed-kk/client'
import {
  appointmentsToWeekData,
  appointmentsToMonthCells,
} from '@/lib/adapters/reservation'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import {
  getAppointmentsByDateWithClient,
  isCountedBooking,
} from '@/lib/appointments/by-date'

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

// 2 real bookings · 1 cancelled · 2 no-show · 1 BLOCK (no customer) · 1 booking
// with a customer and NO staff. The 件 number is 3: staff is optional, the
// tombstones are not visits, and a BLOCK is capacity, not a booking.
//
// The cancelled/no-show counts are deliberately ASYMMETRIC (1 vs 2). With one
// of each, swapping the two counters in the adapter passed this whole file —
// the suite only caught it through an unrelated route fixture (L2 own-1a).
const ROWS = [
  appt({ id: 'ok-1' }),
  appt({ id: 'ok-2', customer_id: 'c2', staff_id: 's2', starts_at: '2026-09-15T04:00:00Z' }),
  appt({ id: 'cancelled-1', customer_id: 'c3', status: 'CANCELLED' }),
  appt({ id: 'noshow-1', customer_id: 'c4', status: 'NO_SHOW' }),
  appt({ id: 'noshow-2', customer_id: 'c6', status: 'NO_SHOW', starts_at: '2026-09-15T06:00:00Z' }),
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
    const week = appointmentsToWeekData(counted, DAY, DAY, 480, TODAY, 'ja', { byDay: new Map(), known: true }, {
      cancelled,
      noShow,
    })
    expect(week).toHaveLength(1)
    expect(week[0].count).toBe(3)
    expect(week[0].cancelledCount).toBe(1)
    expect(week[0].noShowDayCount).toBe(2)

    const cells = appointmentsToMonthCells(counted, DAY, DAY, TODAY, undefined, weekStartFor('ja'))
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
    expect(screen.dayTotals?.noShowDayCount).toBe(2)
    expect(screen.dayTotals?.dateIso).toBe('2026-09-15')
  })

  it('a BLOCK row never counts, on any surface (mutant m1)', () => {
    const block = [appt({ id: 'block-only', kind: 'BLOCK', customer_id: null })]
    expect(appointmentsToWeekData(block, DAY, DAY, 480, TODAY, 'ja')[0].count).toBe(0)
    expect(
      appointmentsToMonthCells(block, DAY, DAY, TODAY, undefined, weekStartFor('ja')).find((c) => c.id === '2026-09-15')!
        .count,
    ).toBe(0)

    // The `kind` check standing on its OWN: core's type says customer_id is
    // null only on BLOCK rows, but the count must not lean on that. A hold that
    // names a customer is still a hold, not a visit.
    const blockWithCustomer = [appt({ id: 'block-named', kind: 'BLOCK' })]
    expect(isCountedBooking(blockWithCustomer[0])).toBe(false)
    expect(
      appointmentsToWeekData(blockWithCustomer, DAY, DAY, 480, TODAY, 'ja')[0].count,
    ).toBe(0)
    expect(
      appointmentsToMonthCells(blockWithCustomer, DAY, DAY, TODAY, undefined, weekStartFor('ja')).find(
        (c) => c.id === '2026-09-15',
      )!.count,
    ).toBe(0)
  })

  it('a customerless BOOKING row never counts (mutant m2)', () => {
    const nobody = [appt({ id: 'nobody', customer_id: null })]
    expect(appointmentsToWeekData(nobody, DAY, DAY, 480, TODAY, 'ja')[0].count).toBe(0)
    expect(
      appointmentsToMonthCells(nobody, DAY, DAY, TODAY, undefined, weekStartFor('ja')).find((c) => c.id === '2026-09-15')!
        .count,
    ).toBe(0)
  })

  it('a row with no `kind` at all reads as a BOOKING (pre-kind rows)', () => {
    const legacy = [{ ...appt({ id: 'legacy' }), kind: undefined } as unknown as Appointment]
    expect(isCountedBooking(legacy[0])).toBe(true)
  })
})

describe('the day LIST and the 件 number — one BLOCK rule, one declared gap', () => {
  /** A stand-in for core serving one JST day. */
  function dayClient(rows: Appointment[]) {
    return {
      appointments: { list: jest.fn(async () => ({ appointments: rows, total: rows.length })) },
      karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) },
      staff: { list: jest.fn(async () => ({ staff: [{ id: 's1', user_id: 'p1', name: '—' }], total: 1 })) },
    } as never
  }

  it('a BLOCK row carrying a customer is in NEITHER the day list nor 件', async () => {
    // AppointmentRow has no `kind` field, so before the guard this hold drew a
    // customer card on the agenda, offered itself to the recorder's booking
    // picker, and pushed 「本日の予約」 one above the week row's 件.
    const rows = [
      appt({ id: 'ok-1' }),
      appt({ id: 'block-named', kind: 'BLOCK', title: 'オーナー業務' }),
    ]
    const list = await getAppointmentsByDateWithClient(dayClient(rows), '2026-09-15', {
      nameById: new Map(),
    })
    expect(list.map((r) => r.id)).toEqual(['ok-1'])
    expect(rows.filter(isCountedBooking).map((a) => a.id)).toEqual(['ok-1'])
  })

  it('DECLARED DIVERGENCE: an unassigned booking counts in 件 but draws no lane', async () => {
    // Staff is optional for the COUNT (spec §8) and required by the day list,
    // which draws one lane per staffer. Out of scope for 1a — pinned so 1b
    // inherits a known number instead of a surprise.
    const rows = [appt({ id: 'ok-1' }), appt({ id: 'no-staff-1', customer_id: 'c5', staff_id: null })]
    const list = await getAppointmentsByDateWithClient(dayClient(rows), '2026-09-15', {
      nameById: new Map(),
    })
    expect(list.map((r) => r.id)).toEqual(['ok-1'])
    expect(rows.filter(isCountedBooking)).toHaveLength(2)
  })
})
