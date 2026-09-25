// fill.ts — the test-world FILL LOADER: makes a Dev Salon test store look like a real business of its
// type (registry.json maps store → type; recipes/<type>.ts holds the data; plan.ts turns it into rows).
//
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/fill.ts <cmd>
//     plan  [--type <id>] [--manifest <path>]           counts per section, no network
//     apply --type <id> --manifest <path> [--dry-run]  live; --dry-run does every READ and writes nothing
//   CADENCE: re-run `apply` WEEKLY. The window is epoch − pastDays … today + futureDays; a re-run only
//   adds the days that appeared since (the top-up). Rows are matched by stable keys, so a re-run of
//   an unchanged window creates 0.
//
// It ADDS and never takes away: no delete call, and no update of an existing row's fields — Liam's own
// changes in Business survive every top-up. The one exception is staffStores.set, used only to ADD this
// store to a staff member's list (the list already there is kept).
//
// Why it does NOT import scripts/lib/core-target-guard.ts: that guard refuses every non-local core
// because it protects a DELETING seeder (seed-booking-data.ts). This loader targets the shared core on
// purpose and deletes nothing. Its guard is the Dev Salon pin instead: the client is built with the hard
// Dev Salon business id, core must resolve that business (orgSettings) and hold the dev@karute.test
// card (count-baseline's assertDevSalon) — checked before any write — and the store must be mapped in
// registry.json. Never wire this into e2e/global-setup.ts or any npm script that runs by itself.
//
// Env: SYNQED_CORE_URL, SYNQED_CORE_API_KEY (values are never printed). The manifest holds ids only.
// Exit: 0 ok · 1 error · 2 REFUSED (pin) · 4 unexpected 409s > 0.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Appointment, SynqedClient, WeeklyHours } from '@synqed-kk/client'
import { isTerminalStatus } from '../../src/lib/appointments/status'
import { assertDevSalon, DEV_EMAIL, DEV_SALON_BUSINESS_ID, pageAll, Refused } from './count-baseline'
import { addDays, hoursOn, jstIso, plan, type Plan, type Recipe, type RecipeData, type StoreCtx } from './plan'

export type FillCore = Pick<
  SynqedClient,
  'orgSettings' | 'stores' | 'staff' | 'staffStores' | 'storePolicies' | 'resources' | 'menus' | 'customers' | 'packs' | 'appointments' | 'karuteRecords'
>
type Section = 'storePolicies' | 'staff' | 'staffStores' | 'resources' | 'menus' | 'customers' | 'packs' | 'appointments' | 'karuteRecords' | 'redemptions'
interface Run { at: string; type: string; store: string; today: string; created: Partial<Record<Section, number>>; skipped: string[]; conflicts409: string[]; errors: string[] }
export interface Manifest {
  businessId: string
  stores: Record<string, { type: string; epoch: string; weeklyHours: WeeklyHours; created: Partial<Record<Section, Record<string, string>>> }>
  runs: Run[]
}
interface Registry {
  types: Record<string, { label: string; sections: string[]; recipe: Recipe['counts'] | null }>
  stores: Record<string, string>
  slotMinutes: Record<string, number>
}

export const registry: Registry = JSON.parse(readFileSync(join(__dirname, 'registry.json'), 'utf8'))

/** The recipe for a registry type: data from recipes/<id>.ts, counts from registry.json. */
export async function loadRecipe(id: string): Promise<Recipe> {
  const counts = registry.types[id]?.recipe
  if (!/^[a-z_]+$/.test(id) || !counts) throw new Error(`type ${id} has no recipe in registry.json`)
  const mod = (await import(`./recipes/${id}`)) as { recipe: RecipeData }
  return { ...mod.recipe, id, counts }
}

/** What plan() needs of one store: its hours snapshot (manifest) and booking step (registry.json). */
export const storeCtx = (storeId: string, st: { weeklyHours: WeeklyHours }): StoreCtx => ({ storeId, weeklyHours: st.weeklyHours, slotMinutes: registry.slotMinutes[storeId] })

