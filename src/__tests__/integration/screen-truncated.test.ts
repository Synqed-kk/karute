/**
 * ⚖ A window we could not read in full renders NOTHING, never a low number.
 *
 * Silent truncation is the dangerous failure on a booking screen: an empty
 * Tuesday and a Tuesday-we-could-not-read look identical, and only one of them
 * is safe to act on. The builder's gate turns a truncated window into null
 * week/month/day data plus a `truncated` flag the surface can speak out loud.
 */
import type { Appointment } from '@synqed-kk/client'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { computeMonthRange, computeWeekRange } from '@/lib/date/calendar-range'

const SELECTED = new Date('2026-09-15T00:00:00+09:00')
const NOW = new Date('2026-09-15T05:00:00+09:00')

function appt(): Appointment {
  return {
    id: 'a1',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: '2026-09-15T01:00:00Z',
    ends_at: '2026-09-15T02:00:00Z',
    duration_minutes: 60,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  } as unknown as Appointment
}

const TRUNCATED = { counted: [], cancelled: [], noShow: [], truncated: true }
const WHOLE = {
  counted: [appt()],
  cancelled: [],
  noShow: [],
  truncated: false,
}

function build(over: Parameters<typeof buildAppointmentsScreen>[0]) {
  return buildAppointmentsScreen(over)
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
} as unknown as Parameters<typeof buildAppointmentsScreen>[0]

describe('buildAppointmentsScreen — the truncation gate', () => {
  it('a truncated WEEK window: weekData and dayTotals are null, truncated is true', () => {
    const screen = build({
      ...base,
      weekRange: computeWeekRange(SELECTED),
      weekWindow: TRUNCATED,
    })
    expect(screen.truncated).toBe(true)
    expect(screen.weekData).toBeNull()
    expect(screen.dayTotals).toBeNull()
    // weekStartIso still rides, so the view knows WHICH week failed.
    expect(screen.weekStartIso).not.toBeNull()
  })

  it('a truncated MONTH window: monthData and dayTotals are null', () => {
    const screen = build({
      ...base,
      monthRange: computeMonthRange(SELECTED),
      monthWindow: TRUNCATED,
    })
    expect(screen.truncated).toBe(true)
    expect(screen.monthData).toBeNull()
    expect(screen.dayTotals).toBeNull()
    expect(screen.monthStartIso).not.toBeNull()
  })

  it('a truncated DAY window blanks dayTotals', () => {
    const screen = build({ ...base, dayWindow: TRUNCATED })
    expect(screen.truncated).toBe(true)
    expect(screen.dayTotals).toBeNull()
  })

  it('a whole window renders normally — truncated is false', () => {
    const screen = build({
      ...base,
      weekRange: computeWeekRange(SELECTED),
      weekWindow: WHOLE,
    })
    expect(screen.truncated).toBe(false)
    expect(screen.weekData).toHaveLength(7)
    expect(screen.weekData![0].count).toBe(1)
    expect(screen.dayTotals?.count).toBe(1)
  })
})

describe('buildAppointmentsScreen — dayTotals sourcing', () => {
  it('reads the selected day out of the WEEK window when no day window was fetched', () => {
    const screen = build({
      ...base,
      weekRange: computeWeekRange(SELECTED),
      weekWindow: WHOLE,
    })
    expect(screen.dayTotals?.dateIso).toBe('2026-09-15')
    expect(screen.dayTotals?.count).toBe(screen.weekData![0].count)
  })

  it('stays null when no window covers the selected day at all', () => {
    // A week window anchored a fortnight later cannot speak for today.
    const elsewhere = computeWeekRange(new Date('2026-10-01T00:00:00+09:00'))
    const screen = build({ ...base, weekRange: elsewhere, weekWindow: WHOLE })
    expect(screen.dayTotals).toBeNull()
  })

  it("the window's LAST day still reads out of it (mutant m13)", () => {
    // The rolling week starts on the selected day, so its last day is +6. An
    // off-by-one at that edge reads as 「この日の予約はまだありません」 on a day
    // the window genuinely covers.
    const weekRange = computeWeekRange(SELECTED)
    const lastDay = new Date('2026-09-21T00:00:00+09:00')
    const screen = build({
      ...base,
      selectedDate: lastDay,
      weekRange,
      weekWindow: WHOLE,
    })
    expect(screen.dayTotals).not.toBeNull()
    expect(screen.dayTotals!.dateIso).toBe('2026-09-21')
    expect(screen.dayTotals!.count).toBe(0)
  })

  it('the day AFTER the window is null, not a zero', () => {
    const screen = build({
      ...base,
      selectedDate: new Date('2026-09-22T00:00:00+09:00'),
      weekRange: computeWeekRange(SELECTED),
      weekWindow: WHOLE,
    })
    expect(screen.dayTotals).toBeNull()
  })

  it('the legacy raw-array inputs still build a week (compatibility path)', () => {
    const screen = build({
      ...base,
      weekRange: computeWeekRange(SELECTED),
      weekRangeAppts: [appt()],
    })
    expect(screen.truncated).toBe(false)
    expect(screen.weekData).toHaveLength(7)
    expect(screen.weekData![0].count).toBe(1)
    // No terminal partitions on that path — the counts are honestly 0.
    expect(screen.weekData![0].cancelledCount).toBe(0)
  })
})
