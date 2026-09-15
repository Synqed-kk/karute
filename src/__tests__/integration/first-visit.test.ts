/**
 * ⚖ PKT-2 / R1-1 — THE 新規 NUMBER IS THE LIST'S OWN TAG, COUNTED (spec §8).
 *
 * Liam 2026-09-15 16:0x: 「count how many new customers are in the booking on
 * that day by just scrolling through the 予約 tab」. The number is therefore the
 * people whose row that day carries the list's 新規 tag — ONE predicate, read
 * by the tag and by the number.
 *
 * R1 deleted the number's own second rule (`enrichment.firstVisitIso`, then the
 * customer's earliest counted booking inside the fetched window). The four
 * inputs the blind round measured it failing on are pinned below by name.
 *
 * The chip vs the number: the visible 新規 chip yields to the session status
 * (a started booking reads 進行中/完了), so the chip disappears at the booking's
 * start time. The number counts the PERSON — the tag the row carries before the
 * session status hides the chip — which is why the parity below reads
 * `isFirstTimeVisit` (the tag) and the afternoon case is pinned separately.
 */
import type { Appointment } from '@synqed-kk/client'
import type { AppointmentRow } from '@/actions/appointments'
import type { CachedCustomerOption } from '@/lib/customers/cached'
import type { CustomerEnrichment } from '@/lib/customers/list-enrich'
import {
  isNewCustomerForDay,
  newCountByDay,
  titleVerdictByClient,
  type NewCustomerInputs,
} from '@/lib/appointments/first-visit'
import { countedClientIds } from '@/lib/appointments/by-date'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import {
  appointmentsToMonthCells,
  appointmentsToWeekData,
  monthCellsToDTO,
} from '@/lib/adapters/reservation'
import { computeWeekRange } from '@/lib/date/calendar-range'
import { ymdInJst } from '@/lib/date/jst'

// Mon 2026-09-14 → Sun 2026-09-20 JST. `NOW` sits before every booking, because
// the visible chip only survives on a booking that has not started. The parity
// claim is about the TAG, but reading it off a rendered screen is the stronger
// proof, so the fixture keeps both answering.
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

/** The day list's own row shape. */
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

/** A cached customer row — the QR half of the signal set. */
function cust(over: Partial<CachedCustomerOption> = {}): CachedCustomerOption {
  return {
    id: 'c1',
    name: '—',
    phone: null,
    furigana: null,
    isExistingCustomer: false,
    created_at: '2026-01-01T00:00:00Z',
    visitCount: 0,
    hasTicketPack: false,
    karute_number: null,
    ...over,
  } as CachedCustomerOption
}

/** A full enrichment row — the reconciled half. `visits` writes the two counts
 *  the 新規 rule actually reads (karute + past appointments) together, because
 *  a customer with one and not the other is a fixture contradicting itself. */
function enr(over: { visits?: number } = {}): CustomerEnrichment {
  const visits = over.visits ?? 0
  return {
    totalKarute: visits,
    lastVisitIso: null,
    pastAppointmentCount: visits,
    lastVisitService: null,
    bookingStaffId: null,
    nextAppointmentIso: null,
    firstVisitIso: null,
    datedVisitCount: visits,
    noShowCount: 0,
  }
}

function inputs(over: Partial<NewCustomerInputs> = {}): NewCustomerInputs {
  return {
    customers: over.customers ?? new Map(),
    enrichment: over.enrichment ?? new Map(),
    packUsage: over.packUsage ?? new Map(),
  }
}

/** The whole window's answer for ONE day. */
function countOn(day: string, rows: Appointment[], over: Partial<NewCustomerInputs> = {}): number {
  return newCountByDay(rows, inputs(over)).get(day) ?? 0
}

/** Every counted client in these rows has an enrichment row saying "no history
 *  on file" — what `enrichCustomers` genuinely returns for a first-timer. */
