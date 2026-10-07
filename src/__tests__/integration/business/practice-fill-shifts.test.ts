import { shifts, absence, sellSlots } from '@/business/lib/fixtures-today'
import { serveDay, shiftDay } from '@/business/lib/practice-door/sample-day'
import { weekFromPair } from '@/business/lib/practice-door/store-hours'
const sample = { open: 600, close: 1140 }
const roster = shifts.map((s) => s.staff_id)
const input = (pair = sample) => ({
  shifts, absence, roster, rows: [], carried: new Set<string>(), taken: sellSlots, sellSlots, sample, dayKey: 20733,
  hours: { operatingHours: pair, weeklyHours: weekFromPair(pair, []), closedWeekdays: [], hoursSource: 'core' as const, shownDayKey: 20733, shownDayClosed: null },
})

it('T7: fixture world and the 10–19 six-person twin retain byte-identical day data', () => {
  const before = JSON.stringify({ shifts, absence, sellSlots })
  expect(JSON.stringify(serveDay({ ...input(), hours: { ...input().hours, hoursSource: 'sample' } }))).toBe(before)
  expect(JSON.stringify(serveDay({ ...input(), type: 'beauty_chiropractic' }))).toBe(before)
  expect(JSON.stringify({ shifts, absence, sellSlots })).toBe(before)
})

it('T7: the gym has early/late nine-hour shifts, mid-shift breaks, one absence and two slots per shift', () => {
  const pair = { open: 420, close: 1320 }
  const out = serveDay({ ...input(pair), type: 'personal_gym' })
  expect(new Set(out.shifts.map((s) => `${s.start}-${s.end}`))).toEqual(new Set(['420-960', '780-1320']))
  expect(out.shifts).toHaveLength(roster.length)
  for (const s of out.shifts) {
    expect(s.start).toBeGreaterThanOrEqual(pair.open); expect(s.end).toBeLessThanOrEqual(pair.close)
    expect(s.end - s.start).toBeLessThanOrEqual(540)
    expect(s.breaks).toHaveLength(1)
    expect(s.breaks[0].end - s.breaks[0].start).toBe(60)
    expect(s.breaks[0].start).toBeGreaterThanOrEqual(s.start); expect(s.breaks[0].end).toBeLessThanOrEqual(s.end)
  }
  expect(out.absence?.from).toBe(690)
  expect(out.sellSlots?.map((s) => s.start).sort()).toEqual([420, 420, 780, 780].sort())
  expect(serveDay({ ...input(pair), type: 'personal_gym' })).toEqual(out)
})

it('T7: an 11–18 salon uses every roster member with staggered lunch breaks and its first-hour slots', () => {
  const out = shiftDay('hair_salon', roster, { open: 660, close: 1080 }, absence, sellSlots)
  expect(out.shifts).toHaveLength(roster.length)
  for (const s of out.shifts) {
    expect([s.start, s.end]).toEqual([660, 1080])
    expect(s.breaks[0].start).toBeGreaterThanOrEqual(720)
    expect(s.breaks[0].end).toBeLessThanOrEqual(900)
    expect(s.breaks[0].end - s.breaks[0].start).toBe(60)
  }
  expect(new Set(out.shifts.map((s) => s.breaks[0].start)).size).toBeGreaterThan(1)
  expect(out.sellSlots.map((s) => [s.start, s.end])).toEqual([[660, 720], [660, 720]])
})

it('generated slots yield to a busy person or room; closed dates generate no day', () => {
  const base = { ...input({ open: 660, close: 1080 }), type: 'hair_salon' as const }
  const out = serveDay(base)
  const slot = out.sellSlots![0]
  expect(serveDay({ ...base, roomsBusy: [{ room: slot.resource_id, start: slot.start, end: slot.end }] }).sellSlots).not.toContainEqual(slot)
  expect(serveDay({ ...base, rows: [{ staff: slot.staff_id, id: 'live', start: slot.start, end: slot.end }] }).sellSlots).not.toContainEqual(slot)
  expect(serveDay({ ...base, hours: { ...base.hours, shownDayClosed: 'closed_date' } })).toEqual({ shifts: [], absence: null, sellSlots: [] })
})
