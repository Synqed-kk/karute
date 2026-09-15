/**
 * ⚖ S8 — THE LAYER MATRIX (COUNCIL-C4 §(2), the 2026-09-12 00:5x amendment).
 *
 * Every layer this round adds has to work ALONE, TOGETHER, and with any one of
 * them switched OFF — and with everything OFF it must reproduce the screen the
 * salon had this morning, minus the named truth fixes and nothing else. A
 * layer that is honest only in the combination it was built in is not a layer,
 * it is a coincidence.
 *
 * The ALL-OFF row is the strongest of them, so it is not an assertion someone
 * wrote by hand: the SAME fixture was run through the adapter at the BASE SHA
 * (25c209377) and the output committed beside this file. This test re-runs the
 * fixture and diffs against that capture, key by key, on the keys the base
 * version had. Exactly two cells may differ, and they are named.
 *
 * Mutants m1–m7 are pinned as tests rather than as prose — each is the ONE
 * assertion that goes red if the guard it names is reversed. The mutant runs
 * themselves are in the build report.
 */
process.env.TZ = 'UTC'

import type { Appointment } from '@synqed-kk/client'
import type { DayHoursFact } from '@/lib/operating-hours'
import type * as Reservation from '@/lib/adapters/reservation'
import {
  APPTS,
  FALLBACK,
  TODAY,
  WEEK_START,
  WEEK_END,
  YMD,
  baseShape,
  hoursFacts,
} from './__fixtures__/capacity-week-fixture'
import BASELINE from './__fixtures__/capacity-allof-baseline.json'

type Switches = {
  multiStaffCapacity: boolean
  percentBands: boolean
  bedLanes: boolean
  shiftLanes: boolean
}

const ALL_ON: Switches = {
  multiStaffCapacity: true,
  percentBands: true,
  bedLanes: true,
  shiftLanes: true,
}
const ALL_OFF: Switches = {
  multiStaffCapacity: false,
  percentBands: false,
  bedLanes: false,
  shiftLanes: false,
}

/** The adapter re-required against a given switch state. The registry is a
 *  plain const object, so the only honest way to test a layer OFF is to load
 *  the module that reads it against that state — never to pass the switch in
 *  as an argument the shipped code does not have. */
function loadAdapter(overrides: Partial<Switches> = {}): typeof Reservation {
  jest.resetModules()
  jest.doMock('@/lib/appointments/booking-switches', () => {
    const actual = jest.requireActual('@/lib/appointments/booking-switches') as {
      BOOKING_SWITCHES: Record<string, boolean>
    }
    return { BOOKING_SWITCHES: { ...actual.BOOKING_SWITCHES, ...overrides } }
  })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/lib/adapters/reservation')
}

type WeekOpts = {
  switches?: Partial<Switches>
  rosterHeadcount?: number | null
  laneKind?: 'staff' | 'none'
  soloMode?: boolean
  appointments?: Appointment[]
  facts?: ReadonlyMap<string, DayHoursFact>
}

function weekRows(opts: WeekOpts = {}) {
  const { appointmentsToWeekData } = loadAdapter(opts.switches)
  return appointmentsToWeekData(
    opts.appointments ?? APPTS,
    WEEK_START,
    WEEK_END,
    FALLBACK,
    TODAY,
    'ja',
    new Set<string>(),
    undefined,
    opts.facts ?? hoursFacts(),
    opts.soloMode ?? true,
    {
      rosterHeadcount: opts.rosterHeadcount === undefined ? 1 : opts.rosterHeadcount,
      laneKind: opts.laneKind ?? 'staff',
    },
  )
}

function byDay(rows: ReturnType<typeof weekRows>) {
  return new Map(rows.map((r) => [r.dateIso, r]))
}

// ───────────────────────────────────────────────────────────────────────────
// ALL OFF — the required strongest-proof row
// ───────────────────────────────────────────────────────────────────────────

