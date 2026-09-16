/**
 * ⚖ STRESS-S F1 — capacity is NEVER derived from who got booked.
 *
 * 稼働% and 空き only mean anything when we can name the day's real capacity.
 * The five-conjunct block this file was written against is gone (PKT-1c-B):
 * the rule now lives in src/lib/capacity, and the adapter feeds it the store's
 * roster, its lane kind and the day's hours. The MATRIX survives, because the
 * questions are the same ones — is the roster readable, does anyone overlap,
 * were the hours saved, is the day open, does a booking sit outside them — and
 * each still flips the answer alone.
 *
 * Two answers deliberately MOVED with the model; both are marked ⚠ below.
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
  source: 'store',
  closed: false,
}

function appt(over: Partial<Appointment> = {}): Appointment {
  const startsAt = over.starts_at ?? '2026-09-15T01:00:00Z' // 10:00 JST
  const durationMinutes = over.duration_minutes ?? 60
  return {
    id: 'a1',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: startsAt,
    // Derived, not a fixed default. The capacity model reads the INTERVAL
    // (ends_at, or occupied_until) and never duration_minutes — core stores
    // that column independently and never validates it against the interval
    // (E30) — so a fixture whose ends_at ignored its own duration would be
    // describing a row core could never produce.
    ends_at: new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString(),
    duration_minutes: durationMinutes,
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

function row(
  rows: Appointment[],
  opts: { fact?: DayHoursFact | null; roster?: number | null } = {},
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
    { byDay: new Map(), known: true },
    undefined,
    facts,
    true,
    // The store's booking roster. One lane = the solo store this file has
    // always described; null = the lens failed, and the divisor fails CLOSED.
    { rosterHeadcount: opts.roster === undefined ? 1 : opts.roster },
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
  it('the roster could not be read — the divisor fails CLOSED', () => {
    const day = row(ONE_STAFFER, { roster: null })
    expect(day.capacityDefensible).toBe(false)
    expect(day.availableMinutes).toBe(FALLBACK * 1)
  })

  it('⚠ MOVED — a second staffer LIFTS the lane count instead of killing it', () => {
    // Was: two booked staffers = no capacity (the old ≤1 conjunct). Now the
    // roster is a FLOOR, never a ceiling (C3 rule c): the owner who cuts and
    // the helper off the roster each add a lane, so the day is describable —
    // 2 lanes × 600 saved minutes. This is the model change the packet ships,
    // not a regression.
    const day = row([appt(), appt({ id: 'a2', staff_id: 's2' })])
    expect(day.capacityDefensible).toBe(true)
    expect(day.lanes).toBe(2)
    expect(day.availableMinutes).toBe(1200)
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

  it('bookings that OVERLAP ACROSS JST MIDNIGHT (mutant m12)', () => {
    // 23:30–00:30 on the 15th and 00:00–01:00 on the 16th, same staffer. They
    // genuinely collide, but they bucket to different days by START, so the
    // old per-bucket check never compared them and both days read defensible.
    const rows = [
      appt({ id: 'late', starts_at: '2026-09-15T14:30:00Z', duration_minutes: 60 }),
      appt({ id: 'early', starts_at: '2026-09-15T15:00:00Z', duration_minutes: 60 }),
    ]
    const facts = new Map<string, DayHoursFact>([
      [YMD, SAVED_OPEN],
      ['2026-09-16', SAVED_OPEN],
    ])
    const days = appointmentsToWeekData(
      rows,
      DAY,
      new Date('2026-09-16T00:00:00+09:00'),
      FALLBACK,
      TODAY,
      'ja',
      { byDay: new Map(), known: true },
      undefined,
      facts,
      true,
      { rosterHeadcount: 1 },
    )
    expect(days.map((d) => d.dateIso)).toEqual([YMD, '2026-09-16'])
    expect(days[0].capacityDefensible).toBe(false)
    expect(days[1].capacityDefensible).toBe(false)
    // Counting stays START-day bucketed on both days — only the overlap
    // candidate set widened.
    expect(days[0].count).toBe(1)
    expect(days[1].count).toBe(1)
  })

  it('⚠ MOVED (T1) — a lone 23:30 booking withdraws its START day', () => {
    // Was: both days defensible. A booking that starts at 23:30 against saved
    // 10:00–20:00 hours is PROOF the hours do not describe that day, so the
    // day claims nothing rather than a percentage of a window it broke. The
    // next day, which the booking only runs INTO, is untouched by that rule —
    // but its own 00:00 start is likewise outside its window here.
    const facts = new Map<string, DayHoursFact>([
      [YMD, SAVED_OPEN],
      ['2026-09-16', SAVED_OPEN],
    ])
    const days = appointmentsToWeekData(
      [appt({ id: 'late', starts_at: '2026-09-15T14:30:00Z', duration_minutes: 60 })],
      DAY,
      new Date('2026-09-16T00:00:00+09:00'),
      FALLBACK,
      TODAY,
      'ja',
      { byDay: new Map(), known: true },
      undefined,
      facts,
      true,
      { rosterHeadcount: 1 },
    )
    expect(days[0].capacityDefensible).toBe(false)
    expect(days[0].capacityReason).toBe('outside-hours')
    // The day it only runs INTO keeps its capacity — one late booking blanks
    // one day, not two (FIXLIST-1C-A R3).
    expect(days[1].capacityDefensible).toBe(true)
    expect(days[1].count).toBe(0)
  })

  it('the hours were never saved', () => {
    const day = row(ONE_STAFFER, {
      fact: { ...SAVED_OPEN, saved: false, source: 'default' },
    })
    expect(day.capacityDefensible).toBe(false)
    expect(day.hoursSaved).toBe(false)
    expect(day.availableMinutes).toBe(FALLBACK * 1)
  })

  it('the day is closed', () => {
    const day = row(ONE_STAFFER, {
      fact: { minutes: 0, openMinute: 0, closeMinute: 0, saved: true, source: 'store', closed: true },
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
      { byDay: new Map([[YMD, 1]]), known: true },
      undefined,
      facts,
      true,
      { rosterHeadcount: 1 },
    )[0]
    const without = appointmentsToWeekData(
      [appt({ customer_id: 'new-1' })],
      DAY,
      DAY,
      FALLBACK,
      TODAY,
      'ja',
      { byDay: new Map([[YMD, 1]]), known: true },
      undefined,
      facts,
      true,
      { rosterHeadcount: null },
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

// ── S7 — the window's extra day is for the SPANS, never for the counts ──────
describe('⚖ S7 — a booking that ran in from last night', () => {
  const PREV_NIGHT = appt({
    id: 'run-in',
    // 2026-09-14 23:00 JST → 2026-09-15 01:00 JST, i.e. two hours of the 15th
    // that the 15th's own fetch window would never have returned.
    starts_at: '2026-09-14T14:00:00Z',
    duration_minutes: 120,
  })

  it('reaches day 1 through the spans index, and NO count on day 1', () => {
    const day = row([PREV_NIGHT])
    // 件 and 予約時間 stay bucketed by START day, so the 15th counts nothing…
    expect(day.count).toBe(0)
    expect(day.bookedMinutes).toBe(0)
    // …but the model saw the row: its staffer worked, so the day has a lane,
    // and the two hours land entirely before the 10:00 open, so they occupy
    // none of the declared window.
    expect(day.capacityDefensible).toBe(true)
    expect(day.lanes).toBe(1)
    expect(day.capacityMinutes).toBe(600)
    expect(day.occupancyPct).toBe(0)
  })

  it('a run-in row that reaches INTO the open hours occupies them', () => {
    // 2026-09-14 23:00 JST → 2026-09-15 11:00 JST: one hour inside a
    // 10:00–20:00 window.
    const day = row([appt({ id: 'long-run-in', starts_at: '2026-09-14T14:00:00Z', duration_minutes: 720 })])
    expect(day.count).toBe(0)
    expect(day.capacityMinutes).toBe(600)
    expect(day.freeMinutes).toBe(540)
    expect(day.occupancyPct).toBe(10)
  })

  it('a row that starts today and ends tomorrow still withdraws TODAY', () => {
    // The mirror image: 19:00 → 03:00 starts inside the day and runs past the
    // 20:00 close, which is the day whose hours the booking broke.
    const day = row([appt({ id: 'overnight', starts_at: '2026-09-15T10:00:00Z', duration_minutes: 480 })])
    expect(day.capacityDefensible).toBe(false)
    expect(day.capacityReason).toBe('outside-hours')
  })
})
