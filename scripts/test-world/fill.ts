// fill.ts — the test-world FILL LOADER: makes a Dev Salon test store look like a real business of its
// type (registry.json maps store → type; recipes/<type>.ts holds the data; plan.ts turns it into rows).
//
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/fill.ts <cmd>
//     plan  --store <uuid|all> [--rows] [--type <id>] [--manifest <path>]           counts per section, no network
//     apply --store <uuid|all> --manifest <path> [--dry-run]  live; --dry-run does every READ and writes nothing
//   CADENCE: re-run `apply` WEEKLY. The window is epoch − pastDays … today + futureDays; a re-run only
//   adds the days that appeared since (the top-up). Rows are matched by stable keys, so a re-run of
//   an unchanged window creates 0.
//
// It ADDS and never takes away: no delete call, and no edit of an existing row's fields — Liam's own changes in
// Business survive every top-up. Two exceptions: staffStores.set, used only to ADD this store to a staff member's
// list (the list already there is kept); and the status of today's still-予約済み loader bookings (non-legacy, no
// person set it), written through close-out.ts's setPlannedStatus — this file itself has no update call.
//
// Why it does NOT import scripts/lib/core-target-guard.ts: that guard refuses every non-local core
// because it protects a DELETING seeder (seed-booking-data.ts). This loader targets the shared core on
// purpose and deletes nothing. Its guard is the Dev Salon pin instead: the client is built with the hard
// Dev Salon business id, core must resolve that business (orgSettings) and hold the dev@karute.test
// card (count-baseline's assertDevSalon) — checked before any write — and the store must be mapped in
// registry.json. Never wire this into e2e/global-setup.ts or any npm script that runs by itself.
//
// Env: SYNQED_CORE_URL, SYNQED_CORE_API_KEY (values are never printed). The manifest holds ids only.
// Exit: 0 ok · 1 error (or core's database full) · 2 REFUSED (pin, or a bad throttle flag) · 4 unexpected 409s > 0.
// Throttle (S90): every core request passes ONE limiter — `--concurrency <1–4>` in flight (default 1), `--pause-ms <n>`
// between request starts (default 150; 0 only with `--no-pause`). The first EMAXCONN error stops all requests.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Appointment, SynqedClient, WeeklyHours } from '@synqed-kk/client'
import { isTerminalStatus } from '../../src/lib/appointments/status'
import { assertDevSalon, DEV_EMAIL, DEV_SALON_BUSINESS_ID, pageAll, Refused } from './count-baseline'
import { setPlannedStatus, todayStatusFixes } from './close-out'
import { namePoolFor, STAFF_NAMES } from './names'
import { addDays, bookingNotes, hoursOn, jstIso, plan, rng, type Plan, type Realism, type Recipe, type RecipeData, type StoreCtx } from './plan'

export type FillCore = Pick<
  SynqedClient,
  'orgSettings' | 'stores' | 'staff' | 'staffStores' | 'storePolicies' | 'resources' | 'menus' | 'customers' | 'packs' | 'appointments' | 'karuteRecords'
>
type Section = 'storePolicies' | 'staff' | 'staffStores' | 'resources' | 'menus' | 'customers' | 'packs' | 'appointments' | 'karuteRecords' | 'redemptions' | 'todayStatus'
interface Run { at: string; type: string; store: string; today: string; created: Partial<Record<Section, number>>; skipped: string[]; conflicts409: string[]; errors: string[] }
export interface Manifest {
  businessId: string
  // realismFrom: set by realism.ts --apply — the first day the plan follows the type's realism recipe (see plan.ts)
  stores: Record<string, { type: string; epoch: string; pastDays?: number; legacyThrough?: string | null; weeklyHours: WeeklyHours; realismFrom?: string; created: Partial<Record<Section, Record<string, string>>> }>
  runs: Run[]
}
interface Registry {
  types: Record<string, { label: string; sections: string[]; recipe: Recipe['counts'] | null; realism?: Realism }>
  // identityIndex: ⚖ G3 (S87) the store's FIXED identity slot (staff names, member series, phones) — never its position in this map
  stores: Record<string, { type: string; keyPrefix: string; namePool: number; identityIndex: number }>
  pastDays: number
  futureDays: number
  slotMinutes: Record<string, number>
  cancelReasons: Record<string, number>
}