function noHistoryFor(rows: Appointment[]): Map<string, CustomerEnrichment> {
  const m = new Map<string, CustomerEnrichment>()
  for (const a of rows) if (a.customer_id) m.set(a.customer_id, enr())
  return m
}

// ---------------------------------------------------------------------------
// R1-1 — the rule, one conjunct at a time
// ---------------------------------------------------------------------------

describe('isNewCustomerForDay — the list’s rule, one home', () => {
  const verdictOf = (rows: Appointment[]) =>
    titleVerdictByClient(
      rows.map((a) => ({ clientId: a.customer_id as string, title: a.title })),
    )

  it('a 新規〜 course IS a first visit — the reservation system outranks inference', () => {
    // No history on file at all, and none needed: the booking says so.
    const rows = [appt({ title: '新規カット', starts_at: at(D.tue) })]
    expect(isNewCustomerForDay('c1', verdictOf(rows), inputs())).toBe(true)
  })

  it('any OTHER named course says RETURNING, even with no history on file', () => {
    const rows = [appt({ title: 'カット', starts_at: at(D.tue) })]
    expect(
      isNewCustomerForDay('c1', verdictOf(rows), inputs({ enrichment: noHistoryFor(rows) })),
    ).toBe(false)
  })

  it('the day’s course name is a fact about the PERSON: it carries to their titleless row', () => {
    // 10:00 「カット」 proves they are returning; the 14:00 titleless row is the
    // same person on the same day. This is the list's own per-customer loop.
    const rows = [
      appt({ id: 'am', title: 'カット', starts_at: at(D.tue, 10) }),
      appt({ id: 'pm', title: null, starts_at: at(D.tue, 14) }),
    ]
    expect(
      isNewCustomerForDay('c1', verdictOf(rows), inputs({ enrichment: noHistoryFor(rows) })),
    ).toBe(false)
  })

  it('a titleless booking takes the customer’s own history signals', () => {
    const rows = [appt({ title: null, starts_at: at(D.tue) })]
    const v = verdictOf(rows)
    expect(isNewCustomerForDay('c1', v, inputs({ enrichment: noHistoryFor(rows) }))).toBe(true)
    expect(
      isNewCustomerForDay(
        'c1',
        v,
        inputs({ enrichment: new Map([['c1', enr({ visits: 4 })]]) }),
      ),
    ).toBe(false)
  })

  it('⚖ a QR-migrated regular is never 新規 — the import flag and visit_count are read', () => {
    // LENS-1 §2. Imported with is_existing_customer / visits_number_cache 7,
    // history never synced, so every reconciled count is 0. The old rule called
    // them 新規; the list never did.
    const rows = [appt({ title: null, starts_at: at(D.tue) })]
    const v = verdictOf(rows)
    const history = noHistoryFor(rows)
    expect(
      isNewCustomerForDay(
        'c1',
        v,
        inputs({ enrichment: history, customers: new Map([['c1', cust({ isExistingCustomer: true })]]) }),
      ),
    ).toBe(false)
    expect(
      isNewCustomerForDay(
        'c1',
        v,
        inputs({ enrichment: history, customers: new Map([['c1', cust({ visitCount: 7 })]]) }),
      ),
    ).toBe(false)
    expect(
      isNewCustomerForDay(
        'c1',
        v,
        inputs({ enrichment: history, customers: new Map([['c1', cust({ hasTicketPack: true })]]) }),
      ),
    ).toBe(false)
  })

  it('a 回数券 ledger holder is NEVER 新規 — even on a 新規〜 course', () => {
    const rows = [appt({ title: '新規カット', starts_at: at(D.tue) })]
    expect(
      isNewCustomerForDay(
        'c1',
        verdictOf(rows),
        inputs({ packUsage: new Map([['c1', { remaining: 3, size: 10 }]]) }),
      ),
    ).toBe(false)
  })

  it('…and by course title, for customers with no ledger entry yet', () => {
    // The row-level half of the exclusion — applied by newCountByDay on the
    // number's side and by the agenda adapter on the list's, one shared regex.
    const rows = [appt({ title: '10回券', starts_at: at(D.tue) })]
    expect(countOn(D.tue, rows, { enrichment: noHistoryFor(rows) })).toBe(0)
  })

  it('⚖ no history read for this person → NOT 新規, never "everyone is new"', () => {
    // LENS-1 §4. An absent enrichment entry is the list's `?? false`.
    const rows = [appt({ title: null, starts_at: at(D.tue) })]
    expect(isNewCustomerForDay('c1', verdictOf(rows), inputs())).toBe(false)
    expect(countOn(D.tue, rows)).toBe(0)
  })

  it('a BLOCK hold, a terminal row and a customerless row are never anyone’s visit', () => {
    const base = { title: null, starts_at: at(D.tue) }
    const history = new Map([['c1', enr()]])
    for (const over of [
      { kind: 'BLOCK' },
      { status: 'CANCELLED' },
      { status: 'NO_SHOW' },
      { customer_id: null },
    ] as Partial<Appointment>[]) {
      expect(countOn(D.tue, [appt({ ...base, ...over })], { enrichment: history })).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// newCountByDay — PEOPLE, one day at a time
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

  it('⚖ a first-timer who books twice in one week is tagged — and counted — on BOTH days', () => {
    // R1-1's ruling, and the death of the window-earliest fallback. The list
    // prints the chip on both rows (its tag asks "is this person new?"), so the
    // number a staffer counts on each day is 1. An answer that depended on the
    // window is what made one Wednesday read 1 in day view and 0 in week view.
    const rows = [
      appt({ id: 'mon', title: null, starts_at: at(D.mon) }),
      appt({ id: 'wed', title: null, starts_at: at(D.wed) }),
    ]
    const counts = newCountByDay(rows, inputs({ enrichment: noHistoryFor(rows) }))
    expect({ mon: counts.get(D.mon), wed: counts.get(D.wed) }).toEqual({ mon: 1, wed: 1 })
  })

  it('an empty window has no 新規 anywhere', () => {
    expect(newCountByDay([], inputs()).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// THE PARITY PIN — the list's tag and the number, over one fixture week
// ---------------------------------------------------------------------------

//  c1  新規カット on Mon                        → 新規 Mon
//  c2  titleless Tue, nothing on file           → 新規 Tue
//  c3  titleless Tue, four visits on file       → a regular, never 新規
//  c4  カット (a named non-新規 course) Wed      → returning by the booking's word
//  c5  新規カット Wed, holds a 回数券             → never 新規
//  c6  新規 TWICE on Thu                        → one person, one 新規
//  c7  titleless Thu, QR regular (visit_count)  → never 新規 (LENS-1 §2)
const WEEK_ROWS: Appointment[] = [
  appt({ id: 'c1-mon', customer_id: 'c1', title: '新規カット', starts_at: at(D.mon) }),
  appt({ id: 'c2-tue', customer_id: 'c2', title: null, starts_at: at(D.tue) }),
  appt({ id: 'c3-tue', customer_id: 'c3', title: null, starts_at: at(D.tue, 14) }),
  appt({ id: 'c4-wed', customer_id: 'c4', title: 'カット', starts_at: at(D.wed) }),
  appt({ id: 'c5-wed', customer_id: 'c5', title: '新規カット', starts_at: at(D.wed, 14) }),
  appt({ id: 'c6-thu-am', customer_id: 'c6', title: '新規カット', starts_at: at(D.thu, 10) }),
  appt({ id: 'c6-thu-pm', customer_id: 'c6', title: '新規カラー', starts_at: at(D.thu, 15) }),
  appt({ id: 'c7-thu', customer_id: 'c7', title: null, starts_at: at(D.thu, 11) }),
]

const WEEK_ENRICHMENT = new Map<string, CustomerEnrichment>([
  ['c1', enr()],
  ['c2', enr()],
  ['c3', enr({ visits: 4 })],
  ['c4', enr()],
  ['c5', enr()],
  ['c6', enr()],
  ['c7', enr()],
])
const WEEK_CUSTOMERS: CachedCustomerOption[] = [
  cust({ id: 'c1' }),
  cust({ id: 'c2' }),
  cust({ id: 'c3', visitCount: 4 }),
  cust({ id: 'c4' }),
  cust({ id: 'c5', hasTicketPack: true }),
  cust({ id: 'c6' }),
  // The QR-migrated regular: flagged and counted by QuickReserve, no history of
  // ours to show for it.
  cust({ id: 'c7', isExistingCustomer: true, visitCount: 7 }),
]
const WEEK_PACKS = new Map<string, { remaining: number; size: number }>([
  ['c5', { remaining: 4, size: 10 }],
])

/** The whole screen for one day of the fixture week — the LIST and the NUMBER
 *  out of one call, exactly as the page renders them. */
function screenFor(day: string, now: Date = NOW) {
  return buildAppointmentsScreen({
    locale: 'ja',
    now,
    selectedDate: new Date(`${day}T00:00:00+09:00`),
    staffFilter: 'all',
    staffList: [{ id: 's1', full_name: '—' }] as never,
    activeStaffId: null,
    storeStaffIds: null,
    orgSettings: null,
    customers: WEEK_CUSTOMERS,
    dayAppointments: WEEK_ROWS.filter((a) => ymdInJst(new Date(a.starts_at)) === day).map(listRow),
    weekRange: computeWeekRange(new Date(`${day}T00:00:00+09:00`)),
    monthRange: null,
    weekRangeAppts: null,
    monthRangeAppts: null,
    weekWindow: { counted: WEEK_ROWS, cancelled: [], noShow: [], truncated: false },
    enrichment: WEEK_ENRICHMENT,
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
      screen.reservationViews.filter((v) => v.isFirstTimeVisit).map((v) => v.clientId),
    )
    const number = screen.dayTotals?.newCustomerCount ?? 0
    expect({ day, number }).toEqual({ day, number: taggedPeople.size })
    // …and it is the number this fixture was written to produce, so a rule that
    // broke BOTH surfaces the same way still fails here.
    expect({ day, number }).toEqual({ day, number: EXPECTED[day] })
  })

  it.each(DAYS)('%s — the VISIBLE chip agrees too, while nothing has started yet', (day) => {
    const screen = screenFor(day)
    const chipped = new Set(
      screen.reservationViews.filter((v) => v.displayStatus === 'new').map((v) => v.clientId),
    )
    expect({ day, n: chipped.size }).toEqual({ day, n: EXPECTED[day] })
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
})

// ---------------------------------------------------------------------------
// THE FOUR MEASURED FAILURES (LENS-1, blind round on 08a05b72)
// ---------------------------------------------------------------------------

describe('⚖ LENS-1’s four cases', () => {
  /** One first-timer, 10:00–11:00 on Monday, read at the hour given. */
  function afternoonScreen(now: Date) {
    const row = appt({ id: 'a1', customer_id: 'c1', title: null })
    return buildAppointmentsScreen({
      locale: 'ja',
      now,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: [cust({ id: 'c1' })],
      dayAppointments: [listRow(row)],
      weekRange: computeWeekRange(MON),
      monthRange: null,
      weekRangeAppts: null,
      monthRangeAppts: null,
      weekWindow: { counted: [row], cancelled: [], noShow: [], truncated: false },
      enrichment: new Map([['c1', enr()]]),
      packUsage: new Map(),
    })
  }

  it('1 · the afternoon first-timer: the chip yields to the session status, the number counts the person', () => {
    const morning = afternoonScreen(new Date('2026-09-14T09:30:00+09:00'))
    expect(morning.reservationViews[0].displayStatus).toBe('new')
    expect(morning.dayTotals?.newCustomerCount).toBe(1)

    const evening = afternoonScreen(new Date('2026-09-14T19:00:00+09:00'))
    // The row is 完了 now — that is a STATUS, not a verdict about the person.
    expect(evening.reservationViews[0].displayStatus).toBe('completed')
    // The TAG the number counts is still true, and so is the number: the salon
    // did see one new customer that Monday.
    expect(evening.reservationViews[0].isFirstTimeVisit).toBe(true)
    expect(evening.dayTotals?.newCustomerCount).toBe(1)
  })

  it('2 · the QR-imported regular: the list says 予約済 and so does the number', () => {
    const screen = screenFor(D.thu)
    const c7 = screen.reservationViews.find((v) => v.clientId === 'c7')
    expect(c7?.isFirstTimeVisit).toBe(false)
    // Thursday's only 新規 is c6, counted once for their two bookings.
    expect(screen.dayTotals?.newCustomerCount).toBe(1)
  })

  it('3 · the same Wednesday reads the same in day view and in week view', () => {
    const mon = appt({ id: 'm1', customer_id: 'c1', title: null, starts_at: at(D.mon) })
    const wed = appt({ id: 'w1', customer_id: 'c1', title: null, starts_at: at(D.wed) })
    const common = {
      locale: 'ja',
      now: NOW,
      selectedDate: new Date(`${D.wed}T00:00:00+09:00`),
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: [cust({ id: 'c1' })],
      dayAppointments: [listRow(wed)],
      weekRangeAppts: null,
      monthRangeAppts: null,
      monthRange: null,
      enrichment: new Map([['c1', enr()]]),
      packUsage: new Map(),
    }
    const dayView = buildAppointmentsScreen({
      ...common,
      weekRange: null,
      weekWindow: null,
      dayWindow: { counted: [wed], cancelled: [], noShow: [], truncated: false },
    })
    const weekView = buildAppointmentsScreen({
      ...common,
      weekRange: computeWeekRange(MON),
      weekWindow: { counted: [mon, wed], cancelled: [], noShow: [], truncated: false },
      dayWindow: null,
    })
    const wedRow = (weekView.weekData ?? []).find((r) => r.dateIso === D.wed)
    expect(dayView.dayTotals?.newCustomerCount).toBe(1)
    expect(wedRow?.newCustomerCount).toBe(dayView.dayTotals?.newCustomerCount)
  })

  it('4 · a client with no enrichment entry is 予約済 on the list AND 0 in the number', () => {
    const row = appt({ id: 'a1', customer_id: 'c9', title: null })
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: [cust({ id: 'c9' })],
      dayAppointments: [listRow(row)],
      weekRange: computeWeekRange(MON),
      monthRange: null,
      weekRangeAppts: null,
      monthRangeAppts: null,
      weekWindow: { counted: [row], cancelled: [], noShow: [], truncated: false },
      enrichment: new Map(),
      packUsage: new Map(),
    })
    expect(screen.reservationViews[0].isFirstTimeVisit).toBe(false)
    expect(screen.dayTotals?.newCustomerCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ONE TRUTH — week row, day total, month cell
// ---------------------------------------------------------------------------

describe('⚖ ONE TRUTH — every surface answers the same day the same way', () => {
  it('the month cells and the week rows agree over the same days', () => {
    const monthStart = new Date('2026-09-01T00:00:00+09:00')
    const monthEnd = new Date('2026-09-30T23:59:59+09:00')
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: WEEK_CUSTOMERS,
      dayAppointments: [],
      weekRange: null,
      monthRange: { monthStart, monthEnd, rangeFrom: monthStart, rangeTo: monthEnd } as never,
      weekRangeAppts: null,
      monthRangeAppts: null,
      monthWindow: { counted: WEEK_ROWS, cancelled: [], noShow: [], truncated: false },
      enrichment: WEEK_ENRICHMENT,
      packUsage: WEEK_PACKS,
    })
    const weekRows = appointmentsToWeekData(
      WEEK_ROWS,
      MON,
      new Date('2026-09-20T00:00:00+09:00'),
      480,
      NOW,
      'ja',
      {
        byDay: newCountByDay(WEEK_ROWS, {
          customers: new Map(WEEK_CUSTOMERS.map((c) => [c.id, c])),
          enrichment: WEEK_ENRICHMENT,
          packUsage: WEEK_PACKS,
        }),
        known: true,
      },
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
      enrichment: WEEK_ENRICHMENT,
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
    expect([...ids].sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
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

// ---------------------------------------------------------------------------
// ⚖ R1-2 — FAIL CLOSED: a history read that never happened withholds the number
// ---------------------------------------------------------------------------

describe('⚖ R1-2 — the number is WITHHELD, never maximal', () => {
  /** One counted first-timer on Monday, with whatever enrichment is handed in.
   *  An EMPTY map is what both doors produce when the business-id read fails:
   *  `businessId && ids.length ? enrichCustomers(…) : new Map()`. */
  function screenWith(enrichment: Map<string, CustomerEnrichment>, rows = [appt({ id: 'a1', title: null })]) {
    return buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: [cust({ id: 'c1' })],
      dayAppointments: rows.filter((a) => a.customer_id).map(listRow),
      weekRange: computeWeekRange(MON),
      monthRange: null,
      weekRangeAppts: null,
      monthRangeAppts: null,
      weekWindow: { counted: rows, cancelled: [], noShow: [], truncated: false },
      enrichment,
      packUsage: new Map(),
    })
  }

  it('enrichment empty beside a window WITH customers → withheld, and 0 rather than everybody', () => {
    const screen = screenWith(new Map())
    expect(screen.newCountKnown).toBe(false)
    expect(screen.dayTotals?.newCustomerCount).toBe(0)
    expect(screen.dayTotals?.newCountKnown).toBe(false)
    for (const r of screen.weekData ?? []) {
      expect({ day: r.dateIso, n: r.newCustomerCount, known: r.newCountKnown }).toEqual({
        day: r.dateIso,
        n: 0,
        known: false,
      })
    }
  })

  it('…and the LIST is unchanged: an absent entry already read 予約済 there', () => {
    const screen = screenWith(new Map())
    expect(screen.reservationViews).toHaveLength(1)
    expect(screen.reservationViews[0].isFirstTimeVisit).toBe(false)
    expect(screen.reservationViews[0].displayStatus).toBe('booked')
  })

  it('a window with NO customers is still KNOWN — an empty day honestly has no 新規', () => {
    const screen = screenWith(new Map(), [
      appt({ id: 'hold', kind: 'BLOCK', customer_id: null, title: 'オーナー業務' }),
    ])
    expect(screen.newCountKnown).toBe(true)
    expect(screen.dayTotals?.newCustomerCount).toBe(0)
    expect(screen.dayTotals?.newCountKnown).toBe(true)
  })

  it('a real enrichment read is KNOWN, even when every answer is "no history"', () => {
    const screen = screenWith(new Map([['c1', enr()]]))
    expect(screen.newCountKnown).toBe(true)
    expect(screen.dayTotals?.newCustomerCount).toBe(1)
  })

  it('the MONTH withholds with the same flag', () => {
    const monthStart = new Date('2026-09-01T00:00:00+09:00')
    const monthEnd = new Date('2026-09-30T23:59:59+09:00')
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: WEEK_CUSTOMERS,
      dayAppointments: [],
      weekRange: null,
      monthRange: { monthStart, monthEnd, rangeFrom: monthStart, rangeTo: monthEnd } as never,
      weekRangeAppts: null,
      monthRangeAppts: null,
      monthWindow: { counted: WEEK_ROWS, cancelled: [], noShow: [], truncated: false },
      enrichment: new Map(),
      packUsage: new Map(),
    })
    expect(screen.newCountKnown).toBe(false)
    expect([...(screen.monthNewCounts?.values() ?? [])]).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ⚖ R1-3 — the month, on BOTH doors
// ---------------------------------------------------------------------------

describe('⚖ R1-3 — the web door and the facade ship the same month', () => {
  const monthStart = new Date('2026-09-01T00:00:00+09:00')
  const monthEnd = new Date('2026-09-30T23:59:59+09:00')
  const inputsForWeek: NewCustomerInputs = {
    customers: new Map(WEEK_CUSTOMERS.map((c) => [c.id, c])),
    enrichment: WEEK_ENRICHMENT,
    packUsage: WEEK_PACKS,
  }

  /** What `getMonthCells` now does: the window's rows through the SAME producer
   *  and the SAME mapper the facade route uses. */
  function webDoorMonth(known = true) {
    return monthCellsToDTO(
      appointmentsToMonthCells(WEEK_ROWS, monthStart, monthEnd, MON),
      { newCounts: { byDay: known ? newCountByDay(WEEK_ROWS, inputsForWeek) : new Map(), known } },
    )
  }

  /** What the facade route does: the screen's month map through that mapper. */
  function facadeMonth() {
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: MON,
      staffFilter: 'all',
      staffList: [{ id: 's1', full_name: '—' }] as never,
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: WEEK_CUSTOMERS,
      dayAppointments: [],
      weekRange: null,
      monthRange: { monthStart, monthEnd, rangeFrom: monthStart, rangeTo: monthEnd } as never,
      weekRangeAppts: null,
      monthRangeAppts: null,
      monthWindow: { counted: WEEK_ROWS, cancelled: [], noShow: [], truncated: false },
      enrichment: WEEK_ENRICHMENT,
      packUsage: WEEK_PACKS,
    })
    return monthCellsToDTO(screen.monthData ?? [], {
      newCounts: {
        byDay: screen.monthNewCounts ?? new Map(),
        known: screen.newCountKnown,
      },
      facts: screen.monthFacts,
    })
  }

  it('cell for cell, the same 新規 — no door hardcodes a 0 any more', () => {
    const web = webDoorMonth()
    const facade = facadeMonth()
    expect(web.map((c) => [c.id, c.newCount])).toEqual(facade.map((c) => [c.id, c.newCount]))
    // …and it is the fixture's real week, not zeros agreeing with zeros.
    const nonZero = web.filter((c) => c.newCount > 0).map((c) => `${c.id}:${c.newCount}`)
    expect(nonZero).toEqual([`${D.mon}:1`, `${D.tue}:1`, `${D.thu}:1`])
  })

  it('the month cells equal that day’s week row — one number, three surfaces', () => {
    const byId = new Map(facadeMonth().map((c) => [c.id, c.newCount]))
    for (const day of [D.mon, D.tue, D.wed, D.thu] as const) {
      const row = screenFor(day).weekData?.find((r) => r.dateIso === day)
      expect({ day, n: byId.get(day) }).toEqual({ day, n: row?.newCustomerCount })
    }
  })

  it('a padding cell is never anybody’s first visit', () => {
    // 2026-09-01 is a Tuesday, so the grid pads back to Mon 8/31.
    const padding = webDoorMonth().filter((c) => !c.inMonth)
    expect(padding.length).toBeGreaterThan(0)
    expect(padding.every((c) => c.newCount === 0)).toBe(true)
  })

  it('a door that read no history ships 0 WITH the flag down', () => {
    const withheld = webDoorMonth(false)
    expect(withheld.every((c) => c.newCount === 0 && c.newCountKnown === false)).toBe(true)
    // …and the default (no `newCounts` at all) is the same withheld posture.
    const bare = monthCellsToDTO(appointmentsToMonthCells(WEEK_ROWS, monthStart, monthEnd, MON))
    expect(bare.every((c) => c.newCount === 0 && c.newCountKnown === false)).toBe(true)
  })
})
