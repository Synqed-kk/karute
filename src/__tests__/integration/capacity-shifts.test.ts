import { capacityForDay, receivableIntervals, type ShiftCapacityInput, type ShiftRow } from '@/lib/capacity/capacity'
import { DATE, input, minute, span, t4Spans } from './__fixtures__/kadou-fixture'

const roster = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, active: true, stores: [{ storeId: 'store' }] }))
const row = (staffId = 's1', over: Partial<ShiftRow> = {}): ShiftRow => ({ staffId, storeId: 'store', date: DATE, startMs: minute(600), endMs: minute(1140), breaks: [{ startMs: minute(900), endMs: minute(960) }], blocks: [], ...over })
const shifts = (over: Partial<ShiftCapacityInput> = {}): ShiftCapacityInput => ({ storeId: 'store', date: DATE, rows: [row('s1'), row('s2'), row('s3')], roster, readComplete: true, ...over })
const fact = (over: Partial<ShiftCapacityInput> = {}, spans = input().spans) => capacityForDay({ ...input(spans), shift: shifts(over) })

test('T1: 15 booked hours / 24 on-shift hours = 63%, not 30%', () => {
  expect(fact()).toMatchObject({ capacityMinutes: 1440, bookedMinutes: 900, occupancyPct: 63, shiftState: 'entered', availableMinutes: 540 })
})
test('T2: no rows with multiple staff is none, retaining union booked time', () => {
  expect(fact({ rows: [] }, [span('s1', 600, 720), span('s1', 660, 780)])).toMatchObject({ occupancyPct: null, band: null, full: false, shiftState: 'none', bookedMinutes: 180 })
})
test('T3: one-person roster or explicit solo uses store hours', () => {
  expect(fact({ rows: [], roster: [roster[0]] }, [span('s1', 600, 900)])).toMatchObject({ occupancyPct: 50, shiftState: 'solo' })
  expect(fact({ rows: [], soloMode: true }, [span('s1', 600, 900)]).shiftState).toBe('solo')
})
test('T4: an assigned missing-row worker adds booked-only time: W2 = 76%', () => {
  expect(fact({ rows: [row('s1', { breaks: [] }), row('s2', { breaks: [] })] }, t4Spans)).toMatchObject({ bookedMinutes: 960, capacityMinutes: 1260, occupancyPct: 76, shiftState: 'partial' })
})
test('T5: an unassigned helper adds booked-only time without a partial mark', () => {
  expect(fact({ rows: [row()] }, [span('helper', 600, 780)])).toMatchObject({ bookedMinutes: 180, capacityMinutes: 660, shiftState: 'entered' })
})
test('T6: whole-window block adds 0/0 or booked-only time, without a mark', () => {
  const off = row('s2', { blocks: [span('s2', 600, 1140)] })
  expect(fact({ rows: [row(), off] }, [])).toMatchObject({ capacityMinutes: 480, shiftState: 'entered' })
  expect(fact({ rows: [row(), off] }, [span('s2', 660, 720)])).toMatchObject({ capacityMinutes: 540, bookedMinutes: 60, shiftState: 'entered' })
})
test('T7: everybody off is nobody, never zero percent', () => {
  expect(fact({ rows: [row('s1', { blocks: [span('s1', 600, 1140)] })] }, [])).toMatchObject({ shiftState: 'nobody', occupancyPct: null, band: null, full: false })
})
test('T8: overtime and cleanup past closing add to both sides', () => {
  expect(fact({ rows: [row()] }, [span('s1', 1170, 1230)])).toMatchObject({ bookedMinutes: 60, capacityMinutes: 540 })
  expect(fact({ rows: [row()] }, [span('s1', 1170, 1260)])).toMatchObject({ bookedMinutes: 90, capacityMinutes: 570 })
})
test('T9: overlapping bookings on one worker count once', () => {
  expect(fact({ rows: [row()] }, [span('s1', 600, 720), span('s1', 660, 780)])).toMatchObject({ bookedMinutes: 180, occupancyPct: 38 })
})
test('T10: overlapping BLOCK and break subtract their union once', () => {
  const r = row('s1', { breaks: [span('s1', 810, 870)] })
  const result = receivableIntervals('s1', 'store', DATE, [r], input().hours, [span('s1', 780, 840)])
  expect(result).toEqual([{ startMs: minute(600), endMs: minute(780) }, { startMs: minute(870), endMs: minute(1140) }])
  expect(fact({ rows: [r], blocks: [span('s1', 780, 840)] }, []).capacityMinutes).toBe(450)
})
test('T11: bed-only BLOCK changes nothing', () => {
  expect(fact({ blocks: [span(null, 600, 1140)] })).toEqual(fact())
})
test('T12: greedy unassigned allocation, overflow adds to both totals', () => {
  expect(fact({ rows: [row()] }, [span(null, 600, 660), span(null, 600, 660)])).toMatchObject({ bookedMinutes: 120, capacityMinutes: 540, unassignedOverflow: 1 })
  expect(fact({ rows: [row()] }, [span(null, 1110, 1170)])).toMatchObject({ bookedMinutes: 60, capacityMinutes: 510, unassignedOverflow: 1 })
})
test('T12 variant: unassigned fill prefers the person whose free time covers most of the booking', () => {
  const rows = [row('s1', { breaks: [] }), row('s2', { breaks: [] })]
  expect(fact({ rows }, [span('s1', 630, 1140), span(null, 600, 720)])).toMatchObject({ bookedMinutes: 630, capacityMinutes: 1080, occupancyPct: 58, unassignedOverflow: 0 })
})
test('T13: almost full pins 99; truly full = 100', () => {
  const rows = [row('s1', { breaks: [] })]
  expect(fact({ rows }, [span('s1', 600, 1139)]).occupancyPct).toBe(99)
  expect(fact({ rows }, [span('s1', 600, 1140)])).toMatchObject({ occupancyPct: 100, full: true, availableMinutes: 0 })
})
test('T14: each store counts only its own row; late entry recomputes', () => {
  const rows = [row(), row('s1', { storeId: 'other', endMs: minute(720), breaks: [] })]
  expect(fact({ rows }, []).capacityMinutes).toBe(480)
  expect(fact({ rows, storeId: 'other' }, []).capacityMinutes).toBe(120)
  expect(fact({ rows: [] }, []).shiftState).toBe('none')
  expect(fact({ rows }, []).shiftState).toBe('entered')
})
test('T15: a saved row survives current inactivity / assignment changes', () => {
  expect(fact({ rows: [row()], roster: [{ id: 's1', active: false, stores: [{ storeId: 'other' }] }] }, []).capacityMinutes).toBe(480)
})
test('T17: individual view off only on entered days', () => {
  expect(fact({ personId: 's5' }, [])).toMatchObject({ shiftState: 'off', occupancyPct: null, lanes: 1 })
  expect(fact({ personId: 's5', rows: [] }, []).shiftState).toBe('none')
  expect(fact({ personId: 's1' }).occupancyPct).toBe(63)
})
test('T18: saved receivable rows with no bookings are counted', () => {
  expect(fact({}, [span('s1', 600, 900), span('s2', 600, 900)]).onShiftNoBooking).toBe(1)
})
test('a null roster fails closed inside the module, never a number', () => {
  expect(fact({ roster: null })).toMatchObject({ shiftState: 'unavailable', occupancyPct: null, band: null, capacityMinutes: null, reason: 'roster-unknown', bookedMinutes: 900 })
})
test('onShiftNoBooking is counted after the unassigned fill', () => {
  expect(fact({}, [span('s1', 600, 900), span('s2', 600, 900), span(null, 600, 660)])).toMatchObject({ onShiftNoBooking: 0, unassignedOverflow: 0 })
})
test('future assignments do not make a historical day partial or solo', () => {
  const future = { id: 's2', active: true, stores: [{ storeId: 'store', createdAtMs: minute(1500) }] }
  expect(fact({ rows: [row()], roster: [roster[0], future] }, [span('s2', 600, 660)]).shiftState).toBe('entered')
})
test('hours clamp and org free-time rule; a closed solo day needs no row', () => {
  expect(fact({ rows: [row('s1', { startMs: minute(300), endMs: minute(500), breaks: [] })] }, [])).toMatchObject({ shiftState: 'nobody', capacityMinutes: null })
  const base = input([span('s1', 600, 660)])
  expect(capacityForDay({ ...base, hours: { ...base.hours!, source: 'org' }, shift: shifts() }).availableMinutes).toBeNull()
  expect(capacityForDay({ ...input([]), hours: { ...base.hours!, closed: true }, shift: shifts({ rows: [], roster: [roster[0]] }) }).shiftState).toBe('nobody')
})