export const registry: Registry = JSON.parse(readFileSync(join(__dirname, 'registry.json'), 'utf8'))

/** The recipe for a registry type: data from recipes/<id>.ts, counts and realism values from registry.json. */
export async function loadRecipe(id: string, storeId = targetsFor(undefined, id)[0], recordedPastDays?: number): Promise<Recipe> {
  const counts = registry.types[id]?.recipe
  if (!/^[a-z_]+$/.test(id) || !counts) throw new Error(`type ${id} has no recipe in registry.json`)
  const mod = (await import(`./recipes/${id}`)) as { recipe: RecipeData }
  const entry = registry.stores[storeId]
  if (!entry || entry.type !== id) throw new Error(`store ${storeId} is not mapped to ${id}`)
  const data = mod.recipe
  const size = counts.customers
  const original = entry.keyPrefix === id
  // ⚖ G3 (S87): identities derive from the store's fixed identityIndex (registry.json), never from its position in the map —
  // reordering or inserting stores never changes a saved member number, staff name or phone
  const storeIndex = entry.identityIndex
  if (!Number.isInteger(storeIndex) || storeIndex < 0 || (storeIndex + 1) * data.staff.length > STAFF_NAMES.length || Object.entries(registry.stores).some(([sid, s]) => sid !== storeId && s.identityIndex === storeIndex))
    throw new Error(`store ${storeId}: registry.json identityIndex must be a non-negative integer no other store carries, inside the staff-name pool`)
  // ⚖ R6/Q2: an applied store sizes its window AND its 新規 first visits by the pastDays its manifest recorded; registry.json only for a new store
  const pastDays = recordedPastDays ?? registry.pastDays ?? 105
  const legacyCount = original ? data.customers.length : 0
  // ⚖ R9: the type's surname × given-name pool (names.ts), seeded order, a disjoint slice per store
  const names = namePoolFor(id).slice(entry.namePool * size, (entry.namePool + 1) * size) // never a hand-written customer's name, of any type
  if (names.length !== size) throw new Error(`recipe ${id}: name pool too short for store ${storeId}`)
  const practitioners = data.staff.filter((s) => s.role !== 'ASSISTANT')
  // ⚖ R8: a generated store's staff are plain names from its own slice of STAFF_NAMES (disjoint by identityIndex)
  const staffOf = new Map(data.staff.map((s, i) => [s.name, original ? s.name : STAFF_NAMES[storeIndex * data.staff.length + i]]))
  const series = data.customers[0].member.split('-')[0]
  const pad = (n: number, w = 4) => String(n).padStart(w, '0')
  const member = (i: number) => (original ? `${series}-${pad(i + 1)}` : `${series}${storeIndex + 1}-${pad(i + 1)}`)
  const customers: Recipe['customers'] = names.map(([name, kana, gender], i) => {
    if (i < legacyCount) return data.customers[i]
    const r = rng(`${entry.keyPrefix}|customer|${i}`)
    const t = rng(`${entry.keyPrefix}|template|${i}`)
    const templates = data.customers.filter((c) => c.gender === gender)
    // the first thirty keep their template by index (the 回数券 holders' menus); the rest pick theirs by seed
    const c = i < data.customers.length && data.customers[i].gender === gender ? data.customers[i] : templates[Math.floor(t() * templates.length)]
    const [lo, hi] = data.profile!.cadence
    const every = lo + Math.floor(r() * (hi - lo + 1))
    const menus = data.menus.filter((m) => m.duration >= data.profile!.menuMinutes[0] && m.duration <= data.profile!.menuMinutes[1])
    const usual = menus.find((m) => m.name === c.menu) ?? menus[i % menus.length]
    const alt = menus.find((m) => m.name === c.alt) ?? usual
    const staff = practitioners.find((s) => s.name === c.staff) ?? practitioners[i % practitioners.length]
    const birth = `${Number(c.birth.slice(0, 4)) + Math.floor(t() * 9) - 4}-${pad(1 + Math.floor(t() * 12), 2)}-${pad(1 + Math.floor(t() * 28), 2)}`
    return { ...c, member: member(i), name, kana, gender, birth, staff: staffOf.get(staff.name)!, menu: usual.name, alt: alt.name,
      every, start: Math.floor(r() * every), isNew: false,
      phone: `090-0000-${String(4000 + storeIndex * 700 + i + 1).padStart(4, '0')}`, email: `${id}.${entry.namePool}.${i + 1}@example.jp` }
  })
  // ⚖ R10: 9 % of every store's members are 新規 — their first visit (the 初回 menu) falls inside the window
  const holders = new Set(data.packs.map((p) => data.customers.findIndex((c) => c.member === p.member)))
  const owed = Math.round(size * 0.09) - customers.filter((c) => c.isNew).length
  const fresh = customers.map((_, i) => ({ i, w: rng(`${entry.keyPrefix}|new|${i}`)() })).filter(({ i }) => i >= legacyCount && !holders.has(i))
    .sort((a, b) => a.w - b.w).slice(0, Math.max(0, owed))
  for (const { i } of fresh) customers[i] = { ...customers[i], isNew: true, start: Math.floor(rng(`${entry.keyPrefix}|new-start|${i}`)() * (pastDays + registry.futureDays)) }
  return { ...data, id, storeId, customers, staff: data.staff.map((s) => ({ ...s, name: staffOf.get(s.name)! })),
    packs: data.packs.map((p) => ({ ...p, member: member(data.customers.findIndex((c) => c.member === p.member)) })),
    counts: { ...counts, pastDays, futureDays: registry.futureDays },
    addedStaff: data.addedStaff?.map((n) => staffOf.get(n)!),
    legacyMembers: original ? data.customers.map((c) => c.member) : [], legacyPastDays: counts.pastDays,
    realism: registry.types[id].realism }
}

