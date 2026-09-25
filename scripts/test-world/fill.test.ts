// Runnable check (no framework, no network), same command as ci.yml:
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/fill.test.ts
// An in-memory core stands in for SynqedClient. Like core, it answers a double-booked practitioner or bed with a 409
// (a CANCELLED / NO_SHOW booking frees its slot: the app's isTerminalStatus).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTerminalStatus } from '../../src/lib/appointments/status'
import { DEV_SALON_BUSINESS_ID } from './count-baseline'
import { apply, assertOneStore, loadRecipe, registry, withRetry, type FillCore, type Manifest } from './fill'
import { addDays, DEFAULT_SLOT_MINUTES, hoursOn, jstIso, plan, preferredStart, type Plan } from './plan'

const STORE = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f'
const OTHER = 'store-other'
const TODAY = '2026-09-24'
type Row = Record<string, unknown> & { id: string }
type Q = { page?: number; page_size?: number; store_id?: string; from?: string; to?: string; include_deleted?: boolean }
const paged = (key: string, rows: unknown[], { page = 1, page_size = 20 }: Q = {}) => {
  const size = Math.min(page_size, 50)
  return { [key]: rows.slice((page - 1) * size, page * size), page, page_size: size, total: rows.length }
}
const conflict = (msg: string) => Object.assign(new Error(msg), { status: 409 })

function fakeCore(o: { business?: string; devEmail?: string; fail409?: boolean; defaultHours?: Record<string, unknown>; stores?: string[] } = {}) {
  let n = 0
  const t = { staff: [] as Row[], links: new Map<string, string[]>(), resources: [] as Row[], menus: [] as Row[], customers: [] as Row[], packs: [] as Row[], burns: [] as Row[], appts: [] as Row[], karutes: [] as Row[] }
  const stats = { writes: 0, policy: null as null | Record<string, unknown> }
  const add = (table: Row[], row: Record<string, unknown>) => {
    stats.writes++
    const r = { id: `id-${++n}`, business_id: o.business ?? DEV_SALON_BUSINESS_ID, ...row }
    table.push(r)
    return r
  }
  // Existing world: the dev card (all stores), and the six practitioners — one works everywhere (no rows), one elsewhere too.
  t.staff.push({ id: 'dev', name: 'Dev Salon', email: o.devEmail ?? 'dev@karute.test' })
  for (const [i, name] of ['見本 はなこ', '見本 あずさ', '見本 しろう', '見本 ごろう', 'テスト さぶろう', '見本 みらい'].entries()) {
    t.staff.push({ id: `st-${i}`, name, email: null })
    if (i > 0) t.links.set(`st-${i}`, i === 3 ? [OTHER, STORE] : i === 4 ? [OTHER] : [STORE])
  }
  // A recipe customer Liam put in the bin: listed only with include_deleted, like core.
  t.customers.push({ id: 'binned', name: '伊藤 恵', member_number: 'BC-0003', deleted_at: '2026-09-01T00:00:00Z' })
  const overlaps = (a: Row, b: Record<string, unknown>) =>
    Date.parse(a.starts_at as string) < Date.parse(b.ends_at as string) && Date.parse(b.starts_at as string) < Date.parse(a.ends_at as string)
  const core = {
    orgSettings: { get: async () => ({ business_id: o.business ?? DEV_SALON_BUSINESS_ID }) },
    stores: { list: async () => ({ stores: [{ id: STORE, name: 'テスト東京店' }, ...(o.stores ?? []).map((id) => ({ id, name: id }))] }) },
    staff: { list: async (q: Q) => paged('staff', t.staff, q), create: async (i: Record<string, unknown>) => add(t.staff, i) },
    staffStores: {
      get: async (id: string) => ({ store_ids: t.links.get(id) ?? [] }),
      set: async (id: string, ids: string[]) => (stats.writes++, t.links.set(id, ids), { ok: true }),
    },
    storePolicies: {
      get: async () => stats.policy ?? { source: 'default', weekly_hours: o.defaultHours ?? null },
      set: async (_: string, i: Record<string, unknown>) => (stats.writes++, (stats.policy = { ...i, source: 'custom' })),
    },
    resources: { list: async () => ({ resources: t.resources }), create: async (i: Record<string, unknown>) => add(t.resources, i) },
    menus: { list: async () => ({ menus: t.menus }), create: async (i: Record<string, unknown>) => add(t.menus, i) },
    customers: { list: async (q: Q) => paged('customers', t.customers.filter((c) => q.include_deleted || !c.deleted_at), q), create: async (i: Record<string, unknown>) => add(t.customers, i) },
    packs: {
      listPacks: async (cid: string) => t.packs.filter((p) => p.customer_id === cid),
      createPack: async (i: Record<string, unknown>) => add(t.packs, i),
      listRedemptions: async (cid: string) => t.burns.filter((b) => b.customer_id === cid),
      addRedemption: async (i: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        if (t.burns.some((b) => b.appointment_id === i.appointment_id)) throw conflict('duplicate redemption')
        return add(t.burns, { ...i, idempotencyKey: opts?.idempotencyKey })
      },
    },
    appointments: {
      list: async (q: Q) => paged('appointments', t.appts.filter((a) => (!q.from || (a.starts_at as string) >= q.from) && (!q.to || (a.starts_at as string) < q.to)), q),
      create: async (i: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        if (o.fail409) throw conflict('RESOURCE_TAKEN')
        if (t.appts.some((a) => !isTerminalStatus(a.status as string) && overlaps(a, i) && (a.staff_id === i.staff_id || a.resource_id === i.resource_id))) throw conflict('double-booked')
        return add(t.appts, { ...i, occupied_until: null, idempotencyKey: opts?.idempotencyKey })
      },
    },
    karuteRecords: {
      list: async (q: Q) => paged('karute_records', t.karutes.filter((k) => k.store_id === q.store_id), q),
      create: async (i: Record<string, unknown>) => add(t.karutes, i),
    },
  }
  return { core: core as unknown as FillCore, t, stats }
}

