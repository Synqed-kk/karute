import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { SynqedClient } from '@synqed-kk/client'
import { loadRecipe, registry, storeCtx, summarize, targetsFor } from '../../../../scripts/test-world/fill'
import { addDays, bookingNotes, hoursOn, jstIso, plan, type Plan, type Recipe } from '../../../../scripts/test-world/plan'
import { STORE_SAMPLE_POLICY } from '@/business/lib/practice-door/registry'
import { boardNow } from '@/business/lib/fixtures-today'

jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => { throw new Error('pure plan attempted SDK construction') }) }))
const TODAY = '2026-10-07'
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'scripts/test-world/__fixtures__/legacy-keys.txt'), 'utf8').split('\n').slice(3).join('\n'))
const plans = new Map<string, { r: Recipe; p: Plan }>()
beforeAll(async () => {
  for (const [id, entry] of Object.entries(registry.stores)) {
    const r = await loadRecipe(entry.type, id)
    plans.set(id, { r, p: plan(r, storeCtx(id, { weeklyHours: r.policy.weekly_hours }), TODAY, TODAY) })
  }
})

it('T1: every practice store, original aliases/prefixes, disjoint customer identities and staff', () => {
  expect(Object.keys(registry.stores).sort()).toEqual(Object.keys(STORE_SAMPLE_POLICY).sort())
  const names = new Set<string>(), members = new Set<string>(), staff = new Set<string>(), phones = new Set<string>()
  const prefixes = new Set<string>()
  for (const [id, { r, p }] of plans) {
    const e = registry.stores[id]
    expect(STORE_SAMPLE_POLICY[id]).toMatchObject({ type: e.type })
    expect(prefixes.has(e.keyPrefix)).toBe(false); prefixes.add(e.keyPrefix)
    expect(e.keyPrefix).toBe(fixture.stores[id] ? e.type : `${e.type}@${id.slice(0, 8)}`)
    expect(targetsFor(id)).toEqual([id])
    if (fixture.stores[id]) expect(targetsFor(undefined, e.type)).toEqual([id])
    expect(p.customers.map((c) => [c.name, c.kana, c.gender])).toEqual(r.namePool!.slice(e.namePool * r.counts.customers, (e.namePool + 1) * r.counts.customers))
    for (const c of p.customers) {
      expect(names.has(c.name)).toBe(false); names.add(c.name)
      expect(members.has(c.member)).toBe(false); members.add(c.member)
      expect(phones.has(c.phone)).toBe(false); phones.add(c.phone)
    }
    for (const s of p.staff) { expect(staff.has(s.name)).toBe(false); staff.add(s.name) }
  }
  expect(targetsFor('all')).toEqual(Object.keys(registry.stores))
  expect(() => targetsFor('unknown')).toThrow('unmapped')
  expect(() => targetsFor(undefined, 'unknown')).toThrow('unknown type')
  expect(() => targetsFor('all', 'hair_salon')).toThrow('choose')
})

it('T2: the pre-change planner golden preserves every original member, key and visit date', () => {
  expect(fixture.epoch).toBe(TODAY)
  for (const [id, old] of Object.entries(fixture.stores) as [string, { customers: Recipe['customers']; keys: string[] }][]) {
    const { p } = plans.get(id)!
    expect(p.customers.slice(0, 30)).toEqual(old.customers)
    const members = new Set(old.customers.map((c) => c.member))
    expect(p.appointments.filter((a) => members.has(a.member)).map((a) => a.key).sort()).toEqual([...old.keys].sort())
  }
})