/** What plan() needs of one store: its hours snapshot (manifest), booking step (registry.json) and realismFrom (manifest). */
/** ⚖ E2: the last day the pre-FILL-2 planner already wrote for a store = its latest recorded run's today + futureDays; null = none. */
export const lastWindowEnd = (runs: readonly { store: string; today: string }[], storeId: string): string | null =>
  runs.filter((r) => r.store === storeId).map((r) => addDays(r.today, registry.futureDays)).sort().pop() ?? null

export const storeCtx = (storeId: string, st: { weeklyHours: WeeklyHours; realismFrom?: string; pastDays?: number; legacyThrough?: string | null }, runs: readonly { store: string; today: string }[] = []): StoreCtx => {
  // ⚖ R6: an applied store plans from the pastDays its manifest recorded at first apply; a differing registry value is logged and ignored
  if (st.pastDays !== undefined && st.pastDays !== registry.pastDays) console.warn(`store ${storeId}: manifest pastDays ${st.pastDays} kept, registry.json pastDays ${registry.pastDays} ignored`)
  return { storeId, weeklyHours: st.weeklyHours, slotMinutes: registry.slotMinutes[storeId], keyPrefix: registry.stores[storeId]?.keyPrefix, realismFrom: st.realismFrom, pastDays: st.pastDays,
    legacyThrough: st.legacyThrough !== undefined ? st.legacyThrough : lastWindowEnd(runs, storeId) } // unrecorded: derived from the runs
}

