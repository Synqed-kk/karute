// FILL 2 (S86) — the generated sample day: the side rule (R4), staggered breaks, the 販売可能枠 after the pin at the
// store's own prices (R16), the closed day as before (R15), the 10–19 six-person twin untouched (R22).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shifts, absence, sellSlots } from '@/business/lib/fixtures-today'
import { SAMPLE_SLOT_PRICES } from '@/business/lib/practice-door/registry'
import { serveDay, shiftDay, sidesOf, type LiveSpan } from '@/business/lib/practice-door/sample-day'
import { weekFromPair } from '@/business/lib/practice-door/store-hours'

const sample = { open: 600, close: 1140 }
const roster = shifts.map((s) => s.staff_id)
const GYM = { open: 420, close: 1320 }
const NAMES = ['見本 けんた', '見本 だいち', 'テスト りな', '見本 なつみ', 'テスト こはる', '見本 ゆうと'] // as scripts/test-world/recipes/personal_gym.ts names them
const ROLES = ['STYLIST', 'STYLIST', 'STYLIST', 'STYLIST', 'ASSISTANT', 'STYLIST'] // the recipe's roles, parallel
const crew = (names: readonly string[] = NAMES) => roster.map((id, i) => ({ id, name: names[i], role: ROLES[i] }))
const input = (pair = sample) => ({
  shifts, absence, roster, rows: [] as LiveSpan[], carried: new Set<string>(), taken: sellSlots, sellSlots, sample, dayKey: 20733,
  hours: { operatingHours: pair, weeklyHours: weekFromPair(pair, []), closedWeekdays: [], hoursSource: 'core' as const, shownDayKey: 20733, shownDayClosed: null },
})
const gym = (rows: LiveSpan[] = []) => serveDay({ ...input(GYM), type: 'personal_gym', names: NAMES, roles: ROLES, prices: SAMPLE_SLOT_PRICES.personal_gym, pin: 804, rows })
type Day = ReturnType<typeof serveDay>
const onFloor = (out: Day, t: number) => out.shifts.filter((s) => s.start <= t && t < s.end && !s.breaks.some((b) => b.start <= t && t < b.end)
  && !(out.absence && out.absence.staff_id === s.staff_id && t >= out.absence.from)).length

it('T7 (R22): fixture world and the 10–19 six-person twin retain byte-identical day data', () => {
  const before = JSON.stringify({ shifts, absence, sellSlots })
  expect(JSON.stringify(serveDay({ ...input(), hours: { ...input().hours, hoursSource: 'sample' } }))).toBe(before)
  expect(JSON.stringify(serveDay({ ...input(), type: 'beauty_chiropractic' }))).toBe(before)
  expect(JSON.stringify({ shifts, absence, sellSlots })).toBe(before)
})

it('T7 (R4): the gym — sides by NAME parity, nine-hour shifts, staggered breaks, somebody on the floor all day', () => {
  const out = gym()
  const sides = sidesOf(NAMES, GYM)!
  for (const [i, id] of roster.entries()) expect(out.shifts.find((s) => s.staff_id === id)).toMatchObject(sides.get(NAMES[i])!)
  expect(new Set(out.shifts.map((s) => `${s.start}-${s.end}`))).toEqual(new Set(['420-960', '780-1320']))
  for (const s of out.shifts) {
    expect(s.end - s.start).toBeLessThanOrEqual(540)
    expect(s.breaks).toHaveLength(1)
    expect(s.breaks[0].start).toBeGreaterThan(s.start); expect(s.breaks[0].end).toBeLessThan(s.end)
  }
  for (const side of [420, 780]) expect(new Set(out.shifts.filter((s) => s.start === side).map((s) => s.breaks[0].start)).size).toBe(3)
  for (let t = GYM.open; t < GYM.close; t += 30) expect({ t, n: onFloor(out, t) > 0 }).toEqual({ t, n: true })
  // ⚖ S87 Q4: the absence is a STYLIST's — the opening side's STYLISTs are けんた and なつみ (こはる opens too, but is the
  // ASSISTANT); no rows, so none ends first and けんた leads by name; `from` is the middle of his 07:00–16:00 side
  expect([out.absence?.staff_id, out.absence?.from]).toEqual([roster[NAMES.indexOf('見本 けんた')], 690])
  // R16: two slots after the pinned 13:24, at the gym's own prices
  expect(out.sellSlots!.map((s) => [s.start, s.price_low, s.price_high])).toEqual([[960, 11000, 13750], [1050, 11000, 13750]])
  expect(new Set(out.sellSlots!.map((s) => s.staff_id)).size).toBe(2)
  expect(gym()).toEqual(out)
})

