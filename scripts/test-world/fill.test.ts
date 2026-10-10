// Runnable check (no framework, no network), same command as ci.yml:
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/fill.test.ts
// An in-memory core stands in for SynqedClient. Like core, it answers a double-booked practitioner or bed with a 409
// (a CANCELLED / NO_SHOW booking frees its slot: the app's isTerminalStatus).
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTerminalStatus } from '../../src/lib/appointments/status'
import { closeOut, movedLine, todayStatusFixes } from './close-out'
import { DEV_SALON_BUSINESS_ID } from './count-baseline'
import { readLiveCalendar, windowOf } from './live-calendar'
import { apply, DEFAULT_THROTTLE, jstToday, lastWindowEnd, NEW_START_FUTURE_DAYS, limiter, parseThrottle, poolOf, runCli, settleAll, SATURATED_LINE, Saturated, storeCtx, targetsFor, loadRecipe, registry, withRetry, type FillCore, type Manifest, type Throttle } from './fill'
import { addDays, applyLiveCalendar, bookingNotes, DEFAULT_SLOT_MINUTES, hoursOn, jstIso, mins, plan, preferredStart, type LiveCalendar, type Plan } from './plan'

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

function fakeCore(o: { business?: string; devEmail?: string; fail409?: boolean; defaultHours?: Record<string, unknown>; stores?: string[]; closed?: string[]; rawClosed?: unknown[]; special?: { date: string; open: string; close: string }[]; calendarFails?: boolean } = {}) {
  let n = 0
  const t = { staff: [] as Row[], links: new Map<string, string[]>(), resources: [] as Row[], menus: [] as Row[], customers: [] as Row[], packs: [] as Row[], burns: [] as Row[], appts: [] as Row[], karutes: [] as Row[] }
  const stats = { writes: 0, policy: null as null | Record<string, unknown>, updates: [] as { id: string; status: unknown }[] }
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
      counts: async () => ({ counts: {} }), // the read-back's one call (S95 T8 reads its karute row)
    },
    storePolicies: {
      get: async () => ({ special_open_days: o.special ?? [], updated_at: '2026-09-01T00:00:00Z', ...(stats.policy ?? { source: 'default', weekly_hours: o.defaultHours ?? null }) }),
      // like core: YYYY-MM-DD range, `to` exclusive
      listClosedDays: async (sid: string, q: { from?: string; to?: string } = {}) => {
        if (o.calendarFails) throw Object.assign(new Error('closed days unavailable'), { status: 400 })
        return { closed_days: o.rawClosed ?? (o.closed ?? []).filter((d) => (!q.from || d >= q.from) && (!q.to || d < q.to)).map((date, i) => ({ id: `cd-${i}`, store_id: sid, date, reason: '店内研修（テスト）', created_by: 'dev', created_at: '2026-09-28T00:00:00Z' })) }
      },
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
      list: async (q: Q) => paged('appointments', t.appts.filter((a) => (!q.store_id || a.store_id === q.store_id) && (!q.from || (a.starts_at as string) >= q.from) && (!q.to || (a.starts_at as string) < q.to)), q),
      create: async (i: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        if (o.fail409) throw conflict('RESOURCE_TAKEN')
        if (t.appts.some((a) => !isTerminalStatus(a.status as string) && overlaps(a, i) && (a.staff_id === i.staff_id || a.resource_id === i.resource_id))) throw conflict('double-booked')
        return add(t.appts, { ...i, occupied_until: null, idempotencyKey: opts?.idempotencyKey })
      },
      // like core: a status write stamps who set it (status_set_by) and its reason
      update: async (id: string, i: Record<string, unknown>) => {
        stats.writes++
        stats.updates.push({ id, status: i.status })
        const r = t.appts.find((a) => a.id === id)!
        return Object.assign(r, { status: i.status, status_reason: i.status_reason, status_set_by: i.acting_staff_id })
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
  for (const a of f.t.appts) {
    const planned = p1.appointments.find((p) => p.key === tagOf(a))!
    assert.equal(a.booked_price_amount, planned.booked_price, 'the create payload carries the menu price')
    assert.equal(a.booked_price_currency, 'JPY')
    assert.equal(a.status, planned.status, 'the create payload carries the planned status')
  }
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
  assert.equal(m.runs[0].created.customers, recipe.customers.length - 1)
  assert.equal(await apply(f.core, opts(m)), 0)
  assert.equal(f.stats.writes, first, 'second run: 0 writes')
  assert.equal(m.runs.length, 2)
  assert.ok(Object.values(m.runs[1].created).every((x) => x === 0), JSON.stringify(m.runs[1].created))
  assert.deepEqual([...m.runs[1].skipped].sort(), binLines, 'a re-run finds its own rows by key (never mistakes them for foreign bookings)')
  // A week later: only the new days, no booking twice.
  assert.equal(await apply(f.core, opts(m, addDays(TODAY, 7))), 0)
  assert.equal(new Set(f.t.appts.map((a) => `${a.customer_id}|${a.starts_at}`)).size, f.t.appts.length, 'no duplicate booking after the top-up')
  assert.equal(f.t.appts.length, p2.appointments.length - binnedOnly(p2.appointments).length)

  // ⚖ G3 (S87): a store's identities come from its fixed identityIndex, not its place in registry.json — reverse the
  // stores map and insert a new store first: every existing store's recipe (members, staff, phones) is byte-identical.
  {
    const ids = Object.keys(registry.stores)
    assert.deepEqual(ids.map((sid) => registry.stores[sid].identityIndex), ids.map((_, i) => i), 'today\'s identityIndex = today\'s position (nothing moves for the current registry)')
    const before = await Promise.all(ids.map(async (sid) => JSON.stringify(await loadRecipe(registry.stores[sid].type, sid))))
    const saved = registry.stores
    try {
      registry.stores = Object.fromEntries([['store-new-first', { type: 'hair_salon', keyPrefix: 'hair_salon@new', namePool: 3, identityIndex: ids.length }], ...ids.reverse().map((sid) => [sid, saved[sid]])])
      const after = await Promise.all(Object.keys(saved).map(async (sid) => JSON.stringify(await loadRecipe(saved[sid].type, sid))))
      assert.deepEqual(after, before, 'reordered + a store inserted first: every existing store\'s identities are byte-identical')
      registry.stores = { ...registry.stores, clash: { type: 'hair_salon', keyPrefix: 'hair_salon@clash', namePool: 4, identityIndex: 0 } }
      await assert.rejects(loadRecipe('hair_salon', 'clash'), /identityIndex must be a non-negative integer no other store carries, inside the staff-name pool/, 'a duplicate identityIndex is refused')
      // the staff-name pool holds 7 stores × 6 names: an index past it, or a negative one, is refused (never undefined names)
      for (const bad of [7, -1]) {
        registry.stores = { ...saved, outside: { type: 'hair_salon', keyPrefix: 'hair_salon@outside', namePool: 4, identityIndex: bad } }
        await assert.rejects(loadRecipe('hair_salon', 'outside'), /inside the staff-name pool/, `identityIndex ${bad} is refused`)
      }
    } finally { registry.stores = saved }
    console.log(`✓ G3: ${ids.length} stores' recipes byte-identical after reorder + insert-first`)
  }

  // ⚖ G1 (S87): a later apply reconciles TODAY's owned rows to the plan's status (the 13:24 pin → IN_PROGRESS) — exactly
  // the non-legacy, loader-set ones still SCHEDULED; a legacy row and a staff-edited row of the same day stay as they were.
  {
    const g = fakeCore()
    const gm = empty()
    assert.equal(await apply(g.core, opts(gm)), 0)
    const planOn = (d: string) => new Map(plan(recipe, { ...ctx, legacyThrough: gm.stores[STORE].legacyThrough }, d, TODAY).appointments.map((a) => [a.key, a]))
    // the first future day with a legacy row and a non-legacy session across the pin
    const day = [...Array(14).keys()].map((i) => addDays(TODAY, i + 1)).find((d) => {
      const k = planOn(d)
      const of = g.t.appts.map((r) => k.get(tagOf(r))).filter((a) => a?.date === d)
      return of.some((a) => recipe.legacyMembers!.includes(a!.member)) && of.some((a) => a!.status === 'IN_PROGRESS')
    })!
    assert.ok(day, 'a future day carries both a legacy row and a session across the pin')
    const byKey = planOn(day)
    const rowsOfDay = g.t.appts.filter((r) => byKey.get(tagOf(r))?.date === day)
    assert.ok(rowsOfDay.length > 0 && rowsOfDay.every((r) => r.status === 'SCHEDULED'), 'the first fill wrote that future day SCHEDULED')
    const legacyRow = rowsOfDay.find((r) => recipe.legacyMembers!.includes(byKey.get(tagOf(r))!.member))!
    const moving = rowsOfDay.filter((r) => !recipe.legacyMembers!.includes(byKey.get(tagOf(r))!.member) && byKey.get(tagOf(r))!.status !== 'SCHEDULED')
    assert.ok(legacyRow && moving.some((r) => byKey.get(tagOf(r))!.status === 'IN_PROGRESS') && moving.length >= 2, `that day has a legacy row and ${moving.length} non-legacy rows the plan moves`)
    const edited = moving.find((r) => byKey.get(tagOf(r))!.status !== 'IN_PROGRESS') ?? moving[moving.length - 1]
    Object.assign(edited, { status_set_by: 'st-1', status_reason: null }) // a staff member set it back to 予約済み
    const legacyBefore = { ...legacyRow }
    const editedBefore = { ...edited }
    assert.equal(await apply(g.core, opts(gm, day)), 0)
    const want = moving.filter((r) => r !== edited).map((r) => ({ id: r.id, status: byKey.get(tagOf(r))!.status })).sort((a, b) => a.id.localeCompare(b.id))
    assert.deepEqual([...g.stats.updates].sort((a, b) => a.id.localeCompare(b.id)), want, 'exactly the owned non-legacy loader-set SCHEDULED rows of today were updated, to the plan\'s status')
    assert.ok(want.some((w) => w.status === 'IN_PROGRESS'), 'the session across the pin is IN_PROGRESS')
    assert.deepEqual(legacyRow, legacyBefore, 'a legacy row stays as it was')
    assert.deepEqual(edited, editedBefore, 'a staff-edited row stays as it was')
    assert.equal(gm.runs[1].created.todayStatus, want.length)
    assert.equal(await apply(g.core, opts(gm, day)), 0)
    assert.equal(g.stats.updates.length, want.length, 'a third run the same day: no further status write')
    // the picker itself, row by row: a pin session planned IN_PROGRESS today, still SCHEDULED, no person set it → picked;
    // the same row moved by staff to another day → never picked (the row's own start, not just the plan's date);
    // the same row for a legacy member → never picked (the legacy guard, pinned directly)
    {
      const pin = moving.find((r) => byKey.get(tagOf(r))!.status === 'IN_PROGRESS')!
      const pinP = byKey.get(tagOf(pin))!
      const fresh = { id: pin.id as string, staff_id: pin.staff_id as string, starts_at: pin.starts_at as string, ends_at: pin.ends_at as string, status: 'SCHEDULED' as const, status_set_by: null, status_reason: null }
      assert.equal(todayStatusFixes([{ row: fresh, planned: pinP }], recipe, day).length, 1, 'the untouched pin session is picked')
      const moved = { ...fresh, starts_at: new Date(Date.parse(fresh.starts_at) + 86_400_000).toISOString() }
      assert.deepEqual(todayStatusFixes([{ row: moved, planned: pinP }], recipe, day), [], 'a booking staff moved to another day is never picked')
      assert.deepEqual(todayStatusFixes([{ row: fresh, planned: { ...pinP, member: recipe.legacyMembers![0] } }], recipe, day), [], 'a legacy member\'s booking is never picked')
      // ⚖ G-P1 (S88): the row must still BE the planned booking (stillPlanned) — a same-day move, a re-staff or a new
      // duration is a person's edit: never picked, one skipped line each; the untouched row with its staff id still is
      const shift = (ms: number) => (t: string) => new Date(Date.parse(t) + ms).toISOString()
      const later = { ...fresh, starts_at: shift(3 * 3_600_000)(fresh.starts_at), ends_at: shift(3 * 3_600_000)(fresh.ends_at) }
      assert.equal(jstToday(new Date(later.starts_at)), day, 'the fixture: the moved row is still today')
      const restaffed = { ...fresh, staff_id: 'another-staff' }
      const longer = { ...fresh, ends_at: shift(30 * 60_000)(fresh.ends_at) }
      const moveLines: string[] = []
      assert.deepEqual(todayStatusFixes([later, restaffed, longer].map((row) => ({ row, planned: pinP, staffId: fresh.staff_id })), recipe, day, moveLines), [], '(a)(b) a row moved later today, re-staffed or re-timed is never picked')
      assert.deepEqual(moveLines, [later, restaffed, longer].map((r) => `appointments ${pinP.key}: booking ${r.id}'s time or duration differs from the plan (or its staff, where the planned staff is known) — a person moved it, left alone`), '(a)(b) one skipped line per moved row')
      const keep: string[] = []
      assert.deepEqual(todayStatusFixes([{ row: fresh, planned: pinP, staffId: fresh.staff_id }], recipe, day, keep).map((x) => x.row), [fresh], '(c) the unchanged row, its staff id known, is still picked')
      assert.deepEqual(keep, [], '(c) no skipped line for the unchanged row')
    }
    console.log(`✓ G1: today's reconcile updated ${want.length} rows (${want.filter((w) => w.status === 'IN_PROGRESS').length} IN_PROGRESS); legacy + staff-edited untouched`)
  }

  // ⚖ G-P1 (S88) wiring pin: apply itself passes the planned staff id and run.skipped to the reconcile — an owned row the
  // plan moves today, then moved +3h (still today) or re-staffed on core, is not updated and gets exactly one movedLine.
  for (const variant of ['moved', 'restaffed'] as const) {
    const g = fakeCore()
    const gm = empty()
    assert.equal(await apply(g.core, opts(gm)), 0)
    const byKey0 = (d: string) => new Map(plan(recipe, { ...ctx, legacyThrough: gm.stores[STORE].legacyThrough }, d, TODAY).appointments.map((a) => [a.key, a]))
    const day = [...Array(14).keys()].map((i) => addDays(TODAY, i + 1)).find((d) => {
      const k = byKey0(d)
      return g.t.appts.some((r) => { const a = k.get(tagOf(r)); return a?.date === d && a.status !== 'SCHEDULED' && !recipe.legacyMembers!.includes(a.member) && r.status === 'SCHEDULED' && jstToday(new Date(Date.parse(r.starts_at as string) + 3 * 3_600_000)) === d })
    })!
    assert.ok(day, `${variant}: a future day has an owned row the plan moves off SCHEDULED, +3h still that day`)
    const byKey = byKey0(day)
    const target = g.t.appts.find((r) => { const a = byKey.get(tagOf(r)); return a?.date === day && a.status !== 'SCHEDULED' && !recipe.legacyMembers!.includes(a.member) && r.status === 'SCHEDULED' && jstToday(new Date(Date.parse(r.starts_at as string) + 3 * 3_600_000)) === day })!
    if (variant === 'moved') {
      const shift = (s: unknown) => new Date(Date.parse(s as string) + 3 * 3_600_000).toISOString()
      Object.assign(target, { starts_at: shift(target.starts_at), ends_at: shift(target.ends_at), ...(target.occupied_until ? { occupied_until: shift(target.occupied_until) } : {}) })
    } else {
      const other = g.t.staff.find((s) => s.id !== target.staff_id)!
      assert.ok(other, 'restaffed: a second real staff id exists')
      Object.assign(target, { staff_id: other.id })
    }
    assert.equal(await apply(g.core, opts(gm, day)), 0)
    assert.ok(g.stats.updates.length > 0, `${variant}: the reconcile ran (other rows of the day were updated)`)
    assert.ok(!g.stats.updates.some((u) => u.id === target.id), `${variant}: the moved row is not among the status updates`)
    const line = movedLine(tagOf(target), target.id as string)
    assert.equal(gm.runs[gm.runs.length - 1].skipped.filter((l) => l === line).length, 1, `${variant}: the run's skipped list carries the movedLine exactly once`)
    console.log(`✓ G-P1 wiring (${variant}): row ${tagOf(target)} left alone, one movedLine`)
  }

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

  // ⚖ F2 (S88): the clash window is business-wide — the same practitioner's live booking at ANOTHER store holds the slot
  // (skipped up front, never a double-booking or a 409); a CANCELLED one there frees it. The fake's list honours store_id like core.
  // The abroad row carries a0's own tag (another customer), and in the recorded variant the manifest even names its id:
  // ownership stays this store's rows only (fill.ts mine), so it is never adopted — no 「customer differs」 line for a0.
  for (const [status, clashes, recorded] of [['SCHEDULED', true, false], ['CANCELLED', false, false], ['SCHEDULED', true, true], ['CANCELLED', false, true]] as const) {
    const fx = fakeCore()
    const staffCard = fx.t.staff.find((x) => x.name === a0.staff)!.id
    fx.t.appts.push({ id: 'abroad-appt', store_id: OTHER, customer_id: 'foreign', staff_id: staffCard, resource_id: 'other-bed', starts_at: a0.startsAt, ends_at: a0.endsAt, occupied_until: null, notes: bookingNotes(a0), status })
    const mfx = empty()
    if (recorded) mfx.stores[STORE] = { type: recipe.id, epoch: TODAY, weeklyHours: recipe.policy.weekly_hours, created: { appointments: { [a0.key]: 'abroad-appt' } } }
    const code = await apply(fx.core, opts(mfx))
    assert.deepEqual(mfx.runs[0].skipped.filter((l) => l.includes('customer differs') && l.startsWith(`appointments ${a0.key}:`)), [], `${status} abroad${recorded ? ' (recorded id)' : ''}: the other store's tagged row is not adopted as a0`)
    assert.deepEqual([code, mfx.runs[0].skipped.filter((l) => /overlaps existing booking/.test(l)), mfx.runs[0].conflicts409], [0, clashes ? [`appointments ${a0.key}: overlaps existing booking abroad-appt`] : [], []], `another store's ${status} booking, same staff`)
    assert.equal(fx.t.appts.filter((x) => x.store_id === STORE).length, p1.appointments.length - binnedOnly(p1.appointments).length - (clashes ? 1 : 0), `${status} abroad: every planned booking but the binned customer's (and the clashing one), none at the other store`)
    assert.ok(!fx.t.appts.some((x) => x.store_id === STORE && x.staff_id === staffCard && x.starts_at === a0.startsAt) === clashes, `${status} abroad: the planned row is ${clashes ? 'not ' : ''}created`)
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
  const own = fd.t.appts.filter((x) => x.notes === bookingNotes(ab))
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
  // ⚖ Q7: the cap counts burns, not distinct dates — core already holding size burns on ONE date (a same-day double
  // burn) gets no further burn on the re-run (counting dates would allow size − 1 more).
  const fq = fakeCore()
  const mq = empty()
  const addQ = fq.core.packs.addRedemption
  Object.assign(fq.core.packs, { addRedemption: async () => Promise.reject(Object.assign(new Error('refused'), { status: 400 })) })
  assert.equal(await apply(fq.core, opts(mq)), 1)
  Object.assign(fq.core.packs, { addRedemption: addQ })
  const pq = fq.t.packs.find((x) => x.id === mq.stores[STORE].created.packs![k0.key])!
  for (let i = 0; i < k0.size; i++) fq.t.burns.push({ id: `double-${i}`, pack_id: pq.id, customer_id: pq.customer_id, redeemed_on: '2026-01-05', appointment_id: `hand-${i}` })
  assert.equal(await apply(fq.core, opts(mq)), 0)
  assert.equal(fq.t.burns.filter((b) => b.pack_id === pq.id).length, k0.size, 'a full pack burnt twice on one day gets no further burn')
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
  assert.equal(fz.t.appts.filter((x) => x.notes === bookingNotes(ab)).length, 1, 'no row at all: the booking is made once')

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
  const storeOf = new Map(types.map((t) => [t, targetsFor(undefined, t)[0]]))
  const mapped: string[] = []
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
      // Keep the original bed/part-of-day characterization intact on its original thirty-person recipe.
      // The expanded profile's keys are checked separately against the captured pre-change golden.
      const legacy = { ...r, customers: r.customers.slice(0, 30), profile: undefined, legacyMembers: undefined,
        counts: { ...r.counts, customers: 30, pastDays: r.legacyPastDays!, futureDays: 14, cancelShare: .08 } }
      const legacyPlans = [plan(legacy, ctxT, TODAY, TODAY), plan(legacy, ctxT, addDays(TODAY, 7), TODAY)]
      const perBed = legacyPlans[0].appointments.reduce<Record<string, number>>((n, a) => ((n[a.resource] = (n[a.resource] ?? 0) + 1), n), {})
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
      const starts = (part: string) => legacyPlans[0].appointments.filter((a) => cust.get(a.member)!.time === part).map(startMinute)
      const median = (xs: number[]) => ((s) => (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2)([...xs].sort((a, b) => a - b))
      const [am, pm, eve] = [starts('am'), starts('pm'), starts('eve')]
      assert.ok(median(am) < median(pm) && median(pm) < median(eve), `${type}: median start am ${median(am)} < pm ${median(pm)} < eve ${median(eve)}`)
      const days = [...new Set(q1.appointments.map((a) => a.date))].map((d) => hoursOn(r.policy.weekly_hours, d)!)
      assert.equal(Math.min(...am), Math.min(...days.map((h) => at(h.open))), `${type}: an am visit takes the first slot of the earliest-opening day`)
      const longest = Math.max(...r.menus.map((x) => x.duration))
      assert.ok(Math.max(...eve) >= Math.max(...days.map((h) => at(h.close) - longest - 2 * DEFAULT_SLOT_MINUTES)), `${type}: an eve visit starts near closing`)
      // ...and per visit: every am visit starts before its own day's midpoint, every eve visit at or after it (pm sits on it).
      for (const q of legacyPlans) for (const a of q.appointments) {
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

  // Per-store targeting replaces the removed one-store-per-type restriction. Same-type stores
  // are accepted, while unknown stores, type mismatches and foreign manifests still write nothing.
  const second = Object.keys(registry.stores).find((id) => registry.stores[id].type === recipe.id && id !== STORE)!
  const twice = fakeCore({ stores: [second] })
  const secondRecipe = await loadRecipe(recipe.id, second)
  assert.equal(await apply(twice.core, { ...opts(empty()), storeId: second, recipe: secondRecipe, dry: true }), 0)
  await assert.rejects(apply(twice.core, { ...opts(empty()), storeId: second }), /prepared for store/)
  await assert.rejects(apply(twice.core, { ...opts(empty()), storeId: 'unmapped' }), /not mapped|prepared for store/)
  await assert.rejects(apply(twice.core, { ...opts(empty()), recipe: await loadRecipe('hair_salon') }), /not mapped|prepared for store/)
  await assert.rejects(apply(twice.core, opts({ ...empty(), businessId: 'foreign' })), /not a Dev Salon manifest/)
  assert.equal(twice.stats.writes, 0, 'dry-run and rejected targets never write')

  // (e) S90 throttle: every core request passes ONE limiter; the first EMAXCONN stops every later request.
  {
  const full = Object.assign(new Error('connect EMAXCONN: max client connections reached'), { status: 500 })
  // Every method of a fake core, watched: requests in flight, start times on a fake clock, an optional failure.
  const watched = (fail?: (call: string) => boolean, err: Error = full, fo: Parameters<typeof fakeCore>[0] = {}, early?: (call: string) => Error | undefined) => {
    const f = fakeCore(fo)
    Object.assign(f.core.staffStores, { counts: async () => ({ counts: { [STORE]: f.t.links.size } }) })
    const s = { calls: 0, inFlight: 0, max: 0, starts: [] as number[], clock: 0, failedAt: 0, after: 0, names: [] as string[] }
    for (const [ns, obj] of Object.entries(f.core as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>))
      for (const [k, fn] of Object.entries(obj)) obj[k] = async (...args: unknown[]) => {
        s.calls++, s.inFlight++, s.starts.push(s.clock), s.names.push(`${ns}.${k}`), (s.after += +!!s.failedAt)
        s.max = Math.max(s.max, s.inFlight)
        try {
          const now = early?.(`${ns}.${k}`) // fails at once, before a sibling in flight answers
          if (now) throw now
          await new Promise((r) => setImmediate(r)) // a request takes time: overlap shows
          if (!s.failedAt && fail?.(`${ns}.${k}`)) throw ((s.failedAt = s.calls), err)
          return await fn(...args)
        } finally {
          s.inFlight--
        }
      }
    const lim = (t: Throttle) => limiter(t, async (ms) => void (s.clock += ms), () => s.clock)
    return { ...f, s, lim }
  }
  const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i])
  // defaults: 1 in flight, 150 ms between starts — from the CLI (no flags) and from apply (no limiter given)
  assert.deepEqual([parseThrottle([]), DEFAULT_THROTTLE], [{ concurrency: 1, pauseMs: 150 }, { concurrency: 1, pauseMs: 150 }])
  const d1 = watched()
  assert.equal(await apply(d1.core, { ...opts(empty()), limiter: d1.lim(parseThrottle([]) as Throttle) }), 0)
  assert.ok(d1.s.calls > 300 && d1.s.max === 1 && Math.min(...gaps(d1.s.starts)) >= 150, `default: ${d1.s.calls} calls, max in flight ${d1.s.max}, min gap ${Math.min(...gaps(d1.s.starts))}`)
  const d2 = watched()
  const pauses: number[] = []
  assert.equal(await apply(d2.core, { ...opts(empty()), wait: async (ms: number) => void pauses.push(ms) }), 0)
  assert.ok(d2.s.max === 1 && pauses.length > 0 && pauses.every((ms) => ms <= 150), `apply's own default: max in flight ${d2.s.max}, ${pauses.length} pauses`)
  console.log(`✓ S90 default: ${d1.s.calls} requests, max in flight ${d1.s.max}, min start gap ${Math.min(...gaps(d1.s.starts))} ms; apply default max ${d2.s.max}`)
  // --concurrency 2 → 2 in flight, never 3; 5 and 0 are refused before any core call
  const c2 = watched()
  assert.equal(await apply(c2.core, { ...opts(empty()), limiter: c2.lim(parseThrottle(['--concurrency', '2']) as Throttle) }), 0)
  assert.equal(c2.s.max, 2, `--concurrency 2: max in flight ${c2.s.max}`)
  for (const bad of ['5', '0', '-1', '1.5', 'x']) assert.equal(typeof parseThrottle(['--concurrency', bad]), 'string', `--concurrency ${bad} refused`)
  for (const t of [{ concurrency: 5, pauseMs: 150 }, { concurrency: 0, pauseMs: 150 }, { concurrency: 1, pauseMs: -1 }, { concurrency: 1, pauseMs: 60_001 }]) {
    const r = watched()
    assert.equal(await apply(r.core, { ...opts(empty()), limiter: r.lim(t) }), 2, JSON.stringify(t))
    assert.equal(r.s.calls, 0, `${JSON.stringify(t)}: zero core calls`)
  }
  // --pause-ms 0 needs --no-pause; --no-pause alone means 0
  assert.equal(typeof parseThrottle(['--pause-ms', '0']), 'string', '--pause-ms 0 alone refused')
  for (const bad of ['-5', '2.5', '', '60001', '3000000000']) assert.equal(typeof parseThrottle(['--pause-ms', bad]), 'string', `--pause-ms ${bad} refused`)
  assert.deepEqual([parseThrottle(['--pause-ms', '0', '--no-pause']), parseThrottle(['--no-pause']), parseThrottle(['--pause-ms', '400', '--concurrency', '4']), parseThrottle(['--pause-ms', '60000'])],
    [{ concurrency: 1, pauseMs: 0 }, { concurrency: 1, pauseMs: 0 }, { concurrency: 4, pauseMs: 400 }, { concurrency: 1, pauseMs: 60000 }])
  console.log(`✓ S90 flags: --concurrency 2 max ${c2.s.max}; 5 / 0 / --pause-ms 0 refused with 0 core calls`)
  // the read-back's per-customer reads: bounded by the setting, same table as the old Promise.all fan-out
  const rb = watched()
  assert.equal(await apply(rb.core, opts(empty())), 0)
  const [from, table] = [rb.s.calls, [] as string[]]
  assert.equal(await apply(rb.core, { ...opts(empty()), readBack: true, log: (l: string) => void table.push(l), limiter: rb.lim({ concurrency: 3, pauseMs: 150 }) }), 0)
  const perCustomer = rb.s.names.slice(from).filter((n) => n === 'packs.listPacks').length
  const ours = rb.t.customers.filter((c) => c.member_number).length // the bin counts too: the read-back lists include_deleted
  assert.ok(perCustomer >= 50 && rb.s.max === 3, `read-back: ${perCustomer} per-customer reads, max in flight ${rb.s.max}`)
  for (const [label, n] of [['packs of those customers', rb.t.packs.length], ['redemptions on those packs', rb.t.burns.length]] as const)
    assert.match(table.find((l) => l.startsWith(label))!, new RegExp(`\\| ${n}$`), `${label}: in core now = ${n}`)
  assert.ok(table.some((l) => l.startsWith('customers (recipe member numbers)') && l.endsWith(`| ${ours}`)), table.join('\n'))
  console.log(`✓ S90 read-back: ${perCustomer} per-customer reads, max in flight ${rb.s.max}, packs ${rb.t.packs.length}, burns ${rb.t.burns.length}`)
  // EMAXCONN in the writes: no request starts after it, exit 1, the plain line once
  const sw = watched((call) => call === 'appointments.create')
  const swLog: string[] = []
  assert.equal(await apply(sw.core, { ...opts(empty()), readBack: true, log: (l: string) => void swLog.push(l), limiter: sw.lim(DEFAULT_THROTTLE) }), 1)
  assert.ok(sw.s.failedAt > 0 && sw.s.calls === sw.s.failedAt, `writes: failed at request ${sw.s.failedAt}, ${sw.s.calls} started`)
  assert.equal(swLog.filter((l) => l === SATURATED_LINE).length, 1, swLog.join('\n'))
  const [created, stopLine] = [swLog.findIndex((l) => /^created: \{.*"customers":\d+.*· writes sent: \d+$/.test(l)), swLog.indexOf(SATURATED_LINE)]
  assert.ok(created >= 0 && created < stopLine && swLog.some((l) => l.startsWith('FAILED: stopped: ')), swLog.join('\n'))
  console.log(`✓ S90 EMAXCONN in writes: stopped at request ${sw.s.failedAt}, ${sw.s.calls - sw.s.failedAt} started after, exit 1`)
  // EMAXCONN in the read-back (counts() is read by the read-back only): the read-back stops, the exit code stays
  const sr = watched((call) => call === 'staffStores.counts')
  const srLog: string[] = []
  assert.equal(await apply(sr.core, { ...opts(empty()), readBack: true, log: (l: string) => void srLog.push(l), limiter: sr.lim(DEFAULT_THROTTLE) }), 0)
  assert.ok(sr.s.failedAt > 0 && sr.s.calls === sr.s.failedAt, `read-back: failed at request ${sr.s.failedAt}, ${sr.s.calls} started`)
  assert.deepEqual([srLog.filter((l) => l === SATURATED_LINE).length, srLog.some((l) => l.startsWith('section |'))], [1, false], srLog.join('\n'))
  console.log(`✓ S90 EMAXCONN in read-back: stopped at request ${sr.s.failedAt}, ${sr.s.calls - sr.s.failedAt} started after, exit 0 kept`)
  // the stop at 3 in flight, other workers waiting on the limiter: no request starts after the first EMAXCONN
  const s3 = watched((call) => call === 'appointments.create')
  assert.equal(await apply(s3.core, { ...opts(empty()), limiter: s3.lim({ concurrency: 3, pauseMs: 150 }) }), 1)
  assert.ok(s3.s.max === 3 && s3.s.failedAt > 0 && s3.s.after === 0, `3 in flight: max ${s3.s.max}, ${s3.s.after} started after the stop`)
  console.log(`✓ S90 stop at 3 in flight: failed at request ${s3.s.failedAt}, max in flight ${s3.s.max}, ${s3.s.after} started after the stop`)
  // the full-database text only in the error code, or only in the JSON body, stops the run too
  for (const err of [Object.assign(new Error('pool refused'), { status: 500, code: 'EMAXCONN' }), Object.assign(new Error('unavailable'), { status: 503, body: { error: { message: 'sorry, too many clients already' } } }),
    Object.assign(new Error('FATAL: max clients reached'), { status: 500 })]) {
    const sc = watched((call) => call === 'appointments.create', err)
    assert.equal(await apply(sc.core, { ...opts(empty()), limiter: sc.lim(DEFAULT_THROTTLE) }), 1, err.message)
    assert.ok(sc.s.failedAt > 0 && sc.s.calls === sc.s.failedAt, `${err.message}: ${sc.s.calls - sc.s.failedAt} started after`)
  }
  console.log('✓ S90 detection: EMAXCONN only in the code, "too many clients" only in the body, "max clients reached" only in the message: each stops the run')
  // lead note: a full database is never retried (one request, not a whole read-back); a plain 5xx re-run of the read-back still queues in the limiter
  let tries = 0
  await assert.rejects(withRetry(async () => { tries++; throw new Saturated('EMAXCONN') }, false, async () => {}), Saturated)
  assert.equal(tries, 1, 'withRetry never retries a full database')
  const r5 = watched((call) => call === 'staffStores.counts', Object.assign(new Error('busy'), { status: 500 }))
  const r5Log: string[] = []
  assert.equal(await apply(r5.core, { ...opts(empty()), readBack: true, log: (l: string) => void r5Log.push(l), limiter: r5.lim(DEFAULT_THROTTLE) }), 0)
  const rerun = r5.s.starts.slice(r5.s.failedAt - 2)
  assert.ok(r5Log.some((l) => l.startsWith('section |')) && r5.s.max === 1 && Math.min(...gaps(rerun)) >= 150, `5xx read-back re-run: max ${r5.s.max}, min gap ${Math.min(...gaps(rerun))}`)
  // the CLI itself (runCli): flags reach the limiter; a stop ends the store loop; the exit code
  const dir = mkdtempSync(join(tmpdir(), 'fill-cli-'))
  const allStores = Object.keys(registry.stores)
  const cli = async (args: string[], w: ReturnType<typeof watched>) => {
    const out: string[] = []
    const code = await runCli(['apply', '--manifest', join(dir, `${Math.random()}.json`), ...args], async () => w.core,
      { log: (...l: unknown[]) => void out.push(l.join(' ')), sleep: async (ms) => void (w.s.clock += ms), now: () => w.s.clock, today: TODAY })
    return { code, out, stores: w.s.names.filter((n) => n === 'orgSettings.get').length, stops: out.filter((l) => l === SATURATED_LINE).length, notStarted: out.find((l) => l.startsWith('not started')) }
  }
  for (const bad of [['--concurrency', '5'], ['--pause-ms', '60001'], ['--pause-ms', '0']]) {
    const w = watched()
    assert.deepEqual([(await cli(['--store', STORE, ...bad], w)).code, w.s.calls], [2, 0], `CLI ${bad.join(' ')}: exit 2, zero core calls`)
  }
  let k = 0
  const wc = watched(() => ++k >= 100)
  const rc = await cli(['--store', STORE, '--concurrency', '2'], wc)
  assert.ok(rc.out[0] === 'throttle: 2 in flight, 150 ms between requests' && wc.s.max === 2 && Math.min(...gaps(wc.s.starts)) >= 150 && rc.code === 1, `CLI --concurrency 2: max ${wc.s.max}, exit ${rc.code}`)
  const w1 = watched((call) => call === 'appointments.create', full, { stores: allStores })
  const r1 = await cli(['--store', 'all'], w1)
  assert.deepEqual([r1.code, r1.stores, r1.stops, w1.s.calls - w1.s.failedAt, r1.notStarted?.split(', ').length], [1, 1, 1, 0, allStores.length - 1], r1.out.filter((l) => !l.includes('|')).join('\n'))
  assert.equal(r1.notStarted, `not started (core's database is full): ${allStores.slice(1).join(', ')}`)
  let begun = 0
  const w4 = watched((call) => ((begun += +(call === 'orgSettings.get')), begun === 2 && call === 'resources.list'), full, { stores: allStores, fail409: true })
  const r4 = await cli(['--store', 'all'], w4)
  assert.deepEqual([r4.code, r4.stores, r4.stops], [1, 2, 1], 'an earlier store\'s 409s (4) and a later write-phase stop: exit 1')
  // a full database before store 2's run began (its first core call), after store 1's 409s: exit 1, stores 3… named
  let opened = 0
  const w6 = watched((call) => call === 'orgSettings.get' && ++opened === 2, full, { stores: allStores, fail409: true })
  const r6 = await cli(['--store', 'all'], w6)
  assert.deepEqual([r6.code, r6.stores, r6.stops, r6.notStarted], [1, 2, 1, `not started (core's database is full): ${allStores.slice(2).join(', ')}`], 'a pre-run stop after an earlier store\'s 409s: exit 1')
  const w5 = watched((call) => call === 'staffStores.counts', full, { stores: allStores })
  const r5c = await cli(['--store', 'all'], w5)
  assert.deepEqual([r5c.code, r5c.stores, r5c.stops, !!r5c.notStarted], [0, 1, 1, true], 'a read-back stop: later stores not started, exit unchanged')
  console.log(`✓ S90 CLI: refusals 0 calls; --concurrency 2 max ${wc.s.max}; write stop exit ${r1.code} after ${r1.stores} store (${allStores.length - 1} not started); 409 then stop exit ${r4.code}; read-back stop exit ${r5c.code}`)
  // the pool settles every worker before it throws: no request starts after it rejected; a full database wins
  const tick = () => new Promise((r) => setImmediate(r))
  let started = 0
  await assert.rejects(poolOf([1, 2, 3, 4, 5, 6], async (x: number) => { started++; await tick(); if (x === 1) throw new Error('boom'); await tick(); await tick() }, 3), /boom/)
  const atReject = started
  for (let i = 0; i < 5; i++) await tick()
  assert.deepEqual([started, atReject], [6, 6], `${started - atReject} requests started after the pool rejected`)
  await assert.rejects(poolOf([1, 2, 3], async (x: number) => { await tick(); if (x === 1) throw new Error('first'); await tick(); if (x === 2) throw new Saturated('full') }, 3), Saturated)
  console.log(`✓ S90 pool: ${started} of 6 started before the rejection, ${started - atReject} after; a full database is the error thrown; pre-run stop after 409s exit ${r6.code}`)
  // Greptile G1: the read-back's first batch settles together — a 4xx at once, a sibling's EMAXCONN later: this store's stop
  const bad = Object.assign(new Error('bad request'), { status: 400 })
  let pol = 0
  const g1 = watched((call) => call === 'storePolicies.get' && ++pol === 2, full, { stores: allStores }, (call) => (call === 'staffStores.counts' ? bad : undefined))
  const rg1 = await cli(['--store', 'all', '--concurrency', '2'], g1)
  assert.deepEqual([rg1.code, rg1.stores, rg1.stops, rg1.notStarted], [0, 1, 1, `not started (core's database is full): ${allStores.slice(1).join(', ')}`], rg1.out.filter((l) => !l.includes('|')).join('\n'))
  // …and at 1 in flight, a first-batch failure leaves nothing queued: no request starts after apply returned
  const g1b = watched(undefined, full, {}, (call) => (call === 'staffStores.counts' ? bad : undefined))
  const g1Log: string[] = []
  assert.equal(await apply(g1b.core, { ...opts(empty()), readBack: true, log: (l: string) => void g1Log.push(l), limiter: g1b.lim(DEFAULT_THROTTLE) }), 0)
  const atReturn = g1b.s.calls
  for (let i = 0; i < 20; i++) await tick()
  assert.ok(g1Log.includes('read-back failed (writes unaffected): bad request') && g1b.s.calls === atReturn, `${g1b.s.calls - atReturn} requests started after apply returned`)
  assert.deepEqual(await settleAll([Promise.resolve(1), Promise.resolve('a')]), [1, 'a'])
  console.log(`✓ S90 read-back first batch: a 4xx then a late EMAXCONN → this store's stop (exit ${rg1.code}, ${allStores.length - 1} not started); ${g1b.s.calls - atReturn} requests after apply returned`)
  // Greptile G2: at 3 in flight, "writes sent" in the stop summary = the write requests that really started
  const g2 = watched((call) => call === 'appointments.create')
  const g2Log: string[] = []
  assert.equal(await apply(g2.core, { ...opts(empty()), log: (l: string) => void g2Log.push(l), limiter: g2.lim({ concurrency: 3, pauseMs: 150 }) }), 1)
  const reported = Number(/writes sent: (\d+)$/.exec(g2Log.find((l) => l.startsWith('created: '))!)![1])
  const startedWrites = g2.s.names.filter((n) => /\.(create|set|createPack|addRedemption|update)$/.test(n)).length
  assert.equal(reported, startedWrites, `writes sent ${reported}, write requests started ${startedWrites}`)
  console.log(`✓ S90 writes sent after a stop at 3 in flight: ${reported} reported = ${startedWrites} started`)
  console.log(`✓ S90 withRetry: EMAXCONN tried ${tries}×; a 5xx read-back re-ran ${r5.s.calls - r5.s.failedAt} requests through the limiter (max in flight ${r5.s.max}, min gap ${Math.min(...gaps(rerun))} ms)`)
  }

  // S94 (Greptile P2): widening registry futureDays 14 → 30 only ADDS days — every booking the 14-day plan holds (the 新規
  // start span is frozen at 14, NEW_START_FUTURE_DAYS) is the same whole object in the 30-day plan, for every registry store,
  // with the manifest's shape (recorded pastDays, legacyThrough and realismFrom), same today and epoch
  {
    const [epoch, today, saved] = ['2026-09-24', '2026-10-10', registry.futureDays]
    const at = async (sid: string, futureDays: number) => {
      registry.futureDays = futureDays
      try {
        const r = await loadRecipe(registry.stores[sid].type, sid, registry.pastDays)
        return plan(r, storeCtx(sid, { weeklyHours: r.policy.weekly_hours, pastDays: registry.pastDays, legacyThrough: today, realismFrom: addDays(today, -1) }), today, epoch)
      } finally { registry.futureDays = saved }
    }
    const stable: string[] = []
    for (const sid of Object.keys(registry.stores)) {
      const [p14, p30] = [await at(sid, 14), await at(sid, 30)]
      const end = addDays(today, 14)
      assert.ok(p14.window.to === end && p30.window.to === addDays(today, 30) && p14.appointments.every((a) => a.date <= end), `${sid}: the 14-day plan ends at today + 14`)
      assert.ok(p14.customers.some((c) => c.isNew) && p14.appointments.length > 0, `${sid}: the store has 新規 customers and bookings`)
      assert.deepEqual(p30.appointments.filter((a) => a.date <= end), p14.appointments, `${sid}: every booking inside today + 14 is identical (whole object) at futureDays 30`)
      const k30 = new Map(p30.appointments.map((a) => [a.key, a]))
      assert.ok(p14.appointments.every((a) => k30.has(a.key)) && p30.appointments.length > p14.appointments.length, `${sid}: the 30-day plan is a strict superset of the 14-day plan`)
      const kar30 = new Map(p30.karutes.map((k) => [k.key, k]))
      assert.deepEqual(p14.karutes.map((k) => kar30.get(k.key)), p14.karutes, `${sid}: every karute of the 14-day plan is identical at futureDays 30`)
      stable.push(`${registry.stores[sid].type}@${sid.slice(0, 8)} ${p14.appointments.length}⊂${p30.appointments.length}`)
    }
    console.log(`✓ S94 horizon 14 → 30: every 14-day booking + karute unchanged, ${stable.length} stores (${stable.join(', ')})`)
  }

  // ── S95: the live calendar only REMOVES (D1) ───────────────────────────────────────────────────────────
  {
    const hours = recipe.policy.weekly_hours
    const sctx = storeCtx(STORE, { weeklyHours: hours, pastDays: registry.pastDays, legacyThrough: null })
    const cal = (o: Partial<LiveCalendar> = {}): LiveCalendar => ({ weeklyHours: hours, closedDates: new Set(), specialOpen: new Map(), ...o })
    const base = plan(recipe, sctx, TODAY, TODAY)
    const on = (d: string) => (x: { date: string }) => x.date === d
    const off = (d: string) => (x: { date: string }) => x.date !== d
    const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()
    assert.deepEqual(plan(recipe, { ...sctx, liveCalendar: cal() }, TODAY, TODAY), base, 'an empty live calendar = the plan, byte-identical')
    // T1 one closed row on an open weekday
    const kd = base.karutes[base.karutes.length >> 1].date
    const t1 = plan(recipe, { ...sctx, liveCalendar: cal({ closedDates: new Set([kd]) }) }, TODAY, TODAY)
    assert.ok(hoursOn(hours, kd) && base.appointments.filter(on(kd)).length > 1 && base.karutes.some(on(kd)), 'T1 fixture: an open day with bookings and a karute')
    assert.ok(!t1.appointments.some(on(kd)) && !t1.karutes.some(on(kd)), 'T1: nothing planned on the closed day')
    assert.deepEqual(t1.appointments, base.appointments.filter(off(kd)), 'T1: every other booking identical')
    assert.deepEqual(t1.karutes, base.karutes.filter(off(kd)), 'T1: every other karute identical')
    assert.deepEqual(t1.dropped, base.appointments.filter(on(kd)).map((a) => ({ key: a.key, date: kd, why: 'closed-day' })), 'T1: dropped names them')
    assert.deepEqual(t1.packs, base.packs, 'T1: packs untouched')
    assert.deepEqual(applyLiveCalendar(base, cal({ closedDates: new Set([kd]) })), t1, 'fill\'s applyLiveCalendar(plan) = plan() with StoreCtx.liveCalendar')
    console.log(`✓ S95 T1 closed day ${kd}: dropped ${t1.dropped.length} bookings + ${base.karutes.length - t1.karutes.length} karutes, ${t1.appointments.length} others identical`)
    // T3 a live-closed weekday (Wednesday, open in the snapshot); a special-open Wednesday keeps only rows inside its window
    const t3 = plan(recipe, { ...sctx, liveCalendar: cal({ weeklyHours: { ...hours, wed: null } }) }, TODAY, TODAY)
    const isWed = (x: { date: string }) => dow(x.date) === 3
    assert.ok(base.appointments.some(isWed), 'T3 fixture: Wednesday bookings')
    assert.deepEqual(t3.appointments, base.appointments.filter((a) => !isWed(a)), 'T3: only Wednesdays dropped, others identical')
    assert.ok(t3.dropped.length === base.appointments.filter(isWed).length && t3.dropped.every((d) => d.why === 'live-weekday-closed'), 'T3: why live-weekday-closed')
    const wd = base.appointments.find(isWed)!.date
    const sp = plan(recipe, { ...sctx, liveCalendar: cal({ weeklyHours: { ...hours, wed: null }, specialOpen: new Map([[wd, { open: '12:00', close: '16:00' }]]) }) }, TODAY, TODAY)
    const inside = (a: Plan['appointments'][number]) => a.startsAt >= jstIso(a.date, 720) && a.endsAt <= jstIso(a.date, 960)
    assert.deepEqual(sp.appointments.filter(on(wd)), base.appointments.filter(on(wd)).filter(inside), 'T3: the special-open Wednesday keeps the rows inside its window only')
    assert.ok(sp.dropped.filter(on(wd)).every((d) => d.why === 'outside-live-hours'), 'T3: the rest of that day: outside-live-hours')
    // T4 live close 18:00 against the snapshot's 19:00
    const h18 = Object.fromEntries(Object.entries(hours).map(([k, v]) => [k, v ? { ...v, close: '18:00' } : v])) as typeof hours
    const t4 = plan(recipe, { ...sctx, liveCalendar: cal({ weeklyHours: h18 }) }, TODAY, TODAY)
    const late = (a: Plan['appointments'][number]) => a.endsAt > jstIso(a.date, 1080)
    assert.ok(base.appointments.some(late), 'T4 fixture: rows ending after 18:00')
    assert.deepEqual(t4.appointments, base.appointments.filter((a) => !late(a)), 'T4: rows ending after 18:00 dropped, others identical')
    assert.ok(t4.dropped.every((d) => d.why === 'outside-live-hours'), 'T4: why outside-live-hours')
    // T5 a closed row AND a special-open entry on the same date = closed
    const t5 = plan(recipe, { ...sctx, liveCalendar: cal({ closedDates: new Set([kd]), specialOpen: new Map([[kd, { open: '10:00', close: '19:00' }]]) }) }, TODAY, TODAY)
    assert.deepEqual(t5.dropped, t1.dropped.map((d) => ({ ...d, why: 'closed-and-special' })), 'T5: closed-and-special')
    // stress 5: a special-open entry on the snapshot-closed Tuesday plans nothing (removes, never adds) and does not crash
    const tue = addDays(TODAY, (2 - dow(TODAY) + 7) % 7)
    const t5b = plan(recipe, { ...sctx, liveCalendar: cal({ specialOpen: new Map([[tue, { open: '10:00', close: '19:00' }]]) }) }, TODAY, TODAY)
    assert.deepEqual(t5b, base, 'special-open on a snapshot-closed Tuesday: nothing added')
    console.log(`✓ S95 T3–T5: live-closed Wednesday −${t3.dropped.length}, special window keeps ${sp.appointments.filter(on(wd)).length}, close 18:00 −${t4.dropped.length}, closed+special = closed`)
  }
  // T2 the 14 → 30 stability with a live calendar
  {
    const [epoch, today, saved] = ['2026-09-24', '2026-10-10', registry.futureDays]
    const r = await loadRecipe('beauty_chiropractic', STORE, registry.pastDays)
    const hours = r.policy.weekly_hours
    const at = (futureDays: number, closed: string[]) => {
      registry.futureDays = futureDays
      try {
        const rr = { ...r, counts: { ...r.counts, futureDays } }
        return plan(rr, { ...storeCtx(STORE, { weeklyHours: hours, pastDays: registry.pastDays, legacyThrough: today, realismFrom: addDays(today, -1) }), liveCalendar: { weeklyHours: hours, closedDates: new Set(closed), specialOpen: new Map() } }, today, epoch)
      } finally { registry.futureDays = saved }
    }
    const end = addDays(today, 14)
    const open = (from: number) => { let d = addDays(today, from); while (!hoursOn(hours, d)) d = addDays(d, 1); return d }
    const [far, near] = [open(20), open(4)]
    assert.deepEqual(at(14, [far]), at(14, []), 'T2: a closed row on day 15–30 leaves the 14-day plan byte-identical')
    const [p14, p30] = [at(14, [near]), at(30, [near])]
    assert.ok(p14.dropped.length > 0, 'T2 fixture: the near closed day drops bookings')
    assert.deepEqual(p30.appointments.filter((a) => a.date <= end), p14.appointments, 'T2: filtered 30-day plan holds the filtered 14-day plan, whole objects')
    const k30 = new Set(p30.appointments.map((a) => a.key))
    assert.ok(p14.appointments.every((a) => k30.has(a.key)) && p30.appointments.length > p14.appointments.length, 'T2: strict superset')
    console.log(`✓ S95 T2 horizon 14 → 30 with closed days ${near} (−${p14.dropped.length}) and ${far}: ${p14.appointments.length}⊂${p30.appointments.length}`)
  }
  // readLiveCalendar: range (to exclusive), out-of-window and malformed rows, a paged answer, a default policy
  {
    const calls: unknown[] = []
    const lines: string[] = []
    const w = { from: '2026-06-11', to: '2026-10-24' }
    const mk = (res: unknown, pol: Record<string, unknown>) => ({ storePolicies: {
      get: async () => pol, listClosedDays: async (_: string, q: unknown) => (calls.push(q), res) } }) as unknown as FillCore
    const rows = { closed_days: [{ id: 'a', date: '2026-10-24' }, { id: 'b', date: '2031-03-03' }, { id: 'c', date: '2026-13-45' }, { id: 'd', date: '2026-02-30' }, { id: 'e', date: '2026-10-02' }] }
    const special = [{ date: '2026-10-20', open: '10:00', close: '19:00' }, { date: '2031-03-10', open: '10:00', close: '19:00' }, { date: '2026-10-21', open: 'late', close: '19:00' }, { date: '2026-10-22', open: '10:00', close: '24:00' }]
    const c1 = await readLiveCalendar(mk(rows, { source: 'custom', weekly_hours: { mon: null }, special_open_days: special }), STORE, w, (fn) => fn(), recipe.policy.weekly_hours, (l) => void lines.push(l))
    assert.deepEqual(calls, [{ from: w.from, to: '2026-10-25' }], 'the read asks for the full window, `to` exclusive = window end + 1')
    assert.deepEqual([...c1.closedDates].sort(), ['2026-10-02', '2026-10-24'], 'the last window day counts; 2031 and malformed dates do not')
    assert.deepEqual([...c1.specialOpen.keys()], ['2026-10-20', '2026-10-22'], 'special-open: in window, well-formed only (a 24:00 close is well-formed)')
    assert.equal(lines.filter((l) => l.includes('malformed')).length, 3, 'one line per malformed row')
    assert.ok(!lines.some((l) => l.includes('2026-10-22')) && lines.some((l) => l.includes('special-open day #2 has a malformed') && l.includes('"open":"late"')), 'the 24:00 row is not logged; a bad special-open row is named by position and printed whole')
    const night = { key: 'tw:x:BC-0001:2026-10-22', date: '2026-10-22', startsAt: jstIso('2026-10-22', 22 * 60 + 30), endsAt: jstIso('2026-10-22', 23 * 60 + 30) } as Plan['appointments'][number]
    const kept = applyLiveCalendar({ window: w, staff: [], resources: [], menus: [], customers: [], packs: [], appointments: [night], karutes: [], dropped: [] }, c1)
    assert.ok(kept.appointments.length === 1 && kept.dropped.length === 0, 'a booking ending 23:30 on a special-open day closing 24:00 survives')
    assert.deepEqual(c1.weeklyHours, { mon: null }, 'a custom policy: its live hours')
    // S96 finding 1 — ONE window check (windowOf) for every window read: reversed and zero-length are malformed, 24:00 closes
    {
      const wl: string[] = []
      const d = '2026-10-21'
      const wh = hoursOn(recipe.policy.weekly_hours, d)!
      const wd = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(`${d}T00:00:00Z`).getUTCDay()]
      const sp = [{ date: d, open: '19:00', close: '10:00' }, { date: '2026-10-23', open: '10:00', close: '10:00' }, { date: '2026-10-22', open: '10:00', close: '24:00' }, { date: '2026-10-20', open: '24:00', close: '24:00' }]
      const live = { ...recipe.policy.weekly_hours, [wd]: { open: '19:00', close: '10:00' } }
      const c = await readLiveCalendar(mk({ closed_days: [] }, { source: 'custom', weekly_hours: live, special_open_days: sp }), STORE, w, (fn) => fn(), recipe.policy.weekly_hours, (l) => void wl.push(l))
      assert.deepEqual([...c.specialOpen.keys()], ['2026-10-22'], 'S96: reversed, zero-length and 24:00–24:00 special-open windows are malformed; 10:00–24:00 is kept')
      assert.ok(['#0', '#1', '#3'].every((r) => wl.some((l) => l.includes(`special-open day ${r} has a malformed`))), 'S96: each malformed special-open row is logged by position')
      assert.ok(wl.some((l) => l.includes(`weekly hours ${wd} has a malformed`)) && wl.length === 4, 'S96: the reversed weekday is logged through the same path, 4 lines in all')
      assert.deepEqual(c.weeklyHours[wd], recipe.policy.weekly_hours[wd], 'S96: a reversed live weekday falls through to the recipe hours for that weekday')
      const a = { key: `tw:x:BC-0001:${d}`, date: d, startsAt: jstIso(d, mins(wh.open)), endsAt: jstIso(d, mins(wh.open) + 60) } as Plan['appointments'][number]
      const kept = applyLiveCalendar({ window: w, staff: [], resources: [], menus: [], customers: [], packs: [], appointments: [a], karutes: [], dropped: [] }, c)
      assert.ok(kept.appointments.length === 1 && kept.dropped.length === 0, 'S96: a booking inside the weekly hours survives a reversed special-open row on its day (no longer empties the day)')
      assert.ok(windowOf({ open: '10:00', close: '24:00' }) && !windowOf({ open: '19:00', close: '10:00' }) && !windowOf({ open: '10:00', close: '10:00' }) && !windowOf(null), 'S96: windowOf')
      const same = { ...recipe.policy.weekly_hours }
      const c3 = await readLiveCalendar(mk({ closed_days: [] }, { source: 'custom', weekly_hours: same }), STORE, w, (fn) => fn(), recipe.policy.weekly_hours, () => {})
      assert.ok(c3.weeklyHours === same, 'S96: well-formed live hours are passed through untouched')
      console.log(`✓ S96 windowOf: reversed + zero-length + 24:00–24:00 special-open rejected (${wl.length} lines), 10:00–24:00 kept, reversed ${wd} → recipe ${wh.open}–${wh.close}, the day keeps its booking`)
    }
    const c2 = await readLiveCalendar(mk({ closed_days: [] }, { source: 'default', weekly_hours: null }), STORE, w, (fn) => fn(), recipe.policy.weekly_hours, () => {})
    assert.ok(c2.weeklyHours === recipe.policy.weekly_hours && c2.closedDates.size === 0, 'a default policy: the recipe hours, 0 closed')
    await assert.rejects(readLiveCalendar(mk({ closed_days: [{ id: 'a', date: '2026-10-02' }], total: 2 }, { source: 'custom', weekly_hours: {} }), STORE, w, (fn) => fn(), recipe.policy.weekly_hours, () => {}), /1 of 2/, 'a paged answer fails loud')
    console.log('✓ S95 readLiveCalendar: to-exclusive range, last day in, 2031 + malformed out (3 lines), paged = loud, default = recipe hours')
  }
  // T6 fill dry + apply with one closed row · T11 a failed calendar read · T10 weekly_hours null · T9 lastWindowEnd
  {
    const base = plan(recipe, storeCtx(STORE, { weeklyHours: recipe.policy.weekly_hours, pastDays: registry.pastDays, legacyThrough: null }), TODAY, TODAY)
    const d = base.appointments.find((a) => a.date > TODAY && a.member !== 'BC-0003')!.date
    const dropping = base.appointments.filter((a) => a.date === d && a.member !== 'BC-0003').length
    const wc = (l: string[]) => JSON.parse(l.find((x) => x.startsWith('would create: '))!.slice(14).split(' · ')[0]).appointments as number
    const [dl, ol]: string[][] = [[], []]
    assert.equal(await apply(fakeCore({ closed: [d] }).core, { ...opts(empty()), dry: true, log: (l: string) => void dl.push(l) }), 0, 'T6 dry: exit 0')
    assert.equal(await apply(fakeCore().core, { ...opts(empty()), dry: true, log: (l: string) => void ol.push(l) }), 0)
    assert.equal(wc(ol) - wc(dl), dropping, 'T6: would-create excludes the closed day\'s bookings')
    assert.ok(dl.some((l) => l.startsWith(`live calendar: 1 closed days in window [${d}] · 0 special-open days · dropped `) && l.endsWith(`[${d}]`)), `T6: the summary line names ${d}`)
    const fc = fakeCore({ closed: [d] })
    const mc = empty()
    assert.equal(await apply(fc.core, opts(mc)), 0, 'T6 apply: exit 0')
    assert.ok(!fc.t.appts.some((a) => (a.notes as string).includes(`:${d}]`)) && fc.t.appts.length > 100, 'T6: no create on the closed day')
    assert.deepEqual(mc.runs[0].dropped, { bookings: base.appointments.filter((a) => a.date === d).length, karutes: base.karutes.filter((k) => k.date === d).length, dates: [d] }, 'T6: the Run entry records dropped')
    console.log(`✓ S95 T6 closed ${d}: would-create ${wc(ol)} → ${wc(dl)}, apply exit 0, run.dropped ${JSON.stringify(mc.runs[0].dropped)}`)
    // T11
    const ff = fakeCore({ calendarFails: true })
    const fl: string[] = []
    const mf = empty()
    assert.equal(await apply(ff.core, { ...opts(mf), log: (l: string) => void fl.push(l) }), 1, 'T11: a failed calendar read exits 1')
    assert.ok(ff.stats.writes === 0 && !ff.t.appts.length && !mf.stores[STORE], 'T11: no write, no epoch left behind')
    assert.ok(fl.some((l) => l.startsWith('FAILED: live calendar: read failed')), 'T11: said loud')
    // T10
    const fn = fakeCore()
    fn.stats.policy = { source: 'custom', weekly_hours: null }
    assert.equal(await apply(fn.core, opts(empty())), 0)
    assert.deepEqual(fn.stats.policy?.weekly_hours, recipe.policy.weekly_hours, 'T10: a policy row with weekly_hours null gets the recipe hours')
    // T9
    assert.equal(lastWindowEnd([{ store: STORE, today: '2026-10-01' }, { store: OTHER, today: '2026-10-05' }], STORE), addDays('2026-10-01', 14), 'T9: today + 14')
    assert.ok(NEW_START_FUTURE_DAYS === 14 && registry.futureDays !== 14, 'T9: not registry.futureDays')
    // stress 11: the plan command offline
    const pl: string[] = []
    assert.equal(await runCli(['plan', '--store', STORE], async () => { throw new Error('no client offline') }, { log: (...l: unknown[]) => void pl.push(l.join(' ')), today: TODAY }), 0)
    assert.ok(pl[0] === 'live calendar: not read (no core env)', 'the plan command offline says so and plans')
    console.log('✓ S95 T9–T11: lastWindowEnd today + 14 · weekly_hours null → recipe hours · failed calendar read exit 1, 0 writes · plan offline')
  }
  // T7 close-out after a closure added once rows exist · stress 9 fill leaves them · T8 a CANCELLED booking's karute
  {
    const cfg = { closed: [] as string[] }
    const f7 = fakeCore(cfg)
    const m7 = empty()
    assert.equal(await apply(f7.core, opts(m7)), 0)
    const d = addDays(TODAY, 1)
    const onD = f7.t.appts.filter((a) => (a.notes as string).includes(`:${d}]`))
    assert.ok(onD.length > 0 && onD.every((a) => a.status === 'SCHEDULED'), 'T7 fixture: SCHEDULED rows on the day after')
    cfg.closed.push(d) // the store closes that day after the rows were written
    const later = addDays(TODAY, 3)
    assert.equal(await closeOut(f7.core, STORE, m7, new Date(jstIso(later, 18 * 60)), true, () => {}), 0)
    const upd = new Set(f7.stats.updates.map((u) => u.id))
    const closedOut = onD.filter((a) => upd.has(a.id))
    assert.ok(closedOut.length > 0 && onD.every((a) => a.status !== 'SCHEDULED' || !upd.has(a.id)), 'T7: rows on the now-closed day are still closed out')
    const l7: string[] = []
    const before = f7.t.appts.length
    assert.equal(await apply(f7.core, { ...opts(m7, later), log: (l: string) => void l7.push(l) }), 0)
    assert.ok(onD.every((a) => l7.some((l) => l.includes(`booking ${a.id} is on ${d}, which the live calendar now closes (closed-day), left alone`))), 'stress 9: fill leaves them and says so')
    assert.ok(!f7.t.appts.slice(before).some((a) => (a.notes as string).includes(`:${d}]`)), 'stress 9: nothing new on the closed day')
    console.log(`✓ S95 T7 closure after writing: ${closedOut.length}/${onD.length} rows on ${d} closed out; fill leaves ${onD.length} and says so`)
    // T8
    const f8 = fakeCore()
    const m8 = empty()
    assert.equal(await apply(f8.core, opts(m8)), 0)
    const k = f8.t.karutes[0]
    const appt = f8.t.appts.find((a) => a.id === k.appointment_id)!
    const key = /\[(tw:[^\]]+)\]/.exec(appt.notes as string)![1]
    f8.t.karutes.splice(0, 1)
    Object.assign(appt, { status: 'CANCELLED', status_reason: 'cancel-advance-contact', status_set_by: 'dev' }) // realism's shape
    const l8: string[] = []
    const writes = f8.stats.writes
    assert.equal(await apply(f8.core, { ...opts(m8), readBack: true, log: (l: string) => void l8.push(l) }), 0)
    assert.ok(l8.includes(`karute skipped: booking ${key} is CANCELLED in core`), 'T8: the skip line')
    assert.ok(!f8.t.karutes.some((x) => x.appointment_id === appt.id) && f8.stats.writes === writes, 'T8: no karute write')
    const row = l8.find((l) => l.startsWith('karuteRecords of the store (all) | '))!.split(' | ')
    assert.equal(row[1], row[2], `T8: planned karutes = what fill can write (${row[1]} vs ${row[2]} in core)`)
    console.log(`✓ S95 T8 CANCELLED booking ${key}: karute skipped and said; planned ${row[1]} = in core ${row[2]}`)
  }

  console.log('✓ fill: all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