/** --type is the original store alias; --store all preserves registry order. Unknown selectors fail closed. */
export function targetsFor(store?: string, type?: string): string[] {
  if (store && type) throw new Error('choose --store or --type, not both')
  if (type) {
    const original = Object.keys(registry.stores).find((id) => registry.stores[id].type === type && registry.stores[id].keyPrefix === type)
    if (!original) throw new Error(`unknown type ${type}`)
    return [original]
  }
  if (!store || store === 'all') return Object.keys(registry.stores)
  if (!Object.hasOwn(registry.stores, store)) throw new Error(`unmapped store ${store}`)
  return [store]
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
      if (e instanceof Saturated || attempt >= 5 || !(s === 429 || (write !== 'unkeyed' && (s ?? 0) >= 500) || (s === undefined && !write))) throw e
      await wait(500 * 2 ** attempt)
    }
  }
}

export interface Throttle { concurrency: number; pauseMs: number }
export const DEFAULT_THROTTLE: Throttle = { concurrency: 1, pauseMs: 150 }
export const SATURATED_LINE = "core's database is at its connection limit — stopped. Check core answers before resuming."
/** Thrown by the limiter once core's database reported it is full; no request starts after it. */
export class Saturated extends Error {}
// the text may sit in the message, the error code or the JSON body (SynqedError keeps code and body apart)
const isSaturated = (e: unknown) => ((x) => /EMAXCONN|max client connections|max clients reached|too many clients/i.test(`${message(e)} ${x?.code ?? ''} ${JSON.stringify(x?.body ?? '')}`))(e as { code?: unknown; body?: unknown } | null)

/** The CLI's throttle flags; a string is the refusal (exit 2, before any core call). */
export function parseThrottle(argv: string[]): Throttle | string {
  const val = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? '' : undefined)
  const int = (s: string | undefined, d: number) => (s === undefined ? d : /^\d+$/.test(s) ? Number(s) : NaN)
  const noPause = argv.includes('--no-pause')
  const t = { concurrency: int(val('--concurrency'), DEFAULT_THROTTLE.concurrency), pauseMs: int(val('--pause-ms'), noPause ? 0 : DEFAULT_THROTTLE.pauseMs) }
  if (!(t.concurrency >= 1 && t.concurrency <= 4)) return `--concurrency must be a whole number from 1 to 4 (got ${val('--concurrency')})`
  if (!Number.isInteger(t.pauseMs)) return `--pause-ms must be a whole number of milliseconds (got ${val('--pause-ms')})`
  if (t.pauseMs > 60_000) return `--pause-ms above 60000 is refused (got ${t.pauseMs}; Node's timer overflows near 2^31 ms)`
  if (noPause && t.pauseMs !== 0) return '--no-pause and a non-zero --pause-ms contradict each other'
  if (t.pauseMs === 0 && !noPause) return '--pause-ms 0 needs --no-pause as well'
  return t
}

export type Limiter = ReturnType<typeof limiter>
/** At most `concurrency` requests in flight, `pauseMs` at least between two request starts, and a stop on a full database. */
export function limiter(t: Throttle, sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now) {
  let active = 0
  let last = -Infinity
  let gate: Promise<unknown> = Promise.resolve()
  const queue: (() => void)[] = []
  const lim = {
    ...t,
    stopped: false,
    hardStop: false, // set by apply() when the stop came before the read-back: the run's exit is 1
    async run<T>(fn: () => Promise<T>): Promise<T> {
      while (active >= t.concurrency) await new Promise<void>((r) => queue.push(r))
      active++
      try {
        const turn = gate.then(async () => {
          const gap = last + t.pauseMs - now()
          if (gap > 0 && !lim.stopped) await sleep(gap)
          last = now()
        })
        gate = turn
        await turn
        if (lim.stopped) throw new Saturated('stopped: core\'s database is at its connection limit')
        try {
          return await fn()
        } catch (e) {
          if (!isSaturated(e)) throw e
          lim.stopped = true
          throw new Saturated(message(e))
        }
      } finally {
        active--
        queue.shift()?.()
      }
    },
  }
  return lim
}