/** One recipe = one store: a recipe's member numbers and keys belong to exactly one store in registry.json. */
export function assertOneStore(stores: Record<string, string>, type: string): void {
  if (Object.values(stores).filter((t) => t === type).length !== 1) throw new Error(`type ${type} must map exactly one store in registry.json (one recipe = one store; a second store of a type needs its own recipe and member-number series)`)
}

export const jstToday = (now = new Date()) => new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
const statusOf = (e: unknown) => (e as { status?: number } | null)?.status
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Retried with backoff, 5 retries at most, never a 409. A read: 429 / 5xx / a dropped connection. A keyed write (sent
 *  with an idempotencyKey — core replays it): 429 / 5xx. An unkeyed create: 429 only — a 5xx may come after the commit,
 *  and a resend would make a second row; it is recorded as an error and the next run heals it by natural key. */
export async function withRetry<T>(fn: () => Promise<T>, write: false | 'keyed' | 'unkeyed', wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const s = statusOf(e)
      if (attempt >= 5 || !(s === 429 || (write !== 'unkeyed' && (s ?? 0) >= 500) || (s === undefined && !write))) throw e
      await wait(500 * 2 ** attempt)
    }
  }
}

async function pool<T>(items: T[], fn: (x: T) => Promise<void>, size = 4) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

export interface ApplyOpts { recipe: Recipe; storeId: string; manifest: Manifest; today: string; dry: boolean; log: (l: string) => void; wait?: (ms: number) => Promise<unknown>; readBack?: boolean }

