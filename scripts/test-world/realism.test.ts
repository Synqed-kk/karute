// Runnable check (no framework, no network), same command as ci.yml:
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/realism.test.ts
// The planner's realism (step, rhythm, 指名, ご要望) and realism.ts on an in-memory core that holds what fill.ts left.
import assert from 'node:assert/strict'
import type { Appointment } from '@synqed-kk/client'
import { CANCEL_REASON_SAME_DAY_CONTACT, CANCEL_REASONS, NO_SHOW_REASON_NO_CONTACT } from '../../src/lib/appointments/status'
import { DEV_SALON_BUSINESS_ID, Refused } from './count-baseline'
import { loadRecipe, registry, storeCtx, type Manifest } from './fill'
import { addDays, bookingNotes, hoursOn, isNominated, jstIso, plan, slotStep, type Plan, type Recipe } from './plan'
import { planStore, realism, revert, type Ledger, type RealismCore } from './realism'

const STORE = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f' // beauty_chiropractic in registry.json
const [EPOCH, TODAY] = ['2026-09-18', '2026-09-26']
const NOW = new Date(jstIso(TODAY, 12 * 60))
const TAG = /\[(tw:[^\]]+)\]/ // fill.ts / close-out.ts's own regex
const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const startMin = (a: Plan['appointments'][number]) => (Date.parse(a.startsAt) - Date.parse(jstIso(a.date, 0))) / 60_000
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

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

// ── realism.ts on a fake core ────────────────────────────────────────────────────────────────────
const UPDATE_KEYS = new Set(['customer_id', 'staff_id', 'starts_at', 'ends_at', 'duration_minutes', 'title', 'notes', 'status', 'status_reason', 'acting_staff_id', 'resource_id']) // core's .strict() schema
function fakeCore(rows: Appointment[], o: { business?: string; karuted?: Set<string>; burns?: Map<string, string[]> } = {}) {
  const stats = { writes: 0 }
  const paged = (key: string, xs: unknown[], q: { page?: number; page_size?: number }) => {
    const [page, size] = [q.page ?? 1, Math.min(q.page_size ?? 20, 50)]
    return { [key]: xs.slice((page - 1) * size, page * size), page, page_size: size }
  }
  const members = [...new Set(rows.map((a) => a.customer_id!))]
  const core = {
    orgSettings: { get: async () => ({ business_id: o.business ?? DEV_SALON_BUSINESS_ID }) },
    staff: { list: async (q: { page?: number; page_size?: number }) => paged('staff', [{ id: 'dev', email: 'dev@karute.test' }], q) },
    stores: { list: async () => ({ stores: [{ id: STORE, name: 'テスト東京店' }] }) },
    customers: { list: async (q: { page?: number; page_size?: number }) => paged('customers', members.map((id) => ({ id, member_number: id.slice(2) })), q) },
    karuteRecords: { list: async (q: { page?: number; page_size?: number }) => paged('karute_records', [...(o.karuted ?? [])].map((id) => ({ appointment_id: id })), q) },
    packs: { listRedemptions: async (cid: string) => (o.burns?.get(cid) ?? []).map((id) => ({ pack_id: 'p', redeemed_on: '2026-07-01', appointment_id: id })) },
    appointments: {
      list: async (q: { store_id?: string; page?: number; page_size?: number }) => paged('appointments', rows.filter((a) => !q.store_id || a.store_id === q.store_id || a.business_id !== DEV_SALON_BUSINESS_ID), q),
      get: async (id: string) => rows.find((a) => a.id === id)!,
      update: async (id: string, input: Record<string, unknown>) => {
        for (const k of Object.keys(input)) if (!UPDATE_KEYS.has(k)) throw Object.assign(new Error(`unknown key ${k}`), { status: 400 })
        stats.writes++
        const a = rows.find((x) => x.id === id)!
        Object.assign(a, input)
        if (input.status !== undefined) { // core's own stamps on a status write (appointment.service updateAppointment)
          Object.assign(a, { status_source: 'STAFF', status_set_by: input.acting_staff_id ?? null, status_reason: input.status_reason ?? null, status_set_at: NOW.toISOString() })
          const terminal = input.status === 'CANCELLED' || input.status === 'NO_SHOW'
          if (terminal && !a.cancelled_at) a.cancelled_at = NOW.toISOString()
          else if (!terminal) a.cancelled_at = null
        }
        return a
      },
    },
  }
  return { core: core as unknown as RealismCore, stats }
}