/** The same client, every method call routed through the limiter (namespaces one level deep, like the SDK). */
function throttled<C extends object>(core: C, lim: Limiter): C {
  const wrap = <O extends object>(o: O, depth: number): O => new Proxy(o, {
    get(target, key) {
      const v = Reflect.get(target, key)
      if (typeof v === 'function') return (...args: unknown[]) => lim.run(() => v.apply(target, args))
      return depth && v && typeof v === 'object' ? wrap(v, depth - 1) : v
    },
  })
  return wrap(core, 1)
}

export async function poolOf<T>(items: T[], fn: (x: T) => Promise<void>, size: number) {
  let i = 0
  // every worker settles first (no late write after apply returns), then the first failure is thrown — a full database first
  const settled = await Promise.allSettled(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
  const failed = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []))
  if (failed.length) throw failed.find((e) => e instanceof Saturated) ?? failed[0]
}

export interface ApplyOpts { recipe: Recipe; storeId: string; manifest: Manifest; today: string; dry: boolean; log: (l: string) => void; wait?: (ms: number) => Promise<unknown>; readBack?: boolean
  limiter?: Limiter } // default: DEFAULT_THROTTLE, pausing with `wait`

/** One store of one type. Mutates opts.manifest (the caller saves it, even after a throw). */
export async function apply(raw: FillCore, o: ApplyOpts): Promise<number> {
  const { recipe, storeId, today, dry, log } = o
  if (o.manifest.businessId !== DEV_SALON_BUSINESS_ID) throw new Error('the manifest is not a Dev Salon manifest')
  const lim = o.limiter ?? limiter(DEFAULT_THROTTLE, o.wait)
  if (!Number.isInteger(lim.concurrency) || lim.concurrency < 1 || lim.concurrency > 4 || !Number.isInteger(lim.pauseMs) || lim.pauseMs < 0 || lim.pauseMs > 60_000) {
    log(`REFUSED: throttle ${lim.concurrency} in flight / ${lim.pauseMs} ms is outside 1–4 in flight, 0–60000 ms`)
    return 2
  }
  const core = throttled(raw, lim)
  const pool = <T,>(items: T[], fn: (x: T) => Promise<void>) => poolOf(items, fn, lim.concurrency)
  const read = <T,>(fn: () => Promise<T>) => withRetry(fn, false, o.wait)
  let cards: Awaited<ReturnType<typeof assertDevSalon>>
  try {
    cards = await assertDevSalon(core)
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    log(`REFUSED: ${e.message}`)
    return 2
  }
  if (registry.stores[storeId]?.type !== recipe.id) throw new Error(`store ${storeId} is not mapped to ${recipe.id} in registry.json`)
  if (recipe.storeId && recipe.storeId !== storeId) throw new Error(`recipe was prepared for store ${recipe.storeId}, not ${storeId}`)
  const { stores } = await read(() => core.stores.list())
  if (!stores.some((s) => s.id === storeId)) throw new Error(`store ${storeId} is not in core`)
  const dev = cards.find((s) => s.email?.toLowerCase() === DEV_EMAIL)!

  const m = o.manifest
  const policy = await read(() => core.storePolicies.get(storeId))
  const prior = m.stores[storeId]
  if (prior && prior.type !== recipe.id) throw new Error(`manifest type ${prior.type} ≠ registry type ${recipe.id}`)
  const st = prior ?? { type: recipe.id, epoch: today, pastDays: registry.pastDays ?? 105, legacyThrough: null, weeklyHours: policy.source === 'default' ? recipe.policy.weekly_hours : policy.weekly_hours ?? recipe.policy.weekly_hours, created: {} }
  if (!dry) m.stores[storeId] = st
  if (!dry && st.pastDays === undefined) st.pastDays = registry.pastDays ?? 105 // ⚖ R6: recorded once, at the first apply of this code
  // ⚖ E2: recorded once, at the first apply of this code, from the runs before it (a new entry records null above)
  if (st.legacyThrough === undefined) st.legacyThrough = lastWindowEnd(m.runs, storeId)
  const run: Run = { at: new Date().toISOString(), type: recipe.id, store: storeId, today, created: {}, skipped: [], conflicts409: [], errors: [] }
  if (!dry) m.runs.push(run)
  let sent = 0
  const summary = () => {
    log(`${dry ? 'would create' : 'created'}: ${JSON.stringify(run.created)} · writes sent: ${sent}`)
    run.skipped.forEach((l) => log(`skipped: ${l}`))
    ;[...run.conflicts409, ...run.errors].forEach((l) => log(`FAILED: ${l}`))
  }

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
      if (e instanceof Saturated) throw e
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
    // makes its own tagged one beside it. ⚖ F2 (S88): the window is business-wide (every store, like close-out.ts) so the
    // staff clash sees the same practitioner's bookings at another store; ownership (mine) stays this store's rows only.
    const window = await read(() => pageAll('appointments', (page) => core.appointments.list({ from: jstIso(p.window.from, 0), to: jstIso(addDays(p.window.to, 1), 0), page, page_size: 500 })))
    const mine = new Map<string, Appointment>()
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
    const ownedRows: { row: Appointment; planned: Plan['appointments'][number]; staffId: string }[] = []
    await pool(p.appointments, async (a) => {
      const [cid, sid, rid, mid] = [custId.get(a.member), staffId.get(a.staff), resId.get(a.resource), menuOf.get(a.menu)]
      if (!cid && binned.has(a.member)) return void run.skipped.push(`appointments ${a.key}: customer ${a.member} is in the bin`)
      if (!cid || !sid || !rid || !mid) return void run.skipped.push(`appointments ${a.key}: missing customer/staff/bed/menu`)
      const have = mine.get(a.key)
      // the booking's customer differs from the planned customer: the loader leaves it alone, never written against
      if (have && have.customer_id !== cid) return void run.skipped.push(`appointments ${a.key}: booking ${have.id}'s customer differs from the planned customer, left alone`)
      if (have) {
        if (!dry) (st.created.appointments ??= {})[a.key] = have.id
        ownedRows.push({ row: have, planned: a, staffId: sid })
        return void apptRow.set(a.key, have)
      }
      const other = clash(a, sid, rid)
      if (other) return void run.skipped.push(`appointments ${a.key}: overlaps existing booking ${other.id}`)
      const row = await write('appointments', a.key, () => core.appointments.create({
        customer_id: cid, staff_id: sid, store_id: storeId, menu_id: mid, resource_id: rid, starts_at: a.startsAt, ends_at: a.endsAt,
        duration_minutes: a.duration, booked_price_amount: a.booked_price, booked_price_currency: 'JPY', status: a.status, source: 'MANUAL',
        // Create has no status_reason in this SDK; realism.ts writes the reason and its label together later.
        // ⚖ G-P2 (S88): no status_reason is saved by this create, so no cancel label either (realism.ts writes both, together)
        title: null, notes: bookingNotes({ ...a, cancelReason: null }),
      }, { idempotencyKey: `test-world:${a.key}` }))
      if (row?.id) apptRow.set(a.key, { id: row.id, status: (row as { status?: string }).status ?? a.status })
    })

    // ⚖ G1 (S87): today's owned rows still SCHEDULED take the plan's status, on EVERY run (the board's live session is
    // not a first-fill-only state). The write is close-out.ts's one status write; this file still has no update call.
    for (const { row, planned } of todayStatusFixes(ownedRows, recipe, today, run.skipped)) {
      run.created.todayStatus = (run.created.todayStatus ?? 0) + 1
      if (dry) continue
      try {
        sent++
        await withRetry(() => setPlannedStatus(core, row, planned.status), 'keyed', o.wait) // an update restated is the same update
        apptRow.set(planned.key, { id: row.id, status: planned.status })
      } catch (e) {
        run.created.todayStatus!--
        if (e instanceof Saturated) throw e
        run.errors.push(`todayStatus ${planned.key}: ${message(e)}`)
      }
    }

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
      const redeemed = pid.startsWith('dry:') ? [] : await read(() => core.packs.listRedemptions(cid))
      const burnt = new Set(redeemed.map((r) => `${r.pack_id}|${r.redeemed_on}`))
      let used = redeemed.filter((r) => r.pack_id === pid).length // ⚖ Q7: every burn counts, a same-day double burn too (never distinct dates)
      for (const key of k.redeem) {
        if (used >= k.size) break // ⚖ R5: never more burns than the pack holds (never 6 on a 5)
        const aid = done(key)
        if (!aid || burnt.has(`${pid}|${dateOf.get(key)}`)) continue
        await write('redemptions', key, () => core.packs.addRedemption({
          pack_id: pid, customer_id: cid, redeemed_on: dateOf.get(key)!, appointment_id: aid, source: 'manual', created_by: staffId.get(k.staff) ?? null,
        }, { idempotencyKey: `test-world:${key}:redeem` }))
        used++
      }
    })

    summary()
    // The read-back is a diagnostic: its failure never changes the exit code.
    if (o.readBack) {
      try {
        (await withRetry(() => readBack(core, storeId, p, lim.concurrency), false, o.wait)).forEach((r) => log(r.join(' | ')))
      } catch (e) {
        log(e instanceof Saturated ? SATURATED_LINE : `read-back failed (writes unaffected): ${message(e)}`)
      }
    }
    return run.conflicts409.length ? 4 : run.errors.length ? 1 : 0
  } catch (e) {
    // A first run that failed before any write leaves no epoch behind (no row exists on its dates yet);
    // once a write was sent, the epoch stays — rows may exist on those dates.
    if (!prior && sent === 0) delete m.stores[storeId]
    if (!(e instanceof Saturated)) throw e
    lim.hardStop = true
    run.errors.push(`stopped: ${message(e)}`) // S90: core's database is full — the rest of this run is skipped
    summary() // what was written before the stop: the resume needs these counts
    log(SATURATED_LINE)
    return 1
  }
}

