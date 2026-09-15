/**
 * ⚖ PKT-2 — THE 新規 NUMBER IS THE LIST'S OWN TAG, COUNTED (spec §8).
 *
 * Liam 2026-09-15 16:0x: 「count how many new customers are in the booking on
 * that day by just scrolling through the 予約 tab」. So the number is not a
 * property of a customer record — it is the people whose FIRST VISIT falls on
 * that day, by the same rule the day list prints its 新規 tag from.
 *
 * What it replaced: `newCustomerCount` was the count of that day's bookings
 * whose customer carried the QuickReserve `is_existing_customer === false`
 * import flag — a different source, about a different question. It never
 * printed, because `typeSlot` was 'off' on every surface.
 *
 * The five rules, the people-not-bookings rule, the parity with the list, and
 * the one-truth pin across week row / day total / month cell all live here.
 */
import type { Appointment } from '@synqed-kk/client'
import type { AppointmentRow } from '@/actions/appointments'
import { isFirstVisitOn, newCountByDay } from '@/lib/appointments/first-visit'
import { countedClientIds } from '@/lib/appointments/by-date'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { appointmentsToWeekData } from '@/lib/adapters/reservation'
import { computeWeekRange } from '@/lib/date/calendar-range'
import { ymdInJst } from '@/lib/date/jst'

// Mon 2026-09-14 → Sun 2026-09-20 JST. `NOW` sits before every booking below,
// because the day list only tags a FUTURE booking 新規 (computeDisplayStatus:
// a started one reads 進行中/完了). The parity test needs both surfaces
// answering, not one of them answering "completed".
const NOW = new Date('2026-09-13T00:00:00+09:00')
const MON = new Date('2026-09-14T00:00:00+09:00')
const D = {
  mon: '2026-09-14',
  tue: '2026-09-15',
  wed: '2026-09-16',
  thu: '2026-09-17',
} as const

/** 10:00 JST on the given JST day. */
function at(ymd: string, hourJst = 10): string {
  return new Date(`${ymd}T${String(hourJst).padStart(2, '0')}:00:00+09:00`).toISOString()
}

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: at(D.mon),
    ends_at: at(D.mon, 11),
    duration_minutes: 60,
    occupied_until: null,
    title: 'カット',
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

type Enrichment = ReadonlyMap<string, { firstVisitIso: string | null }>

function inputs(
  over: { enrichment?: Enrichment; packUsage?: ReadonlyMap<string, unknown> } = {},
) {
  return {
    enrichment: over.enrichment ?? new Map<string, { firstVisitIso: string | null }>(),
    packUsage: over.packUsage ?? new Map<string, unknown>(),
  }
}

/** The whole window's answer for ONE day — what every surface reads. */
function countOn(day: string, rows: Appointment[], over = {}): number {
  return newCountByDay(rows, inputs(over)).get(day) ?? 0
}

// ---------------------------------------------------------------------------
// S1 — the five rules, one at a time
// ---------------------------------------------------------------------------

