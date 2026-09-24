// Runnable check (no framework, no network), same command as ci.yml:
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/fill.test.ts
// An in-memory core stands in for SynqedClient. Like core, it answers a double-booked practitioner or bed with a 409.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEV_SALON_BUSINESS_ID } from './count-baseline'
import { apply, loadRecipe, withRetry, type FillCore, type Manifest } from './fill'
import { addDays, hoursOn, jstIso, plan, type Plan } from './plan'

const STORE = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f'
const OTHER = 'store-other'
const TODAY = '2026-09-24'
type Row = Record<string, unknown> & { id: string }
type Q = { page?: number; page_size?: number; store_id?: string; from?: string; to?: string }
const paged = (key: string, rows: unknown[], { page = 1, page_size = 20 }: Q = {}) => {
  const size = Math.min(page_size, 50)
  return { [key]: rows.slice((page - 1) * size, page * size), page, page_size: size, total: rows.length }
}
const conflict = (msg: string) => Object.assign(new Error(msg), { status: 409 })

function fakeCore(o: { business?: string; devEmail?: string; fail409?: boolean; defaultHours?: Record<string, unknown> } = {}) {
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
  const overlaps = (a: Row, b: Record<string, unknown>) =>
    Date.parse(a.starts_at as string) < Date.parse(b.ends_at as string) && Date.parse(b.starts_at as string) < Date.parse(a.ends_at as string)
  const core = {
    orgSettings: { get: async () => ({ business_id: o.business ?? DEV_SALON_BUSINESS_ID }) },
    stores: { list: async () => ({ stores: [{ id: STORE, name: 'テスト東京店' }] }) },
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
    customers: { list: async (q: Q) => paged('customers', t.customers, q), create: async (i: Record<string, unknown>) => add(t.customers, i) },
    packs: {
      listPacks: async (cid: string) => t.packs.filter((p) => p.customer_id === cid),
      createPack: async (i: Record<string, unknown>) => add(t.packs, i),
      listRedemptions: async (cid: string) => t.burns.filter((b) => b.customer_id === cid),
      addRedemption: async (i: Record<string, unknown>) => {
        if (t.burns.some((b) => b.appointment_id === i.appointment_id)) throw conflict('duplicate redemption')
        return add(t.burns, i)
      },
    },
    appointments: {
      list: async (q: Q) => paged('appointments', t.appts.filter((a) => (!q.from || (a.starts_at as string) >= q.from) && (!q.to || (a.starts_at as string) < q.to)), q),
      create: async (i: Record<string, unknown>) => {
        if (o.fail409) throw conflict('RESOURCE_TAKEN')
        if (t.appts.some((a) => overlaps(a, i) && (a.staff_id === i.staff_id || a.resource_id === i.resource_id))) throw conflict('double-booked')
        return add(t.appts, { ...i, occupied_until: null })
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

  // (c) idempotency: the second run creates 0; links kept (never narrowed); a dry-run sends nothing.
  const f = fakeCore()
  const m = empty()
  assert.equal(await apply(f.core, { ...opts(m), dry: true }), 0)
  assert.equal(f.stats.writes, 0, 'dry-run writes nothing')
  assert.equal(await apply(f.core, opts(m)), 0)
  const first = f.stats.writes
  assert.ok(first > 400, `first run fills (${first} writes)`)
  assert.equal(f.t.appts.length, p1.appointments.length, 'every planned booking landed (core-like 409s: none)')
  assert.equal(f.t.karutes.length, p1.karutes.length)
  assert.deepEqual(f.t.links.get('st-3'), [OTHER, STORE], 'an existing link set is kept as is')
  assert.deepEqual(f.t.links.get('st-4'), [OTHER, STORE], 'this store is ADDED to a staff member working elsewhere')
  assert.equal(f.t.links.get('st-0'), undefined, 'a practitioner of every store is never narrowed to one')
  assert.equal(m.stores[STORE].epoch, TODAY)
  assert.equal(await apply(f.core, opts(m)), 0)
  assert.equal(f.stats.writes, first, 'second run: 0 writes')
  assert.equal(m.runs.length, 2)
  assert.ok(Object.values(m.runs[1].created).every((x) => x === 0), JSON.stringify(m.runs[1].created))
  assert.deepEqual(m.runs[1].skipped, [], 'a re-run finds its own rows by key (never mistakes them for foreign bookings)')
  // A week later: only the new days, no booking twice.
  assert.equal(await apply(f.core, opts(m, addDays(TODAY, 7))), 0)
  assert.equal(new Set(f.t.appts.map((a) => `${a.customer_id}|${a.starts_at}`)).size, f.t.appts.length, 'no duplicate booking after the top-up')
  assert.equal(f.t.appts.length, p2.appointments.length)

  // A default policy may echo platform hours: the snapshot is still the recipe's hours, the ones the loader sets.
  const nine = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '09:00', close: '18:00' }]))
  const dh = fakeCore({ defaultHours: nine })
  const mdh = empty()
  const dhCode = await apply(dh.core, opts(mdh))
  assert.deepEqual(mdh.stores[STORE].weeklyHours, recipe.policy.weekly_hours, 'hours snapshot = the recipe hours the loader set, not the default policy echo')
  assert.deepEqual(dh.stats.policy?.weekly_hours, recipe.policy.weekly_hours, 'the loader set the recipe hours')
  assert.equal(dhCode, 0)

  // A 409 is recorded, never retried, and exits 4; 5xx is retried, 409 is not.
  const c409 = fakeCore({ fail409: true })
  const m409 = empty()
  assert.equal(await apply(c409.core, opts(m409)), 4)
  assert.ok(m409.runs[0].conflicts409.length > 0 && m409.runs[0].conflicts409[0].startsWith('appointments '))
  let calls = 0
  await assert.rejects(withRetry(async () => { calls++; throw conflict('x') }, true, async () => {}))
  assert.equal(calls, 1, '409 never retried')
  calls = 0
  assert.equal(await withRetry(async () => { if (++calls < 3) throw Object.assign(new Error('busy'), { status: 503 }); return 'ok' }, true, async () => {}), 'ok')
  assert.equal(calls, 3, '5xx retried')

  // (d) static: the loader has no delete call and never imports the deleting seeder's guard.
  for (const file of ['fill.ts', 'plan.ts', 'recipes/beauty_chiropractic.ts']) {
    const src = readFileSync(join(__dirname, file), 'utf8')
    assert.doesNotMatch(src, /\.delete\(|remove\(|destroy\(|\.update\(|\.patch\(/, `${file}: no delete or update call`)
    assert.doesNotMatch(src, /(from\s+|require\(\s*|import\(\s*)['"][^'"]*core-target-guard/, `${file}: does not import core-target-guard`)
  }

  // One recipe = one store (grep-pinned: the registry is read at import, so a test cannot remap it).
  assert.match(readFileSync(join(__dirname, 'fill.ts'), 'utf8'), /must map exactly one store/, 'fill.ts refuses a type mapped to more than one store')

  console.log('✓ fill: all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
