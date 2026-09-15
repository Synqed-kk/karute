/**
 * ONE capacity per store-day — `src/lib/capacity/capacity.ts`.
 *
 * Pure logic, no mocks, fixtures built by hand (the lane's style). Every `it`
 * is named after the council edge it pins (COUNCIL-C3-BLINDSPOTS-CAPACITY
 * THE TABLE, E1–E35) and every expected number is recomputed here from the
 * fixture rather than copied from the council's prose.
 *
 * The standard fixture is one JST day, 2026-09-19 (a Saturday), with the
 * store's own saved hours 10:00–20:00 = 600 minutes per lane.
 */
import {
  capacityForDay,
  peakConcurrency,
  clipToWindow,
  bandFor,
  type BookedSpan,
  type CapacityFact,
  type CapacityInput,
  type DayHours,
} from '@/lib/capacity/capacity'

const DAY_START = Date.parse('2026-09-19T00:00:00+09:00') // Saturday
const DAY_END = DAY_START + 86_400_000
const SUN_START = DAY_END
const SUN_END = SUN_START + 86_400_000

/** An absolute instant, h:m JST on the fixture's Saturday. */
const at = (h: number, m = 0): number => DAY_START + (h * 60 + m) * 60_000
/** The same on the Sunday after it. */
const sun = (h: number, m = 0): number => SUN_START + (h * 60 + m) * 60_000

const STORE_HOURS: DayHours = { openMs: at(10), closeMs: at(20), source: 'store', closed: false }

function span(startMs: number, endMs: number, staffId: string | null = 's1'): BookedSpan {
  return { startMs, endMs, staffId }
}

function input(over: Partial<CapacityInput> = {}): CapacityInput {
  return {
    laneKind: 'staff',
    rosterLanes: 1,
    hours: STORE_HOURS,
    dayStartMs: DAY_START,
    dayEndMs: DAY_END,
    spans: [],
    ...over,
  }
}