/** What core holds for this store now, per section, beside the plan (reads only). */
async function readBack(core: FillCore, storeId: string, p: Plan, size: number): Promise<(string | number)[][]> {
  // the per-customer reads, `size` at a time (the limiter's setting), results kept in input order
  const each = async <T, R>(xs: T[], fn: (x: T) => Promise<R[]>) => {
    const out: R[][] = []
    await poolOf(xs.map((x, i) => [x, i] as const), async ([x, i]) => void (out[i] = await fn(x)), size)
    return out.flat()
  }
  const members = new Set(p.customers.map((c) => c.member))
  const [policy, links, res, { menus }, customers, appts, karutes] = await Promise.all([
    core.storePolicies.get(storeId), core.staffStores.counts(), core.resources.list({ store_id: storeId }), core.menus.list(),
    pageAll('customers', (page) => core.customers.list({ include_deleted: true, page, page_size: 500 })),
    pageAll('appointments', (page) => core.appointments.list({ store_id: storeId, page, page_size: 500 })),
    pageAll('karute_records', (page) => core.karuteRecords.list({ store_id: storeId, page, page_size: 200 })),
  ])
  const ours = customers.filter((c) => members.has(c.member_number ?? ''))
  const packs = await each(ours, (c) => core.packs.listPacks(c.id))
  const burns = await each([...new Set(packs.map((k) => k.customer_id))], (id) => core.packs.listRedemptions(id))
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
export interface CliIo { log?: (...l: unknown[]) => void; sleep?: (ms: number) => Promise<unknown>; now?: () => number; today?: string }
/** The command line, testable: `makeClient` is called only once every flag has passed (the real one checks the env there). */
export async function runCli(argv: string[], makeClient: () => Promise<FillCore>, io: CliIo = {}): Promise<number> {
  const log = io.log ?? console.log
  const [cmd, ...rest] = argv
  const flag = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
  const [store, type, path, dry, today] = [flag('--store'), flag('--type'), flag('--manifest'), rest.includes('--dry-run'), io.today ?? jstToday()]
  const load = (): Manifest => (path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { businessId: DEV_SALON_BUSINESS_ID, stores: {}, runs: [] })
  const targets = targetsFor(store, type)
  if (cmd === 'plan') {
    const m = load()
    for (const storeId of targets) {
      const t = registry.stores[storeId].type
      const st = m.stores[storeId]
      const r = await loadRecipe(t, storeId, st?.pastDays)
      const hours = st?.weeklyHours ?? r.policy.weekly_hours
      const p = plan(r, storeCtx(storeId, { weeklyHours: hours, realismFrom: st?.realismFrom, pastDays: st?.pastDays, legacyThrough: st?.legacyThrough }, m.runs), today, st?.epoch ?? today)
      log(storeId, t, JSON.stringify(summarize(p, today, hours), null, 1))
      if (rest.includes('--rows')) for (const a of p.appointments)
        log([a.date, a.startsAt, a.endsAt, a.staff, a.resource, a.menu, a.booked_price, a.status, a.key].join(' · '))
    }
    return 0
  }
  if (cmd !== 'apply' || (!store && !type) || !path) {
    log('usage: fill.ts plan [--store <uuid|all> | --type <id>] [--manifest <path>] [--rows] | apply (--store <uuid|all> | --type <id>) --manifest <path> [--dry-run] [--concurrency <1–4>] [--pause-ms <n> | --no-pause]')
    return 1
  }
  const throttle = parseThrottle(rest)
  if (typeof throttle === 'string') {
    log(`REFUSED: ${throttle}`)
    return 2 // before any core call
  }
  log(`throttle: ${throttle.concurrency} in flight, ${throttle.pauseMs} ms between requests`)
  const lim = limiter(throttle, io.sleep, io.now)
  const core = await makeClient()
  const m = load()
  if (m.businessId !== DEV_SALON_BUSINESS_ID) throw new Error('the manifest is not a Dev Salon manifest')
  let code = 0
  try {
    for (const [i, storeId] of targets.entries()) {
      const recipe = await loadRecipe(registry.stores[storeId].type, storeId, m.stores[storeId]?.pastDays)
      let result: number
      try {
        result = await apply(core, { recipe, storeId, manifest: m, today, dry, log, readBack: true, limiter: lim })
      } catch (e) {
        if (!(e instanceof Saturated)) throw e
        log(SATURATED_LINE) // a full database before this store's run began
        lim.hardStop = true
        result = 1
      }
      if (result === 2) return 2 // a refusal stops the whole run, including --store all
      code = Math.max(code, result)
      if (lim.stopped) { // core's database is full: no later store is started
        if (i + 1 < targets.length) log(`not started (core's database is full): ${targets.slice(i + 1).join(', ')}`)
        break
      }
    }
  } finally {
    if (!dry) writeFileSync(path, JSON.stringify(m, null, 1) + '\n')
  }
  if (!dry) log(`manifest: ${path}`)
  return lim.hardStop ? 1 : code // a write-phase stop exits 1, even after an earlier store's 409s (4)
}

if (process.argv[1]?.endsWith('fill.ts')) {
  const makeClient = async (): Promise<FillCore> => {
    const { SYNQED_CORE_URL: baseUrl, SYNQED_CORE_API_KEY: apiKey } = process.env
    if (!baseUrl || !apiKey) throw new Error('set SYNQED_CORE_URL and SYNQED_CORE_API_KEY first (values are never printed)')
    const { SynqedClient } = await import('@synqed-kk/client')
    return new SynqedClient({ baseUrl, apiKey, businessId: DEV_SALON_BUSINESS_ID })
  }
  runCli(process.argv.slice(2), makeClient).then(
    (code) => { process.exitCode = code },
    (e) => {
      console.error('fill failed:', message(e))
      process.exitCode = 1
    },
  )
}
