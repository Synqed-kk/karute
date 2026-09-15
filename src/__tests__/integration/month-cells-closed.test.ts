/**
 * A2 — the 休 fact reaches a MONTH cell from the SAME map the week row reads.
 *
 * The month grid and the week rows answer the same question about the same
 * day ("was the salon open?"), and until this slice the month cell could not
 * answer it at all. The risk of adding the field is a SECOND source: a month
 * cell that says 休 while that day's week row says open. So the proof below is
 * not "the flag arrives" — it is "both surfaces read one map and agree", plus
 * the lead ruling that a closed day WITH bookings is not a 休 cell.
 */
import type { Appointment } from '@synqed-kk/client'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { appointmentsToMonthCells } from '@/lib/adapters/reservation'
import { computeMonthRange, computeWeekRange } from '@/lib/date/calendar-range'
import type { DayHoursFact } from '@/lib/operating-hours'

const SELECTED = new Date('2026-09-15T00:00:00+09:00')
const NOW = new Date('2026-09-15T05:00:00+09:00')

/** 2026-09-16 (水) is the closed day in every fixture below. */
const CLOSED_YMD = '2026-09-16'

function appt(id: string, startsAt: string): Appointment {
  return {
    id,
    kind: 'BOOKING',
    customer_id: `c-${id}`,
    staff_id: 's1',
    starts_at: startsAt,
    ends_at: startsAt,
    duration_minutes: 60,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  } as unknown as Appointment
}

const OPEN_FACT: DayHoursFact = {
  minutes: 600,
  openMinute: 600,
  closeMinute: 1200,
  saved: true,
  closed: false,
}
const CLOSED_FACT: DayHoursFact = {
  minutes: 0,
  openMinute: 0,
  closeMinute: 0,
  saved: true,
  closed: true,
}

/** Every day of the month window open, except CLOSED_YMD. */
function hoursFacts(): Map<string, DayHoursFact> {
  const map = new Map<string, DayHoursFact>()
  for (let d = 1; d <= 30; d += 1) {
    const ymd = `2026-09-${String(d).padStart(2, '0')}`
    map.set(ymd, ymd === CLOSED_YMD ? CLOSED_FACT : OPEN_FACT)
  }
  return map
}

const base = {
  locale: 'ja',
  now: NOW,
  selectedDate: SELECTED,
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
  hoursFacts: hoursFacts(),
} as unknown as Parameters<typeof buildAppointmentsScreen>[0]

const WHOLE = { counted: [], cancelled: [], noShow: [], truncated: false }

describe('appointmentsToMonthCells — the closed fact', () => {
  const { monthStart, monthEnd } = computeMonthRange(SELECTED)

  it('marks a closed day and leaves every other in-month day open', () => {
    const cells = appointmentsToMonthCells([], monthStart, monthEnd, NOW, hoursFacts())
    const closed = cells.filter((c) => c.closed)
    expect(closed.map((c) => c.id)).toEqual([CLOSED_YMD])
  })

  it('without a hours map no cell claims to be closed (today s behaviour)', () => {
    const cells = appointmentsToMonthCells([], monthStart, monthEnd, NOW)
    expect(cells.some((c) => c.closed)).toBe(false)
  })

  it('an OUT-of-month cell never carries a closed flag — it renders nothing', () => {
    // The map covers September only, but the grid's leading/trailing cells are
    // August/October days: an out cell must not inherit a neighbour month's
    // answer, and it has no marker to show one with.
    const cells = appointmentsToMonthCells([], monthStart, monthEnd, NOW, hoursFacts())
    expect(cells.filter((c) => !c.inMonth).every((c) => c.closed === false)).toBe(true)
  })

  it('a closed day WITH bookings keeps its count — the 休 decision is the renderer s', () => {
    // ⚖ lead ruling (spec §8): the bookings are real, so the DATA says both
    // things and the cell shows numbers. If the adapter zeroed the count here,
    // the renderer could never tell the two apart.
    const cells = appointmentsToMonthCells(
      [appt('a1', '2026-09-16T01:00:00Z')],
      monthStart,
      monthEnd,
      NOW,
      hoursFacts(),
    )
    const cell = cells.find((c) => c.id === CLOSED_YMD)!
    expect(cell.closed).toBe(true)
    expect(cell.count).toBe(1)
  })
})

describe('buildAppointmentsScreen — one source for 休', () => {
  it('the month cell and the week row read the SAME map for the same day', () => {
    const month = buildAppointmentsScreen({
      ...base,
      monthRange: computeMonthRange(SELECTED),
      monthWindow: WHOLE,
    })
    const week = buildAppointmentsScreen({
      ...base,
      weekRange: computeWeekRange(SELECTED),
      weekWindow: WHOLE,
    })
    const cell = month.monthData!.find((c) => c.id === CLOSED_YMD)!
    const row = week.weekData!.find((r) => r.dateIso === CLOSED_YMD)!
    expect(cell.closed).toBe(true)
    expect(cell.closed).toBe(row.closed)
  })
})
