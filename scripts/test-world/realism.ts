// realism.ts — THE REALISM PASS on the loader's own bookings (Liam 9/25: 「make them look real … think in the business
// shoes」). fill.ts only ADDS (its static test forbids an update call); this script CHANGES existing rows, so it lives
// apart, like close-out.ts. Per managed store (registry.json), on loader-owned bookings only:
//   · notes — the tag stays first (every reader: /\[(tw:[^\]]+)\]/ or '[tw:'), the booking's ご要望 line follows on the
//     next line (plan.ts requestFor: a function of the key, so fill.ts writes the same line on the rows it makes later)
//   · status — past bookings reach the type's cancel / no-show rates (registry.json realism): a COMPLETED one with no
//     karute and no 回数券 burn becomes CANCELLED / NO_SHOW (never the reverse); the future holds 1–2 per store
//     cancelled with advance contact
//   · status_reason — ⚖ the 7/10 taxonomy: every loader CANCELLED carries a cancel code (a burnt one: same-day contact,
//     the only cancel reason a burn may pair with), every NO_SHOW no-show-no-contact (無断 = no contact, by definition)
//   · the manifest's realismFrom — the first day plan() follows the realism recipe (rhythm, 指名, rates): the day after
//     the last one any run has planned, so no existing booking moves
//   · duration_minutes — a null one → the booked span, only with --repair-foreign (every null in these stores is a
//     SYNQED Reserve booking: Reserve's create sends no duration_minutes — its defect, not the loader's)
// Never: a delete; a row of another business or store; a status a person set (status_set_by present, other than
// close-out's); a booking whose notes a person edited; staff_id (core refuses a staffless BOOKING and has no 指名 field);
// menu_id (core's update takes none).
//
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/realism.ts <args>
//     --manifest <path> [--store <id>] [--repair-foreign] [--dry-run]     every read, no write: the plan + its hash
//     --manifest <path> --apply --expect <hash> [same flags]            exactly that plan: ledger first, then the writes
//     --revert <ledger> [--manifest <path>]                             back to the ledger's old values
// DRY-RUN IS THE DEFAULT. --apply recomputes the plan and refuses unless its hash is the dry-run's; the ledger
// <manifest dir>/ledger/realism-<ts>.json (row, field, old, new) is written BEFORE the first write; each row is read
// again at its write and skipped with one line if it no longer holds the plan's old values. --revert restores
// every field on rows that still hold the ledger's new value; a row changed since is left alone with one line.
// Status writes carry no acting_staff_id: the cancel sheet's 「操作」 line (who + when) stays empty, as on a crawl-set
// row, rather than stamping today on a June booking. Core's own audit (status_source STAFF, status_set_at,
// cancelled_at, the status history) records every write, and --revert does not rewind it.
// Pin (fill.ts's): the client is built on the hard Dev Salon id; assertDevSalon before any booking is read; the
// manifest and ledger must be Dev Salon's; only registry.json stores; a row of another business or store = REFUSED
// before any write. Env: SYNQED_CORE_URL, SYNQED_CORE_API_KEY (never printed).
// Exit: 0 ok · 1 error, a failed write or a skipped row (realismFrom then not advanced) · 2 REFUSED · 3 the plan's hash
// is not --expect.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Appointment, AppointmentStatus } from '@synqed-kk/client'
import {
  CANCEL_REASON_ADVANCE_CONTACT, CANCEL_REASON_SAME_DAY_CONTACT, CANCEL_REASONS, NO_SHOW_REASON_NO_CONTACT,
} from '../../src/lib/appointments/status'
import { assertDevSalon, DEV_SALON_BUSINESS_ID, pageAll, Refused } from './count-baseline'
import { jstToday, loadRecipe, registry, storeCtx, withRetry, type FillCore, type Manifest } from './fill'
import { addDays, bookingNotes, plan, rng, type Plan, type Recipe } from './plan'