const keys = (p: Plan) => new Set(p.appointments.map((a) => a.key))

async function main() {
  const recipe = await loadRecipe('beauty_chiropractic')
  const ctx = { storeId: STORE, weeklyHours: recipe.policy.weekly_hours }
  const cleanup = Object.fromEntries(recipe.resources.map((r) => [r.name, r.cleanup_minutes * 60_000]))

  // (a) planner: deterministic, a later today only adds, no double-booking, every slot inside the hours.
  const p1 = plan(recipe, ctx, TODAY, TODAY)
  assert.deepEqual(plan(recipe, ctx, TODAY, TODAY), p1, 'same inputs → same plan')
  assert.ok(p1.appointments.length > 150 && p1.karutes.length > 50 && p1.packs.length === 12, 'the plan fills the store')
  const p2 = plan(recipe, ctx, addDays(TODAY, 7), TODAY)
  const [k1, k2] = [keys(p1), keys(p2)]
  assert.ok([...k1].every((k) => k2.has(k)) && k2.size > k1.size, 'a week later: strictly a superset of keys')
  const later = new Map(p2.appointments.map((a) => [a.key, a]))
  for (const a of p1.appointments.filter((x) => x.date < TODAY)) assert.deepEqual(later.get(a.key), a, `the past never shifts: ${a.key}`)
  for (const [name, p] of [['p1', p1], ['p2', p2]] as const) {
    const as = p.appointments
    for (const a of as) {
      const h = hoursOn(recipe.policy.weekly_hours, a.date)
      assert.ok(h && a.startsAt >= jstIso(a.date, 600) && a.endsAt <= jstIso(a.date, 1140), `${name} ${a.key} inside the hours`)
      for (const b of as) {
        if (a === b || a.date !== b.date) continue
        const [as0, ae, bs, be] = [Date.parse(a.startsAt), Date.parse(a.endsAt), Date.parse(b.startsAt), Date.parse(b.endsAt)]
        assert.ok(!(a.staff === b.staff && as0 < be && bs < ae), `${name}: ${a.staff} double-booked ${a.key} / ${b.key}`)
        assert.ok(!(a.resource === b.resource && as0 < be + cleanup[b.resource] && bs < ae + cleanup[a.resource]), `${name}: ${a.resource} double-booked ${a.key} / ${b.key}`)
      }
    }
  }

  // (b) pin: another business, or no dev@karute.test card → exit 2 before any write.
  const wrong = fakeCore({ business: '00000000-0000-0000-0000-000000000000' })
  const empty = (): Manifest => ({ businessId: DEV_SALON_BUSINESS_ID, stores: {}, runs: [] })
  const opts = (m: Manifest, today = TODAY) => ({ recipe, storeId: STORE, manifest: m, today, dry: false, log: () => {}, wait: async () => {} })
  assert.equal(await apply(wrong.core, opts(empty())), 2)
  assert.equal(wrong.stats.writes, 0, 'REFUSED before any write')
  const noDev = fakeCore({ devEmail: 'someone@else.test' })
  assert.equal(await apply(noDev.core, opts(empty())), 2)
  assert.equal(noDev.stats.writes, 0)
  // A store registry.json does not map to this type → refused before any write.
  const unmapped = fakeCore()
  await assert.rejects(apply(unmapped.core, { ...opts(empty()), storeId: OTHER }), /not mapped/)
  assert.equal(unmapped.stats.writes, 0, 'an unmapped store gets no write')

  // (c) idempotency: the second run creates 0; links kept (never narrowed); a dry-run sends nothing.
  const f = fakeCore()
  const m = empty()
  assert.equal(await apply(f.core, { ...opts(m), dry: true }), 0)
  assert.equal(f.stats.writes, 0, 'dry-run writes nothing')
  assert.equal(await apply(f.core, opts(m)), 0)
  const first = f.stats.writes
  assert.ok(first > 400, `first run fills (${first} writes)`)
  // The binned BC-0003 gets nothing new: its 回数券 and bookings are skipped with a line each, never made on the binned id.
  const binnedOnly = <T extends { member: string }>(xs: T[]) => xs.filter((x) => x.member === 'BC-0003')
  const binLines = [
    ...binnedOnly(p1.packs).map((k) => `packs ${k.key}: customer BC-0003 is in the bin`),
    ...binnedOnly(p1.appointments).map((a) => `appointments ${a.key}: customer BC-0003 is in the bin`),
  ].sort()
  assert.ok(binnedOnly(p1.packs).length === 1 && binnedOnly(p1.appointments).length > 0, 'the recipe gives BC-0003 a 回数券 and bookings')
  assert.deepEqual([...m.runs[0].skipped].sort(), binLines, 'skipped = exactly the binned customer\'s 回数券 and bookings')
  assert.ok(m.runs[0].skipped.every((l) => l.endsWith('is in the bin')))
  assert.ok(!f.t.packs.some((x) => x.customer_id === 'binned') && !f.t.appts.some((x) => x.customer_id === 'binned'), 'nothing is made on a binned customer')
  assert.equal(f.t.appts.length, p1.appointments.length - binnedOnly(p1.appointments).length, 'every planned booking but the binned customer\'s landed (core-like 409s: none)')
  assert.equal(f.t.karutes.length, p1.karutes.length - binnedOnly(p1.karutes).length)
  // Idempotency keys: one per booking / burn, built from its own fill tag (a constant key would make core drop all but one).
  const tagOf = (r: Row) => /\[(tw:[^\]]+)\]/.exec(r.notes as string)![1]
  const apptKeys = f.t.appts.map((a) => a.idempotencyKey)
  assert.deepEqual(apptKeys, f.t.appts.map((a) => `test-world:${tagOf(a)}`), 'booking key = test-world:<its tag>')
  assert.equal(new Set(apptKeys).size, apptKeys.length, 'booking keys are distinct')
  const apptById = new Map(f.t.appts.map((a) => [a.id, a]))
  const burnKeys = f.t.burns.map((b) => b.idempotencyKey)
  assert.ok(burnKeys.length > 0, 'the run burnt 回数券')
  assert.deepEqual(burnKeys, f.t.burns.map((b) => `test-world:${tagOf(apptById.get(b.appointment_id as string)!)}:redeem`), 'burn key = test-world:<its booking tag>:redeem')
  assert.equal(new Set(burnKeys).size, burnKeys.length, 'burn keys are distinct')
  assert.deepEqual(f.t.links.get('st-3'), [OTHER, STORE], 'an existing link set is kept as is')
  assert.deepEqual(f.t.links.get('st-4'), [OTHER, STORE], 'this store is ADDED to a staff member working elsewhere')
  assert.equal(f.t.links.get('st-0'), undefined, 'a practitioner of every store is never narrowed to one')
  assert.equal(m.stores[STORE].epoch, TODAY)
  assert.deepEqual(f.t.customers.filter((c) => c.member_number === 'BC-0003').map((c) => c.id), ['binned'], 'a binned customer is never re-created')
  assert.equal(m.runs[0].created.customers, 29)
  assert.equal(await apply(f.core, opts(m)), 0)
  assert.equal(f.stats.writes, first, 'second run: 0 writes')
  assert.equal(m.runs.length, 2)
  assert.ok(Object.values(m.runs[1].created).every((x) => x === 0), JSON.stringify(m.runs[1].created))
  assert.deepEqual([...m.runs[1].skipped].sort(), binLines, 'a re-run finds its own rows by key (never mistakes them for foreign bookings)')
  // A week later: only the new days, no booking twice.
  assert.equal(await apply(f.core, opts(m, addDays(TODAY, 7))), 0)
  assert.equal(new Set(f.t.appts.map((a) => `${a.customer_id}|${a.starts_at}`)).size, f.t.appts.length, 'no duplicate booking after the top-up')
  assert.equal(f.t.appts.length, p2.appointments.length - binnedOnly(p2.appointments).length)

  // A default policy may echo platform hours: the snapshot is still the recipe's hours, the ones the loader sets.
  const nine = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '09:00', close: '18:00' }]))
  const dh = fakeCore({ defaultHours: nine })
  const mdh = empty()
  const dhCode = await apply(dh.core, opts(mdh))
  assert.deepEqual(mdh.stores[STORE].weeklyHours, recipe.policy.weekly_hours, 'hours snapshot = the recipe hours the loader set, not the default policy echo')
  assert.deepEqual(dh.stats.policy?.weekly_hours, recipe.policy.weekly_hours, 'the loader set the recipe hours')
  assert.equal(dhCode, 0)

  // A foreign booking (no fill tag) on the first planned slot's practitioner: SCHEDULED / IN_PROGRESS hold the slot
  // (skipped up front, no 409); CANCELLED / NO_SHOW free it (the visit is made) — the app's isTerminalStatus rule.
  const a0 = p1.appointments[0]
  assert.notEqual(a0.member, 'BC-0003')
  for (const [status, clashes] of [['SCHEDULED', true], ['IN_PROGRESS', true], ['CANCELLED', false], ['NO_SHOW', false]] as const) {
    const fo = fakeCore()
    const staffCard = fo.t.staff.find((x) => x.name === a0.staff)!.id
    fo.t.appts.push({ id: 'foreign-appt', store_id: STORE, customer_id: 'foreign', staff_id: staffCard, resource_id: null, starts_at: a0.startsAt, ends_at: a0.endsAt, occupied_until: null, notes: null, status })
    const mfo = empty()
    assert.equal(await apply(fo.core, opts(mfo)), 0)
    assert.deepEqual(mfo.runs[0].skipped.filter((l) => /overlaps existing booking/.test(l)), clashes ? [`appointments ${a0.key}: overlaps existing booking foreign-appt`] : [], `a foreign ${status} booking`)
    assert.deepEqual(mfo.runs[0].conflicts409, [])
    assert.equal(fo.t.appts.length, p1.appointments.length - binnedOnly(p1.appointments).length + (clashes ? 0 : 1), `${status}: the foreign booking + every planned one but the binned customer's (and the clashing one)`)
  }

  // A 回数券 sold by hand (round 1, no loader note) is never adopted: the loader makes its own and burns only that.
  const k0 = p1.packs.find((k) => k.member !== 'BC-0003' && k.redeem.length > 0)!
  const fp = fakeCore()
  fp.t.customers.push({ id: 'pre', name: 'x', member_number: k0.member })
  fp.t.packs.push({ id: 'foreign-pack', customer_id: 'pre', kind: 'pack', purchase_round: 1, notes: null })
  assert.equal(await apply(fp.core, opts(empty())), 0)
  const ownPacks = fp.t.packs.filter((x) => x.customer_id === 'pre' && x.id !== 'foreign-pack')
  assert.deepEqual(ownPacks.map((x) => x.notes), [`テストデータ [${k0.key}]`], 'the loader made its own pack beside the hand-sold one')
  assert.equal(fp.t.burns.filter((b) => b.pack_id === 'foreign-pack').length, 0, 'the hand-sold pack gets no redemption')
  assert.equal(fp.t.burns.filter((b) => b.pack_id === ownPacks[0].id).length, k0.redeem.length, 'every planned burn lands on the loader\'s own pack')

  // An untagged COMPLETED booking of a recipe customer at a planned start (other card, other bed) is never adopted:
  // it gets no karute and no burn; the loader makes its own tagged booking beside it.
  const kb = p1.karutes.find((kr) => kr.member !== 'BC-0003' && p1.packs.some((k) => k.redeem.includes(kr.key)))!
  const ab = p1.appointments.find((a) => a.key === kb.key)!
  const fd = fakeCore()
  fd.t.customers.push({ id: 'pre2', name: 'x', member_number: ab.member })
  fd.t.appts.push({ id: 'foreign-done', store_id: STORE, customer_id: 'pre2', staff_id: 'dev', resource_id: 'foreign-bed', starts_at: ab.startsAt, ends_at: ab.endsAt, occupied_until: null, notes: null, status: 'COMPLETED' })
  assert.equal(await apply(fd.core, opts(empty())), 0)
  assert.equal(fd.t.karutes.filter((k) => k.appointment_id === 'foreign-done').length, 0, 'no karute on a foreign booking')
  assert.equal(fd.t.burns.filter((b) => b.appointment_id === 'foreign-done').length, 0, 'no burn on a foreign booking')
  const own = fd.t.appts.filter((x) => x.notes === `テストデータ [${ab.key}]`)
  assert.equal(own.length, 1, 'the loader made its own tagged booking')
  assert.equal(fd.t.karutes.filter((k) => k.appointment_id === own[0].id).length, 1, 'the karute sits on the loader\'s own booking')

  // Ours = the id this loader recorded, else the notes/tag: a staff edit of the notes never makes a second row.
  // (a) Core refuses every burn once (400); staff then change the pack's note → the re-run finds the pack by its
  // recorded id, makes no second one, and the burns land on it.
  const fn = fakeCore()
  const mn = empty()
  const addRedemption = fn.core.packs.addRedemption
  Object.assign(fn.core.packs, { addRedemption: async () => Promise.reject(Object.assign(new Error('refused'), { status: 400 })) })
  assert.equal(await apply(fn.core, opts(mn)), 1)
  Object.assign(fn.core.packs, { addRedemption })
  const pk = fn.t.packs.find((x) => x.id === mn.stores[STORE].created.packs![k0.key])!
  pk.notes = 'メモ'
  assert.equal(await apply(fn.core, opts(mn)), 0)
  assert.equal(mn.runs[1].created.packs ?? 0, 0, 'an edited pack note: the re-run makes no second pack')
  assert.deepEqual(fn.t.packs.filter((x) => x.customer_id === pk.customer_id).map((x) => x.id), [pk.id], 'one pack on the customer')
  assert.equal(fn.t.burns.filter((b) => b.pack_id === pk.id).length, k0.redeem.length, 'every burn lands on the recorded pack')
  // (b) Staff clear a loader booking's note (its tag is gone) → the re-run finds it by its recorded id: no second
  // booking, no clash skip, its karute and burn stay on it.
  const fb = fakeCore()
  const mb = empty()
  assert.equal(await apply(fb.core, opts(mb)), 0)
  const bk = fb.t.appts.find((x) => x.id === mb.stores[STORE].created.appointments![ab.key])!
  bk.notes = null
  assert.equal(await apply(fb.core, opts(mb)), 0)
  assert.equal(mb.runs[1].created.appointments ?? 0, 0, 'an untagged booking: the re-run makes no second booking')
  assert.deepEqual([...mb.runs[1].skipped].sort(), binLines, 'a booking whose tag was edited away is still ours (no clash skip)')
  assert.equal(fb.t.appts.length, p1.appointments.length - binnedOnly(p1.appointments).length)
  assert.equal(fb.t.karutes.filter((k) => k.appointment_id === bk.id).length, 1, 'its karute stays on it')
  assert.equal(fb.t.burns.filter((b) => b.appointment_id === bk.id).length, 1, 'its burn stays on it')
  // (c) A recorded id that no longer exists: the notes/tag match still finds the row (0 writes); with no row either,
  // the row is made once — never a throw.
  const fc = fakeCore()
  const mc = empty()
  assert.equal(await apply(fc.core, opts(mc)), 0)
  mc.stores[STORE].created.packs![k0.key] = 'gone-pack'
  mc.stores[STORE].created.appointments![ab.key] = 'gone-appt'
  const fcWrites = fc.stats.writes
  assert.equal(await apply(fc.core, opts(mc)), 0)
  assert.equal(fc.stats.writes, fcWrites, 'a gone recorded id falls through to the notes/tag match: 0 writes')
  const fz = fakeCore()
  const mz = empty()
  mz.stores[STORE] = { type: recipe.id, epoch: TODAY, weeklyHours: recipe.policy.weekly_hours, created: { packs: { [k0.key]: 'gone-pack' }, appointments: { [ab.key]: 'gone-appt' } } }
  assert.equal(await apply(fz.core, opts(mz)), 0)
  assert.equal(fz.t.packs.filter((x) => x.notes === `テストデータ [${k0.key}]`).length, 1, 'no row at all: the pack is made once')
  assert.equal(fz.t.appts.filter((x) => x.notes === `テストデータ [${ab.key}]`).length, 1, 'no row at all: the booking is made once')

  // Manifest lost, core rows survive: a fresh manifest finds every loader row by its notes/tag — 0 new rows, no clash
  // skip, 0 409s — including a pack whose note is the old bare 「テストデータ」 (the shape of the 12 live packs) —
  // and records their ids again, so the id-first rule holds from the next run on.
  const fl = fakeCore()
  const mA = empty()
  assert.equal(await apply(fl.core, opts(mA)), 0)
  fl.t.packs.find((x) => x.id === mA.stores[STORE].created.packs![k0.key])!.notes = 'テストデータ'
  const [packsA, apptsA] = [fl.t.packs.length, fl.t.appts.length]
  const mB = empty()
  assert.equal(await apply(fl.core, opts(mB)), 0)
  assert.equal(mB.runs[0].created.packs, undefined, 'lost manifest: no new pack (the bare-note one included)')
  assert.equal(mB.runs[0].created.appointments, undefined, 'lost manifest: no new booking')
  assert.deepEqual([fl.t.packs.length, fl.t.appts.length], [packsA, apptsA], 'lost manifest: 0 new rows')
  assert.deepEqual(mB.runs[0].conflicts409, [])
  assert.deepEqual([...mB.runs[0].skipped].sort(), binLines, 'lost manifest: every booking found by its tag (no clash skip)')
  assert.deepEqual(mB.stores[STORE].created.appointments, mA.stores[STORE].created.appointments, 'the recovery re-learns the booking ids')
  assert.deepEqual(mB.stores[STORE].created.packs, mA.stores[STORE].created.packs, 'the recovery re-learns the pack ids')

  // A loader booking staff reassigned to another customer (its tag cleared too) is no longer ours: the re-run skips it
  // with one line — no new booking, no karute or burn written against it, every other key unchanged.
  const fg = fakeCore()
  const mg = empty()
  assert.equal(await apply(fg.core, opts(mg)), 0)
  const rb = fg.t.appts.find((x) => x.id === mg.stores[STORE].created.appointments![ab.key])!
  Object.assign(rb, { customer_id: 'someone-else', notes: null })
  const onRb = () => [fg.t.karutes.filter((k) => k.appointment_id === rb.id).length, fg.t.burns.filter((b) => b.appointment_id === rb.id).length]
  const [rbBefore, gWrites, gAppts, gIds] = [onRb(), fg.stats.writes, fg.t.appts.length, { ...mg.stores[STORE].created.appointments }]
  assert.deepEqual(rbBefore, [1, 1], 'run A put one karute and one burn on the booking')
  assert.equal(await apply(fg.core, opts(mg)), 0)
  assert.deepEqual([...mg.runs[1].skipped].sort(), [...binLines, `appointments ${ab.key}: booking ${rb.id}'s customer differs from the planned customer, left alone`].sort(), 'a reassigned booking is skipped with one line')
  assert.equal(fg.t.appts.length, gAppts, 'reassigned: no new booking')
  assert.deepEqual(onRb(), rbBefore, 'reassigned: no karute or burn beyond run A\'s')
  assert.equal(fg.stats.writes, gWrites, 'reassigned: 0 new rows overall')
  assert.deepEqual(mg.stores[STORE].created.appointments, gIds, 'the manifest is left as it is')

  // A 409 is recorded, never retried, and exits 4; 5xx is retried, 409 is not.
  const c409 = fakeCore({ fail409: true })
  const m409 = empty()
  assert.equal(await apply(c409.core, opts(m409)), 4)
  assert.ok(m409.runs[0].conflicts409.length > 0 && m409.runs[0].conflicts409[0].startsWith('appointments '))
  let calls = 0
  await assert.rejects(withRetry(async () => { calls++; throw conflict('x') }, 'keyed', async () => {}))
  assert.equal(calls, 1, '409 never retried')
  calls = 0
  assert.equal(await withRetry(async () => { if (++calls < 3) throw Object.assign(new Error('busy'), { status: 503 }); return 'ok' }, 'keyed', async () => {}), 'ok')
  assert.equal(calls, 3, '5xx retried')

  // One 503 on the first customer create and on the first booking create: the keyed booking is resent (1 row), the
  // unkeyed customer is not (0 rows, 1 error line, exit 1) — and the next run heals it by member number.
  const f5 = fakeCore()
  const busy = Object.assign(new Error('busy'), { status: 503 })
  const failed = new Map<unknown, Record<string, unknown>>() // api → the input its one 503 answered
  for (const api of [f5.core.customers, f5.core.appointments] as unknown as Record<string, unknown>[]) {
    const real = api.create as (i: Record<string, unknown>, ...a: unknown[]) => Promise<unknown>
    api.create = async (i: Record<string, unknown>, ...a: unknown[]) => (failed.has(api) ? real(i, ...a) : (failed.set(api, i), Promise.reject(busy)))
  }
  const m5 = empty()
  assert.equal(await apply(f5.core, opts(m5)), 1)
  const lost = failed.get(f5.core.customers)!.member_number
  assert.deepEqual(m5.runs[0].errors, [`customers ${lost}: busy`], 'one error line: the unkeyed create')
  assert.equal(f5.t.customers.filter((c) => c.member_number === lost).length, 0, 'an unkeyed create is never resent after a 5xx')
  assert.equal(f5.t.appts.filter((a) => a.notes === failed.get(f5.core.appointments)!.notes).length, 1, 'a keyed create is resent after a 5xx: 1 row')
  assert.equal(await apply(f5.core, opts(m5)), 0)
  assert.equal(f5.t.customers.filter((c) => c.member_number === lost).length, 1, 'the re-run makes the lost customer once')

  // The read-back failing (core down after the writes) never changes the exit code.
  const fr = fakeCore()
  Object.assign(fr.core.staffStores, { counts: async () => Promise.reject(busy) }) // counts() is read by the read-back only
  const lines: string[] = []
  assert.equal(await apply(fr.core, { ...opts(empty()), readBack: true, log: (l: string) => void lines.push(l) }), 0, 'a failed read-back keeps exit 0')
  assert.ok(lines.includes('read-back failed (writes unaffected): busy'), lines.join('\n'))

  // A first run that throws before any write leaves no epoch behind; once a write was sent, the epoch stays.
  const badRead = Object.assign(new Error('bad request'), { status: 400 })
  const fs0 = fakeCore()
  Object.assign(fs0.core.stores, { list: async () => Promise.reject(badRead) })
  const ms0 = empty()
  await assert.rejects(apply(fs0.core, opts(ms0)), /bad request/)
  assert.equal(ms0.stores[STORE], undefined, 'stores.list failed: no epoch')
  for (const [policy, sentWrites] of [['custom', 0], ['default', 1]] as const) {
    const fe = fakeCore() // a custom policy needs no write; a default one gets storePolicies.set first
    if (policy === 'custom') fe.stats.policy = { source: 'custom', weekly_hours: recipe.policy.weekly_hours }
    Object.assign(fe.core.staffStores, { get: async () => Promise.reject(badRead) }) // the first read after the entry is made
    const me = empty()
    await assert.rejects(apply(fe.core, opts(me)), /bad request/)
    assert.equal(fe.stats.writes, sentWrites)
    assert.equal(me.stores[STORE]?.epoch, sentWrites ? TODAY : undefined, `${policy} policy, ${sentWrites} write(s) before the throw`)
  }

  // (a) + (c) for EVERY registry type with a recipe. A type whose store is not created yet plays a test-only store id,
  // mapped here and removed again. Per type: the recipe's own references hold; no staff name or member-number series
  // is shared with another recipe (fill.ts matches staff by NAME business-wide); the plan is deterministic, only adds
  // days, stays inside the hours and double-books no one; and on a fake core a dry-run writes nothing, the first run
  // lands every planned row, the second writes 0, a week later only adds.
  // The planner's preferred start per day-part comes from the day's own hours (gym 07:00–22:00, テスト東京店 10:00–19:00).
  const prefer = (open: string, close: string) => (['am', 'pm', 'eve'] as const).map((part) => preferredStart({ open, close }, part, 60, 30))
  assert.deepEqual(prefer('07:00', '22:00'), [420, 870, 1230], 'preferredStart: 07:00–22:00 → am 07:00 · pm 14:30 · eve 20:30')
  assert.deepEqual(prefer('10:00', '19:00'), [600, 870, 1050], 'preferredStart: 10:00–19:00 → am 10:00 · pm 14:30 · eve 17:30')
  assert.deepEqual(prefer('09:05', '19:25'), [545, 855, 1075], 'preferredStart: 09:05–19:25 (mid 14:15, off the grid) → am 09:05 · pm 14:15 (the true midpoint) · eve 17:55')
  const types = Object.keys(registry.types).filter((t) => registry.types[t].recipe)
  assert.ok(types.length >= 3, 'every registry type with a recipe runs')
  const storeOf = new Map(types.map((t) => [t, Object.keys(registry.stores).find((id) => registry.stores[id] === t) ?? `store-${t}`]))
  const mapped = [...storeOf].filter(([t, id]) => registry.stores[id] !== t).map(([t, id]) => ((registry.stores[id] = t), id))
  const owner = new Map<string, string>()
  const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
  const startMinute = (a: Plan['appointments'][number]) => (Date.parse(a.startsAt) - Date.parse(jstIso(a.date, 0))) / 60_000
  try {
    for (const type of types) {
      const r = await loadRecipe(type)
      const storeId = storeOf.get(type)!
      const ctxT = { storeId, weeklyHours: r.policy.weekly_hours }
      const [staffNames, menuNames] = [new Set(r.staff.map((s) => s.name)), new Set(r.menus.map((x) => x.name))]
      assert.equal(new Set(r.customers.map((c) => c.member)).size, r.customers.length, `${type}: member numbers are unique inside the recipe`)
      assert.ok(menuNames.has(r.firstMenu), `${type}: firstMenu is a menu`)
      for (const c of r.customers) assert.ok(staffNames.has(c.staff) && menuNames.has(c.menu) && menuNames.has(c.alt), `${type} ${c.member}: 担当 and menus are in the recipe`)
      for (const k of r.packs) assert.ok(r.customers.some((c) => c.member === k.member), `${type}: pack holder ${k.member} is a customer`)
      for (const key of [...staffNames, ...new Set(r.customers.map((c) => `member series ${c.member.slice(0, 3)}`))]) {
        assert.ok(!owner.has(key), `${type}: ${key} is also used by ${owner.get(key)}`)
        owner.set(key, type)
      }

      const q1 = plan(r, ctxT, TODAY, TODAY)
      assert.deepEqual(plan(r, ctxT, TODAY, TODAY), q1, `${type}: same inputs → same plan`)
      // load-bearing: the r() draw order (weights before the role filter). A change here = the plan drifted from the live テスト東京店 — do not re-pin without checking the live rows.
      const perBed = q1.appointments.reduce<Record<string, number>>((n, a) => ((n[a.resource] = (n[a.resource] ?? 0) + 1), n), {})
      if (type === 'beauty_chiropractic') assert.deepEqual(perBed, { 'ベッド1': 74, 'ベッド2': 68, 'ベッド3': 79, '個室': 14 }, `${type}: q1 bookings per bed`)
      assert.equal(q1.packs.length, r.packs.length, `${type}: every 回数券 is bought in the window`)
      assert.ok(q1.appointments.length >= r.customers.length && q1.karutes.length > 0, `${type}: the plan fills the store`)
      for (const k of q1.karutes) assert.ok(k.entries.length >= 3 && k.entries.length <= 6, `${type} ${k.key}: 3–6 karute lines`)
      const q2 = plan(r, ctxT, addDays(TODAY, 7), TODAY)
      const [j1, j2] = [keys(q1), keys(q2)]
      assert.ok([...j1].every((k) => j2.has(k)) && j2.size > j1.size, `${type}: a week later, strictly a superset of keys`)
      const laterT = new Map(q2.appointments.map((a) => [a.key, a]))
      for (const a of q1.appointments.filter((x) => x.date < TODAY)) assert.deepEqual(laterT.get(a.key), a, `${type}: the past never shifts: ${a.key}`)
      const clean = Object.fromEntries(r.resources.map((x) => [x.name, x.cleanup_minutes * 60_000]))
      for (const q of [q1, q2]) {
        const byDate = new Map<string, Plan['appointments']>()
        for (const a of q.appointments) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a])
        for (const [date, as] of byDate) {
          const h = hoursOn(r.policy.weekly_hours, date)
          for (const a of as) {
            assert.ok(h && a.startsAt >= jstIso(date, at(h.open)) && a.endsAt <= jstIso(date, at(h.close)), `${type} ${a.key} inside the hours`)
            for (const b of as) {
              if (a === b) continue
              const [as0, ae, bs, be] = [Date.parse(a.startsAt), Date.parse(a.endsAt), Date.parse(b.startsAt), Date.parse(b.endsAt)]
              assert.ok(!(a.staff === b.staff && as0 < be && bs < ae), `${type}: ${a.staff} double-booked ${a.key} / ${b.key}`)
              assert.ok(!(a.resource === b.resource && as0 < be + clean[b.resource] && bs < ae + clean[a.resource]), `${type}: ${a.resource} double-booked ${a.key} / ${b.key}`)
            }
          }
        }
      }
      // Overflow (a visit away from the customer's own 担当) never lands on the 受付 (ASSISTANT); the role is checked here
      // directly. The gym has overflow, so the check is not vacuous.
      const cust = new Map(r.customers.map((c) => [c.member, c]))
      const overflow = (q: Plan) => q.appointments.filter((a) => a.staff !== cust.get(a.member)!.staff)
      for (const q of [q1, q2]) for (const a of overflow(q)) assert.equal(r.staff.find((s) => s.name === a.staff)!.role !== 'ASSISTANT', true, `${type} ${a.key}: an ASSISTANT holds an overflow booking`)
      if (type === 'personal_gym') assert.ok(overflow(q1).length > 0, `${type}: the plan has overflow bookings`)
      // Preferred starts follow the store's own hours: am visits early (one takes the first slot), eve visits late.
      const starts = (part: string) => q1.appointments.filter((a) => cust.get(a.member)!.time === part).map(startMinute)
      const median = (xs: number[]) => ((s) => (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2)([...xs].sort((a, b) => a - b))
      const [am, pm, eve] = [starts('am'), starts('pm'), starts('eve')]
      assert.ok(median(am) < median(pm) && median(pm) < median(eve), `${type}: median start am ${median(am)} < pm ${median(pm)} < eve ${median(eve)}`)
      const days = [...new Set(q1.appointments.map((a) => a.date))].map((d) => hoursOn(r.policy.weekly_hours, d)!)
      assert.equal(Math.min(...am), Math.min(...days.map((h) => at(h.open))), `${type}: an am visit takes the first slot of the earliest-opening day`)
      const longest = Math.max(...r.menus.map((x) => x.duration))
      assert.ok(Math.max(...eve) >= Math.max(...days.map((h) => at(h.close) - longest - 2 * DEFAULT_SLOT_MINUTES)), `${type}: an eve visit starts near closing`)
      // ...and per visit: every am visit starts before its own day's midpoint, every eve visit at or after it (pm sits on it).
      for (const q of [q1, q2]) for (const a of q.appointments) {
        const [part, h] = [cust.get(a.member)!.time, hoursOn(r.policy.weekly_hours, a.date)!]
        const [mid, start] = [(at(h.open) + at(h.close)) / 2, startMinute(a)]
        if (part !== 'pm') assert.ok(part === 'am' ? start < mid : start >= mid, `${type} ${a.key}: an ${part} visit in the wrong half of its own day (${start} vs mid ${mid})`)
      }

      const ft = fakeCore({ stores: [storeId] })
      const binned = new Set(ft.t.customers.filter((c) => c.deleted_at).map((c) => c.member_number as string))
      const live = <T extends { member: string }>(xs: T[]) => xs.filter((x) => !binned.has(x.member))
      const mt = empty()
      const ot = { recipe: r, storeId, manifest: mt, today: TODAY, dry: false, log: () => {}, wait: async () => {} }
      assert.equal(await apply(ft.core, { ...ot, dry: true }), 0)
      assert.equal(ft.stats.writes, 0, `${type}: dry-run writes nothing`)
      assert.equal(await apply(ft.core, ot), 0)
      assert.deepEqual([mt.runs[0].conflicts409, mt.runs[0].errors], [[], []], `${type}: no 409, no error`)
      assert.equal(ft.t.appts.length, live(q1.appointments).length, `${type}: every planned booking landed`)
      assert.equal(ft.t.karutes.length, live(q1.karutes).length, `${type}: every planned karute landed`)
      assert.equal(ft.t.packs.length, live(q1.packs).length, `${type}: every planned 回数券 landed`)
      assert.equal(ft.t.burns.length, live(q1.packs).reduce((n, k) => n + k.redeem.length, 0), `${type}: every planned burn landed`)
      // an empty link list = every store (core's rule); otherwise the list must hold this store
      const worksHere = (name: string) => ((l) => !l?.length || l.includes(storeId))(ft.t.links.get(ft.t.staff.find((x) => x.name === name)!.id))
      assert.ok(r.staff.every((s) => worksHere(s.name)), `${type}: every recipe staff card works at the store`)
      const firstT = ft.stats.writes
      assert.equal(await apply(ft.core, ot), 0)
      assert.equal(ft.stats.writes, firstT, `${type}: second run, 0 writes`)
      assert.equal(await apply(ft.core, { ...ot, today: addDays(TODAY, 7) }), 0)
      assert.equal(new Set(ft.t.appts.map((a) => `${a.customer_id}|${a.starts_at}`)).size, ft.t.appts.length, `${type}: no duplicate booking after the top-up`)
      assert.equal(ft.t.appts.length, live(q2.appointments).length, `${type}: the top-up adds exactly the new days`)
    }
  } finally {
    for (const id of mapped) delete registry.stores[id]
  }

  // (d) static: the loader has no delete call and never imports the deleting seeder's guard.
  for (const file of ['fill.ts', 'plan.ts', 'create-store.ts', 'probe-chair-overlap.ts', ...readdirSync(join(__dirname, 'recipes')).map((f) => `recipes/${f}`)]) {
    const src = readFileSync(join(__dirname, file), 'utf8')
    assert.doesNotMatch(src, /\.delete\(|remove\(|destroy\(|\.update\(|\.patch\(/, `${file}: no delete or update call`)
    assert.doesNotMatch(src, /(from\s+|require\(\s*|import\(\s*)['"][^'"]*core-target-guard/, `${file}: does not import core-target-guard`)
  }

  // Every registry store id is a whole core uuid (a truncated one passed every other check).
  for (const id of Object.keys(registry.stores)) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `registry store id ${id}: 8-4-4-4-12 lowercase hex`)

  // One recipe = one store: the guard itself, and apply calling it (a second store mapped to the type, removed again).
  assert.throws(() => assertOneStore({ a: 'x', b: 'x' }, 'x'), /must map exactly one store/)
  assert.doesNotThrow(() => assertOneStore({ a: 'x' }, 'x'))
  assert.throws(() => assertOneStore({}, 'x'), /must map exactly one store/)
  const twice = fakeCore()
  registry.stores['store-second-of-type'] = recipe.id
  try {
    await assert.rejects(apply(twice.core, opts(empty())), /must map exactly one store/)
  } finally {
    delete registry.stores['store-second-of-type']
  }
  assert.equal(twice.stats.writes, 0, 'a type mapped to two stores gets no write')

  console.log('✓ fill: all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
