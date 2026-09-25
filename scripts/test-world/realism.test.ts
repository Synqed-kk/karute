// Runnable check (no framework, no network), same command as ci.yml:
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/realism.test.ts
// The planner's realism: the per-store step.
import assert from 'node:assert/strict'
import { loadRecipe, registry, storeCtx } from './fill'
import { hoursOn, jstIso, plan, slotStep, type Plan, type Recipe } from './plan'

const STORE = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f' // beauty_chiropractic in registry.json
const [EPOCH, TODAY] = ['2026-09-18', '2026-09-26']
const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const startMin = (a: Plan['appointments'][number]) => (Date.parse(a.startsAt) - Date.parse(jstIso(a.date, 0))) / 60_000

/** Every booking on its store's step from the day's opening, inside the hours, never on a closed day. */
function onGrid(r: Recipe, p: Plan, step: number) {
  assert.ok(p.appointments.length > 0)
  for (const a of p.appointments) {
    const h = hoursOn(r.policy.weekly_hours, a.date)
    assert.ok(h, `${a.key}: on a closed day`)
    const s = startMin(a)
    assert.equal((s - at(h.open)) % step, 0, `${a.key}: ${s} is off the ${step}-minute step from ${h.open}`)
    assert.ok(s >= at(h.open) && s + a.duration <= at(h.close), `${a.key}: outside ${h.open}–${h.close}`)
  }
}

async function planner() {
  const r = await loadRecipe('beauty_chiropractic')
  const hours = r.policy.weekly_hours
  const ctx = { storeId: STORE, weeklyHours: hours }

  // Step: a per-store setting (registry.json), 30 when absent; refused only when meaningless.
  assert.equal(storeCtx(STORE, { weeklyHours: hours }).slotMinutes, registry.slotMinutes[STORE])
  assert.deepEqual(plan(r, ctx, TODAY, EPOCH), plan(r, { ...ctx, slotMinutes: 30 }, TODAY, EPOCH), 'absent = 30')
  for (const step of [20, 30, 45]) onGrid(r, plan(r, { ...ctx, slotMinutes: step }, TODAY, EPOCH), step)
  const s45 = plan(r, { ...ctx, slotMinutes: 45 }, TODAY, EPOCH).appointments.map(startMin)
  assert.ok(s45.some((m) => m % 30 !== 0) && !s45.includes(630), `45-minute store: starts off the half hour (${[...new Set(s45)].sort((a, b) => a - b).slice(0, 6)}), 10:30 never`)
  assert.ok(!plan(r, ctx, TODAY, EPOCH).appointments.some((a) => new Date(`${a.date}T00:00:00Z`).getUTCDay() === 2), 'closed Tuesday: no booking')
  const odd = { ...hours, mon: { open: '09:05', close: '19:25' } } // an odd opening: the grid starts at it (09:05, 09:25 …)
  onGrid({ ...r, policy: { weekly_hours: odd } }, plan(r, { ...ctx, weeklyHours: odd, slotMinutes: 20 }, TODAY, EPOCH), 20)
  for (const bad of [0, -30, 7.5, 541]) assert.throws(() => slotStep(hours, bad), /slotMinutes/, `step ${bad} refused`)
  assert.equal(slotStep(hours, 540), 540, 'the whole 10:00–19:00 day is a (strange but) valid step')

}

async function main() {
  await planner()
  console.log('✓ realism: all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