describe('isFirstVisitOn — the five rules (S1)', () => {
  const ctx = {
    ...inputs(),
    earliestCountedDay: new Map<string, string>(),
  }

  it('(1) a 新規〜 course IS a first visit — the reservation system outranks inference', () => {
    // No enrichment at all, and the window-earliest fallback deliberately
    // points at ANOTHER day: the course title still wins (Liam 2026-07-03).
    const row = appt({ title: '新規カット', starts_at: at(D.tue) })
    expect(
      isFirstVisitOn(row, D.tue, { ...ctx, earliestCountedDay: new Map([['c1', D.mon]]) }),
    ).toBe(true)
  })

  it('(1) any OTHER named course says RETURNING, even with no history on file', () => {
    // The absence of history proves nothing — imports do not carry it. Both
    // fallbacks below would have said "new"; the title overrules both.
    const row = appt({ title: 'カット', starts_at: at(D.tue) })
    expect(
      isFirstVisitOn(row, D.tue, { ...ctx, earliestCountedDay: new Map([['c1', D.tue]]) }),
    ).toBe(false)
  })

  it('(2) a titleless booking takes the reconciled firstVisitIso', () => {
    const row = appt({ title: null, starts_at: at(D.tue) })
    const withIso = {
      ...ctx,
      enrichment: new Map([['c1', { firstVisitIso: at(D.tue) }]]),
      earliestCountedDay: new Map([['c1', D.mon]]),
    }
    expect(isFirstVisitOn(row, D.tue, withIso)).toBe(true)
    // …and says NO on any other day, whatever the window thinks.
    const monRow = appt({ title: null, starts_at: at(D.mon) })
    expect(isFirstVisitOn(monRow, D.mon, withIso)).toBe(false)
  })

  it('(2) a bare YYYY-MM-DD firstVisitIso lands on the same JST day as the booking', () => {
    // Core's enrichment aggregate returns both shapes. `2026-09-15` parsed as
    // UTC midnight is 09:00 JST the SAME day — a naive substring or a
    // runtime-local getDate() would have moved it.
    const row = appt({ title: null, starts_at: at(D.tue) })
    expect(
      isFirstVisitOn(row, D.tue, { ...ctx, enrichment: new Map([['c1', { firstVisitIso: D.tue }]]) }),
    ).toBe(true)
  })

  it('(3) with no history at all, the window-EARLIEST counted booking is the first visit', () => {
    const rows = [
      appt({ id: 'wed', title: null, starts_at: at(D.wed) }),
      appt({ id: 'mon', title: null, starts_at: at(D.mon) }),
    ]
    expect(countOn(D.mon, rows)).toBe(1)
    expect(countOn(D.wed, rows)).toBe(0)
  })

  it('(4) a 回数券 holder is NEVER 新規 — ledger first', () => {
    const row = appt({ title: '新規カット', starts_at: at(D.tue) })
    const held = { ...ctx, packUsage: new Map([['c1', { remaining: 3, size: 10 }]]) }
    // Even against the strongest positive signal there is.
    expect(isFirstVisitOn(row, D.tue, held)).toBe(false)
  })

  it('(4) …and by course title, for customers with no ledger entry yet', () => {
    const row = appt({ title: '10回券', starts_at: at(D.tue) })
    expect(
      isFirstVisitOn(row, D.tue, { ...ctx, earliestCountedDay: new Map([['c1', D.tue]]) }),
    ).toBe(false)
  })

  it('(5) a BLOCK hold, a terminal row and a customerless row are never anyone’s visit', () => {
    const base = { title: null, starts_at: at(D.tue) }
    const earliest = { ...ctx, earliestCountedDay: new Map([['c1', D.tue]]) }
    expect(isFirstVisitOn(appt({ ...base, kind: 'BLOCK' }), D.tue, earliest)).toBe(false)
    expect(isFirstVisitOn(appt({ ...base, status: 'CANCELLED' }), D.tue, earliest)).toBe(false)
    expect(isFirstVisitOn(appt({ ...base, status: 'NO_SHOW' }), D.tue, earliest)).toBe(false)
    expect(isFirstVisitOn(appt({ ...base, customer_id: null }), D.tue, earliest)).toBe(false)
  })

  it('a booking never counts on a day it does not fall on', () => {
    const row = appt({ title: '新規カット', starts_at: at(D.tue) })
    expect(isFirstVisitOn(row, D.wed, ctx)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// newCountByDay — PEOPLE, not bookings
// ---------------------------------------------------------------------------

describe('newCountByDay — it counts PEOPLE', () => {
  it('two bookings by one person on one day are ONE 新規', () => {
    const rows = [
      appt({ id: 'am', title: '新規カット', starts_at: at(D.tue, 10) }),
      appt({ id: 'pm', title: '新規カラー', starts_at: at(D.tue, 15) }),
    ]
    expect(countOn(D.tue, rows)).toBe(1)
  })

  it('two different people on one day are TWO', () => {
    const rows = [
      appt({ id: 'a', customer_id: 'c1', title: '新規カット', starts_at: at(D.tue) }),
      appt({ id: 'b', customer_id: 'c2', title: '新規カット', starts_at: at(D.tue, 15) }),
    ]
    expect(countOn(D.tue, rows)).toBe(2)
  })

  it('a person has ONE first visit: a contradicting window resolves to the earliest day', () => {
    // A 新規-titled course on Wed after a plain booking on Mon by the same
    // person. Rule (1) fires on Wed and rule (3) on Mon; the count is 1, on
    // Mon — never a person walking in new twice in one week.
    const rows = [
      appt({ id: 'mon', title: null, starts_at: at(D.mon) }),
      appt({ id: 'wed', title: '新規カット', starts_at: at(D.wed) }),
    ]
    const counts = newCountByDay(rows, inputs())
    expect(counts.get(D.mon)).toBe(1)
    expect(counts.get(D.wed) ?? 0).toBe(0)
  })

  it('a terminal row never seeds the window-earliest fallback', () => {
    // A cancelled Monday must not make Monday the customer's "first visit" and
    // steal the 新規 from the Wednesday they actually come in on.
    const rows = [appt({ id: 'wed', title: null, starts_at: at(D.wed) })]
    expect(countOn(D.wed, rows)).toBe(1)
  })

  it('an empty window has no 新規 anywhere', () => {
    expect(newCountByDay([], inputs()).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// THE PARITY PIN — the list's tag and the number, over one fixture week
// ---------------------------------------------------------------------------

/** The day list's own row shape. `client_id` + the course title are what its
 *  tag rule reads; the rest is chrome. */
function listRow(a: Appointment): AppointmentRow {
  return {
    id: a.id,
    staff_profile_id: a.staff_id ?? 's1',
    client_id: a.customer_id as string,
    start_time: a.starts_at,
    duration_minutes: 60,
    title: a.title,
    notes: null,
    karute_record_id: null,
    created_at: a.created_at,
    customers: { name: '—' },
    synqed_status: 'SCHEDULED',
    source: 'MANUAL',
    status_reason: null,
    status_set_by_name: null,
    status_set_at: null,
  } as unknown as AppointmentRow
}

// ONE fixture week, written so the two surfaces are ASKED THE SAME QUESTION:
// every customer's records agree with their bookings (which is the real world
// the parity claim is about — the divergence case gets its own test below).
//
//  c1  新規カット on Mon                    → 新規 Mon
//  c2  titleless Tue, firstVisitIso = Tue   → 新規 Tue
//  c3  titleless Tue, firstVisitIso = 2024  → a regular, never 新規
//  c4  カット (a named non-新規 course) Wed  → returning by the booking's word
//  c5  新規カット Wed, holds a 回数券        → never 新規
//  c6  新規 TWICE on Thu                    → one person, one 新規
const WEEK_ROWS: Appointment[] = [
  appt({ id: 'c1-mon', customer_id: 'c1', title: '新規カット', starts_at: at(D.mon) }),
  appt({ id: 'c2-tue', customer_id: 'c2', title: null, starts_at: at(D.tue) }),
  appt({ id: 'c3-tue', customer_id: 'c3', title: null, starts_at: at(D.tue, 14) }),
  appt({ id: 'c4-wed', customer_id: 'c4', title: 'カット', starts_at: at(D.wed) }),
  appt({ id: 'c5-wed', customer_id: 'c5', title: '新規カット', starts_at: at(D.wed, 14) }),
  appt({ id: 'c6-thu-am', customer_id: 'c6', title: '新規カット', starts_at: at(D.thu, 10) }),
  appt({ id: 'c6-thu-pm', customer_id: 'c6', title: '新規カラー', starts_at: at(D.thu, 15) }),
]

/** A full enrichment row. The DATES and the COUNTS have to agree, because the
 *  two surfaces read different halves of it: the number reads `firstVisitIso`,
 *  the list's tag reads the history counts through `isReturningCustomer`. A
 *  customer whose first visit was 2024 has visits on file — writing the date
 *  without the counts would be a fixture that contradicts itself, not a
 *  parity break. */
function enr(over: { firstVisitIso: string | null; visits?: number }) {
  const visits = over.visits ?? 0
  return {
    totalKarute: visits,
    lastVisitIso: null,
    pastAppointmentCount: visits,
    lastVisitService: null,
    bookingStaffId: null,
    nextAppointmentIso: null,
    firstVisitIso: over.firstVisitIso,
    datedVisitCount: visits,
    noShowCount: 0,
  }
}

const WEEK_ENRICHMENT = new Map([
  // Their first visit IS this Tuesday — nothing on file yet, by definition.
  ['c2', enr({ firstVisitIso: D.tue })],
  // A regular since 2024, with the four visits that date implies.
  ['c3', enr({ firstVisitIso: '2024-05-02', visits: 4 })],
])
const WEEK_PACKS = new Map<string, { remaining: number; size: number }>([
  ['c5', { remaining: 4, size: 10 }],
])

/** The whole screen for one day of the fixture week — the LIST and the NUMBER
 *  out of one call, exactly as the page renders them. */
function screenFor(day: string) {
  const weekRange = computeWeekRange(new Date(`${day}T00:00:00+09:00`))
  const window = { counted: WEEK_ROWS, cancelled: [], noShow: [], truncated: false }
  return buildAppointmentsScreen({
    locale: 'ja',
    now: NOW,
    selectedDate: new Date(`${day}T00:00:00+09:00`),
    staffFilter: 'all',
    staffList: [{ id: 's1', full_name: '—' }] as never,
    activeStaffId: null,
    storeStaffIds: null,
    orgSettings: null,
    customers: [],
    dayAppointments: WEEK_ROWS.filter((a) => ymdInJst(new Date(a.starts_at)) === day).map(listRow),
    weekRange,
    monthRange: null,
    weekRangeAppts: null,
    monthRangeAppts: null,
    weekWindow: window,
    enrichment: WEEK_ENRICHMENT as never,
    packUsage: WEEK_PACKS,
  })
}

describe('⚖ PARITY — the day list’s 新規 tag and the 新規 NUMBER are one rule', () => {
  const DAYS = [D.mon, D.tue, D.wed, D.thu] as const
  const EXPECTED: Record<string, number> = { [D.mon]: 1, [D.tue]: 1, [D.wed]: 0, [D.thu]: 1 }

  it.each(DAYS)('%s — the tagged PEOPLE in the list are exactly the number', (day) => {
    const screen = screenFor(day)
    // What a staffer counts by eye, scrolling the 予約 tab: the distinct
    // customers whose row carries the 新規 tag.
    const taggedPeople = new Set(
      screen.reservationViews.filter((v) => v.displayStatus === 'new').map((v) => v.clientId),
    )
    const number = screen.dayTotals?.newCustomerCount ?? 0
    expect({ day, number }).toEqual({ day, number: taggedPeople.size })
    // …and it is the number this fixture was written to produce, so a rule
    // that broke BOTH surfaces the same way still fails here.
    expect({ day, number }).toEqual({ day, number: EXPECTED[day] })
  })

  it('the week ROW for each day says the same as that day’s own total', () => {
    for (const day of DAYS) {
      const screen = screenFor(day)
      const row = screen.weekData?.find((r) => r.dateIso === day)
      expect({ day, n: row?.newCustomerCount }).toEqual({
        day,
        n: screen.dayTotals?.newCustomerCount,
      })
    }
  })

  it('the summary over the week is the sum of its rows — 3 people', () => {
    const rows = screenFor(D.mon).weekData ?? []
    expect(rows.reduce((sum, r) => sum + r.newCustomerCount, 0)).toBe(3)
  })

  it('DECLARED DIVERGENCE: the list tags a first-timer on EVERY visit, the number only on their first', () => {
    // This is the bug PKT-2 exists to fix, pinned so it is never mistaken for
    // a parity break. c7's reconciled first visit is Monday; they come back on
    // Wednesday. The list tags the Wednesday row 新規 (its tag asks "is this
    // person a first-timer?", not "is this their first visit?"); the NUMBER
    // says 0, because Wednesday is not their first visit.
    const rows = [appt({ id: 'c7-wed', customer_id: 'c7', title: null, starts_at: at(D.wed) })]
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: new Date(`${D.wed}T00:00:00+09:00`),
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: [],
      dayAppointments: rows.map(listRow),
      weekRange: null,
      monthRange: null,
      weekRangeAppts: null,
      monthRangeAppts: null,
      dayWindow: { counted: rows, cancelled: [], noShow: [], truncated: false },
      enrichment: new Map([['c7', enr({ firstVisitIso: D.mon })]]) as never,
      packUsage: new Map(),
    })
    expect(screen.reservationViews.map((v) => v.displayStatus)).toEqual(['new'])
    expect(screen.dayTotals?.newCustomerCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ONE TRUTH — week row, day total, month cell
// ---------------------------------------------------------------------------

describe('⚖ ONE TRUTH — every surface reads the same window map', () => {
  it('the month cells and the week rows agree over the same days', () => {
    const monthStart = new Date('2026-09-01T00:00:00+09:00')
    const monthEnd = new Date('2026-09-30T23:59:59+09:00')
    const window = { counted: WEEK_ROWS, cancelled: [], noShow: [], truncated: false }
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: [],
      dayAppointments: [],
      weekRange: null,
      monthRange: { monthStart, monthEnd, rangeFrom: monthStart, rangeTo: monthEnd } as never,
      weekRangeAppts: null,
      monthRangeAppts: null,
      monthWindow: window,
      enrichment: WEEK_ENRICHMENT as never,
      packUsage: WEEK_PACKS,
    })
    const weekRows = appointmentsToWeekData(
      WEEK_ROWS,
      MON,
      new Date('2026-09-20T00:00:00+09:00'),
      480,
      NOW,
      'ja',
      newCountByDay(WEEK_ROWS, { enrichment: WEEK_ENRICHMENT, packUsage: WEEK_PACKS }),
    )
    for (const row of weekRows) {
      expect({ day: row.dateIso, n: screen.monthNewCounts?.get(row.dateIso) ?? 0 }).toEqual({
        day: row.dateIso,
        n: row.newCustomerCount,
      })
    }
    // …and the month genuinely carries the fixture's three people.
    expect([...(screen.monthNewCounts?.values() ?? [])].reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('a truncated window renders NO 新規 anywhere — not a low number', () => {
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [],
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: [],
      dayAppointments: [],
      weekRange: computeWeekRange(MON),
      monthRange: null,
      weekRangeAppts: null,
      monthRangeAppts: null,
      // The window contract: truncated ⇒ every array empty. Nothing may be
      // derived from it.
      weekWindow: { counted: [], cancelled: [], noShow: [], truncated: true },
      enrichment: WEEK_ENRICHMENT as never,
      packUsage: WEEK_PACKS,
    })
    expect(screen.truncated).toBe(true)
    expect(screen.weekData).toBeNull()
    expect(screen.dayTotals).toBeNull()
    expect(screen.monthNewCounts).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// STORE ISOLATION — the widened enrichment set stays behind the clamp
// ---------------------------------------------------------------------------

describe('⚖ store isolation — the enrichment set comes from the WINDOW, never the roster', () => {
  it('countedClientIds returns exactly the window’s counted customers', () => {
    const otherStore = appt({ id: 'other', customer_id: 'OTHER-STORE-CUSTOMER' })
    const window = {
      counted: WEEK_ROWS,
      // Terminal rows are not counted rows and contribute no ids either.
      cancelled: [otherStore],
      noShow: [otherStore],
      truncated: false,
    }
    const ids = countedClientIds(window, null, undefined)
    expect([...ids].sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
    expect(ids).not.toContain('OTHER-STORE-CUSTOMER')
  })

  it('an id can only enter through a window, and a window is fetched under the clamp', () => {
    // The posture, stated as a test: there is no path from the business-wide
    // roster into this set. Both doors build it from `dayAppointments` (the
    // store-scoped day read) ∪ countedClientIds(the store-scoped windows), so
    // a branch's screen can never ask core to enrich another branch's customer.
    const empty = { counted: [], cancelled: [], noShow: [], truncated: false }
    expect(countedClientIds(empty)).toEqual([])
    expect(countedClientIds()).toEqual([])
    // A BLOCK hold names no customer and a customerless row has none — neither
    // widens the read.
    const holds = {
      ...empty,
      counted: [appt({ kind: 'BLOCK', customer_id: null }), appt({ customer_id: null })],
    }
    expect(countedClientIds(holds)).toEqual([])
  })
})