async function world() {
  const recipe = await loadRecipe('beauty_chiropractic')
  const p = plan(recipe, { storeId: STORE, weeklyHours: recipe.policy.weekly_hours }, TODAY, EPOCH)
  const rows: Appointment[] = p.appointments.map((a) => ({
    id: `a-${a.key}`, business_id: DEV_SALON_BUSINESS_ID, customer_id: `c-${a.member}`, staff_id: `s-${a.staff}`, kind: 'BOOKING', store_id: STORE,
    starts_at: a.startsAt, ends_at: a.endsAt, duration_minutes: a.duration, title: null, notes: `テストデータ [${a.key}]`, menu_id: `m-${a.menu}`,
    resource_id: `r-${a.resource}`, occupied_until: new Date(Date.parse(a.endsAt) + 600_000).toISOString(), booked_price_amount: a.price, booked_price_currency: 'JPY',
    status: a.status, source: 'MANUAL', external_refs: {}, cancelled_at: null, status_source: 'SYSTEM', status_set_by: null, status_reason: null, status_set_at: null,
    rebooked_from_appointment_id: null, created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z',
  }))
  const byKey = new Map(rows.map((r, i) => [p.appointments[i].key, r]))
  const karuted = new Set(p.karutes.map((k) => byKey.get(k.key)!.id))
  const burns = new Map<string, string[]>()
  for (const k of p.packs) for (const key of k.redeem) { const r = byKey.get(key)!; burns.set(r.customer_id!, [...(burns.get(r.customer_id!) ?? []), r.id]) }
  // a status a person set, a note a person wrote, and a SYNQED Reserve booking with no duration (none of them the loader's to change)
  const pastCancelled = rows.filter((r) => r.status === 'CANCELLED')
  Object.assign(pastCancelled[0], { status_set_by: 'st-human', status_source: 'STAFF', status_reason: 'cancel-salon-initiated' })
  const edited = rows.find((r) => r.status === 'COMPLETED' && !karuted.has(r.id))!
  edited.notes = `${edited.notes}\n電話でお時間の変更あり`
  const reserve = { ...clone(rows[rows.length - 1]), id: 'reserve-row', notes: '腰が痛いです', source: 'SYNQED_RESERVE' as const, duration_minutes: null, customer_id: 'c-guest', staff_id: 's-見本 はなこ', starts_at: jstIso(addDays(TODAY, 20), 600), ends_at: jstIso(addDays(TODAY, 20), 690), occupied_until: null }
  rows.push(reserve)
  const manifest: Manifest = { businessId: DEV_SALON_BUSINESS_ID, stores: { [STORE]: { type: recipe.id, epoch: EPOCH, weeklyHours: recipe.policy.weekly_hours, created: {} } }, runs: [{ at: '', type: recipe.id, store: STORE, today: EPOCH, created: {}, skipped: [], conflicts409: [], errors: [] }] }
  return { recipe, p, rows, karuted, burns, human: pastCancelled[0], edited, reserve, manifest }
}