describe('ALL OFF = the screen this morning, minus exactly T1 and T2', () => {
  // The two declared truth fixes, and the shape of each difference.
  const T1 = YMD.tue // a booking an hour past the store's own close
  const T2 = YMD.wed // a day booked to the minute

  it('every key the base version had is byte-identical, except on the two named days', () => {
    const rows = weekRows({ switches: ALL_OFF, soloMode: true, rosterHeadcount: 1 })
    expect(rows).toHaveLength(BASELINE.length)

    const differing: string[] = []
    rows.forEach((row, i) => {
      const now = baseShape(row as unknown as Record<string, unknown>)
      const before = BASELINE[i] as unknown as Record<string, unknown>
      for (const key of Object.keys(before)) {
        if (JSON.stringify(now[key]) !== JSON.stringify(before[key])) {
          differing.push(`${before.dateIso as string}.${key}`)
        }
      }
    })

    // T1 and nothing else. The day claims no capacity any more, so its
    // denominator falls back to the old arithmetic — the two keys that carry
    // exactly that, and no third key anywhere in the week.
    expect(differing.sort()).toEqual([`${T1}.availableMinutes`, `${T1}.capacityDefensible`])
  })

  it('T1 — a day booked past its own close no longer claims a percentage', () => {
    const rows = byDay(weekRows({ switches: ALL_OFF }))
    const before = (BASELINE as unknown as Record<string, unknown>[]).find(
      (r) => r.dateIso === T1,
    )!
    expect(before.capacityDefensible).toBe(true) // it did, this morning
    expect(before.availableMinutes).toBe(600)

    const after = rows.get(T1)!
    expect(after.capacityDefensible).toBe(false)
    expect(after.capacityReason).toBe('outside-hours')
    expect(after.availableMinutes).toBe(FALLBACK) // the old fallback arithmetic
    // The 件 and the minutes staff already read are untouched.
    expect(after.count).toBe(1)
    expect(after.bookedMinutes).toBe(60)
  })

  it('T2 — a day booked to the minute reads 満 on the wire, at 100%', () => {
    const after = byDay(weekRows({ switches: ALL_OFF })).get(T2)!
    // The numbers the shipped screen renders do NOT move — this fix lands as a
    // FACT on the wire, which the wiring round turns into 「満」. Both keys the
    // base version had are identical, which is why T2 is not in the diff above.
    expect(after.capacityDefensible).toBe(true)
    expect(after.availableMinutes).toBe(600)
    // …and the new truth beside them.
    expect(after.full).toBe(true)
    expect(after.occupancyPct).toBe(100)
    expect(after.freeMinutes).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// SINGLES
// ───────────────────────────────────────────────────────────────────────────

describe('multiStaffCapacity ON alone', () => {
  const only = { ...ALL_OFF, multiStaffCapacity: true }

  it('a 3-staff store gets capacity 3 × the day’s minutes', () => {
    const row = byDay(weekRows({ switches: only, rosterHeadcount: 3, soloMode: false })).get(
      YMD.mon,
    )!
    expect(row.lanes).toBe(3)
    expect(row.capacityMinutes).toBe(1800)
    expect(row.availableMinutes).toBe(1800)
    expect(row.freeMinutes).toBe(1740) // one 60-minute booking
  })

  it('the SAME store gets nothing while the switch is OFF — it is not solo', () => {
    const row = byDay(
      weekRows({ switches: ALL_OFF, rosterHeadcount: 3, soloMode: false }),
    ).get(YMD.mon)!
    expect(row.capacityMinutes).toBeNull()
    expect(row.capacityReason).toBe('roster-unknown')
    expect(row.availableMinutes).toBe(FALLBACK * 1) // today's fallback, one staffer booked
  })

  it('a store whose ROSTER could not be read gets none, at any switch state', () => {
    for (const switches of [only, ALL_ON, ALL_OFF]) {
      const row = byDay(weekRows({ switches, rosterHeadcount: null, soloMode: false })).get(
        YMD.mon,
      )!
      expect(row.capacityMinutes).toBeNull()
      expect(row.capacityReason).toBe('roster-unknown')
    }
  })

  it('a CLASS-BOUND store gets none — one row is many people', () => {
    const row = byDay(
      weekRows({ switches: only, rosterHeadcount: 3, laneKind: 'none' }),
    ).get(YMD.mon)!
    expect(row.capacityMinutes).toBeNull()
    expect(row.capacityReason).toBe('kind-none')
    expect(row.laneKind).toBe('none')
  })
})

describe('percentBands ON alone', () => {
  it('changes NOTHING in this round — the field is merely present', () => {
    const on = weekRows({ switches: { ...ALL_OFF, percentBands: true } })
    const off = weekRows({ switches: ALL_OFF })
    expect(on).toEqual(off)
    // The band rides the wire either way; the surfaces read it in the wiring
    // round, which is when flipping this switch starts to mean something.
    expect(byDay(on).get(YMD.mon)!.band).toBe('light')
    expect(byDay(off).get(YMD.mon)!.band).toBe('light')
  })
})

describe('bedLanes ON alone', () => {
  it('is identical to OFF — no bed data exists for it to read', () => {
    // C1 §4: zero Resource rows exist and Karute never writes resource_id, so
    // no store can be identified as bed-bound. The key is declared and
    // reserved; nothing branches on it, which is why this row is inert.
    expect(weekRows({ switches: { ...ALL_OFF, bedLanes: true } })).toEqual(
      weekRows({ switches: ALL_OFF }),
    )
    expect(weekRows({ switches: { ...ALL_ON, bedLanes: false } })).toEqual(
      weekRows({ switches: ALL_ON }),
    )
  })
})

describe('shiftLanes ON alone', () => {
  it('is identical to OFF — it needs shift data that does not exist yet', () => {
    expect(weekRows({ switches: { ...ALL_OFF, shiftLanes: true } })).toEqual(
      weekRows({ switches: ALL_OFF }),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// PAIRS + ALL ON
// ───────────────────────────────────────────────────────────────────────────

describe('pairs — the inert keys never change the answer', () => {
  const pairs: [string, Partial<Switches>][] = [
    ['multiStaff + percentBands', { multiStaffCapacity: true, percentBands: true }],
    ['multiStaff + bedLanes', { multiStaffCapacity: true, bedLanes: true }],
    ['multiStaff + shiftLanes', { multiStaffCapacity: true, shiftLanes: true }],
    ['percentBands + bedLanes', { percentBands: true, bedLanes: true }],
    ['percentBands + shiftLanes', { percentBands: true, shiftLanes: true }],
    ['bedLanes + shiftLanes', { bedLanes: true, shiftLanes: true }],
  ]

  it.each(pairs)('%s reads exactly as multiStaffCapacity alone decides', (_name, pair) => {
    const rows = weekRows({ switches: { ...ALL_OFF, ...pair }, rosterHeadcount: 2 })
    const expected = weekRows({
      switches: { ...ALL_OFF, multiStaffCapacity: pair.multiStaffCapacity === true },
      rosterHeadcount: 2,
    })
    expect(rows).toEqual(expected)
  })

  it('ALL ON is the shipped state, and it is the multiStaffCapacity answer', () => {
    expect(weekRows({ switches: ALL_ON, rosterHeadcount: 2 })).toEqual(
      weekRows({ switches: { ...ALL_OFF, multiStaffCapacity: true }, rosterHeadcount: 2 }),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// NEIGHBOURING PRODUCT LAYERS off, with this round ON
// ───────────────────────────────────────────────────────────────────────────

describe('a neighbouring layer off, with this round ON', () => {
  it('no hours at all: the week degrades honestly, it does not lie', () => {
    const rows = weekRows({ switches: ALL_ON, facts: new Map(), rosterHeadcount: 2 })
    for (const row of rows) {
      expect(row.capacityMinutes).toBeNull()
      expect(row.capacityReason).toBe('hours-unresolved')
      expect(row.occupancyPct).toBeNull()
      expect(row.band).toBeNull()
      // The count table is the floor, and it is still there.
      expect(typeof row.count).toBe('number')
    }
  })

  it('solo_mode off: with the switch ON it is not consulted at all', () => {
    expect(weekRows({ switches: ALL_ON, soloMode: false, rosterHeadcount: 2 })).toEqual(
      weekRows({ switches: ALL_ON, soloMode: true, rosterHeadcount: 2 }),
    )
  })

  it('the terminal partitions off: the capacity facts do not move', () => {
    const withTerminal = weekRows({ switches: ALL_ON, rosterHeadcount: 2 })
    expect(withTerminal.map((r) => r.capacityMinutes)).toEqual(
      weekRows({ switches: ALL_ON, rosterHeadcount: 2 }).map((r) => r.capacityMinutes),
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// STORE ISOLATION
// ───────────────────────────────────────────────────────────────────────────

describe('⚖ store isolation — a divisor never sees another branch', () => {
  it("a store-restricted viewer's rows carry HER store's roster, never the business", () => {
    // Her store rosters two people; the business rosters forty. The lens the
    // doors pass is her store's, so the day divides by 2 × 600, and a number
    // built from 40 can never appear.
    const hers = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: 2 })).get(YMD.mon)!
    expect(hers.lanes).toBe(2)
    expect(hers.capacityMinutes).toBe(1200)

    const business = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: 40 })).get(YMD.mon)!
    expect(business.capacityMinutes).toBe(24_000)
    expect(hers.capacityMinutes).not.toBe(business.capacityMinutes)
  })

  it('MUTANT m1 — a roster that fails OPEN would invent a capacity here', () => {
    // The whole point of the divisor's fail-CLOSED posture: null is not
    // "everyone", it is "we do not know", and a day we cannot describe gets no
    // number rather than the business-wide one.
    const row = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: null })).get(YMD.mon)!
    expect(row.capacityMinutes).toBeNull()
    expect(row.capacityReason).toBe('roster-unknown')
    expect(row.occupancyPct).toBeNull()
    expect(row.freeMinutes).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// MUTANT PINS
// ───────────────────────────────────────────────────────────────────────────

describe('mutant pins', () => {
  it('m2 — the spans come from the INTERVAL, never duration_minutes', () => {
    // core stores duration_minutes as an independent nullable column and never
    // validates it against the interval (E30). Here they disagree by design:
    // the row runs 10:00–20:00 but claims 60 minutes. Reading the column would
    // make this a 10% day; reading the interval makes it the 満 day it is.
    const rows = weekRows({
      switches: ALL_ON,
      appointments: [
        {
          id: 'lying-duration',
          kind: 'BOOKING',
          customer_id: 'c1',
          staff_id: 's1',
          starts_at: '2026-09-14T01:00:00Z',
          ends_at: '2026-09-14T11:00:00Z',
          duration_minutes: 60,
          occupied_until: null,
          status: 'SCHEDULED',
          source: 'MANUAL',
          title: null,
          notes: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        } as unknown as Appointment,
      ],
    })
    const row = byDay(rows).get(YMD.mon)!
    expect(row.occupancyPct).toBe(100)
    expect(row.full).toBe(true)
  })

  it('m2b — occupied_until extends the interval when core snapshotted cleanup', () => {
    const rows = weekRows({
      switches: ALL_ON,
      appointments: [
        {
          id: 'with-cleanup',
          kind: 'BOOKING',
          customer_id: 'c1',
          staff_id: 's1',
          starts_at: '2026-09-14T01:00:00Z', // 10:00 JST
          ends_at: '2026-09-14T02:00:00Z', // 11:00 JST
          occupied_until: '2026-09-14T02:30:00Z', // 11:30 JST — the chair is busy
          duration_minutes: 60,
          status: 'SCHEDULED',
          source: 'MANUAL',
          title: null,
          notes: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        } as unknown as Appointment,
      ],
    })
    const row = byDay(rows).get(YMD.mon)!
    expect(row.freeMinutes).toBe(510) // 600 − 90, not 600 − 60
  })

  it('R1-2 — an occupied_until BEFORE ends_at never shortens the booking', () => {
    // The SDK gives occupied_until no contract of its own, so a stale snapshot
    // can sit before the row's real end. Trusting it blindly halved this
    // booking; the max keeps its full two hours.
    const rows = weekRows({
      switches: ALL_ON,
      appointments: [
        {
          id: 'stale-cleanup',
          kind: 'BOOKING',
          customer_id: 'c1',
          staff_id: 's1',
          starts_at: '2026-09-14T01:00:00Z', // 10:00 JST
          ends_at: '2026-09-14T03:00:00Z', // 12:00 JST
          occupied_until: '2026-09-14T02:00:00Z', // 11:00 JST — written before a move
          duration_minutes: 120,
          status: 'SCHEDULED',
          source: 'MANUAL',
          title: null,
          notes: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        } as unknown as Appointment,
      ],
    })
    const row = byDay(rows).get(YMD.mon)!
    expect(row.occupancyPct).toBe(20) // 120 of 600, not 60
    expect(row.freeMinutes).toBe(480)
  })

  it('R1-2 — MUTANT m2: an occupied_until before STARTS_AT used to erase the row', () => {
    // endMs < startMs made the interval run backwards, and capacityFactsFor
    // drops such a span — so a booked day reported itself empty and the
    // concurrency guard could not see the row at all. Without the max this
    // reads 0 % / 600 free.
    const rows = weekRows({
      switches: ALL_ON,
      appointments: [
        {
          id: 'backwards-cleanup',
          kind: 'BOOKING',
          customer_id: 'c1',
          staff_id: 's1',
          starts_at: '2026-09-14T01:00:00Z', // 10:00 JST
          ends_at: '2026-09-14T03:00:00Z', // 12:00 JST
          occupied_until: '2026-09-14T00:00:00Z', // 09:00 JST
          duration_minutes: 120,
          status: 'SCHEDULED',
          source: 'MANUAL',
          title: null,
          notes: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        } as unknown as Appointment,
      ],
    })
    const row = byDay(rows).get(YMD.mon)!
    expect(row.occupancyPct).toBe(20)
    expect(row.freeMinutes).toBe(480)
    expect(row.capacityReason).toBeNull()
  })

  it('m4 — laneKind ignoring the class-bound store would hand it a percentage', () => {
    const classBound = byDay(
      weekRows({ switches: ALL_ON, rosterHeadcount: 3, laneKind: 'none' }),
    ).get(YMD.mon)!
    const staffBound = byDay(
      weekRows({ switches: ALL_ON, rosterHeadcount: 3, laneKind: 'staff' }),
    ).get(YMD.mon)!
    expect(classBound.occupancyPct).toBeNull()
    expect(staffBound.occupancyPct).not.toBeNull()
  })

  it('m5 — the compat availableMinutes fallback is byte-identical on a day with no capacity', () => {
    // The fallback arm, unchanged: business hours × the staff who worked.
    // Friday has two staffers and (with no roster) no capacity.
    const row = byDay(weekRows({ switches: ALL_OFF, rosterHeadcount: null })).get(YMD.fri)!
    expect(row.capacityMinutes).toBeNull()
    expect(row.availableMinutes).toBe(FALLBACK * 2)
  })

  it('a closed day carries its bookings and its reason, never a number', () => {
    const row = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: 2 })).get(YMD.sat)!
    expect(row.closed).toBe(true)
    expect(row.capacityReason).toBe('closed')
    expect(row.count).toBe(1) // ⚖ the bookings on a 定休日 are real
    expect(row.occupancyPct).toBeNull()
  })

  it('an unsaved day says so, and says it is the HOURS that are missing', () => {
    const row = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: 2 })).get(YMD.sun)!
    expect(row.hoursSaved).toBe(false)
    expect(row.hoursSource).toBe('default')
    expect(row.capacityReason).toBe('hours-not-saved')
  })

  it('an ORG-blob day carries 稼働 and the band but promises no 空き minutes', () => {
    const facts = new Map(hoursFacts())
    facts.set(YMD.mon, {
      minutes: 600,
      openMinute: 600,
      closeMinute: 1200,
      saved: true,
      source: 'org',
      closed: false,
    })
    const row = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: 1, facts })).get(YMD.mon)!
    expect(row.hoursSource).toBe('org')
    expect(row.occupancyPct).toBe(10)
    expect(row.band).toBe('light')
    expect(row.freeMinutes).toBeNull() // E21 — a business default is not this store's word
  })
})

// ───────────────────────────────────────────────────────────────────────────
// ⚖ R1-8 — THE NO-CAPACITY DEFAULT PAIRS ITS FIELDS
// ───────────────────────────────────────────────────────────────────────────

describe('capacityRowFields(undefined) — the door that never looked says so', () => {
  it('pairs capacityMinutes null with a REASON, like every module withdrawal', () => {
    const { capacityRowFields } = loadAdapter()
    const row = capacityRowFields(undefined)
    expect(row.capacityMinutes).toBeNull()
    // Everywhere else in the model a null reason means "there IS a capacity",
    // so "no capacity, no reason" was a shape the 未設定 cell could not read.
    expect(row.capacityReason).toBe('unknown')
  })

  it('does not CLAIM the store runs classes', () => {
    const { capacityRowFields } = loadAdapter()
    // 'none' is a positive statement — one row is many people, no percentage is
    // honest here — and this door has not looked at the store at all.
    expect(capacityRowFields(undefined).laneKind).not.toBe('none')
    expect(capacityRowFields(undefined).laneKind).toBe('staff')
  })

  it('the module’s own facts are passed through unchanged, reason and all', () => {
    const rows = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: 2 }))
    // A day WITH a capacity still carries a null reason — which is what makes
    // the pairing readable in the first place.
    expect(rows.get(YMD.mon)!.capacityReason).toBeNull()
    expect(rows.get(YMD.sat)!.capacityReason).toBe('closed')
    expect(rows.get(YMD.sun)!.capacityReason).toBe('hours-not-saved')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// THE MONTH READS THE SAME FACTS
// ───────────────────────────────────────────────────────────────────────────

describe('the month cell and the week row describe the same day', () => {
  it('appointmentsToMonthFacts agrees with the week row, key for key', () => {
    const { appointmentsToMonthFacts } = loadAdapter(ALL_ON)
    const facts = appointmentsToMonthFacts(APPTS, WEEK_START, WEEK_END, {
      hoursFacts: hoursFacts(),
      soloMode: true,
      rosterHeadcount: 2,
      laneKind: 'staff',
    })
    const rows = byDay(weekRows({ switches: ALL_ON, rosterHeadcount: 2 }))
    for (const [ymd, fact] of facts) {
      const row = rows.get(ymd)!
      expect(fact.capacityMinutes).toBe(row.capacityMinutes)
      expect(fact.occupancyPct).toBe(row.occupancyPct)
      expect(fact.lanes).toBe(row.lanes)
      expect(fact.reason).toBe(row.capacityReason)
    }
  })

  it('covers exactly the in-month days it was asked for', () => {
    const { appointmentsToMonthFacts } = loadAdapter(ALL_ON)
    const facts = appointmentsToMonthFacts(APPTS, WEEK_START, WEEK_END, {})
    expect([...facts.keys()]).toEqual([
      YMD.mon,
      YMD.tue,
      YMD.wed,
      YMD.thu,
      YMD.fri,
      YMD.sat,
      YMD.sun,
    ])
  })
})
