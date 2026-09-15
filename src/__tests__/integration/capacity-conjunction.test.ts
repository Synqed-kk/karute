/**
 * ⚖ STRESS-S F1 — capacity is NEVER derived from who got booked.
 *
 * 稼働% and 空き only mean anything when we can name the day's real capacity.
 * That takes five conjuncts at once: solo_mode on, at most one booked staffer,
 * no overlapping bookings, that day's hours actually saved, and the day open.
 * Miss any one and the day claims nothing — availableMinutes falls back to the
 * old week-average arithmetic and the cell shows 未設定 or the next metric.
 *
 * This is the matrix: each conjunct false ALONE flips it.
 */
process.env.TZ = 'UTC'

import type { Appointment } from '@synqed-kk/client'
import { appointmentsToWeekData } from '@/lib/adapters/reservation'
import type { DayHoursFact } from '@/lib/operating-hours'

// Tue 2026-09-15 JST.
const DAY = new Date('2026-09-15T00:00:00+09:00')
const TODAY = new Date('2026-09-15T05:00:00+09:00')
const YMD = '2026-09-15'
const FALLBACK = 480 // the week-average denominator

const SAVED_OPEN: DayHoursFact = {
  minutes: 600,
  openMinute: 600,
  closeMinute: 1200,
  saved: true,
  closed: false,
}

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: '2026-09-15T01:00:00Z', // 10:00 JST
    ends_at: '2026-09-15T02:00:00Z',
    duration_minutes: 60,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

function row(
  rows: Appointment[],
  opts: { fact?: DayHoursFact | null; solo?: boolean } = {},
) {
  const facts = new Map<string, DayHoursFact>()
  if (opts.fact !== null) facts.set(YMD, opts.fact ?? SAVED_OPEN)
  return appointmentsToWeekData(
    rows,
    DAY,
    DAY,
    FALLBACK,
    TODAY,
    'ja',
    new Set(),
    undefined,
    facts,
    opts.solo ?? true,
  )[0]
}

const ONE_STAFFER = [appt(), appt({ id: 'a2', starts_at: '2026-09-15T04:00:00Z' })]

describe('F1 — all five conjuncts true', () => {
  it("availableMinutes is the day's SAVED minutes, not the arithmetic", () => {
    const day = row(ONE_STAFFER)
    expect(day.capacityDefensible).toBe(true)
    expect(day.availableMinutes).toBe(600)
    expect(day.hoursSaved).toBe(true)
    expect(day.closed).toBe(false)
  })
})

