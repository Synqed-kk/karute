import { capacityForDay, type ShiftCapacityInput, type ShiftRow } from '@/lib/capacity/capacity'
import { DATE, input, minute, span } from './__fixtures__/kadou-fixture'

const roster = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, active: true, stores: [{ storeId: 'store' }] }))
const rowA: ShiftRow = { staffId: 'A', storeId: 'store', date: DATE, startMs: minute(600), endMs: minute(1140), breaks: [{ startMs: minute(900), endMs: minute(960) }], blocks: [] }
const shifts = (over: Partial<ShiftCapacityInput> = {}) => ({ storeId: 'store', date: DATE, rows: [], roster, readComplete: true, breakMinutes: 60, ...over }) as ShiftCapacityInput
const fact = (over: Partial<ShiftCapacityInput>, spans: ReturnType<typeof span>[]) => capacityForDay({ ...input(spans), shift: shifts(over) })
const pick = (f: ReturnType<typeof capacityForDay>) => ({ capacityMinutes: f.capacityMinutes, bookedMinutes: f.bookedMinutes, occupancyPct: f.occupancyPct, shiftState: f.shiftState, lanes: f.lanes, onShiftNoBooking: f.onShiftNoBooking, reason: f.reason })

test('T-G4: real rows win — the pre-PR-2 values (pinned before guess mode) are unchanged', () => {
  expect(pick(fact({ rows: [rowA] }, [span('A', 600, 900), span('B', 600, 900)]))).toMatchInlineSnapshot(`
{
  "bookedMinutes": 600,
  "capacityMinutes": 780,
  "lanes": 2,
  "occupancyPct": 77,
  "onShiftNoBooking": 0,
  "reason": null,
  "shiftState": "partial",
}
`)
})
test('NIT-2 (re-pinned by guess mode): per-person view of a contradicted-solo day', () => {
  // Pre-PR-2 (fix round 2) this read shiftState 'none', bookedMinutes 120,
  // no number. Ruling S110-1 (d) hands such days to guess mode: A is inferred.
  const two = [roster[0], roster[1]]
  expect(pick(fact({ roster: two, soloMode: true, personId: 'A' }, [span('A', 600, 720), span('B', 780, 900)]))).toMatchObject({ shiftState: 'inferred', bookedMinutes: 120, capacityMinutes: 540, occupancyPct: 22, lanes: 1 })
})
const three = [span('A', 600, 900), span('B', 600, 900), span('C', 600, 900)]
test('T-G1 worked example: 3 of 5 booked, 900 min, open 600, break 60 → 1620, 56%', () => {
  const f = fact({}, three)
  expect(pick(f)).toMatchObject({ capacityMinutes: 1620, bookedMinutes: 900, occupancyPct: 56, shiftState: 'inferred', lanes: 3, onShiftNoBooking: 0 })
  expect(f.shiftState).not.toBe('partial')
})
test('T-G2 part-timer: one 2-h booking → 540, 120, 22%', () => {
  expect(pick(fact({}, [span('A', 600, 720)]))).toMatchObject({ capacityMinutes: 540, bookedMinutes: 120, occupancyPct: 22, shiftState: 'inferred', lanes: 1 })
})
test('T-G3 zero-booking staff are not counted: 5 on the roster, 1 booked 300 → 540 (not 2700), 56%', () => {
  expect(pick(fact({}, [span('A', 600, 900)]))).toMatchObject({ capacityMinutes: 540, bookedMinutes: 300, occupancyPct: 56, shiftState: 'inferred', onShiftNoBooking: 0 })
})
test('T-G5 breakMinutes is the setting: 30 → 570, 0 → 600; 700 (≥ open) is sanitised to the default (S111-5) → 540', () => {
  expect(fact({ breakMinutes: 30 }, [span('A', 600, 900)]).capacityMinutes).toBe(570)
  expect(fact({ breakMinutes: 0 }, [span('A', 600, 900)]).capacityMinutes).toBe(600)
  // Pre-S111-5 this floored at the booked 300 (100 %); the break is now sanitised against the 600 open minutes.
  expect(pick(fact({ breakMinutes: 700 }, [span('A', 600, 900)]))).toMatchObject({ capacityMinutes: 540, bookedMinutes: 300, occupancyPct: 56 })
  // The floor still holds when a legal break leaves less than the booked time: open 600, break 599, booked 300.
  expect(pick(fact({ breakMinutes: 599 }, [span('A', 600, 900)]))).toMatchObject({ capacityMinutes: 300, bookedMinutes: 300, occupancyPct: 100 })
})
test('T-G6 unassigned booking on an inferred day fills into A (R-E): 540, 240, 44%', () => {
  expect(pick(fact({}, [span('A', 600, 720), span(null, 840, 960)]))).toMatchObject({ capacityMinutes: 540, bookedMinutes: 240, occupancyPct: 44, shiftState: 'inferred', lanes: 1 })
})
test('T-G6b only unassigned bookings name nobody: none, booked time kept', () => {
  expect(pick(fact({}, [span(null, 840, 960)]))).toMatchObject({ shiftState: 'none', capacityMinutes: null, bookedMinutes: 120 })
})
test('T-G7 incomplete read never guesses: unavailable', () => {
  expect(pick(fact({ readComplete: false }, three))).toMatchObject({ shiftState: 'unavailable', capacityMinutes: null, occupancyPct: null, bookedMinutes: 900 })
})
test("T-G8 per-person view: A's own 300/540 = 56%; C with no booking → off", () => {
  const spans = [span('A', 600, 900), span('B', 600, 900)]
  expect(pick(fact({ personId: 'A' }, spans))).toMatchObject({ capacityMinutes: 540, bookedMinutes: 300, occupancyPct: 56, shiftState: 'inferred', lanes: 1 })
  expect(pick(fact({ personId: 'C' }, spans))).toMatchObject({ shiftState: 'off', capacityMinutes: null, occupancyPct: null })
})
test('T-G9 withheld days are never guessed: no number, the legacy reason, bookedMinutes carried', () => {
  const base = input(three)
  const day = (over: Partial<typeof base>) => pick(capacityForDay({ ...base, ...over, shift: shifts() }))
  expect(day({ hours: { ...base.hours!, closed: true } })).toMatchObject({ capacityMinutes: null, occupancyPct: null, reason: 'closed', bookedMinutes: 900, shiftState: 'none' })
  expect(day({ hours: { ...base.hours!, source: 'default' } })).toMatchObject({ capacityMinutes: null, occupancyPct: null, reason: 'hours-not-saved', bookedMinutes: 900, shiftState: 'none' })
  expect(day({ hours: null })).toMatchObject({ capacityMinutes: null, occupancyPct: null, reason: 'hours-unresolved', bookedMinutes: 900, shiftState: 'none' })
  expect(day({ hours: { ...base.hours!, closeMs: base.hours!.openMs } })).toMatchObject({ capacityMinutes: null, occupancyPct: null, reason: 'hours-unresolved', bookedMinutes: 900 })
  expect(day({ laneKind: 'none' })).toMatchObject({ capacityMinutes: null, occupancyPct: null, reason: 'kind-none', bookedMinutes: 900, shiftState: 'none' })
})
test('no rows and nobody booked stays none (no number)', () => {
  expect(pick(fact({}, []))).toMatchObject({ shiftState: 'none', capacityMinutes: null, occupancyPct: null, bookedMinutes: 0 })
})
// Day 2 of the fixture (the JST day after DATE), same 10:00–20:00 hours.
const D2 = 86_400_000
const day2 = (spans: ReturnType<typeof span>[], over: Partial<ShiftCapacityInput> = {}) => {
  const base = input(spans)
  return pick(capacityForDay({ ...base, dayStartMs: base.dayStartMs + D2, dayEndMs: base.dayEndMs + D2, hours: { ...base.hours!, openMs: base.hours!.openMs + D2, closeMs: base.hours!.closeMs + D2 }, shift: shifts({ date: '2026-10-09', ...over }) }))
}
test('S111-4 midnight: a 23:00–01:00 booking gives no lane on either day (outside hours both sides)', () => {
  // DAY is JST midnight (+09:00) regardless of the jest TZ=UTC process zone:
  // the module takes epoch ms, no timezone argument.
  expect(pick(fact({}, [span('A', 1380, 1500)]))).toMatchObject({ bookedMinutes: 60, shiftState: 'none', capacityMinutes: null })
  expect(day2([span('A', 1380, 1500)])).toMatchObject({ bookedMinutes: 60, shiftState: 'none', capacityMinutes: null })
})
test('S111-4 B1: a 23:30–00:30 overrun → day 2: B contributes her 30 min only, C (in-hours) 540', () => {
  expect(day2([span('B', 1410, 1470), span('C', 1440 + 600, 1440 + 660)])).toMatchObject({ capacityMinutes: 570, bookedMinutes: 90, occupancyPct: 16, shiftState: 'inferred', lanes: 2 })
})
test('S111-4 C6: a 60-min booking entirely after close → that person contributes 60, no lane', () => {
  expect(pick(fact({}, [span('A', 1200, 1260), span('C', 600, 660)]))).toMatchObject({ capacityMinutes: 600, bookedMinutes: 120, occupancyPct: 20, shiftState: 'inferred' })
})
test('S111-4 C7: before open (early 着付け) → 60, no lane', () => {
  expect(pick(fact({}, [span('A', 420, 480), span('C', 600, 660)]))).toMatchObject({ capacityMinutes: 600, bookedMinutes: 120, occupancyPct: 20, shiftState: 'inferred' })
})
test('S111-4 C8: a previous-night tail 00:00–01:00 → 60, no lane', () => {
  expect(pick(fact({}, [span('A', 0, 60), span('C', 600, 660)]))).toMatchObject({ capacityMinutes: 600, bookedMinutes: 120, occupancyPct: 20, shiftState: 'inferred' })
})
test('S111-4: a day whose only bookings are outside hours is not guessed: none, no number', () => {
  expect(pick(fact({}, [span('A', 1200, 1260), span('B', 420, 480), span('C', 0, 60)]))).toMatchObject({ shiftState: 'none', capacityMinutes: null, occupancyPct: null, bookedMinutes: 180 })
})
test('S111-4: an out-of-hours roster person never makes a guessed day partial', () => {
  expect(fact({}, [span('A', 1200, 1260), span('C', 600, 660)]).shiftState).toBe('inferred')
})
test('S111-5: a guessed day with break 1e9 gives the same figure as break 60', () => {
  expect(pick(fact({ breakMinutes: 1e9 }, three))).toEqual(pick(fact({ breakMinutes: 60 }, three)))
})
test('S111-2: hours {openMs: 0, closeMs: Infinity} with a booking → not guessed (none), capacityForDay withholds hours-unresolved', () => {
  const base = input([span('A', 600, 900)])
  expect(pick(capacityForDay({ ...base, hours: { ...base.hours!, openMs: 0, closeMs: Number.POSITIVE_INFINITY }, shift: shifts() }))).toMatchObject({ shiftState: 'none', capacityMinutes: null, occupancyPct: null, reason: 'hours-unresolved', bookedMinutes: 300 })
})
describe('S111-7: the own view of an out-of-hours-only person on a guessed day shows no figure', () => {
  const p5 = [span('A', 600, 900), span('B', 1200, 1260)]
  test('all-staff figure (pinned before K, unchanged): A 540 + B 60 = 600, booked 360, 60 %', () => {
    expect(pick(fact({}, p5))).toMatchObject({ capacityMinutes: 600, bookedMinutes: 360, occupancyPct: 60, shiftState: 'inferred', lanes: 2 })
  })
  test('P5: personId B (only an after-close 60) → off, bookedMinutes 60, no capacity', () => {
    expect(pick(fact({ personId: 'B' }, p5))).toMatchObject({ shiftState: 'off', bookedMinutes: 60, capacityMinutes: null, occupancyPct: null })
  })
  test('personId A → 300/540 = 56 % inferred, unchanged', () => {
    expect(pick(fact({ personId: 'A' }, p5))).toMatchObject({ shiftState: 'inferred', bookedMinutes: 300, capacityMinutes: 540, occupancyPct: 56 })
  })
  test("O5: the midnight-tail stylist's own next-day view → off", () => {
    expect(day2([span('B', 1410, 1470), span('C', 1440 + 600, 1440 + 660)], { personId: 'B' })).toMatchObject({ shiftState: 'off', bookedMinutes: 30, capacityMinutes: null, occupancyPct: null })
  })
})
describe('S111-8 (Greptile P1): a previous-day tail never earns a lane — hours 00:00–08:00, roster A and B, zero rows', () => {
  const night = (spans: ReturnType<typeof span>[]) => {
    const base = input(spans)
    return pick(capacityForDay({ ...base, hours: { ...base.hours!, openMs: minute(0), closeMs: minute(480) }, shift: shifts({ roster: [roster[0], roster[1]] }) }))
  }
  test('only A 23:30 (previous day) → 00:30 → none, bookedMinutes 30, no capacity', () => {
    expect(night([span('A', -30, 30)])).toMatchObject({ shiftState: 'none', bookedMinutes: 30, capacityMinutes: null, occupancyPct: null })
  })
  test('plus B 02:00–03:00 → B inferred 420 (480 − 60), A adds her 30 with no lane: 450, 90, 20 %', () => {
    expect(night([span('A', -30, 30), span('B', 120, 180)])).toMatchObject({ shiftState: 'inferred', capacityMinutes: 450, bookedMinutes: 90, occupancyPct: 20, lanes: 2 })
  })
})