export type RealismCore = Pick<FillCore, 'orgSettings' | 'stores' | 'staff' | 'customers' | 'appointments' | 'karuteRecords' | 'packs'>
export type Fields = { notes?: string | null; status?: AppointmentStatus; status_reason?: string | null; duration_minutes?: number | null }
export interface Change { id: string; store: string; key: string | null; old: Fields; set: Fields }
export interface Ledger { businessId: string; at: string; planHash: string; manifest: string | null; changes: Change[]; realismFrom: { store: string; old: string | null; new: string }[] }

const TAG = /\[(tw:[^\]]+)\]/
const jstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10)
/** A status the loader (fill's create, close-out) or this script set — never one a person set in the app. */
const loaderSet = (a: Appointment) => a.status_set_by == null || (a.status_reason ?? '').startsWith('テストデータ')
/** Seeded order: the same rows, the same pick, on every run (the rate sampler). */
const seeded = <T extends { id: string }>(xs: T[], seed: string) => xs.map((x) => ({ x, w: rng(`${seed}|${x.id}`)() })).sort((a, b) => a.w - b.w).map((y) => y.x)
/** Every field of f holds on the row as read (apply's and revert's check before a write). */
const same = (a: Appointment, f: Fields) => (Object.keys(f) as (keyof Fields)[]).every((k) => a[k] === f[k])

export interface StoreInput {
  recipe: Recipe
  storeId: string
  plan: Plan
  rows: Appointment[] // every booking core lists for the store
  custId: Map<string, string> // member number → live customer id
  karuted: Set<string> // appointment ids with a karute
  burnt: Set<string> // appointment ids with a 回数券 burn
  today: string // JST
  lastPlanned: string // the furthest day any run has planned for the store
  realismFrom: string | null // the manifest's now
  repairForeign: boolean
}