/** One store of one type. Mutates opts.manifest (the caller saves it, even after a throw). */
export async function apply(core: FillCore, o: ApplyOpts): Promise<number> {
  const { recipe, storeId, today, dry, log } = o
  const read = <T,>(fn: () => Promise<T>) => withRetry(fn, false, o.wait)
  let cards: Awaited<ReturnType<typeof assertDevSalon>>
  try {
    cards = await assertDevSalon(core)
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    log(`REFUSED: ${e.message}`)
    return 2
  }
  if (registry.stores[storeId] !== recipe.id) throw new Error(`store ${storeId} is not mapped to ${recipe.id} in registry.json`)
  assertOneStore(registry.stores, recipe.id)
  const { stores } = await read(() => core.stores.list())
  if (!stores.some((s) => s.id === storeId)) throw new Error(`store ${storeId} is not in core`)
  const dev = cards.find((s) => s.email?.toLowerCase() === DEV_EMAIL)!

  const m = o.manifest
  const policy = await read(() => core.storePolicies.get(storeId))
  const prior = m.stores[storeId]
  const st = prior ?? { type: recipe.id, epoch: today, weeklyHours: policy.source === 'default' ? recipe.policy.weekly_hours : policy.weekly_hours ?? recipe.policy.weekly_hours, created: {} }
  if (!dry) m.stores[storeId] = st
  const run: Run = { at: new Date().toISOString(), type: recipe.id, store: storeId, today, created: {}, skipped: [], conflicts409: [], errors: [] }
  if (!dry) m.runs.push(run)
  let sent = 0

  // The only door to a write. Dry-run counts and returns a stand-in; a 409 is recorded, never retried.
  async function write<T>(section: Section, key: string, fn: () => Promise<T>): Promise<(T & { id?: string }) | null> {
    run.created[section] = (run.created[section] ?? 0) + 1
    if (dry) return { id: `dry:${key}` } as T & { id?: string }
    try {
      sent++
      // appointments.create and packs.addRedemption are the only creates the SDK takes an idempotencyKey on.
      const keyed = section === 'appointments' || section === 'redemptions'
      const row = (await withRetry(fn, keyed ? 'keyed' : 'unkeyed', o.wait)) as T & { id?: string }
      if (row?.id) ((st.created[section] ??= {})[key] = row.id)
      return row
    } catch (e) {
      run.created[section]!--
      ;(statusOf(e) === 409 ? run.conflicts409 : run.errors).push(`${section} ${key}: ${message(e)}`)
      return null
    }
  }

  try {
    const p = plan(recipe, storeCtx(storeId, st), today, st.epoch)
    if (policy.source === 'default')
      await write('storePolicies', storeId, () => core.storePolicies.set(storeId, { weekly_hours: recipe.policy.weekly_hours, acting_staff_id: dev.id }))

    const staffId = new Map<string, string>()
    for (const s of p.staff) {
      const have = cards.find((c) => c.name === s.name)
      const id = have?.id ?? (await write('staff', s.name, () => core.staff.create({ name: s.name, role: s.role, is_active: true })))?.id
      if (!id) continue
      staffId.set(s.name, id)
      const cur = have ? (await read(() => core.staffStores.get(id))).store_ids : []
      // An empty list already means "every store": only a non-empty list without this store gets it ADDED.
      if (!have || (cur.length && !cur.includes(storeId))) await write('staffStores', s.name, () => core.staffStores.set(id, [...cur, storeId]))
    }

    const resId = new Map((await read(() => core.resources.list({ store_id: storeId }))).resources.map((r) => [r.name, r.id]))
    await pool(p.resources.filter((r) => !resId.has(r.name)), async (r) => {
      const row = await write('resources', r.name, () => core.resources.create({ store_id: storeId, ...r }))
      if (row?.id) resId.set(r.name, row.id)
    })

    const menuOf = new Map((await read(() => core.menus.list())).menus.filter((x) => x.store_id === storeId).map((x) => [x.name, x.id]))
    await pool(p.menus.filter((x) => !menuOf.has(x.name)), async (x) => {
      const row = await write('menus', x.name, () => core.menus.create({
        store_id: storeId, name: x.name, duration_minutes: x.duration, price_list_amount: x.price, currency: 'JPY', tax_included: true,
        category: x.category, nomination_allowed: x.nomination, online_visible: true, active: true, required_room_class: x.private ? 'private' : null,
        display_order: p.menus.indexOf(x),
      }))
      if (row?.id) menuOf.set(x.name, row.id)
    })

    // include_deleted: a customer Liam put in the bin stays there — never re-created, and gets no new 回数券 or booking.
    const all = await read(() => pageAll('customers', (page) => core.customers.list({ include_deleted: true, page, page_size: 500 })))
    // SDK skew: core sends deleted_at on these rows, the SDK's Customer type does not declare it (same cast as customers.core.ts).
    const inBin = (c: object) => !!(c as { deleted_at?: string | null }).deleted_at
    const binned = new Set(all.filter((c) => c.member_number && inBin(c)).map((c) => c.member_number!))
    const custId = new Map(all.filter((c) => c.member_number && !inBin(c)).map((c) => [c.member_number!, c.id]))
    await pool(p.customers.filter((c) => !custId.has(c.member) && !binned.has(c.member)), async (c) => {
      const row = await write('customers', c.member, () => core.customers.create({
        name: c.name, furigana: c.kana, gender: c.gender, date_of_birth: c.birth, occupation: c.occupation, phone: c.phone, email: c.email,
        member_number: c.member, notes: c.memo, assigned_staff_id: staffId.get(c.staff) ?? null, has_ticket_pack: recipe.packs.some((x) => x.member === c.member),
      }))
      if (row?.id) custId.set(c.member, row.id)
    })

    const packId = new Map<string, string>()
    await pool(p.packs, async (k) => {
      const cid = custId.get(k.member)
      if (!cid) return void run.skipped.push(`packs ${k.key}: ${binned.has(k.member) ? `customer ${k.member} is in the bin` : 'no customer'}`)
      // ours = the id this loader recorded, else the notes/tag (a staff edit of the notes must not make a second row).
      // A pack sold by hand (no recorded id, no テストデータ note) is never adopted or burnt.
      const rec = st.created.packs?.[k.key]
      const list = dry && cid.startsWith('dry:') ? undefined : await read(() => core.packs.listPacks(cid))
      const have = list?.find((x) => x.id === rec) ?? list?.find((x) => x.kind === 'pack' && x.purchase_round === 1 && (x.notes ?? '').startsWith('テストデータ'))
      // an adopted row is recorded like a created one, so a lost manifest is rebuilt in one run
      if (have && !dry) (st.created.packs ??= {})[k.key] = have.id
      const id = have?.id ?? (await write('packs', k.key, () => core.packs.createPack({
        customer_id: cid, kind: 'pack', pack_size: k.size, unit_price: k.unitPrice, total_price: k.unitPrice * k.size, purchase_round: 1,
        purchased_at: k.purchasedOn, source: 'manual', notes: `テストデータ [${k.key}]`, created_by: staffId.get(k.staff) ?? null,
      })))?.id
      if (id) packId.set(k.key, id)
    })

    // ours = the id this loader recorded, else the notes/tag (a staff edit of the notes must not make a second row).
    // A foreign booking at the same customer + start is never adopted: it either clashes (skipped below) or the loader
    // makes its own tagged one beside it.
    const window = await read(() => pageAll('appointments', (page) => core.appointments.list({ from: jstIso(p.window.from, 0), to: jstIso(addDays(p.window.to, 1), 0), page, page_size: 500 })))
    const mine = new Map<string, { id: string; status: string; customer_id: string | null }>()
    for (const a of window) {
      const tag = /\[(tw:[^\]]+)\]/.exec(a.notes ?? '')?.[1]
      if (tag && a.store_id === storeId) mine.set(tag, a)
    }
    for (const [key, id] of Object.entries(st.created.appointments ?? {})) {
      const a = window.find((x) => x.id === id && x.store_id === storeId)
      if (a) mine.set(key, a) // the recorded id wins over a tag match for the same key
    }
    // A CANCELLED / NO_SHOW booking frees its slot — the app's own rule (isTerminalStatus, src/lib/appointments/status.ts).
    const clash = (a: Plan['appointments'][number], sid: string, rid: string) => {
      const [start, end] = [Date.parse(a.startsAt), Date.parse(a.endsAt) + p.resources.find((r) => r.name === a.resource)!.cleanup_minutes * 60_000]
      return window.find((x: Appointment) => !isTerminalStatus(x.status) && Date.parse(x.starts_at) < end && start < Date.parse(x.occupied_until ?? x.ends_at) && (x.staff_id === sid || x.resource_id === rid))
    }
    const apptRow = new Map<string, { id: string; status: string }>()
    await pool(p.appointments, async (a) => {
      const [cid, sid, rid, mid] = [custId.get(a.member), staffId.get(a.staff), resId.get(a.resource), menuOf.get(a.menu)]
      if (!cid && binned.has(a.member)) return void run.skipped.push(`appointments ${a.key}: customer ${a.member} is in the bin`)
      if (!cid || !sid || !rid || !mid) return void run.skipped.push(`appointments ${a.key}: missing customer/staff/bed/menu`)
      const have = mine.get(a.key)
      // the booking's customer differs from the planned customer: the loader leaves it alone, never written against
      if (have && have.customer_id !== cid) return void run.skipped.push(`appointments ${a.key}: booking ${have.id}'s customer differs from the planned customer, left alone`)
      if (have) {
        if (!dry) (st.created.appointments ??= {})[a.key] = have.id
        return void apptRow.set(a.key, have)
      }
      const other = clash(a, sid, rid)
      if (other) return void run.skipped.push(`appointments ${a.key}: overlaps existing booking ${other.id}`)
      const row = await write('appointments', a.key, () => core.appointments.create({
        customer_id: cid, staff_id: sid, store_id: storeId, menu_id: mid, resource_id: rid, starts_at: a.startsAt, ends_at: a.endsAt,
        duration_minutes: a.duration, booked_price_amount: a.price, booked_price_currency: 'JPY', status: a.status, source: 'MANUAL',
        title: null, notes: `テストデータ [${a.key}]`,
      }, { idempotencyKey: `test-world:${a.key}` }))
      if (row?.id) apptRow.set(a.key, { id: row.id, status: (row as { status?: string }).status ?? a.status })
    })

    // Karutes and 回数券 burns only for bookings that are COMPLETED in core (a top-up never closes a booking out).
    const done = (key: string) => (apptRow.get(key)?.status === 'COMPLETED' ? apptRow.get(key)!.id : null)
    const karuted = new Set((await read(() => pageAll('karute_records', (page) => core.karuteRecords.list({ store_id: storeId, page, page_size: 200 })))).map((k) => k.appointment_id))
    await pool(p.karutes, async (k) => {
      const aid = done(k.key)
      if (!aid || karuted.has(aid)) return
      await write('karuteRecords', k.key, () => core.karuteRecords.create({
        customer_id: custId.get(k.member)!, store_id: storeId, staff_id: staffId.get(k.staff)!, appointment_id: aid, status: 'APPROVED',
        ai_summary: k.entries.map((l) => `【${l.label}】${l.text}`).join('\n'), service: k.menu, duration_minutes: k.duration, session_date: k.date,
        entries: k.entries.map((l, i) => ({ category: l.category, content: l.text, sort_order: i, is_manual: true })),
      }))
    })
    const dateOf = new Map(p.appointments.map((a) => [a.key, a.date]))
    await pool(p.packs, async (k) => {
      const pid = packId.get(k.key)
      if (!pid) return
      const cid = custId.get(k.member)! // a pack id is only set for a customer that exists
      const burnt = pid.startsWith('dry:') ? new Set<string>() : new Set((await read(() => core.packs.listRedemptions(cid))).map((r) => `${r.pack_id}|${r.redeemed_on}`))
      for (const key of k.redeem) {
        const aid = done(key)
        if (!aid || burnt.has(`${pid}|${dateOf.get(key)}`)) continue
        await write('redemptions', key, () => core.packs.addRedemption({
          pack_id: pid, customer_id: cid, redeemed_on: dateOf.get(key)!, appointment_id: aid, source: 'manual', created_by: staffId.get(k.staff) ?? null,
        }, { idempotencyKey: `test-world:${key}:redeem` }))
      }
    })

    log(`${dry ? 'would create' : 'created'}: ${JSON.stringify(run.created)} · writes sent: ${sent}`)
    run.skipped.forEach((l) => log(`skipped: ${l}`))
    ;[...run.conflicts409, ...run.errors].forEach((l) => log(`FAILED: ${l}`))
    // The read-back is a diagnostic: its failure never changes the exit code.
    if (o.readBack) {
      try {
        (await withRetry(() => readBack(core, storeId, p), false, o.wait)).forEach((r) => log(r.join(' | ')))
      } catch (e) {
        log(`read-back failed (writes unaffected): ${message(e)}`)
      }
    }
    return run.conflicts409.length ? 4 : run.errors.length ? 1 : 0
  } catch (e) {
    // A first run that failed before any write leaves no epoch behind (no row exists on its dates yet);
    // once a write was sent, the epoch stays — rows may exist on those dates.
    if (!prior && sent === 0) delete m.stores[storeId]
    throw e
  }
}