// ⚖ R4 cross-check inside the territory: today's rows from a small generator that follows the SAME side rule as the loader
// (scripts/test-world/plan.ts sidesOf, which this test may not import): every person books only inside their side.
function planRows(names: readonly string[], ids: readonly string[], pair: { open: number; close: number }): LiveSpan[] {
  const sides = sidesOf(names, pair)!
  return ids.flatMap((id, i) => {
    const side = sides.get(names[i])!
    return Array.from({ length: Math.floor((side.end - side.start - 60) / 90) + 1 }, (_, k) => side.start + k * 90)
      .filter((start, k) => (k + i) % 3 !== 0).map((start, k) => ({ id: `${id}-r${k}`, staff: id, start, end: start + 60 }))
  })
}

it('T7 (R4): serveDay with today\'s plan-shaped rows — shifts stay ≤ 9 h, the early 勤務不可 survives, the floor is never empty at 11:30 / 17:30', () => {
  const rows = planRows(NAMES, roster, GYM)
  const out = gym(rows)
  for (const s of out.shifts) expect(s.end - s.start).toBeLessThanOrEqual(540)
  expect(out.absence).not.toBeNull()
  // ⚖ S87 Q4: carried by the opening-side STYLIST whose rows end first (derived by a run: 見本 けんた; never こはる, the ASSISTANT)
  expect(ROLES[roster.indexOf(out.absence!.staff_id)]).toBe('STYLIST')
  expect(NAMES[roster.indexOf(out.absence!.staff_id)]).toBe('見本 けんた')
  expect(out.shifts.find((s) => s.staff_id === out.absence!.staff_id)!.start).toBe(GYM.open)
  expect(onFloor(out, 690)).toBeGreaterThan(0)
  expect(onFloor(out, 1050)).toBeGreaterThan(0)
  for (const r of rows) expect(out.sellSlots!.some((s) => s.staff_id === r.staff && s.start < r.end && r.start < s.end)).toBe(false)
  // negative: a row outside its person's side stretches that shift past nine hours (the S27 defect the rule prevents)
  const late = roster[NAMES.indexOf([...NAMES].sort()[1])]
  expect(Math.max(...gym([...rows, { id: 'x', staff: late, start: 480, end: 540 }]).shifts.map((s) => s.end - s.start))).toBeGreaterThan(540)
})

it('T7 (R4): one person works early with no absence; 00–24 adds a middle side; an 11–18 salon staggers lunch', () => {
  const one = shiftDay('personal_gym', [{ id: 'solo', name: 'solo', role: 'STYLIST' }], GYM, absence, sellSlots)
  expect(one.shifts.map((s) => [s.start, s.end])).toEqual([[420, 960]])
  expect(one.absence).toBeNull()
  const day = shiftDay('personal_gym', crew(), { open: 0, close: 1440 }, absence, sellSlots)
  expect(new Set(day.shifts.map((s) => s.start))).toEqual(new Set([0, 450, 900]))
  for (let t = 0; t < 1440; t += 30) expect(day.shifts.some((s) => s.start <= t && t < s.end)).toBe(true)
  const salon = shiftDay('hair_salon', crew(), { open: 660, close: 1080 }, absence, sellSlots, SAMPLE_SLOT_PRICES.hair_salon)
  for (const s of salon.shifts) {
    expect([s.start, s.end]).toEqual([660, 1080])
    expect(s.breaks[0].start).toBeGreaterThanOrEqual(720); expect(s.breaks[0].end).toBeLessThanOrEqual(900)
  }
  expect(new Set(salon.shifts.map((s) => s.breaks[0].start)).size).toBeGreaterThan(1)
  expect(salon.sellSlots.map((s) => [s.start, s.price_low])).toEqual([[930, 6600], [1020, 6600]])
})

it('R19: an overnight day (18:00–03:00) generates no inverted shift', () => {
  expect(shiftDay('hair_salon', [{ id: 'a', name: 'a', role: 'STYLIST' }, { id: 'b', name: 'b', role: 'STYLIST' }], { open: 1080, close: 180 }, absence, sellSlots).shifts).toEqual([])
})

it('R15/R16: generated slots yield to a busy person or room; a closed day keeps the slots it always had', () => {
  const base = { ...input({ open: 660, close: 1080 }), type: 'hair_salon' as const, roles: ROLES, prices: SAMPLE_SLOT_PRICES.hair_salon }
  const out = serveDay(base)
  const slot = out.sellSlots![0]
  expect(slot.start).toBeGreaterThan(804)
  expect(serveDay({ ...base, roomsBusy: [{ room: slot.resource_id, start: slot.start, end: slot.end }] }).sellSlots).not.toContainEqual(slot)
  expect(serveDay({ ...base, rows: [{ staff: slot.staff_id, id: 'live', start: slot.start, end: slot.end }] }).sellSlots).not.toContainEqual(slot)
  const closed = serveDay({ ...base, hours: { ...base.hours, shownDayClosed: 'closed_date' } })
  expect(closed).toEqual({ shifts: [], absence: null, sellSlots })
})