/** The pure plan of one store's realism pass: which fields change on which rows, and what is held back (one line each). */
export function planStore(i: StoreInput): { changes: Change[]; held: string[]; owned: number; realismFrom: { old: string | null; new: string } | null } {
  const { recipe, storeId, today } = i
  const real = recipe.realism ?? fail(`recipe ${recipe.id} has no realism block in registry.json`)
  for (const a of i.rows) {
    if (a.business_id !== DEV_SALON_BUSINESS_ID) throw new Refused(`booking ${a.id} belongs to business ${a.business_id}, not the Dev Salon`)
    if (a.store_id !== storeId) throw new Refused(`booking ${a.id} belongs to store ${a.store_id}, not ${storeId}`)
  }
  const planned = new Map(i.plan.appointments.map((a) => [a.key, a]))
  const seen = new Map<string, number>()
  for (const a of i.rows) { const t = TAG.exec(a.notes ?? '')?.[1]; if (t) seen.set(t, (seen.get(t) ?? 0) + 1) }
  const held: string[] = []
  const owned: { a: Appointment; p: Plan['appointments'][number] }[] = []
  for (const a of i.rows) {
    const tag = TAG.exec(a.notes ?? '')?.[1]
    const p = tag ? planned.get(tag) : undefined
    const bare = `テストデータ [${tag}]`
    const why = !tag ? `not a loader booking (source ${a.source})`
      : seen.get(tag)! > 1 ? `its tag ${tag} is on ${seen.get(tag)} bookings`
      : !p ? `${tag} is not in the plan`
      : a.customer_id !== i.custId.get(p.member) ? `its customer differs from the planned customer (${p.member})`
      : a.notes !== bare && a.notes !== bookingNotes(p) ? 'its notes were edited by hand' // any text but the plan's own line
      : null
    if (why) {
      const dur = a.duration_minutes != null ? '' : i.repairForeign ? ' — but its null duration_minutes is set to the booked span (--repair-foreign)'
        : ' — its duration_minutes is null (SYNQED Reserve\'s create sends none); --repair-foreign sets the booked span'
      held.push(`${a.id}: ${why}, left alone${dur}`)
      continue
    }
    owned.push({ a, p: p! })
  }

  // The rows' next state; status moves first (they decide the reasons), notes and durations after.
  const next = new Map<string, Fields>(i.rows.map((a) => [a.id, { status: a.status, status_reason: a.status_reason }]))
  const statusOf = (a: Appointment) => next.get(a.id)!.status!
  const move = (a: Appointment, status: AppointmentStatus) => next.set(a.id, { status, status_reason: a.status_reason })
  const past = owned.filter(({ a, p }) => p.date < today && ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status)).map((x) => x.a)
  const moved = new Set<string>()
  for (const [status, share] of [['NO_SHOW', real.noShowShare], ['CANCELLED', real.cancelShare]] as const) {
    const target = Math.round(share * past.length)
    const have = past.filter((a) => statusOf(a) === status)
    // Above the target stays above: never back to COMPLETED — fill.ts karutes only planned-COMPLETED rows, so a restored
    // visit would show in Karute as a lost karute (⚖ never lose a karute).
    const can = past.filter((a) => statusOf(a) === 'COMPLETED' && !moved.has(a.id) && loaderSet(a) && !i.karuted.has(a.id) && !i.burnt.has(a.id))
    for (const a of seeded(can, `${storeId}|${status}`).slice(0, Math.max(0, target - have.length))) {
      move(a, status)
      moved.add(a.id)
    }
  }
  const [lo, hi] = real.futureCancels
  const futureTarget = lo + Math.floor(rng(`${storeId}|future`)() * (hi - lo + 1))
  const future = owned.filter(({ p }) => p.date > today)
  const futureHave = future.filter(({ a }) => statusOf(a) === 'CANCELLED').length
  const advance = future.filter(({ a, p }) => a.status === 'SCHEDULED' && p.date >= addDays(today, 2) && loaderSet(a)).map((x) => x.a)
  const cancelledAhead = new Set(seeded(advance, `${storeId}|future`).slice(0, Math.max(0, futureTarget - futureHave)).map((a) => a.id))
  for (const a of advance) if (cancelledAhead.has(a.id)) move(a, 'CANCELLED')

  // Reasons (⚖ taxonomy), on every loader-set row whose next status is terminal.
  const mix = Object.entries(registry.cancelReasons)
  for (const { a } of owned) {
    const n = next.get(a.id)!
    if (!loaderSet(a)) continue
    if (n.status === 'NO_SHOW') n.status_reason = NO_SHOW_REASON_NO_CONTACT
    else if (n.status === 'CANCELLED') {
      const valid = (CANCEL_REASONS as readonly string[]).includes(a.status_reason ?? '')
      n.status_reason = i.burnt.has(a.id) ? CANCEL_REASON_SAME_DAY_CONTACT
        : cancelledAhead.has(a.id) ? CANCEL_REASON_ADVANCE_CONTACT
        : valid && a.status === 'CANCELLED' ? a.status_reason
        : ((u) => mix.find(([, w]) => (u -= w) < 0)?.[0] ?? mix[0][0])(rng(`${storeId}|reason|${a.id}`)())
    }
  }

  const changes: Change[] = []
  const repair = new Set(i.repairForeign ? i.rows.map((a) => a.id) : owned.map((x) => x.a.id))
  const pOf = new Map(owned.map(({ a, p }) => [a.id, p]))
  for (const a of i.rows) {
    const [p, n] = [pOf.get(a.id), next.get(a.id)!]
    const old: Fields = {}
    const set: Fields = {}
    if (p && a.notes !== bookingNotes(p)) {
      old.notes = a.notes
      set.notes = bookingNotes(p)
    }
    if (p && (n.status !== a.status || n.status_reason !== a.status_reason)) {
      // core writes status_reason only beside a status (the same one restated when only the reason moves)
      Object.assign(old, { status: a.status, status_reason: a.status_reason })
      Object.assign(set, n)
    }
    if (repair.has(a.id) && a.duration_minutes == null) {
      old.duration_minutes = null
      set.duration_minutes = (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000
    }
    if (Object.keys(set).length) changes.push({ id: a.id, store: storeId, key: p?.key ?? null, old, set })
  }
  const want = addDays(i.lastPlanned, 1)
  return { changes, held, owned: owned.length, realismFrom: i.realismFrom ? null : { old: null, new: want } }
}