async function pass() {
  const w = await world()
  const lines: string[] = []
  const ledgers: { l: Ledger; writesBefore: number }[] = []
  const f = fakeCore(w.rows, { karuted: w.karuted, burns: w.burns })
  const opts = (extra: Partial<Parameters<typeof realism>[1]> = {}) => ({
    manifest: w.manifest, manifestPath: null, stores: [STORE], now: NOW, apply: false, repairForeign: false, log: (l: string) => void lines.push(l),
    saveLedger: (l: Ledger) => void ledgers.push({ l: clone(l), writesBefore: f.stats.writes }), ...extra,
  })
  const hashOf = () => /plan hash ([0-9a-f]{16})/.exec(lines.join('\n'))![1]

  // The guard: another business (org, manifest or a row), or an unmanaged store → REFUSED (2), nothing written.
  const other = fakeCore(clone(w.rows), { business: '00000000-0000-0000-0000-000000000000' })
  assert.equal(await realism(other.core, opts({ apply: true, expect: 'x' })), 2)
  assert.equal(other.stats.writes, 0)
  assert.equal(await realism(f.core, opts({ manifest: { ...w.manifest, businessId: 'other' } })), 2)
  assert.equal(await realism(f.core, opts({ stores: ['store-not-managed'] })), 2)
  const leak = clone(w.rows)
  leak.push({ ...leak[0], id: 'leak', business_id: '00000000-0000-0000-0000-000000000000' })
  const lk = fakeCore(leak)
  assert.equal(await realism(lk.core, opts({ apply: true, expect: 'x' })), 2, 'a row of another business in the list → REFUSED')
  const abroad = clone(w.rows)
  abroad.push({ ...abroad[0], id: 'abroad', store_id: 'store-other', business_id: 'x' })
  assert.equal(await realism(fakeCore(abroad).core, opts()), 2)
  // the store check on its own: the Dev Salon's business id, another store (the list never returns it; planStore refuses it)
  const elsewhere = [...clone(w.rows), { ...clone(w.rows[0]), id: 'elsewhere', store_id: 'store-other' }]
  assert.throws(() => planStore({ recipe: w.recipe, storeId: STORE, plan: w.p, rows: elsewhere, custId: new Map(), karuted: new Set(), burnt: new Set(), today: TODAY, lastPlanned: TODAY, realismFrom: null, repairForeign: false }),
    (e: Error) => e instanceof Refused && e.message === `booking elsewhere belongs to store store-other, not ${STORE}`, 'a Dev Salon row of another store → REFUSED, naming the store')
  assert.equal(lk.stats.writes + f.stats.writes, 0, 'refused before any write')
  assert.equal(ledgers.length, 0)

  // Dry-run: every read, nothing written, the plan + its hash. A wrong --expect → 3, nothing written, no ledger.
  const before = clone(w.rows)
  lines.length = 0
  assert.equal(await realism(f.core, opts()), 0)
  const hash = hashOf()
  assert.equal(f.stats.writes, 0, 'dry-run writes nothing')
  assert.equal(await realism(f.core, opts({ apply: true, expect: 'not-the-hash' })), 3)
  assert.equal(f.stats.writes + ledgers.length, 0)
  assert.deepEqual(w.rows, before)

  // The sampler is deterministic: the same input, the same plan (hash) on every run.
  lines.length = 0
  await realism(f.core, opts())
  assert.equal(hashOf(), hash, 'same world → same plan')

  // Apply: exactly the printed plan; the ledger is saved before the first write.
  lines.length = 0
  assert.equal(await realism(f.core, opts({ apply: true, expect: hash })), 0, lines.join('\n'))
  assert.equal(ledgers.length, 1)
  assert.equal(ledgers[0].writesBefore, 0, 'ledger first')
  const ledger = ledgers[0].l
  assert.equal(f.stats.writes, ledger.changes.length)
  assert.equal(w.manifest.stores[STORE].realismFrom, addDays(TODAY, 15), 'realismFrom = the day after the last planned day')

  const real = w.recipe.realism!
  const planned = new Map(w.p.appointments.map((a) => [`a-${a.key}`, a]))
  const owned = w.rows.filter((r) => planned.has(r.id) && r !== w.edited)
  const past = owned.filter((r) => planned.get(r.id)!.date < TODAY)
  const count = (s: string, rs: Appointment[] = past) => rs.filter((r) => r.status === s).length
  const pastBefore = before.filter((b) => past.some((r) => r.id === b.id))
  // up to the rate, never down to it: a row above the target stays (fill.ts karutes only planned-COMPLETED rows)
  assert.equal(count('CANCELLED'), Math.max(Math.round(real.cancelShare * past.length), count('CANCELLED', pastBefore)), 'past cancel rate')
  assert.equal(count('NO_SHOW'), Math.max(Math.round(real.noShowShare * past.length), count('NO_SHOW', pastBefore)), 'past no-show rate')
  assert.ok(count('CANCELLED', pastBefore) > Math.round(real.cancelShare * past.length), 'the world starts above the cancel target (not vacuous)')
  assert.ok(!ledger.changes.some((c) => c.set.status === 'COMPLETED'), 'no change ever sets COMPLETED')
  const future = owned.filter((r) => planned.get(r.id)!.date > TODAY && r.status === 'CANCELLED').length
  assert.ok(future >= real.futureCancels[0] && future <= real.futureCancels[1], `future cancels ${future}`)
  const burnt = new Set([...w.burns.values()].flat())
  for (const r of owned) {
    const was = before.find((b) => b.id === r.id)!
    if (r.status === 'NO_SHOW' && r.status_set_by == null) assert.equal(r.status_reason, NO_SHOW_REASON_NO_CONTACT, `${r.id}: 無断 = no contact`)
    if (r.status === 'CANCELLED') assert.ok((CANCEL_REASONS as readonly string[]).includes(r.status_reason!), `${r.id}: a cancel code`)
    if (r.status === 'CANCELLED' && burnt.has(r.id)) assert.equal(r.status_reason, CANCEL_REASON_SAME_DAY_CONTACT, `${r.id}: a burnt cancel is same-day contact`)
    if (r.status !== was.status) assert.ok(!w.karuted.has(r.id) && !burnt.has(r.id), `${r.id}: a booking with a karute or a burn was cancelled`)
    assert.equal(r.status_set_by, was.status_set_by, `${r.id}: no acting staff stamped`)
    assert.equal(r.notes, bookingNotes(planned.get(r.id)!), `${r.id}: tag first, then the ご要望 line`)
    assert.equal(TAG.exec(r.notes!)?.[1], planned.get(r.id)!.key, 'fill / close-out still find the tag')
  }
  assert.ok(owned.some((r) => r.notes!.includes('\n')) && owned.some((r) => !r.notes!.includes('\n')), 'some forms filled, some left empty')
  assert.deepEqual([w.human.status, w.human.status_reason], ['CANCELLED', 'cancel-salon-initiated'], 'a status a person set is never changed')
  assert.deepEqual(w.edited, before.find((b) => b.id === w.edited.id), 'a note a person wrote: the booking is left alone')
  assert.deepEqual(w.reserve, before.find((b) => b.id === 'reserve-row'), 'a SYNQED Reserve booking is left alone without --repair-foreign')
  assert.ok(lines.some((l) => l.includes('reserve-row: not a loader booking (source SYNQED_RESERVE), left alone — its duration_minutes is null')))

  // A second run finds nothing to do.
  lines.length = 0
  await realism(f.core, opts())
  assert.ok(lines.some((l) => l.includes('TOTAL rows touched 0 · manifest realismFrom 0')), lines.slice(-3).join('\n'))

  // Revert: every row back to the ledger's old values — byte-equal but for core's own audit stamps on a status write.
  const changedSince = ledger.changes.find((c) => c.set.notes && !c.set.status)!
  w.rows.find((r) => r.id === changedSince.id)!.notes = 'スタッフが書き換えたメモ'
  const writes = f.stats.writes
  lines.length = 0
  assert.equal(await revert(f.core, ledger, w.manifest, (l) => void lines.push(l)), 0)
  assert.ok(lines.includes(`changed since the ledger, left alone: ${changedSince.id}`))
  assert.equal(f.stats.writes - writes, ledger.changes.length - 1)
  const STAMPS = ['status_source', 'status_set_at', 'cancelled_at'] as const // core-owned; a status write restamps them
  const strip = (r: Appointment) => Object.fromEntries(Object.entries(r).filter(([k]) => !(STAMPS as readonly string[]).includes(k)))
  for (const r of w.rows) if (r.id !== changedSince.id) assert.deepEqual(strip(r), strip(before.find((b) => b.id === r.id)!), `${r.id}: reverted`)
  assert.equal(w.manifest.stores[STORE].realismFrom, undefined, 'realismFrom removed again')
  lines.length = 0
  await revert(f.core, ledger, w.manifest, (l) => void lines.push(l))
  assert.ok(lines.filter((l) => l.startsWith('already back:')).length === ledger.changes.length - 1, 'a second revert writes nothing')
  // A ledger of another business is refused.
  assert.equal(await revert(f.core, { ...ledger, businessId: 'other' }, null, () => {}), 2)

  // --repair-foreign: only the null duration of a foreign booking → its booked span; its notes stay the customer's.
  const w2 = await world()
  const out = planStore({ recipe: w2.recipe, storeId: STORE, plan: w2.p, rows: w2.rows, custId: new Map(w2.rows.map((r) => [r.customer_id!.slice(2), r.customer_id!])), karuted: w2.karuted, burnt: new Set(), today: TODAY, lastPlanned: TODAY, realismFrom: null, repairForeign: true })
  assert.deepEqual(out.changes.find((c) => c.id === 'reserve-row'), { id: 'reserve-row', store: STORE, key: null, old: { duration_minutes: null }, set: { duration_minutes: 90 } })
  // The sampler: the same input twice → the same changes.
  const again = planStore({ recipe: w2.recipe, storeId: STORE, plan: w2.p, rows: w2.rows, custId: new Map(w2.rows.map((r) => [r.customer_id!.slice(2), r.customer_id!])), karuted: w2.karuted, burnt: new Set(), today: TODAY, lastPlanned: TODAY, realismFrom: null, repairForeign: true })
  assert.deepEqual(again, out)
  // A karute or a 回数券 burn means the visit happened: with every past booking COMPLETED (so the rates need moves) and
  // every one holding a karute — or a burn — nothing may be cancelled or marked no-show.
  const input = { recipe: w2.recipe, storeId: STORE, plan: w2.p, custId: new Map(w2.rows.map((r) => [r.customer_id!.slice(2), r.customer_id!])), today: TODAY, lastPlanned: TODAY, realismFrom: null, repairForeign: false }
  const allDone = clone(w2.rows).map((r) => (r.status === 'CANCELLED' || r.status === 'NO_SHOW' ? { ...r, status: 'COMPLETED' as const } : r))
  const ids = new Set(allDone.map((r) => r.id))
  const pastMoves = (o: ReturnType<typeof planStore>) => o.changes.filter((c) => c.set.status && c.old.status === 'COMPLETED')
  assert.ok(pastMoves(planStore({ ...input, rows: allDone, karuted: new Set(), burnt: new Set() })).length > 0, 'the rates need moves (not vacuous)')
  assert.deepEqual(pastMoves(planStore({ ...input, rows: allDone, karuted: ids, burnt: new Set() })), [], 'no booking with a karute is cancelled or marked no-show')
  assert.deepEqual(pastMoves(planStore({ ...input, rows: allDone, karuted: new Set(), burnt: ids })), [], 'no booking with a burn is cancelled or marked no-show')
  // A cancelled booking holding a burn carries same-day contact — the only cancel reason a burn may pair with.
  const cancels = w2.rows.filter((r) => r.status === 'CANCELLED' && r.status_set_by == null).map((r) => r.id)
  const paired = planStore({ ...input, rows: w2.rows, karuted: new Set(), burnt: new Set(cancels) }).changes.filter((c) => c.set.status === 'CANCELLED' && cancels.includes(c.id))
  assert.ok(paired.length > 3 && paired.every((c) => c.set.status_reason === CANCEL_REASON_SAME_DAY_CONTACT), `burnt cancels: ${paired.map((c) => c.set.status_reason)}`)
}

async function main() {
  await planner()
  await pass()
  console.log('✓ realism: all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