it('T3: every store meets its density tolerance; the operating gym week covers all fifteen open hours', () => {
  const targets: Record<string, [number, number]> = { personal_gym: [24, 30], hair_salon: [16, 20], beauty_chiropractic: [14, 18] }
  for (const [id, { r, p }] of plans) {
    const [low, high] = targets[r.id]
    const density = Number(summarize(p, TODAY, r.policy.weekly_hours).perOpenDay)
    expect({ id, density }).toEqual({ id, density: expect.any(Number) })
    expect(density).toBeGreaterThanOrEqual(low * .85)
    expect(density).toBeLessThanOrEqual(high * 1.15)
    if (r.id !== 'personal_gym') continue
    for (let d = TODAY; d <= addDays(TODAY, 6); d = addDays(d, 1)) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
      if (wd === 0 || wd === 6) continue
      const starts = new Set(p.appointments.filter((a) => a.date === d).map((a) => Math.floor((Date.parse(a.startsAt) - Date.parse(jstIso(d, 0))) / 3600000)))
      expect({ d, starts: [...starts].sort((a, b) => a - b) }).toEqual({ d, starts: Array.from({ length: 15 }, (_, i) => i + 7) })
    }
  }
})

it('T4/T5: stable status hashes, one current booking at the board pin, menu prices and history window', () => {
  expect(boardNow).toBe(13 * 60 + 24)
  for (const [id, { r, p }] of plans) {
    const again = plan(r, storeCtx(id, { weeklyHours: r.policy.weekly_hours }), TODAY, TODAY)
    expect(again).toEqual(p)
    expect(p.window).toEqual({ from: addDays(TODAY, -105), to: addDays(TODAY, 14) })
    const now = jstIso(TODAY, boardNow), today = p.appointments.filter((a) => a.date === TODAY)
    expect(today.filter((a) => a.status === 'IN_PROGRESS')).toHaveLength(1)
    for (const a of p.appointments) {
      expect(a.booked_price).toBe(r.menus.find((m) => m.name === a.menu)!.price)
      expect(a.price).toBe(a.booked_price)
      expect(hoursOn(r.policy.weekly_hours, a.date)).not.toBeNull()
      if (a.date < TODAY) expect(['COMPLETED', 'CANCELLED', 'NO_SHOW']).toContain(a.status)
      else if (a.date > TODAY) expect(a.status).toBe('SCHEDULED')
      else if (a.status === 'IN_PROGRESS') { expect(a.startsAt <= now && now < a.endsAt).toBe(true) }
      else {
        expect(a.status).toBe(a.startsAt < now ? 'COMPLETED' : 'SCHEDULED')
        if (a.status === 'COMPLETED') expect(a.endsAt <= now).toBe(true)
      }
      if (a.status === 'CANCELLED') {
        expect(Object.keys(registry.cancelReasons)).toContain(a.cancelReason)
        expect(bookingNotes(a)).toContain(a.cancelReason!)
      }
    }
    const past = p.appointments.filter((a) => a.date < TODAY)
    for (const [status, share] of [['CANCELLED', .04], ['NO_SHOW', .02]] as const)
      expect(Math.abs(past.filter((a) => a.status === status).length / past.length - share)).toBeLessThan(.02)
    const future = plan(r, storeCtx(id, { weeklyHours: r.policy.weekly_hours }), addDays(TODAY, 7), TODAY)
    expect(p.appointments.every((a) => future.appointments.some((b) => a.key === b.key))).toBe(true)
  }
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
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const sections = [...output.matchAll(/^([0-9a-f-]{36}) ([a-z_]+) (\{\n[\s\S]*?\n\})/gm)]
  expect(sections.map((s) => s[1])).toEqual(Object.keys(registry.stores))
  const planned = sections.reduce((n, s) => n + Number(JSON.parse(s[3]).appointments.split(' ')[0]), 0)
  expect(output.split('\n').filter((l) => /^\d{4}-\d\d-\d\d · /.test(l))).toHaveLength(planned)
})

it('a menu longer than a special opening is dropped, without crashing the pure planner', async () => {
  const r = await loadRecipe('hair_salon')
  const hours = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '11:00', close: '11:30' }]))
  expect(() => plan(r, { storeId: r.storeId!, weeklyHours: hours }, TODAY, TODAY)).not.toThrow()
})