/** What core holds for this store now, per section, beside the plan (reads only). */
async function readBack(core: FillCore, storeId: string, p: Plan): Promise<(string | number)[][]> {
  const members = new Set(p.customers.map((c) => c.member))
  const [policy, links, res, { menus }, customers, appts, karutes] = await Promise.all([
    core.storePolicies.get(storeId), core.staffStores.counts(), core.resources.list({ store_id: storeId }), core.menus.list(),
    pageAll('customers', (page) => core.customers.list({ include_deleted: true, page, page_size: 500 })),
    pageAll('appointments', (page) => core.appointments.list({ store_id: storeId, page, page_size: 500 })),
    pageAll('karute_records', (page) => core.karuteRecords.list({ store_id: storeId, page, page_size: 200 })),
  ])
  const ours = customers.filter((c) => members.has(c.member_number ?? ''))
  const packs = (await Promise.all(ours.map((c) => core.packs.listPacks(c.id)))).flat()
  const burns = (await Promise.all([...new Set(packs.map((k) => k.customer_id))].map((id) => core.packs.listRedemptions(id)))).flat()
  const tagged = appts.filter((a) => a.notes?.includes('[tw:'))
  const status = JSON.stringify(tagged.reduce<Record<string, number>>((o, a) => ((o[a.status] = (o[a.status] ?? 0) + 1), o), {}))
  return [
    ['section', 'planned', 'in core now'],
    ['storePolicies', 'weekly_hours', `${policy.source} ${JSON.stringify(policy.weekly_hours)}`],
    ['staff linked to the store', p.staff.length, links.counts[storeId] ?? 0],
    ['resources', p.resources.length, res.resources.length],
    ['menus of the store (all)', p.menus.length, menus.filter((m) => m.store_id === storeId).length],
    ['customers (recipe member numbers)', p.customers.length, ours.length],
    ['packs of those customers', p.packs.length, packs.length],
    ['redemptions on those packs', p.packs.reduce((n, k) => n + k.redeem.length, 0), burns.length],
    ['appointments (fill-tagged)', p.appointments.length, `${tagged.length} ${status}`],
    ['appointments of the store (all)', '', appts.length],
    ['karuteRecords of the store (all)', p.karutes.length, karutes.length],
  ]
}

