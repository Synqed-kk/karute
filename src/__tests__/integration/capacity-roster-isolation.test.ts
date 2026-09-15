/**
 * ⚖ STORE ISOLATION at the SHARED site (PKT-1c-B S4).
 *
 * The web page and the facade GET both end in buildAppointmentsScreen, and
 * both hand it the same thing: the active store's staff lens. This file pins
 * what that builder does with it, which is the only place either door can get
 * it wrong:
 *
 *   - the divisor is the LENS, counted — never the business roster;
 *   - a null lens is "we do not know this store's roster", so the day gets no
 *     capacity at all (the pickers read the same null as "show everyone" —
 *     opposite default, same value, on purpose);
 *   - under 自分/担当 the day is one person's, so one lane.
 *
 * A day's capacity is the number staff will read a percentage off. Feeding it
 * forty people from four branches is the lie this packet exists to stop.
 */
process.env.TZ = 'UTC'

import type { Appointment } from '@synqed-kk/client'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { computeWeekRange } from '@/lib/date/calendar-range'
import type { DayHoursFact } from '@/lib/operating-hours'

const SELECTED = new Date('2026-09-15T00:00:00+09:00')
const NOW = new Date('2026-09-15T05:00:00+09:00')
const YMD = '2026-09-15'

/** 10:00–11:00 JST on the selected Tuesday, staff s1. */
function appt(over: Partial<Appointment> = {}): Appointment {
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

const WINDOW = { counted: [appt()], cancelled: [], noShow: [], truncated: false }

/** A saved 10:00–20:00 for every day of the week the builder walks. */
function savedHours(): Map<string, DayHoursFact> {
  const facts = new Map<string, DayHoursFact>()
  const { weekStart } = computeWeekRange(SELECTED)
  const cursor = new Date(weekStart)
  for (let i = 0; i < 7; i++) {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(cursor)
    facts.set(ymd, {
      minutes: 600,
      openMinute: 600,
      closeMinute: 1200,
      saved: true,
      source: 'store',
      closed: false,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return facts
}

/** The 40-person business roster; only two of them work at this store. */
const BUSINESS_ROSTER = Array.from({ length: 40 }, (_, i) => ({
  id: `s${i + 1}`,
  full_name: `staff ${i + 1}`,
}))
const HER_STORE = new Set(['s1', 's2'])

function build(over: Record<string, unknown> = {}) {
  return buildAppointmentsScreen({
    locale: 'ja',
    now: NOW,
    selectedDate: SELECTED,
    staffFilter: 'all',
    staffList: BUSINESS_ROSTER,
    activeStaffId: null,
    storeStaffIds: HER_STORE,
    orgSettings: null,
    customers: [],
    dayAppointments: [],
    weekRange: computeWeekRange(SELECTED),
    monthRange: null,
    weekRangeAppts: null,
    monthRangeAppts: null,
    weekWindow: WINDOW,
    hoursFacts: savedHours(),
    enrichment: new Map(),
    packUsage: new Map(),
    ...over,
  } as unknown as Parameters<typeof buildAppointmentsScreen>[0])
}

function selectedRow(screen: ReturnType<typeof buildAppointmentsScreen>) {
  return screen.weekData!.find((r) => r.dateIso === YMD)!
}

describe('the divisor is the store lens, never the business roster', () => {
  it("two people work here, so the day is 2 lanes — not the business's forty", () => {
    const row = selectedRow(build())
    expect(row.lanes).toBe(2)
    expect(row.capacityMinutes).toBe(1200)
    // The number a 40-person roster would have produced must not appear.
    expect(row.capacityMinutes).not.toBe(24_000)
  })

  it('MUTANT m1 — a null lens gives NO capacity, never the business roster', () => {
    const row = selectedRow(build({ storeStaffIds: null }))
    expect(row.capacityMinutes).toBeNull()
    expect(row.capacityReason).toBe('roster-unknown')
    expect(row.occupancyPct).toBeNull()
    expect(row.freeMinutes).toBeNull()
  })

  it('the pickers still fail OPEN on that same null — opposite default, one value', () => {
    const screen = build({ storeStaffIds: null })
    // The list shows everyone (a list may be generous)…
    expect(screen.staff).toHaveLength(40)
    // …while the divisor above refused to name a number. Both read the same
    // null; only one of them is allowed to guess.
    expect(selectedRow(screen).capacityMinutes).toBeNull()
  })

  it('a bigger store is a bigger denominator — the lens is what moves it', () => {
    const wider = selectedRow(build({ storeStaffIds: new Set(['s1', 's2', 's3', 's4']) }))
    expect(wider.lanes).toBe(4)
    expect(wider.capacityMinutes).toBe(2400)
  })
})

describe('自分 / 担当 — one person, one lane', () => {
  it("担当 <someone>: the day divides by that person's single lane", () => {
    const row = selectedRow(build({ staffFilter: 's2' }))
    expect(row.lanes).toBe(1)
    expect(row.capacityMinutes).toBe(600)
  })

  it('自分 with a known viewer: one lane', () => {
    const row = selectedRow(build({ staffFilter: 'self', activeStaffId: 's1' }))
    expect(row.lanes).toBe(1)
    expect(row.capacityMinutes).toBe(600)
  })

  it("自分 with NO viewer id keeps the store's roster — that fetch is not filtered", () => {
    // resolveFetchStaffId returns no filter in this case and the views fall
    // back to the whole salon, so dividing the salon's day by one person would
    // read as a 200% Tuesday.
    const row = selectedRow(build({ staffFilter: 'self', activeStaffId: null }))
    expect(row.lanes).toBe(2)
    expect(row.capacityMinutes).toBe(1200)
  })
})

describe('the class-bound store, through the builder', () => {
  it('a pilates studio gets no percentage, whatever its roster', () => {
    const row = selectedRow(build({ businessType: 'pilates_studio' }))
    expect(row.laneKind).toBe('none')
    expect(row.capacityMinutes).toBeNull()
    expect(row.capacityReason).toBe('kind-none')
  })

  it('a hair salon does', () => {
    const row = selectedRow(build({ businessType: 'hair_salon' }))
    expect(row.laneKind).toBe('staff')
    expect(row.capacityMinutes).toBe(1200)
  })
})