describe('capacityForDay — the council edges', () => {
  it('E1: roster only — 4 rostered, 1 off, twelve 60-minute rows → 2400 capacity, 30%, light, 1680 free', () => {
    // Three staff each take 10:00,11:00,12:00,13:00 — 12 rows × 60 = 720 booked.
    const spans: BookedSpan[] = []
    for (const staff of ['s1', 's2', 's3']) {
      for (const h of [10, 11, 12, 13]) spans.push(span(at(h), at(h + 1), staff))
    }
    const fact = capacityForDay(input({ rosterLanes: 4, spans }))

    expect(spans).toHaveLength(12)
    expect(fact.reason).toBeNull()
    expect(fact.lanes).toBe(4) // roster 4 is the floor; only 3 worked
    expect(fact.capacityMinutes).toBe(2400) // 4 × 600
    expect(fact.bookedMinutes).toBe(720)
    expect(fact.occupancyPct).toBe(30) // 720 ÷ 2400
    expect(fact.band).toBe('light')
    expect(fact.full).toBe(false)
    expect(fact.availableMinutes).toBe(1680) // 2400 − 720, and source is 'store'
    expect(fact.hoursSource).toBe('store')
  })

  it('E1: floor lifts — worked exceeds the roster, so lanes must FAIL if the floor is removed (R8)', () => {
    // Roster 2, but 3 DISTINCT people work — worked.size(3) > rosterLanes(2),
    // so `lanes = max(roster, worked)` must actually bind here. E1's own
    // roster-only fixture never exercised this: roster(4) ≥ worked(3) there,
    // so a mutant that dropped the floor (`lanes = input.rosterLanes`) would
    // still pass it unnoticed.
    const spans = ['s1', 's2', 's3'].map((staff) => span(at(10), at(11), staff))
    const fact = capacityForDay(input({ rosterLanes: 2, spans }))

    expect(fact.reason).toBeNull()
    expect(fact.lanes).toBe(3) // would be 2 if the floor were removed
    expect(fact.capacityMinutes).toBe(1800) // would be 1200 without the floor
    expect(fact.bookedMinutes).toBe(180)
    expect(fact.occupancyPct).toBe(10) // would be 15 without the floor
    expect(fact.band).toBe('light')
    expect(fact.availableMinutes).toBe(1620) // would be 1020 without the floor
  })

  it('E2: a helper off the roster works beside 3 rostered → the floor lifts lanes to 4, 72.5%', () => {
    const spans = [
      span(at(10), at(18), 's1'), // 480
      span(at(10), at(18), 's2'), // 480
      span(at(10), at(19), 's3'), // 540  → rostered 1500
      span(at(10), at(14), 'helper'), // 240
    ]
    const fact = capacityForDay(input({ rosterLanes: 3, spans }))

    expect(fact.reason).toBeNull()
    expect(fact.lanes).toBe(4) // max(roster 3, worked 4) — a FLOOR, never a ceiling
    expect(fact.capacityMinutes).toBe(2400)
    expect(fact.bookedMinutes).toBe(1740) // 1500 + 240
    expect(fact.occupancyPct).toBe(73) // R4: Math.round(72.5) — the renderer and the band read this same integer
    expect(fact.band).toBe('busy')
    expect(fact.availableMinutes).toBe(660)
  })

  it('E3: two overlapping rows on ONE person at roster 1 → over-concurrency, not a quiet day', () => {
    const spans = [span(at(10), at(11), 's1'), span(at(10, 30), at(11, 30), 's1')]
    const fact = capacityForDay(input({ rosterLanes: 1, spans }))

    expect(fact.reason).toBe('over-concurrency')
    expect(fact.capacityMinutes).toBeNull()
    expect(fact.lanes).toBe(1)
    expect(fact.bookedMinutes).toBe(120)
    expect(fact.occupancyPct).toBeNull()
    expect(fact.band).toBeNull()
    expect(fact.availableMinutes).toBeNull()
    expect(fact.full).toBe(false)
  })

  it('E4: a 23:00→02:00 row is outside the Saturday that closes at 20:00', () => {
    const fact = capacityForDay(input({ spans: [span(at(23), sun(2))] }))

    expect(fact.reason).toBe('outside-hours')
    expect(fact.capacityMinutes).toBeNull()
    // R2: bookedMinutes is the day-clipped minutes (23:00–24:00 on Saturday),
    // not the 0 that fell inside 10:00–20:00.
    expect(fact.bookedMinutes).toBe(60)
  })

  it('E4: the same row is still outside a Saturday that closes at 24:00 — it runs past the close', () => {
    const fact = capacityForDay(
      input({
        hours: { openMs: at(10), closeMs: DAY_END, source: 'store', closed: false },
        spans: [span(at(23), sun(2))],
      }),
    )

    expect(fact.reason).toBe('outside-hours')
    expect(fact.bookedMinutes).toBe(60) // 23:00–24:00 is inside; the 2h past midnight are not
  })

  it('E4/R3: the Sunday it runs into no longer withdraws — one booking blanks one day, not two', () => {
    // Supersedes the 12:5x D-1 amendment's second sentence (R3, lead re-ruling):
    // this row does not START Sunday, so it can no longer withdraw Sunday —
    // only the Saturday it actually starts on (see the sibling E4 case above).
    const fact = capacityForDay(
      input({
        hours: { openMs: sun(10), closeMs: sun(20), source: 'store', closed: false },
        dayStartMs: SUN_START,
        dayEndMs: SUN_END,
        spans: [span(at(23), sun(2))],
      }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.capacityMinutes).toBe(600) // 1 lane × 10h; the row adds no lane (0 inside minutes)
    // R2 round 2 (HIGH-1): capacity is present, so bookedMinutes IS
    // windowMinutes (0 — none of the row lands inside Sunday's 10:00–20:00),
    // not the day-clipped 120 round 1 reported.
    expect(fact.bookedMinutes).toBe(0)
    expect(fact.occupancyPct).toBe(0) // none of it lands inside Sunday's 10:00–20:00
    expect(fact.band).toBe('light')
    expect(fact.availableMinutes).toBe(600)
  })

  it('E4: a Sunday that opens at 00:00 sees the 120 minutes it actually loses', () => {
    const fact = capacityForDay(
      input({
        hours: { openMs: SUN_START, closeMs: sun(20), source: 'store', closed: false },
        dayStartMs: SUN_START,
        dayEndMs: SUN_END,
        spans: [span(at(23), sun(2))],
      }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.capacityMinutes).toBe(1200) // 1 lane × 20h
    expect(fact.bookedMinutes).toBe(120)
    expect(fact.occupancyPct).toBe(10)
    expect(fact.band).toBe('light')
    expect(fact.availableMinutes).toBe(1080)
  })

  it('E5: a 300-minute row from 18:00 against a 20:00 close → outside-hours, the DAY reports 300 booked (R2)', () => {
    const fact = capacityForDay(input({ spans: [span(at(18), at(23))] }))

    expect(fact.reason).toBe('outside-hours')
    expect(fact.capacityMinutes).toBeNull()
    // R2: bookedMinutes is the day-clipped minutes (予約時間) — the whole
    // 18:00–23:00 row falls inside the JST day, not just its 18:00–20:00
    // slice against the store's hours.
    expect(fact.bookedMinutes).toBe(300)
    expect(fact.lanes).toBe(1) // R5: the roster, not the 0 default — real even on withdrawal
  })

  it("E6: a saved '24:00' close is 840 lane-minutes and keeps source 'store'", () => {
    const fact = capacityForDay(
      input({ hours: { openMs: at(10), closeMs: DAY_END, source: 'store', closed: false } }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.lanes).toBe(1)
    expect(fact.capacityMinutes).toBe(840) // 1 lane × 14h
    expect(fact.hoursSource).toBe('store')
    expect(fact.bookedMinutes).toBe(0)
    expect(fact.occupancyPct).toBe(0)
    expect(fact.band).toBe('light')
    expect(fact.availableMinutes).toBe(840)
  })

  it('R1: NaN/Infinity/non-forward hours never reach the divisor — hours-unresolved, every field finite or null', () => {
    const cases: DayHours[] = [
      { openMs: NaN, closeMs: at(20), source: 'store', closed: false },
      { openMs: at(10), closeMs: Infinity, source: 'store', closed: false },
      { openMs: at(10), closeMs: at(10), source: 'store', closed: false }, // closeMs === openMs
    ]
    for (const hours of cases) {
      const fact = capacityForDay(input({ rosterLanes: 2, hours, spans: [span(at(9), at(10))] }))

      expect(fact.reason).toBe('hours-unresolved')
      expect(fact.capacityMinutes).toBeNull()
      for (const value of [
        fact.capacityMinutes,
        fact.lanes,
        fact.bookedMinutes,
        fact.occupancyPct,
        fact.availableMinutes,
      ]) {
        expect(value === null || Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('E10: a brand-new store (roster 0, no rows) prints no-lanes and never a NaN', () => {
    const fact = capacityForDay(input({ rosterLanes: 0 }))

    expect(fact.reason).toBe('no-lanes')
    expect(fact.capacityMinutes).toBeNull() // never 0-as-unknown
    expect(fact.lanes).toBe(0)
    expect(fact.occupancyPct).toBeNull()
    expect(fact.band).toBeNull()
    expect(fact.availableMinutes).toBeNull()
    for (const value of [
      fact.capacityMinutes,
      fact.lanes,
      fact.bookedMinutes,
      fact.occupancyPct,
      fact.availableMinutes,
    ]) {
      expect(Number.isNaN(value)).toBe(false)
    }
  })

  it('E11: the owner who cuts — 3 people full against a roster of 2 → lanes 3, 100%, 満', () => {
    const spans = ['owner', 's1', 's2'].map((staff) => span(at(10), at(20), staff))
    const fact = capacityForDay(input({ rosterLanes: 2, spans }))

    expect(fact.reason).toBeNull()
    expect(fact.lanes).toBe(3) // the floor keeps her a lane
    expect(fact.capacityMinutes).toBe(1800)
    expect(fact.bookedMinutes).toBe(1800)
    expect(fact.occupancyPct).toBe(100)
    expect(fact.full).toBe(true)
    expect(fact.band).toBe('busy')
    expect(fact.availableMinutes).toBe(0)
  })

  it('E12: recorded overcount (receptionist counted until takesBookings is real)', () => {
    const spans = ['s1', 's2', 's3'].map((staff) => span(at(10), at(20), staff))
    const fact = capacityForDay(input({ rosterLanes: 5, spans }))

    expect(fact.reason).toBeNull()
    expect(fact.lanes).toBe(5)
    expect(fact.capacityMinutes).toBe(3000)
    expect(fact.bookedMinutes).toBe(1800)
    expect(fact.occupancyPct).toBe(60)
    expect(fact.band).toBe('medium')
    expect(fact.availableMinutes).toBe(1200)
  })

  it('E14: an unassigned row is booked minutes like any other', () => {
    const fact = capacityForDay(
      input({ rosterLanes: 2, spans: [span(at(10), at(11), 's1'), span(at(12), at(13), null)] }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.bookedMinutes).toBe(120)
    expect(fact.lanes).toBe(2) // an unassigned row adds no lane
    expect(fact.capacityMinutes).toBe(1200)
    expect(fact.occupancyPct).toBe(10)
    expect(fact.availableMinutes).toBe(1080)
  })

  it('E14: two overlapping unassigned rows count toward concurrency', () => {
    const fact = capacityForDay(
      input({
        rosterLanes: 1,
        spans: [span(at(10), at(11), null), span(at(10, 30), at(11, 30), null)],
      }),
    )

    expect(fact.reason).toBe('over-concurrency')
    expect(fact.bookedMinutes).toBe(120)
    expect(fact.lanes).toBe(1)
  })

  it("E21: an org-blob day may carry 稼働 and a band, never 空き", () => {
    const spans = [span(at(10), at(15), 's1'), span(at(10), at(15), 's2')]
    const fact = capacityForDay(
      input({
        rosterLanes: 2,
        hours: { openMs: at(10), closeMs: at(20), source: 'org', closed: false },
        spans,
      }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.hoursSource).toBe('org')
    expect(fact.capacityMinutes).toBe(1200)
    expect(fact.bookedMinutes).toBe(600)
    expect(fact.occupancyPct).toBe(50)
    expect(fact.band).toBe('medium')
    expect(fact.availableMinutes).toBeNull() // an HQ default is not this store's declaration
  })

  it('E23: exactly 100% keeps its capacity, says 満, and leaves 0 free', () => {
    const fact = capacityForDay(input({ rosterLanes: 1, spans: [span(at(10), at(20), 's1')] }))

    expect(fact.reason).toBeNull()
    expect(fact.capacityMinutes).toBe(600) // never withdrawn
    expect(fact.bookedMinutes).toBe(600)
    expect(fact.occupancyPct).toBe(100)
    expect(fact.full).toBe(true)
    expect(fact.band).toBe('busy')
    expect(fact.availableMinutes).toBe(0)
  })

  it('R2-HIGH-2: 597 of 600 minutes booked → 99%, not 満, 3 free (E23/E24 held; the tolerance gap closed)', () => {
    const fact = capacityForDay(
      input({ rosterLanes: 1, spans: [span(at(10), at(10) + 597 * 60_000, 's1')] }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.capacityMinutes).toBe(600)
    expect(fact.bookedMinutes).toBe(597)
    expect(fact.occupancyPct).toBe(99)
    expect(fact.full).toBe(false)
    expect(fact.availableMinutes).toBe(3)
  })

  it('R2-HIGH-2: 599.7 of 600 minutes booked (inside the old 0.5-minute tolerance) still reads 満 at 100%, 0 free', () => {
    const fact = capacityForDay(
      input({ rosterLanes: 1, spans: [span(at(10), at(10) + 599.7 * 60_000, 's1')] }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.occupancyPct).toBe(100)
    expect(fact.full).toBe(true)
    expect(fact.availableMinutes).toBe(0)
  })

  it('R2-HIGH-2: a 10-lane store with 5,980 of 6,000 minutes booked → 99%, not 満, 20 free (the gap widens with store size)', () => {
    const spans = Array.from({ length: 10 }, (_, i) =>
      span(at(10), at(10) + 598 * 60_000, `s${i + 1}`),
    )
    const fact = capacityForDay(input({ rosterLanes: 10, spans }))

    expect(fact.reason).toBeNull()
    expect(fact.capacityMinutes).toBe(6000)
    expect(fact.bookedMinutes).toBe(5980)
    expect(fact.occupancyPct).toBe(99)
    expect(fact.full).toBe(false)
    expect(fact.availableMinutes).toBe(20)
  })

  it('E24: the 610-in-600 shape can only reach the module as over-concurrency — and the band above 100 is still busy', () => {
    // The council's 101.67% cell came from a bed plane. On the staff plane the
    // concurrency guard runs first and bounds Σ inside-minutes by lanes ×
    // laneMinutes, so a day that passes every rule can never exceed 100%
    // (∫ concurrency dt ≤ lanes × laneMinutes). The extra 10 minutes therefore
    // surface as the wrong lane count, which is what they are.
    const spans = [
      span(at(10), at(15), 's1'), // 300
      span(at(15), at(20), 's1'), // 300
      span(at(10), at(10, 10), 's1'), // 10 → collides with the first
    ]
    const fact = capacityForDay(input({ rosterLanes: 1, spans }))

    expect(fact.reason).toBe('over-concurrency')
    expect(fact.bookedMinutes).toBe(610)
    expect(fact.capacityMinutes).toBeNull()
    // Nothing in the module clamps: the band table answers above 100 too.
    expect(bandFor((610 / 600) * 100)).toBe('busy')
  })

  it("E25: the 10:00–24:00 fallback is not a fact about the day → hours-not-saved", () => {
    const fact = capacityForDay(
      input({
        rosterLanes: 2,
        hours: { openMs: at(10), closeMs: DAY_END, source: 'default', closed: false },
        spans: [span(at(9), at(10))],
      }),
    )

    expect(fact.reason).toBe('hours-not-saved')
    expect(fact.capacityMinutes).toBeNull()
    expect(fact.hoursSource).toBe('default')
    // The unsaved window never clips: the row's own 60 minutes are still reported.
    expect(fact.bookedMinutes).toBe(60)
  })

  it('E28: an unreadable roster fails CLOSED', () => {
    const fact = capacityForDay(input({ rosterLanes: null, spans: [span(at(10), at(11))] }))

    expect(fact.reason).toBe('roster-unknown')
    expect(fact.capacityMinutes).toBeNull()
    expect(fact.lanes).toBe(0)
    expect(fact.bookedMinutes).toBe(60)
  })

  it('R6: a non-finite rosterLanes (NaN, Infinity) fails CLOSED like null', () => {
    for (const rosterLanes of [NaN, Infinity]) {
      const fact = capacityForDay(input({ rosterLanes, spans: [span(at(10), at(11))] }))

      expect(fact.reason).toBe('roster-unknown')
      expect(fact.capacityMinutes).toBeNull()
      expect(fact.lanes).toBe(0)
      expect(fact.bookedMinutes).toBe(60)
    }
  })

  it('E31: the solo store keeps its merged overlap guard', () => {
    const fact = capacityForDay(
      input({
        rosterLanes: 1,
        spans: [span(at(10), at(12), 's1'), span(at(11), at(12), null)],
      }),
    )

    expect(fact.reason).toBe('over-concurrency')
    expect(fact.lanes).toBe(1)
    expect(fact.bookedMinutes).toBe(180)
  })

  it('E35: occupied_until — a longer end instant grows booked by the cleanup minutes', () => {
    const withoutCleanup = capacityForDay(input({ spans: [span(at(10), at(11))] }))
    const withCleanup = capacityForDay(input({ spans: [span(at(10), at(11, 15))] }))

    expect(withoutCleanup.bookedMinutes).toBe(60)
    expect(withCleanup.bookedMinutes).toBe(75)
    expect(withCleanup.bookedMinutes - withoutCleanup.bookedMinutes).toBe(15)
    expect(withCleanup.capacityMinutes).toBe(600)
    expect(withCleanup.occupancyPct).toBe(13) // R4: Math.round(12.5)
  })

  it('KIND-NONE: a count-table day still reports its 予約時間', () => {
    const fact = capacityForDay(
      input({
        laneKind: 'none',
        rosterLanes: 3,
        spans: [span(at(10), at(11), 's1'), span(at(12), at(13), 's2')],
      }),
    )

    expect(fact.reason).toBe('kind-none')
    expect(fact.capacityMinutes).toBeNull()
    expect(fact.lanes).toBe(0)
    expect(fact.laneKind).toBe('none')
    expect(fact.bookedMinutes).toBe(120)
    expect(fact.occupancyPct).toBeNull()
    expect(fact.band).toBeNull()
    expect(fact.availableMinutes).toBeNull()
    expect(fact.hoursSource).toBe('store')
  })

  it('R4: 13-way tiling drift (IEEE float, not an unfilled window) still reads 満 at pct 100', () => {
    // L1's tiling defect: dividing the window into 13 equal-length spans and
    // summing each one's own (endMs-startMs)/60000 back up does not land on
    // exactly 600 in floating point (599.9999999999999) — the exact-equality
    // `full` check used to miss a window that was, in fact, completely filled.
    const sliceMs = (STORE_HOURS.closeMs - STORE_HOURS.openMs) / 13
    const spans = Array.from({ length: 13 }, (_, i) =>
      span(STORE_HOURS.openMs + i * sliceMs, STORE_HOURS.openMs + (i + 1) * sliceMs, 's1'),
    )
    const fact = capacityForDay(input({ rosterLanes: 1, spans }))

    expect(fact.reason).toBeNull()
    expect(fact.capacityMinutes).toBe(600)
    expect(fact.bookedMinutes).toBeCloseTo(600, 9) // sums to ~599.9999999999999, not exactly 600
    expect(fact.occupancyPct).toBe(100) // Math.round of the ~99.9999999999999 raw value
    expect(fact.full).toBe(true) // R4: capacity − window < 0.5, not an exact >= check
    expect(fact.band).toBe('busy')
  })

  it('R4: rounding decides the band at the 35/65 boundaries — 34.6→35 medium, 65.4→65 medium, 65.5→66 busy', () => {
    const pct346 = capacityForDay(
      input({ rosterLanes: 1, spans: [span(at(10), at(10) + 207.6 * 60_000, 's1')] }),
    )
    expect(pct346.occupancyPct).toBe(35)
    expect(pct346.band).toBe('medium')

    const pct654 = capacityForDay(
      input({ rosterLanes: 1, spans: [span(at(10), at(10) + 392.4 * 60_000, 's1')] }),
    )
    expect(pct654.occupancyPct).toBe(65)
    expect(pct654.band).toBe('medium')

    const pct655 = capacityForDay(
      input({ rosterLanes: 1, spans: [span(at(10), at(10) + 393 * 60_000, 's1')] }),
    )
    expect(pct655.occupancyPct).toBe(66)
    expect(pct655.band).toBe('busy')
  })

  it('R3: a run-in row that ends before open no longer withdraws today', () => {
    // 22:00 the previous night → 08:00 today, open 10:00: the row never
    // starts today, so rule 4 does not look at it at all (R3 deletes the
    // branch that used to withdraw a day over a row it doesn't start).
    const fact = capacityForDay(
      input({ rosterLanes: 1, spans: [span(DAY_START - 2 * 3_600_000, at(8), 's1')] }),
    )

    expect(fact.reason).toBeNull() // capacity present
    expect(fact.capacityMinutes).toBe(600)
    // R2 round 2 (HIGH-1): capacity is present, so bookedMinutes IS
    // windowMinutes (0 — none of it lands inside 10:00–20:00), not the
    // day-clipped 480 round 1 reported.
    expect(fact.bookedMinutes).toBe(0)
    expect(fact.occupancyPct).toBe(0) // windowMinutes 0 — none of it lands inside 10:00–20:00
    expect(fact.availableMinutes).toBe(600)
  })

  it('R8: KIND-NONE short-circuits even when the hours would otherwise have produced capacity', () => {
    const fact = capacityForDay(
      input({ laneKind: 'none', rosterLanes: 2, spans: [span(at(10), at(11), 's1')] }),
    )

    expect(fact.reason).toBe('kind-none')
    expect(fact.capacityMinutes).toBeNull()
    expect(fact.lanes).toBe(0)
    expect(fact.occupancyPct).toBeNull()
    expect(fact.band).toBeNull()
    expect(fact.availableMinutes).toBeNull()
  })

  it('R2: a class outside the store hours still reports its day minutes on a kind-none store', () => {
    const fact = capacityForDay(
      input({ laneKind: 'none', rosterLanes: 3, spans: [span(at(21), at(22))] }),
    )

    expect(fact.reason).toBe('kind-none')
    expect(fact.capacityMinutes).toBeNull()
    expect(fact.bookedMinutes).toBe(60) // was 0 — 21:00–22:00 falls outside 10:00–20:00
  })

  it('CLOSED: 定休日 with bookings on it reports the minutes and no capacity', () => {
    const fact = capacityForDay(
      input({
        rosterLanes: 2,
        hours: { openMs: DAY_START, closeMs: DAY_START, source: 'store', closed: true },
        spans: [span(at(10), at(11)), span(at(13), at(14))],
      }),
    )

    expect(fact.reason).toBe('closed')
    expect(fact.capacityMinutes).toBeNull()
    expect(fact.bookedMinutes).toBe(120) // clipped to the JST day, not to a 0-wide window
  })

  it('HOURS UNRESOLVED: no fact at all still reports the day’s minutes', () => {
    const fact = capacityForDay(
      input({ rosterLanes: 2, hours: null, spans: [span(at(10), at(11))] }),
    )

    expect(fact.reason).toBe('hours-unresolved')
    expect(fact.hoursSource).toBeNull()
    expect(fact.bookedMinutes).toBe(60)
  })

  it('WINDOW EDGE: a row that began last night and runs into today’s hours contributes its inside minutes', () => {
    const fact = capacityForDay(
      input({ rosterLanes: 1, spans: [span(DAY_START - 3 * 3_600_000, at(11), 's1')] }),
    )

    expect(fact.reason).toBeNull() // no 'outside-hours' — it is last night's booking
    // R2 round 2 (HIGH-1): capacity is present, so bookedMinutes IS
    // windowMinutes — the 10:00–11:00 hour inside the store's window (60),
    // not the day-clipped 660 round 1 reported.
    expect(fact.bookedMinutes).toBe(60)
    expect(fact.lanes).toBe(1)
    expect(fact.capacityMinutes).toBe(600)
    expect(fact.occupancyPct).toBe(10)
    expect(fact.availableMinutes).toBe(540)
  })

  it('WINDOW EDGE: a row entirely on another day is not "outside" — it contributes nothing', () => {
    const fact = capacityForDay(
      input({ rosterLanes: 1, spans: [span(sun(10), sun(11), 's1'), span(at(10), at(11), 's1')] }),
    )

    expect(fact.reason).toBeNull()
    expect(fact.bookedMinutes).toBe(60)
  })

  it(
    'R9: a NaN startMs never launders into booked minutes or a lane, and never hangs',
    () => {
      const fact = capacityForDay(
        input({ rosterLanes: 1, spans: [{ startMs: NaN, endMs: at(11), staffId: 's1' }] }),
      )

      expect(fact.reason).toBeNull()
      expect(fact.bookedMinutes).toBe(0)
      expect(fact.lanes).toBe(1) // roster floor only — the NaN span adds no worked staffer
      expect(fact.capacityMinutes).toBe(600)
    },
    2000,
  )
})

describe('bandFor — the one 35/65 table', () => {
  it('BANDS: 0 light · 34.99 light · 35 medium · 65 medium · 65.01 busy', () => {
    expect(bandFor(0)).toBe('light')
    expect(bandFor(34.99)).toBe('light')
    expect(bandFor(35)).toBe('medium')
    expect(bandFor(65)).toBe('medium')
    expect(bandFor(65.01)).toBe('busy')
  })
})

describe('peakConcurrency — the sweep', () => {
  it('CONCURRENCY: touching intervals do not overlap', () => {
    expect(
      peakConcurrency([
        { startMs: at(10), endMs: at(11) },
        { startMs: at(11), endMs: at(12) },
      ]),
    ).toBe(1)
  })

  it('CONCURRENCY: three staggered rows peak at 3', () => {
    expect(
      peakConcurrency([
        { startMs: at(10), endMs: at(13) },
        { startMs: at(11), endMs: at(14) },
        { startMs: at(12), endMs: at(15) },
      ]),
    ).toBe(3)
  })

  it('CONCURRENCY: an empty day peaks at 0', () => {
    expect(peakConcurrency([])).toBe(0)
  })

  it(
    'CONCURRENCY: a NaN startMs is dropped, not counted, not a hang',
    () => {
      expect(
        peakConcurrency([
          { startMs: NaN, endMs: at(11) },
          { startMs: at(10), endMs: at(11) },
        ]),
      ).toBe(1)
    },
    2000,
  )

  it(
    'CONCURRENCY: an Infinity endMs is dropped, not counted',
    () => {
      expect(
        peakConcurrency([
          { startMs: at(10), endMs: Infinity },
          { startMs: at(10), endMs: at(11) },
        ]),
      ).toBe(1)
    },
    2000,
  )

  it(
    'CONCURRENCY: a -Infinity startMs is dropped, not counted',
    () => {
      expect(
        peakConcurrency([
          { startMs: -Infinity, endMs: at(11) },
          { startMs: at(10), endMs: at(11) },
        ]),
      ).toBe(1)
    },
    2000,
  )

  it('CONCURRENCY: 200 spans sweep in well under 50 ms', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      startMs: at(10) + i,
      endMs: at(11) + i,
    }))
    const started = Date.now()
    const peak = peakConcurrency(many)
    const elapsed = Date.now() - started

    expect(peak).toBe(200)
    expect(elapsed).toBeLessThan(50)
  })
})

describe('clipToWindow — inside and outside', () => {
  it('E5: the part after close is outside, the part before it is inside', () => {
    expect(clipToWindow(span(at(18), at(23)), at(10), at(20), DAY_START, DAY_END)).toEqual({
      insideMinutes: 120,
      outsideMinutes: 180,
    })
  })

  it('E4: a row on another day yields nothing and is not outside', () => {
    expect(clipToWindow(span(sun(10), sun(11)), at(10), at(20), DAY_START, DAY_END)).toEqual({
      insideMinutes: 0,
      outsideMinutes: 0,
    })
  })

  it('WINDOW EDGE: a row from last night is inside from open onward', () => {
    expect(
      clipToWindow(
        span(DAY_START - 3 * 3_600_000, at(11)),
        at(10),
        at(20),
        DAY_START,
        DAY_END,
      ),
    ).toEqual({ insideMinutes: 60, outsideMinutes: 600 })
  })
})

describe('PROPERTY — round 2 HIGH-1/HIGH-2: capacity-present coherence (seeded, 300 trials)', () => {
  // ponytail: mulberry32 — the smallest deterministic PRNG, no dependency
  // needed for a seeded test loop.
  function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** Every capacity-present, store-sourced fact from 300 seeded trials (0-3
   *  spans each, ~50% run-in / ~50% same-day, roster 1..5). HIGH-1 and HIGH-2
   *  below both read this SAME seeded loop (round 2's instruction), just
   *  asserting different invariants over its output. */
  function capacityPresentStoreFacts(): CapacityFact[] {
    const rand = mulberry32(20260915)
    const facts: CapacityFact[] = []

    for (let trial = 0; trial < 300; trial++) {
      const rosterLanes = 1 + Math.floor(rand() * 5) // 1..5
      const spanCount = Math.floor(rand() * 4) // 0..3
      const spans: BookedSpan[] = []
      for (let s = 0; s < spanCount; s++) {
        const staffId = `s${1 + Math.floor(rand() * rosterLanes)}`
        if (rand() < 0.5) {
          // run-in: starts before today, ends somewhere in or after today —
          // the shape that makes bookedMinutes and windowMinutes diverge.
          const startMs = DAY_START - Math.floor(rand() * 6 * 3_600_000)
          const endMs = DAY_START + Math.floor(rand() * 26 * 3_600_000)
          if (endMs > startMs) spans.push(span(startMs, endMs, staffId))
        } else {
          // same-day
          const startMs = DAY_START + Math.floor(rand() * 24 * 3_600_000)
          const endMs = startMs + 1 + Math.floor(rand() * 4 * 3_600_000)
          spans.push(span(startMs, endMs, staffId))
        }
      }

      const fact = capacityForDay(input({ rosterLanes, spans }))
      if (fact.reason === null && fact.hoursSource === 'store') facts.push(fact)
    }
    return facts
  }

  it("HIGH-1: bookedMinutes + availableMinutes === capacityMinutes (±1) — whenever source is 'store'", () => {
    const facts = capacityPresentStoreFacts()
    // The property is meaningless if the generator never produced a
    // capacity-present, store-sourced trial to check it on.
    expect(facts.length).toBeGreaterThan(50)
    for (const fact of facts) {
      expect(
        Math.abs(fact.bookedMinutes + (fact.availableMinutes ?? 0) - (fact.capacityMinutes ?? 0)),
      ).toBeLessThanOrEqual(1)
    }
  })

  it("HIGH-2: full === (occupancyPct === 100) === (availableMinutes === 0) — whenever source is 'store'", () => {
    const facts = capacityPresentStoreFacts()
    expect(facts.length).toBeGreaterThan(50)
    for (const fact of facts) {
      expect(fact.full).toBe(fact.occupancyPct === 100)
      expect(fact.occupancyPct === 100).toBe(fact.availableMinutes === 0)
    }
  })
})