/** Counts per section of a plan, plus the shape numbers a reader checks at a glance. */
export function summarize(p: Plan, today: string, hours: WeeklyHours) {
  const by = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {})
  const visits = Object.values(by(p.appointments, (a) => a.member)).sort((a, b) => a - b)
  let days = 0
  for (let d = p.window.from; d <= p.window.to; d = addDays(d, 1)) days += hoursOn(hours, d) ? 1 : 0
  const full = p.packs.filter((k) => k.redeem.length === k.size).length
  return {
    window: `${p.window.from} … ${p.window.to} (today ${today})`, staff: p.staff.length, resources: p.resources.length, menus: p.menus.length,
    customers: p.customers.length, packs: `${p.packs.length} (${full} fully used)`, redemptions: p.packs.reduce((n, k) => n + k.redeem.length, 0),
    appointments: `${p.appointments.length} ${JSON.stringify(by(p.appointments, (a) => a.status))}`,
    perOpenDay: (p.appointments.length / days).toFixed(1), visitsPerCustomer: `min ${visits[0]} · median ${visits[visits.length >> 1]} · max ${visits[visits.length - 1]}`,
    karuteRecords: p.karutes.length,
  }
}

// ── CLI (lazy client import, so the test loads this file under CommonJS ts-node) ───────────────
if (process.argv[1]?.endsWith('fill.ts')) {
  const [cmd, ...rest] = process.argv.slice(2)
  const flag = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
  const [type, path, dry, today] = [flag('--type'), flag('--manifest'), rest.includes('--dry-run'), jstToday()]
  const load = (): Manifest => (path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { businessId: DEV_SALON_BUSINESS_ID, stores: {}, runs: [] })
  const main = async (): Promise<number> => {
    const targets = Object.entries(registry.stores).filter(([, t]) => (type ? t === type : registry.types[t]?.recipe))
    if (cmd === 'plan') {
      const m = load()
      for (const [storeId, t] of targets) {
        const r = await loadRecipe(t)
        const st = m.stores[storeId]
        const hours = st?.weeklyHours ?? r.policy.weekly_hours
        console.log(storeId, t, JSON.stringify(summarize(plan(r, storeCtx(storeId, { weeklyHours: hours }), today, st?.epoch ?? today), today, hours), null, 1))
      }
      return 0
    }
    if (cmd !== 'apply' || !type || !path) {
      console.log('usage: fill.ts plan [--type <id>] [--manifest <path>] | apply --type <id> --manifest <path> [--dry-run]')
      return 1
    }
    const { SYNQED_CORE_URL: baseUrl, SYNQED_CORE_API_KEY: apiKey } = process.env
    if (!baseUrl || !apiKey) throw new Error('set SYNQED_CORE_URL and SYNQED_CORE_API_KEY first (values are never printed)')
    const { SynqedClient } = await import('@synqed-kk/client')
    const core = new SynqedClient({ baseUrl, apiKey, businessId: DEV_SALON_BUSINESS_ID })
    const m = load()
    if (m.businessId !== DEV_SALON_BUSINESS_ID) throw new Error('the manifest is not a Dev Salon manifest')
    const recipe = await loadRecipe(type)
    let code = 0
    try {
      for (const [storeId] of targets) code = Math.max(code, await apply(core, { recipe, storeId, manifest: m, today, dry, log: console.log, readBack: true }))
    } finally {
      if (!dry) writeFileSync(path, JSON.stringify(m, null, 1) + '\n')
    }
    if (!dry) console.log(`manifest: ${path}`)
    return code
  }
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error('fill failed:', message(e))
      process.exit(1)
    },
  )
}