export interface RealismOpts {
  manifest: Manifest
  manifestPath: string | null
  stores: string[]
  now: Date
  apply: boolean
  expect?: string
  repairForeign: boolean
  log: (l: string) => void
  saveLedger: (l: Ledger) => void
  wait?: (ms: number) => Promise<unknown>
}

export const planHash = (changes: Change[], realismFrom: Ledger['realismFrom']) =>
  createHash('sha256').update(JSON.stringify({ changes, realismFrom })).digest('hex').slice(0, 16)

const show = (v: unknown) => (typeof v === 'string' ? (v.includes('\n') ? `「${v.slice(v.indexOf('\n') + 1)}」` : v) : String(v))
const cell = (f: keyof Fields, c: Change) => (f === 'notes' ? (c.set.notes!.includes('\n') ? '+ ご要望 line' : '− ご要望 line') : `${show(c.old[f])} → ${show(c.set[f])}`)

/** Every read, the plan per store (printed), then — with apply and the matching hash — the ledger and the writes. */
export async function realism(core: RealismCore, o: RealismOpts): Promise<number> {
  const { log } = o
  const read = <T,>(fn: () => Promise<T>) => withRetry(fn, false, o.wait)
  if (o.manifest.businessId !== DEV_SALON_BUSINESS_ID) return (log('REFUSED: the manifest is not a Dev Salon manifest'), 2)
  try {
    await assertDevSalon(core)
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    return (log(`REFUSED: ${e.message}`), 2)
  }
  const today = jstToday(o.now)
  const names = new Map((await read(() => core.stores.list())).stores.map((s) => [s.id, s.name]))
  const all = await read(() => pageAll('customers', (page) => core.customers.list({ include_deleted: true, page, page_size: 500 })))
  const custId = new Map(all.filter((c) => c.member_number && !(c as { deleted_at?: string | null }).deleted_at).map((c) => [c.member_number!, c.id]))
  const changes: Change[] = []
  const realismFrom: Ledger['realismFrom'] = []
  for (const storeId of o.stores) {
    const type = registry.stores[storeId]
    const st = o.manifest.stores[storeId]
    if (!type) return (log(`REFUSED: store ${storeId} is not a managed test store (registry.json)`), 2)
    if (!st || st.type !== type) throw new Error(`store ${storeId}: not in the manifest as ${type}`)
    const recipe = await loadRecipe(type)
    const p = plan(recipe, storeCtx(storeId, st), today, st.epoch)
    const rows = await read(() => pageAll('appointments', (page) => core.appointments.list({ store_id: storeId, page, page_size: 500 })))
    const karuted = new Set((await read(() => pageAll('karute_records', (page) => core.karuteRecords.list({ store_id: storeId, page, page_size: 200 })))).map((k) => k.appointment_id))
    const burnt = new Set<string>()
    for (const cid of new Set(rows.map((a) => a.customer_id).filter((x): x is string => !!x)))
      // SDK skew: core sends appointment_id (packs.service listRedemptionsByCustomer); the SDK type does not declare it
      for (const b of (await read(() => core.packs.listRedemptions(cid))) as { appointment_id?: string | null }[]) if (b.appointment_id) burnt.add(b.appointment_id)
    const lastPlanned = [...o.manifest.runs.filter((r) => r.store === storeId).map((r) => addDays(r.today, recipe.counts.futureDays)), ...rows.filter((a) => TAG.exec(a.notes ?? '')?.[1].startsWith(`tw:${type}:`)).map((a) => jstDate(a.starts_at))].sort().pop() ?? addDays(st.epoch, recipe.counts.futureDays)
    let out: ReturnType<typeof planStore>
    try {
      out = planStore({ recipe, storeId, plan: p, rows, custId, karuted: karuted as Set<string>, burnt, today, lastPlanned, realismFrom: st.realismFrom ?? null, repairForeign: o.repairForeign })
    } catch (e) {
      if (!(e instanceof Refused)) throw e
      return (log(`REFUSED: ${e.message}`), 2)
    }
    changes.push(...out.changes)
    if (out.realismFrom) realismFrom.push({ store: storeId, ...out.realismFrom })

    // The table: rows touched per field and move, then every row.
    const by = new Map<string, number>()
    for (const c of out.changes) for (const f of Object.keys(c.set) as (keyof Fields)[]) if (c.old[f] !== c.set[f]) by.set(`${f} | ${cell(f, c)}`, (by.get(`${f} | ${cell(f, c)}`) ?? 0) + 1)
    log(`\n## ${names.get(storeId) ?? storeId} · ${storeId} · ${type}`)
    log(`rows read ${rows.length} · loader-owned ${out.owned} · rows touched ${out.changes.length} · today ${today}`)
    log('\n| field | old → new | rows |\n|---|---|---|')
    for (const [k, v] of [...by].sort()) log(`| ${k} | ${v} |`)
    log(`| manifest realismFrom | ${out.realismFrom ? `(none) → ${out.realismFrom.new}` : `${st.realismFrom} (kept)`} | ${out.realismFrom ? 1 : 0} |`)
    if (out.held.length) log(`\nheld:\n${out.held.map((l) => `- ${l}`).join('\n')}`)
    log('\nrows:')
    for (const c of out.changes)
      log(`- ${c.id} ${c.key ?? '(not the loader\'s)'} · ${(Object.keys(c.set) as (keyof Fields)[]).filter((f) => c.old[f] !== c.set[f]).map((f) => (f === 'notes' ? `notes ${show(c.set.notes)}` : `${f} ${cell(f, c)}`)).join(' · ')}`)
  }
  const hash = planHash(changes, realismFrom)
  log(`\nTOTAL rows touched ${changes.length} · manifest realismFrom ${realismFrom.length} · plan hash ${hash}`)
  if (!o.apply) return (log('mode: dry-run (nothing written). Apply exactly this plan: --apply --expect ' + hash), 0)
  if (o.expect !== hash) return (log(`REFUSED: the plan's hash is ${hash}, not --expect ${o.expect ?? '(none)'} — re-run the dry-run and read it`), 3)

  o.saveLedger({ businessId: DEV_SALON_BUSINESS_ID, at: o.now.toISOString(), planHash: hash, manifest: o.manifestPath, changes, realismFrom })
  let [failed, skipped] = [0, 0]
  for (const c of changes) {
    try {
      // read again at the write: a person may have changed the row since the plan (the ledger keeps it; revert's same() leaves it)
      const a = await withRetry(() => core.appointments.get(c.id), false, o.wait)
      if (!same(a, c.old)) { skipped++; log(`skipped (changed since the plan): ${c.id}`); continue }
      await withRetry(() => core.appointments.update(c.id, c.set), 'keyed', o.wait) // a field set is safe to resend
    } catch (e) {
      failed++
      log(`FAILED: ${c.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // realismFrom moves only on a clean apply (the CLI saves the manifest only when it changed)
  const clean = failed === 0 && skipped === 0
  if (clean) for (const r of realismFrom) o.manifest.stores[r.store].realismFrom = r.new
  else if (realismFrom.length) log(`manifest realismFrom NOT advanced (${failed} failed / ${skipped} skipped) — fix, re-run the dry-run, apply again`)
  log(`mode: apply · written ${changes.length - failed - skipped} of ${changes.length} · failed ${failed} · skipped ${skipped}`)
  return clean ? 0 : 1
}

/** Back to the ledger's old values, on rows that still hold its new ones (every row read and fenced before any write). */
export async function revert(core: Pick<RealismCore, 'orgSettings' | 'staff' | 'appointments'>, l: Ledger, manifest: Manifest | null, log: (l: string) => void, wait?: (ms: number) => Promise<unknown>): Promise<number> {
  if (l.businessId !== DEV_SALON_BUSINESS_ID) return (log('REFUSED: the ledger is not a Dev Salon ledger'), 2)
  try {
    await assertDevSalon(core)
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    return (log(`REFUSED: ${e.message}`), 2)
  }
  const rows = new Map<string, Appointment>()
  for (const c of l.changes) {
    const a = await withRetry(() => core.appointments.get(c.id), false, wait)
    if (a.business_id !== DEV_SALON_BUSINESS_ID || a.store_id !== c.store || !registry.stores[c.store]) return (log(`REFUSED: booking ${c.id} is not in managed store ${c.store} of the Dev Salon`), 2)
    rows.set(c.id, a)
  }
  let [done, failed] = [0, 0]
  for (const c of [...l.changes].reverse()) {
    const a = rows.get(c.id)!
    if (same(a, c.old)) { log(`already back: ${c.id}`); continue }
    if (!same(a, c.set)) { log(`changed since the ledger, left alone: ${c.id}`); continue }
    try {
      await withRetry(() => core.appointments.update(c.id, c.old), 'keyed', wait)
      done++
    } catch (e) {
      failed++
      log(`FAILED: ${c.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  for (const r of l.realismFrom) {
    const st = manifest?.stores[r.store]
    if (st?.realismFrom === r.new) st.realismFrom = r.old ?? undefined
    else log(`manifest realismFrom of ${r.store} is not the ledger's (${st ? st.realismFrom ?? 'none' : 'no manifest'}), left alone`)
  }
  log(`revert: restored ${done} · failed ${failed} · of ${l.changes.length}`)
  return failed ? 1 : 0
}

function fail(msg: string): never {
  throw new Error(msg)
}

// ── CLI (lazy client import, so the test loads this file under CommonJS ts-node) ───────────────
if (process.argv[1]?.endsWith('realism.ts')) {
  const args = process.argv.slice(2)
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const [path, ledgerPath, store] = [flag('--manifest'), flag('--revert'), flag('--store')]
  const main = async (): Promise<number> => {
    if (!(ledgerPath ? existsSync(ledgerPath) : path && existsSync(path))) {
      console.log('usage: realism.ts --manifest <path> [--store <id>] [--repair-foreign] [--dry-run] | … --apply --expect <hash> | --revert <ledger> [--manifest <path>]')
      return 1
    }
    const { SYNQED_CORE_URL: baseUrl, SYNQED_CORE_API_KEY: apiKey } = process.env
    if (!baseUrl || !apiKey) throw new Error('set SYNQED_CORE_URL and SYNQED_CORE_API_KEY first (values are never printed)')
    const { SynqedClient } = await import('@synqed-kk/client')
    const core = new SynqedClient({ baseUrl, apiKey, businessId: DEV_SALON_BUSINESS_ID })
    const m: Manifest | null = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
    if (ledgerPath) {
      const before = JSON.stringify(m)
      const code = await revert(core, JSON.parse(readFileSync(ledgerPath, 'utf8')), m, console.log)
      if (m && path && JSON.stringify(m) !== before) writeFileSync(path, JSON.stringify(m, null, 1) + '\n')
      return code
    }
    const stores = store ? [store] : Object.keys(registry.stores)
    const before = JSON.stringify(m)
    try {
      return await realism(core, {
        manifest: m!, manifestPath: path!, stores, now: new Date(), apply: args.includes('--apply'), expect: flag('--expect'), repairForeign: args.includes('--repair-foreign'), log: console.log,
        saveLedger: (l) => {
          const dir = join(dirname(path!), 'ledger')
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `realism-${l.at.replace(/[:.]/g, '-')}.json`)
          writeFileSync(file, JSON.stringify(l, null, 1) + '\n', { flag: 'wx' })
          console.log(`ledger: ${file}`)
        },
      })
    } finally {
      if (JSON.stringify(m) !== before) writeFileSync(path!, JSON.stringify(m, null, 1) + '\n') // only a clean apply sets realismFrom
    }
  }
  main().then((code) => process.exit(code), (e) => (console.error('realism failed:', e instanceof Error ? e.message : String(e)), process.exit(1)))
}
