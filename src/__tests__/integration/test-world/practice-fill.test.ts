// FILL 2 (S86) — the practice-world planner, all seven stores. Jest-collected, outside Business territory (R3): it may import
// the SDK mock and scripts/, never Business code (the registry-key and board-pin pins live in the Business territory test
// practice-fill-registry.test.ts, which reads scripts/test-world/registry.json by node:fs).
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { SynqedClient } from '@synqed-kk/client'
import { lastWindowEnd, loadRecipe, registry, storeCtx, summarize, targetsFor } from '../../../../scripts/test-world/fill'
import { addDays, bookingNotes, CANCEL_LABELS, hoursOn, jstIso, plan, sidesOf, type Plan, type Recipe } from '../../../../scripts/test-world/plan'

jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => { throw new Error('pure plan attempted SDK construction') }) }))
const TODAY = '2026-10-07'
const BOARD_PIN = 13 * 60 + 24 // the loader's literal pin (plan.ts boardMinute default); Business pins boardNow to the same value
const golden = JSON.parse(readFileSync(join(process.cwd(), 'scripts/test-world/__fixtures__/legacy-keys.txt'), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n'))
const plans = new Map<string, { r: Recipe; p: Plan }>()
const minute = (a: { date: string; startsAt: string }) => (Date.parse(a.startsAt) - Date.parse(jstIso(a.date, 0))) / 60_000
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()
// the originals as core holds them: every legacy row of the TODAY window already applied (E2); a generated store has none
const ctxOf = (id: string, r: Recipe) =>
  storeCtx(id, { weeklyHours: r.policy.weekly_hours, legacyThrough: registry.stores[id].keyPrefix === r.id ? addDays(TODAY, registry.futureDays) : null })
beforeAll(async () => {
  for (const [id, entry] of Object.entries(registry.stores)) {
    const r = await loadRecipe(entry.type, id)
    // the originals as core holds them: every legacy row of the window already applied (E2); a generated store has none
    plans.set(id, { r, p: plan(r, ctxOf(id, r), TODAY, TODAY) })
  }
})

it('T1: every practice store, original prefixes, plain staff names (R8), disjoint identities, a real name spread (R9)', () => {
  const names = new Set<string>(), members = new Set<string>(), staff = new Set<string>(), phones = new Set<string>(), prefixes = new Set<string>()
  for (const [id, { r, p }] of plans) {
    const e = registry.stores[id]
    const original = !!golden.stores[id]
    expect(prefixes.has(e.keyPrefix)).toBe(false); prefixes.add(e.keyPrefix)
    expect(e.keyPrefix).toBe(original ? e.type : `${e.type}@${id.slice(0, 8)}`)
    expect(targetsFor(id)).toEqual([id])
    if (original) expect(targetsFor(undefined, e.type)).toEqual([id])
    for (const c of p.customers) {
      expect(names.has(c.name)).toBe(false); names.add(c.name)
      expect(members.has(c.member)).toBe(false); members.add(c.member)
      expect(phones.has(c.phone)).toBe(false); phones.add(c.phone)
      if (!r.legacyMembers?.includes(c.member)) expect(c.member).toMatch(original ? /^[A-Z]+-\d{4}$/ : new RegExp(`^[A-Z]+${Object.keys(registry.stores).indexOf(id) + 1}-\\d{4}$`))
    }
    for (const s of p.staff) {
      expect(staff.has(s.name)).toBe(false); staff.add(s.name)
      if (!original) expect(s.name).not.toMatch(/見本|（|[0-9a-f]{8}/)
    }
    const surnames = new Map<string, number>()
    for (const c of p.customers) surnames.set(c.name.split(' ')[0], (surnames.get(c.name.split(' ')[0]) ?? 0) + 1)
    expect(surnames.size).toBeGreaterThanOrEqual(80)
    expect(Math.max(...surnames.values())).toBeLessThan(p.customers.length * 0.05)
    expect(new Set(p.customers.map((c) => c.birth)).size).toBeGreaterThan(p.customers.length * 0.8)
    expect(new Set(p.customers.map((c) => c.memo)).size).toBeGreaterThan(Math.min(25, p.customers.length / 2))
    if (r.id === 'hair_salon') expect(Math.abs(p.customers.filter((c) => c.gender === 'male').length / p.customers.length - 0.35)).toBeLessThan(0.05) // R18
  }
  expect(targetsFor('all')).toEqual(Object.keys(registry.stores))
  expect(() => targetsFor('unknown')).toThrow('unmapped')
  expect(() => targetsFor(undefined, 'unknown')).toThrow('unknown type')
  expect(() => targetsFor('all', 'hair_salon')).toThrow('choose')
})

it('T2 (R5): the original stores\' legacy members keep the origin/main planner\'s rows — key, status, start, staff, resource, menu', () => {
  expect(golden.epoch).toBe(TODAY)
  for (const [id, old] of Object.entries(golden.stores) as [string, { customers: Recipe['customers']; rows: string[][] }][]) {
    const { r, p } = plans.get(id)!
    expect(p.customers.slice(0, 30)).toEqual(old.customers)
    const legacy = new Set(r.legacyMembers)
    expect(p.appointments.filter((a) => legacy.has(a.member)).map((a) => [a.key, a.status, a.startsAt, a.staff, a.resource, a.menu])).toEqual(old.rows)
  }
})

it('T3 (R11/R13): the mean inside the type band, no weekday above 1.5 × the mean, the gym\'s peak/trough ≥ 1.5', () => {
  const targets: Record<string, [number, number]> = { personal_gym: [24, 30], hair_salon: [16, 20], beauty_chiropractic: [14, 18] }
  for (const [id, { r, p }] of plans) {
    const [low, high] = targets[r.id]
    const density = Number(summarize(p, TODAY, r.policy.weekly_hours).perOpenDay)
    console.log(`T3 ${id.slice(0, 8)} ${r.id} perOpenDay ${density}`)
    expect({ id, density, ok: density >= low && density <= high }).toEqual({ id, density, ok: true })
    const past = p.appointments.filter((a) => a.date < TODAY)
    const days = [...new Set(past.map((a) => a.date))]
    const mean = past.length / days.length
    for (let wd = 0; wd < 7; wd++) {
      const on = days.filter((d) => weekday(d) === wd)
      if (on.length) expect({ id, wd, ok: past.filter((a) => weekday(a.date) === wd).length / on.length <= 1.5 * mean }).toEqual({ id, wd, ok: true })
    }
    if (r.id !== 'personal_gym') continue
    const perHour = new Map<number, number>()
    for (const a of past) perHour.set(Math.floor(minute(a) / 60), (perHour.get(Math.floor(minute(a) / 60)) ?? 0) + 1)
    expect([...perHour.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 7)) // every open hour has starts
    expect(Math.max(...perHour.values()) / Math.min(...perHour.values())).toBeGreaterThanOrEqual(1.5)
  }
})

it('T4/T5 (R7/R17): today every profile row across 13:24 is IN_PROGRESS (≥ 1), other days carry no pin rule; prices; window; labels', () => {
  for (const [id, { r, p }] of plans) {
    const again = plan(r, ctxOf(id, r), TODAY, TODAY)
    expect(again).toEqual(p)
    expect(p.window).toEqual({ from: addDays(TODAY, -105), to: addDays(TODAY, 14) })
    const legacy = new Set(r.legacyMembers)
    const now = jstIso(TODAY, BOARD_PIN)
    const across = (a: { startsAt: string; endsAt: string; date: string }) => a.startsAt <= jstIso(a.date, BOARD_PIN) && jstIso(a.date, BOARD_PIN) < a.endsAt
    expect(p.appointments.filter((a) => a.date === TODAY && a.status === 'IN_PROGRESS').length).toBeGreaterThanOrEqual(1)
    const pastDays = [...new Set(p.appointments.filter((a) => a.date < TODAY).map((a) => a.date))]
    expect(pastDays.some((d) => p.appointments.filter((a) => a.date === d && across(a)).length >= 2)).toBe(true) // no daily one-row stripe
    for (const a of p.appointments) {
      expect(a.booked_price).toBe(r.menus.find((m) => m.name === a.menu)!.price)
      expect(a.price).toBe(a.booked_price)
      expect(hoursOn(r.policy.weekly_hours, a.date)).not.toBeNull()
      if (a.date < TODAY) expect(['COMPLETED', 'CANCELLED', 'NO_SHOW']).toContain(a.status)
      else if (a.date > TODAY) expect(a.status).toBe('SCHEDULED')
      else if (!legacy.has(a.member)) expect(a.status).toBe(across(a) ? 'IN_PROGRESS' : a.startsAt < now ? 'COMPLETED' : 'SCHEDULED')
      if (a.status === 'CANCELLED') {
        expect(Object.keys(registry.cancelReasons)).toContain(a.cancelReason)
        expect(bookingNotes(a)).toContain(`キャンセル理由：${CANCEL_LABELS[a.cancelReason!]}`)
        expect(bookingNotes(a)).not.toContain(a.cancelReason!)
      }
      if (a.status === 'NO_SHOW') expect(bookingNotes(a)).not.toContain('キャンセル理由')
    }
    const future = plan(r, ctxOf(id, r), addDays(TODAY, 7), TODAY)
    expect(p.appointments.every((a) => future.appointments.some((b) => a.key === b.key))).toBe(true)
  }
})

it('R6: a manifest that recorded pastDays keeps every key when registry pastDays changes; without it the keys move', () => {
  for (const [id, { r, p }] of plans) {
    const moved = { ...r, counts: { ...r.counts, pastDays: r.counts.pastDays + 7 } }
    const ctx = ctxOf(id, r)
    const keys = (q: Plan) => q.appointments.filter((a) => a.date >= p.window.from).map((a) => a.key).sort()
    expect(keys(plan(moved, { ...ctx, pastDays: r.counts.pastDays }, TODAY, TODAY))).toEqual(keys(p))
    expect(keys(plan(moved, ctx, TODAY, TODAY))).not.toEqual(keys(p)) // the negative: an unrecorded pastDays re-draws keys
  }
})

it('R10: 8–10 % of every store\'s members are 新規 with a 初回 visit in the window', () => {
  for (const [id, { r, p }] of plans) {
    const fresh = p.customers.filter((c) => c.isNew)
    expect({ id, share: fresh.length / p.customers.length >= 0.08 && fresh.length / p.customers.length <= 0.1 }).toEqual({ id, share: true })
    const firsts = new Set(p.appointments.filter((a) => a.menu === r.firstMenu).map((a) => a.member))
    expect(fresh.filter((c) => firsts.has(c.member)).length).toBeGreaterThanOrEqual(fresh.length * 0.8)
  }
})

it('R4: the side rule — staff by name alternate early/late; the planner books a profile visit only inside its person\'s side', () => {
  expect(sidesOf(['b', 'a'], 600, 1140)).toBeNull()
  expect(sidesOf(['solo'], 420, 1320)!.get('solo')).toEqual({ start: 420, end: 960 })
  const two = sidesOf(['z', 'a'], 420, 1320)!
  expect([two.get('a'), two.get('z')]).toEqual([{ start: 420, end: 960 }, { start: 780, end: 1320 }])
  expect(new Set([...sidesOf(['a', 'b', 'c'], 0, 1440)!.values()].map((s) => s.start)).size).toBe(3)
  const gym = [...plans.values()].find(({ r }) => r.id === 'personal_gym')!
  const legacy = new Set(gym.r.legacyMembers)
  const sides = sidesOf(gym.r.staff.map((s) => s.name), 420, 1320)!
  const outside = gym.p.appointments.filter((a) => !legacy.has(a.member)).filter((a) => { const s = sides.get(a.staff)!; return minute(a) < s.start || minute(a) + a.duration > s.end })
  expect(outside).toEqual([])
})

it('T6: loading and planning all seven stores never constructs the SDK or calls fetch', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network forbidden') })
  try {
    for (const id of targetsFor('all')) {
      const r = await loadRecipe(registry.stores[id].type, id)
      plan(r, storeCtx(id, { weeklyHours: r.policy.weekly_hours }), TODAY, TODAY)
    }
    expect(SynqedClient).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  } finally { fetch.mockRestore() }
})

it('--store all --rows flushes every store and row through a pipe before exiting', () => {
  const output = execFileSync(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', '-O',
    '{"module":"commonjs","moduleResolution":"node"}', 'scripts/test-world/fill.ts', 'plan', '--store', 'all', '--rows'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const sections = [...output.matchAll(/^([0-9a-f-]{36}) ([a-z_]+) (\{\n[\s\S]*?\n\})/gm)]
  expect(sections.map((s) => s[1])).toEqual(Object.keys(registry.stores))
  const planned = sections.reduce((n, s) => n + Number(JSON.parse(s[3]).appointments.split(' ')[0]), 0)
  expect(output.split('\n').filter((l) => /^\d{4}-\d\d-\d\d · /.test(l))).toHaveLength(planned)
})

it('R19: a day no menu fits is logged once and planned empty, without crashing the pure planner', async () => {
  const r = await loadRecipe('hair_salon')
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const hours = { ...r.policy.weekly_hours, mon: { open: '18:00', close: '03:00' } }
  const q = plan(r, { storeId: 'overnight', weeklyHours: hours }, TODAY, TODAY)
  expect(q.appointments.filter((a) => weekday(a.date) === 1)).toEqual([])
  expect(q.appointments.length).toBeGreaterThan(0)
  expect(warn.mock.calls.filter((c) => String(c[0]).includes('overnight'))).toHaveLength(1)
  warn.mockRestore()
})

it('E2 (R5 vs R4): legacy rows in core keep their old time and staff; legacy rows not yet in core follow the side rule', () => {
  const gym = [...plans.values()].find(({ r }) => r.id === 'personal_gym')!
  const { r } = gym
  const id = r.storeId!
  const legacy = new Set(r.legacyMembers)
  const sides = sidesOf(r.staff.map((s) => s.name), 420, 1320)!
  const outside = (rows: Plan['appointments']) => rows.filter((a) => legacy.has(a.member)).filter((a) => { const s = sides.get(a.staff)!; return minute(a) < s.start || minute(a) + a.duration > s.end })
  const row = (a: Plan['appointments'][number]) => [a.key, a.status, a.startsAt, a.staff, a.resource, a.menu]
  // negative: all legacy rows in core (the golden world) — the old paths sit outside the sides
  expect(outside(gym.p.appointments).length).toBeGreaterThan(0)
  // no manifest entry: every row, legacy included, follows the side rule
  expect(outside(plan(r, storeCtx(id, { weeklyHours: r.policy.weekly_hours }), TODAY, TODAY).appointments)).toEqual([])
  // a boundary mid-window: on or before it = the golden rows exactly; after it = inside the sides
  const through = addDays(TODAY, -30)
  const split = plan(r, storeCtx(id, { weeklyHours: r.policy.weekly_hours, legacyThrough: through }), TODAY, TODAY).appointments
  const before = (a: { date: string }) => a.date <= through
  expect(split.filter((a) => legacy.has(a.member) && before(a)).map(row)).toEqual(golden.stores[id].rows.filter((x: string[]) => x[2].slice(0, 10) <= through))
  expect(outside(split.filter((a) => !before(a)))).toEqual([])
  // the boundary: recorded wins; unrecorded = the latest run's today + futureDays; no run = none
  const runs = [{ store: id, today: '2026-09-20' }, { store: id, today: '2026-10-01' }, { store: 'other', today: '2026-10-05' }]
  expect(lastWindowEnd(runs, id)).toBe(addDays('2026-10-01', registry.futureDays))
  expect(lastWindowEnd([], id)).toBeNull()
  expect(storeCtx(id, { weeklyHours: r.policy.weekly_hours }, runs).legacyThrough).toBe(addDays('2026-10-01', registry.futureDays))
  expect(storeCtx(id, { weeklyHours: r.policy.weekly_hours, legacyThrough: null }, runs).legacyThrough).toBeNull()
})