// ⚖ S87 Q1 pin — the gym recipe's six people (name + role) ARE the roster the side rule above expects: read from the loader's
// files by node:fs (the territory never imports scripts/), skipped until the loader's FILL 2 lands exactly like
// practice-fill-registry.test.ts (registry.json without a FILL 2 `stores` map), strict after it.
const world = (f: string) => join(process.cwd(), 'scripts/test-world', f)
const reg = existsSync(world('registry.json')) ? (JSON.parse(readFileSync(world('registry.json'), 'utf8')) as { stores?: Record<string, unknown> }) : null
const filled = !!reg?.stores && Object.values(reg.stores).every((e) => typeof e === 'object' && e !== null && 'keyPrefix' in e)
if (!filled) console.log('practice-fill-shifts: scripts/test-world/registry.json has no FILL 2 `stores` map yet (loader FILL 2 not merged) — the gym roster pin skipped')
;(filled ? it : it.skip)('Q1 pin: the gym recipe staffs exactly these six, with these roles (registry.json: c33e4c43 is the personal_gym)', () => {
  expect((reg!.stores!['c33e4c43-bc3b-4470-ac22-aa60fecdabe3'] as { type: string }).type).toBe('personal_gym')
  const src = readFileSync(world('recipes/personal_gym.ts'), 'utf8')
  const consts = Object.fromEntries([...src.matchAll(/^const (\w+) = '([^']+)'/gm)].map((m) => [m[1], m[2]]))
  const block = src.match(/\n  staff: \[([\s\S]*?)\n  \],/)![1]
  const staffed = [...block.matchAll(/\{ name: (\w+|'[^']+'), role: '(\w+)' \}/g)].map((m) => [m[1].startsWith("'") ? m[1].slice(1, -1) : consts[m[1]], m[2]].join(' / '))
  expect(staffed.sort()).toEqual(NAMES.map((n, i) => `${n} / ${ROLES[i]}`).sort())
})

// ⚖ S87 Q1 negative — the attack's failure case (a card whose name sorts FIRST used to flip every trainer to 07:00–22:00,
// 900 min): one extra OWNER or ADMIN card changes no trainer's side, no trainer serves past 540 min, and the card itself
// works the whole day with no side.
it.each(['OWNER', 'ADMIN'])('Q1 negative: an extra %s card sorting first moves no trainer; it works the whole day', (role) => {
  const rows = planRows(NAMES, roster, GYM)
  const base = gym(rows)
  const card = 'card-extra'
  expect(['Dev Salon', ...NAMES].sort()[0]).toBe('Dev Salon')
  const out = serveDay({ ...input(GYM), roster: [...roster, card], type: 'personal_gym', names: [...NAMES, 'Dev Salon'], roles: [...ROLES, role], prices: SAMPLE_SLOT_PRICES.personal_gym, pin: 804, rows })
  const span = (d: Day, id: string) => { const s = d.shifts.find((x) => x.staff_id === id)!; return { id, start: s.start, end: s.end } }
  for (const id of roster) expect(span(out, id)).toEqual(span(base, id))
  for (const id of roster) expect(span(out, id).end - span(out, id).start).toBeLessThanOrEqual(540)
  expect(span(out, card)).toEqual({ id: card, start: GYM.open, end: GYM.close })
  expect(sidesOf(NAMES, GYM)!.has('Dev Salon')).toBe(false)
})

it('F3 (Greptile #1153 P2): the absence starts only once another person covers every minute to the absent shift\'s end', () => {
  const two = [{ id: 'a', name: '見本 あ', role: 'STYLIST' }, { id: 'b', name: '見本 い', role: 'STYLIST' }]
  // 07:00–22:00: あ opens 07:00–16:00, い closes 13:00–22:00 — the midpoint (11:30) would leave nobody working until 13:00
  const split = shiftDay('hair_salon', two, { open: 420, close: 1320 }, absence, sellSlots)
  const early = split.shifts.find((s) => s.staff_id === split.absence!.staff_id)!
  const others = split.shifts.filter((s) => s.staff_id !== early.staff_id)
  const empty = Array.from({ length: early.end - split.absence!.from }, (_, i) => split.absence!.from + i).filter((m) => !others.some((s) => s.start <= m && m < s.end))
  expect({ staff: split.absence!.staff_id, from: split.absence!.from, empty: empty.length }).toEqual({ staff: 'a', from: 13 * 60, empty: 0 })
  // coverage already holds (10:00–19:00, both work the day): today's start, the midpoint 14:30, exactly
  expect(shiftDay('hair_salon', two, sample, absence, sellSlots).absence!.from).toBe(Math.floor((600 + 1140) / 2))
  // a lone person: nobody covers, so no absence
  expect(shiftDay('hair_salon', two.slice(0, 1), sample, absence, sellSlots).absence).toBeNull()
})