describe('F1 — each conjunct false ALONE flips it', () => {
  it('solo_mode off', () => {
    const day = row(ONE_STAFFER, { solo: false })
    expect(day.capacityDefensible).toBe(false)
    expect(day.availableMinutes).toBe(FALLBACK * 1)
  })

  it('two booked staffers', () => {
    const day = row([appt(), appt({ id: 'a2', staff_id: 's2' })])
    expect(day.capacityDefensible).toBe(false)
    expect(day.availableMinutes).toBe(FALLBACK * 2)
  })

  it('overlapping bookings — 10:00–11:00 and 10:30–11:30, one staffer (mutant m6)', () => {
    const day = row([
      appt({ starts_at: '2026-09-15T01:00:00Z', duration_minutes: 60 }),
      appt({ id: 'a2', starts_at: '2026-09-15T01:30:00Z', duration_minutes: 60 }),
    ])
    expect(day.capacityDefensible).toBe(false)
    expect(day.availableMinutes).toBe(FALLBACK * 1)
  })

  it('back-to-back bookings do NOT overlap — 10:00–11:00 then 11:00–12:00', () => {
    const day = row([
      appt({ starts_at: '2026-09-15T01:00:00Z', duration_minutes: 60 }),
      appt({ id: 'a2', starts_at: '2026-09-15T02:00:00Z', duration_minutes: 60 }),
    ])
    expect(day.capacityDefensible).toBe(true)
  })

  it('the hours were never saved', () => {
    const day = row(ONE_STAFFER, { fact: { ...SAVED_OPEN, saved: false } })
    expect(day.capacityDefensible).toBe(false)
    expect(day.hoursSaved).toBe(false)
    expect(day.availableMinutes).toBe(FALLBACK * 1)
  })

  it('the day is closed', () => {
    const day = row(ONE_STAFFER, {
      fact: { minutes: 0, openMinute: 0, closeMinute: 0, saved: true, closed: true },
    })
    expect(day.capacityDefensible).toBe(false)
    expect(day.closed).toBe(true)
    expect(day.availableMinutes).toBe(FALLBACK * 1)
  })

  it('booked PAST the saved window — 稼働 would read 117% (mutant m11)', () => {
    // One staffer, 08:00–19:40 JST against a saved 10:00–20:00 (600 min) day.
    // Nothing else fails: solo, one staffer, no overlap, hours saved, open.
    const day = row([
      appt({ starts_at: '2026-09-14T23:00:00Z', duration_minutes: 700 }),
    ])
    expect(day.bookedMinutes).toBe(700)
    expect(day.capacityDefensible).toBe(false)
    expect(day.availableMinutes).toBe(FALLBACK * 1)
  })

  it('STAFFLESS rows push the day past 100% — 稼働 would read 110%', () => {
    // The ≤1-staffer conjunct only looks at non-null staff ids, so three
    // unassigned bookings sail past it while their minutes still count.
    // 480 + 3×60 = 660 against a 600-minute day.
    const day = row([
      appt({ starts_at: '2026-09-15T01:00:00Z', duration_minutes: 480 }),
      appt({ id: 'u1', staff_id: null, starts_at: '2026-09-15T10:00:00Z' }),
      appt({ id: 'u2', staff_id: null, starts_at: '2026-09-15T11:00:00Z' }),
      appt({ id: 'u3', staff_id: null, starts_at: '2026-09-15T12:00:00Z' }),
    ])
    expect(day.bookedMinutes).toBe(660)
    expect(day.capacityDefensible).toBe(false)
    // The fallback counts DISTINCT staff_id values on the day, null included —
    // pre-existing arithmetic, unchanged here.
    expect(day.availableMinutes).toBe(FALLBACK * 2)
  })

  it('a day booked to exactly its saved minutes is still defensible', () => {
    const day = row([
      appt({ starts_at: '2026-09-15T01:00:00Z', duration_minutes: 600 }),
    ])
    expect(day.bookedMinutes).toBe(600)
    expect(day.capacityDefensible).toBe(true)
    expect(day.availableMinutes).toBe(600)
  })

  it('no hours fact at all (the window carried none)', () => {
    const day = row(ONE_STAFFER, { fact: null })
    expect(day.capacityDefensible).toBe(false)
    expect(day.hoursSaved).toBe(false)
  })
})

describe('F1 — what does NOT affect it', () => {
  it('a BLOCK row never counts toward the staff or the overlap check', () => {
    // A BLOCK row at 10:00 under a second staffer would break both conjuncts if
    // it reached them. It never does: it is not a counted booking.
    const day = row([
      appt(),
      appt({
        id: 'block-1',
        kind: 'BLOCK',
        customer_id: null,
        staff_id: 's2',
        starts_at: '2026-09-15T01:00:00Z',
      }),
    ])
    expect(day.capacityDefensible).toBe(true)
    expect(day.count).toBe(1)
  })

  it('an unassigned booking (no staff_id) leaves the ≤1-staffer conjunct intact', () => {
    const day = row([appt(), appt({ id: 'a2', staff_id: null, starts_at: '2026-09-15T04:00:00Z' })])
    expect(day.capacityDefensible).toBe(true)
    expect(day.count).toBe(2)
  })

  it('newCustomerCount is untouched by the conjunction', () => {
    const facts = new Map([[YMD, SAVED_OPEN]])
    const withCapacity = appointmentsToWeekData(
      [appt({ customer_id: 'new-1' })],
      DAY,
      DAY,
      FALLBACK,
      TODAY,
      'ja',
      new Set(['new-1']),
      undefined,
      facts,
      true,
    )[0]
    const without = appointmentsToWeekData(
      [appt({ customer_id: 'new-1' })],
      DAY,
      DAY,
      FALLBACK,
      TODAY,
      'ja',
      new Set(['new-1']),
      undefined,
      facts,
      false,
    )[0]
    expect(withCapacity.capacityDefensible).toBe(true)
    expect(without.capacityDefensible).toBe(false)
    expect(withCapacity.newCustomerCount).toBe(1)
    expect(without.newCustomerCount).toBe(1)
  })

  it('returningCount is 0 on the wire until PKT-2 ships its producer', () => {
    expect(row(ONE_STAFFER).returningCount).toBe(0)
  })
})
