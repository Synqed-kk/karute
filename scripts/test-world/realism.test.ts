// Runnable check (no framework, no network), same command as ci.yml:
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/realism.test.ts
// The planner's realism: the per-store step, the realismFrom cut (rhythm, 指名), the ご要望 pools.
import assert from 'node:assert/strict'
import { loadRecipe, registry, storeCtx } from './fill'
import { addDays, bookingNotes, hoursOn, isNominated, jstIso, plan, slotStep, type Plan, type Recipe } from './plan'

const STORE = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f' // beauty_chiropractic in registry.json
const [EPOCH, TODAY] = ['2026-09-18', '2026-09-26']
const TAG = /\[(tw:[^\]]+)\]/ // fill.ts / close-out.ts's own regex
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

  // realismFrom: every day before it is exactly the old plan; from it, the rhythm, 指名 and a later today only adding.
  const until = addDays(TODAY, 120) // a long horizon so every type shows several rhythm visits
  for (const type of Object.keys(registry.types)) {
    const t = await loadRecipe(type)
    const c0 = { storeId: `store-${type}`, weeklyHours: t.policy.weekly_hours }
    const cut = addDays(TODAY, 15)
    const [old, neu] = [plan(t, c0, until, EPOCH), plan(t, { ...c0, realismFrom: cut }, until, EPOCH)]
    assert.deepEqual(neu.appointments.filter((a) => a.date < cut), old.appointments.filter((a) => a.date < cut), `${type}: nothing before realismFrom moves`)
    const later = plan(t, { ...c0, realismFrom: cut }, addDays(until, 7), EPOCH)
    const next = new Map(later.appointments.map((a) => [a.key, a]))
    for (const a of neu.appointments.filter((x) => x.date < until)) assert.deepEqual(next.get(a.key), a, `${type}: the past never shifts after the cut: ${a.key}`)
    onGrid(t, neu, 30)
    const [lo, hi] = t.realism!.rhythmDays
    const j = t.realism!.rhythmJitter
    const gaps: number[] = []
    for (const c of t.customers) {
      const days = neu.appointments.filter((a) => a.member === c.member).map((a) => a.date)
      const after = days.filter((d) => d >= cut)
      if (after.length) assert.ok(c.every || days.length === 1, `${type} ${c.member}: a one-visit customer came back`)
      for (let k = 1; k < days.length; k++) if (days[k - 1] >= cut) gaps.push((Date.parse(days[k]) - Date.parse(days[k - 1])) / 86_400_000)
      // 指名 continuity: a nominating customer's 指名 visits (a menu that takes 指名) are all with their own 担当
      const own = neu.appointments.filter((a) => a.member === c.member && a.date >= cut && t.menus.find((m) => m.name === a.menu)!.nomination)
      if (isNominated(t, c.member)) assert.ok(own.every((a) => a.staff === c.staff), `${type} ${c.member}: a 指名 visit went to someone else`)
    }
    const after = gaps.filter((g) => g < 5 * hi) // a visit dropped on a full day doubles one gap
    const median = [...after].sort((a, b) => a - b)[after.length >> 1]
    assert.ok(gaps.length > t.customers.length / 2, `${type}: ${gaps.length} rhythm gaps`)
    assert.ok(Math.min(...gaps) >= lo - j && median >= lo - j && median <= hi + j + 2, `${type}: rhythm gaps min ${Math.min(...gaps)} median ${median} vs [${lo}, ${hi}] ± ${j}`)
    const free = t.customers.filter((c) => c.every && !isNominated(t, c.member))
    assert.ok(free.some((c) => new Set(neu.appointments.filter((a) => a.member === c.member && a.date >= cut).map((a) => a.staff)).size > 1), `${type}: フリー customers meet more than one staffer after the cut`)
    const nominated = t.customers.filter((c) => isNominated(t, c.member)).length / t.customers.length
    assert.ok(Math.abs(nominated - t.realism!.nominatedShare) <= 0.2, `${type}: ${nominated} of customers nominate vs ${t.realism!.nominatedShare}`)

    // ご要望: a pool of 12–20 native lines; the share of filled forms ≈ requestShare; conditions hold; the tag stays first.
    assert.ok(t.requests.length >= 12 && t.requests.length <= 20, `${type}: ${t.requests.length} request lines`)
    for (const l of t.requests) assert.doesNotMatch(l.text, /[A-Za-z]/, `${type}: no English in 「${l.text}」`)
    const filled = old.appointments.filter((a) => a.request).length / old.appointments.length
    assert.ok(Math.abs(filled - t.realism!.requestShare) <= 0.1, `${type}: ${filled.toFixed(2)} of bookings carry a request vs ${t.realism!.requestShare}`)
    const byText = new Map(t.requests.map((l) => [l.text, l]))
    const firstOf = new Map<string, string>() // member → key of their earliest booking
    for (const a of old.appointments) if (!firstOf.has(a.member)) firstOf.set(a.member, a.key)
    for (const a of old.appointments) {
      const c = t.customers.find((x) => x.member === a.member)!
      const l = a.request ? byText.get(a.request)! : null
      const firstVisit = c.isNew && a.menu === t.firstMenu && firstOf.get(a.member) === a.key
      if (l?.first === true) assert.ok(c.isNew && a.menu === t.firstMenu, `${type} ${a.key}: 「${l.text}」 on a return visit`)
      if (l?.first === false) assert.ok(!firstVisit, `${type} ${a.key}: 「${l.text}」 on a first visit`)
      if (l?.themes) assert.ok(l.themes.includes(c.theme), `${type} ${a.key}: 「${l.text}」 is not ${c.theme}'s concern`)
      if (l?.nominated) assert.equal(a.staff, c.staff, `${type} ${a.key}: a 指名 line on a visit with someone else`)
      assert.equal(TAG.exec(bookingNotes(a))?.[1], a.key, 'the tag reader still finds the key')
      assert.ok(bookingNotes(a).includes('[tw:') && bookingNotes(a).startsWith(`テストデータ [${a.key}]`))
    }
  }
}

async function main() {
  await planner()
  console.log('✓ realism: all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
