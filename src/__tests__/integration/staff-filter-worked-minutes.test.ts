/**
 * ⚖ Liam 10/6 — never a number that counts someone not working.
 *
 * Since the window collapse, a 担当/自分 filter's week and month windows hold
 * that staff's rows AND the 担当未定 rows (shownUnder = isShownBooking), so 件
 * and the list count a booking nobody has taken yet. Its minutes are nobody's
 * work, so the staff's 予約時間 / 稼働 / 空き must not grow by them. Under 全員
 * the window was always the whole store's and every booking's minutes count.
 */
process.env.TZ = 'UTC'

import type { Appointment } from '@synqed-kk/client'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { computeMonthRange, computeWeekRange } from '@/lib/date/calendar-range'
import type { DayHoursFact } from '@/lib/operating-hours'

const SELECTED = new Date('2026-09-15T00:00:00+09:00')
const NOW = new Date('2026-09-15T05:00:00+09:00')
const YMD = '2026-09-15'

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: '2026-09-15T01:00:00Z',
    ends_at: '2026-09-15T02:00:00Z',
    duration_minutes: 60,
    occupied_until: null,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

/** s1's own 10:00–11:00 and one 担当未定 13:00–14:00, same day. */
const OWN = appt({ id: 'own' })
const UNASSIGNED = appt({
  id: 'nostaff',
  customer_id: 'c2',
  staff_id: null as unknown as string,
  starts_at: '2026-09-15T04:00:00Z',
  ends_at: '2026-09-15T05:00:00Z',
})
const WINDOW = { counted: [OWN, UNASSIGNED], cancelled: [], noShow: [], truncated: false }

/** A saved 10:00–20:00 (600 min) for every day of September and its edges. */
function savedHours(): Map<string, DayHoursFact> {
  const facts = new Map<string, DayHoursFact>()
  const cursor = new Date('2026-08-25T00:00:00+09:00')
  for (let i = 0; i < 50; i++) {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(cursor)
    facts.set(ymd, { minutes: 600, openMinute: 600, closeMinute: 1200, saved: true, source: 'store', closed: false })
    cursor.setDate(cursor.getDate() + 1)
  }
  return facts
}

const ONE_PERSON_STORE = new Set(['s1'])

type Win = typeof WINDOW
function build(
  view: 'week' | 'month' | 'day',
  staffFilter: string,
  opts: { window?: Win; hours?: Map<string, DayHoursFact>; unknown?: boolean } = {},
) {
  const win = opts.window ?? WINDOW
  return buildAppointmentsScreen({
    staffFilterUnknown: opts.unknown ?? false,
    dayWindow: view === 'day' ? win : null,
    locale: 'ja',
    now: NOW,
    selectedDate: SELECTED,
    staffFilter,
    staffList: [{ id: 's1', full_name: 'staff 1' }],
    activeStaffId: 's1',
    storeStaffIds: ONE_PERSON_STORE,
    divisorStaffIds: ONE_PERSON_STORE,
    orgSettings: null,
    customers: [],
    dayAppointments: [],
    weekRange: view === 'week' ? computeWeekRange(SELECTED) : null,
    monthRange: view === 'month' ? computeMonthRange(SELECTED) : null,
    weekRangeAppts: null,
    monthRangeAppts: null,
    weekWindow: view === 'week' ? win : null,
    monthWindow: view === 'month' ? win : null,
    hoursFacts: opts.hours ?? savedHours(),
    enrichment: new Map(),
    packUsage: new Map(),
  } as unknown as Parameters<typeof buildAppointmentsScreen>[0])
}

describe('week: 件 keeps 担当未定, the staff filter minutes do not', () => {
  it.each(['s1', 'self'])('under %s: 件 2, 予約時間 60, 空き 540, 稼働 10%%', (filter) => {
    const row = build('week', filter).weekData!.find((r) => r.dateIso === YMD)!
    expect(row.count).toBe(2)
    expect(row.bookedMinutes).toBe(60)
    expect(row.capacityMinutes).toBe(600)
    expect(row.freeMinutes).toBe(540)
    expect(row.occupancyPct).toBe(10)
  })

  it('under 全員: 件 2 and both bookings are worked minutes (120, 空き 480, 20%)', () => {
    const row = build('week', 'all').weekData!.find((r) => r.dateIso === YMD)!
    expect(row.count).toBe(2)
    expect(row.bookedMinutes).toBe(120)
    expect(row.freeMinutes).toBe(480)
    expect(row.occupancyPct).toBe(20)
  })
})

describe('month: the cell counts 担当未定, the staff filter facts do not', () => {
  it('under s1: cell 件 2, fact 予約時間 60, 空き 540, 稼働 10%', () => {
    const screen = build('month', 's1')
    expect(screen.monthData!.find((c) => c.id === YMD)!.count).toBe(2)
    const fact = screen.monthFacts!.get(YMD)!
    expect(fact.bookedMinutes).toBe(60)
    expect(fact.availableMinutes).toBe(540)
    expect(fact.occupancyPct).toBe(10)
  })

  it('under 全員: cell 件 2, fact 予約時間 120, 空き 480, 稼働 20%', () => {
    const screen = build('month', 'all')
    expect(screen.monthData!.find((c) => c.id === YMD)!.count).toBe(2)
    const fact = screen.monthFacts!.get(YMD)!
    expect(fact.bookedMinutes).toBe(120)
    expect(fact.availableMinutes).toBe(480)
    expect(fact.occupancyPct).toBe(20)
  })
})

describe('unknown filter: the window holds only 担当未定 rows, nobody worked them', () => {
  it('under an unplaceable 担当: 件 1, 予約時間 0, no capacity (no 稼働, no 空き)', () => {
    const row = build('week', 'ghost', {
      window: { counted: [UNASSIGNED], cancelled: [], noShow: [], truncated: false },
      unknown: true,
    }).weekData!.find((r) => r.dateIso === YMD)!
    expect(row.count).toBe(1)
    expect(row.bookedMinutes).toBe(0)
    expect(row.capacityMinutes).toBeNull()
    expect(row.occupancyPct).toBeNull()
  })
})

describe('fallback denominator: staffOnDay counts worked rows only', () => {
  it('no saved hours, under s1: availableMinutes = the business day x 1 (the 担当未定 row adds no chair)', () => {
    const row = build('week', 's1', { hours: new Map() }).weekData!.find((r) => r.dateIso === YMD)!
    const allRow = build('week', 'all', { hours: new Map() }).weekData!.find((r) => r.dateIso === YMD)!
    expect(row.count).toBe(2)
    expect(row.bookedMinutes).toBe(60)
    expect(row.capacityMinutes).toBeNull()
    // 全員 counts two "staff" ids (s1 + the null one); s1's fallback counts one.
    expect(allRow.availableMinutes).toBe(2 * row.availableMinutes)
  })
})

describe('day line: the selected day reads the same worked rows as the week row', () => {
  it('under s1: dayTotals 件 2, 予約時間 60, 空き 540', () => {
    const day = build('day', 's1').dayTotals!
    expect(day.count).toBe(2)
    expect(day.bookedMinutes).toBe(60)
    expect(day.freeMinutes).toBe(540)
  })
})
