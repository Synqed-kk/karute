// count-baseline.ts — READ-ONLY count of the Dev Salon test world in core, per store and
// per kind, checked against a saved baseline so a data loss is caught the same day (the
// 9/15–9/20 practice-salon wipe went unnoticed for days). No write call to core anywhere.
//
//   npx tsx scripts/test-world/count-baseline.ts print          counts table + one JSON line
//   npx tsx scripts/test-world/count-baseline.ts write <path>   saves { takenAt, businessId, counts }
//   npx tsx scripts/test-world/count-baseline.ts check <path>   diff vs baseline; exit 3 on any drop
//
// Env: SYNQED_CORE_URL, SYNQED_CORE_API_KEY (values are never printed).
// Exit: 0 ok · 1 error/usage · 2 REFUSED (not Dev Salon) · 3 BASELINE BREACH.
import { readFileSync, writeFileSync } from 'node:fs'
import type { SynqedClient } from '@synqed-kk/client'

// Hard pin: the only business this script will ever count. No flag or env can change it.
export const DEV_SALON_BUSINESS_ID = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
const DEV_EMAIL = 'dev@karute.test'

export type Core = Pick<
  SynqedClient,
  'orgSettings' | 'stores' | 'staff' | 'staffStores' | 'menus' | 'resources' | 'customers' | 'appointments' | 'karuteRecords' | 'recordings' | 'packs'
>
export type Counts = Record<string, Record<string, number | string>>
class Refused extends Error {}

// Pages until a short page. The page size is the server's own `page_size` echo (we ask for
// each route's zod max: staff/karute/recordings 200, customers/appointments 500 — core
// rejects larger, it never clamps silently), so rows < page_size proves the last page.
// ponytail: 1000-page cap, raise it if the test world ever outgrows it.
async function pageAll<K extends string, T>(key: K, fetch: (page: number) => Promise<Record<K, T[]> & { page_size: number }>): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= 1000; page++) {
    const r = await fetch(page)
    out.push(...r[key])
    if (r[key].length < r.page_size) return out
  }
  throw new Error(`${key}: more than 1000 pages`)
}

export async function count(c: Core, now = new Date()): Promise<Counts> {
  const org = await c.orgSettings.get()
  if (org?.business_id !== DEV_SALON_BUSINESS_ID) throw new Refused(`core resolved business ${org?.business_id ?? '(none)'}, not the Dev Salon`)
  const staff = await pageAll('staff', (page) => c.staff.list({ page, page_size: 200 }))
  if (!staff.some((s) => s.email?.toLowerCase() === DEV_EMAIL)) throw new Refused(`no ${DEV_EMAIL} staff card in the resolved business`)

  const [{ stores }, staffPerStore, { menus }, customers, packs, appointments, karute, recordings] = await Promise.all([
    c.stores.list(),
    c.staffStores.counts(),
    c.menus.list(),
    pageAll('customers', (page) => c.customers.list({ page, page_size: 500 })),
    c.packs.listActivePacks(),
    pageAll('appointments', (page) => c.appointments.list({ page, page_size: 500 })),
    pageAll('karute_records', (page) => c.karuteRecords.list({ page, page_size: 200 })),
    pageAll('recordings', (page) => c.recordings.list({ page, page_size: 200 })),
  ])
  const past = (rows: { starts_at: string }[]) => rows.filter((a) => new Date(a.starts_at) < now).length
  // Business row = every row incl. ones with no store (store rows below would miss those).
  const out: Counts = {
    business: {
      name: 'business', stores: stores.length, staff: staff.length, menus: menus.length, customers: customers.length,
      packs_active: packs.length, appointments: appointments.length, appointments_past: past(appointments),
      karute_records: karute.length, recordings: recordings.length,
    },
  }
  for (const s of stores) {
    const [storeCustomers, storeResources] = await Promise.all([
      pageAll('customers', (page) => c.customers.list({ store_id: s.id, page, page_size: 500 })),
      c.resources.list({ store_id: s.id }),
    ])
    const inStore = <T extends { store_id: string | null }>(rows: T[]) => rows.filter((r) => r.store_id === s.id)
    out[s.id] = {
      name: s.name, staff: staffPerStore.counts[s.id] ?? 0, menus: inStore(menus).length, resources: storeResources.resources.length,
      customers: storeCustomers.length, appointments: inStore(appointments).length, appointments_past: past(inStore(appointments)),
      karute_records: inStore(karute).length, recordings: inStore(recordings).length,
    }
  }
  return out
}

// packs_active falls when a pack is used up/closed (normal play, not a loss): shown, never compared.
const VOLATILE = new Set(['packs_active'])

// A count that FELL below its baseline is the loss signal; growth is fine.
export function breaches(base: Counts, now: Counts): string[] {
  const out: string[] = []
  for (const [scope, kinds] of Object.entries(base))
    for (const [kind, was] of Object.entries(kinds)) {
      if (typeof was !== 'number' || VOLATILE.has(kind)) continue
      const is = Number(now[scope]?.[kind] ?? 0)
      if (is < was) out.push(`BASELINE BREACH: ${kinds.name} (${scope}) · ${kind} · baseline ${was} · now ${is}`)
    }
  return out
}

const table = (rows: Record<string, unknown>[]) => {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return [cols, ...rows.map((r) => cols.map((k) => String(r[k] ?? '')))].map((r) => r.join(' | ')).join('\n')
}

export async function run(argv: string[], c: Core, log: (line: string) => void = console.log): Promise<number> {
  const [cmd, path] = argv
  if (!(cmd === 'print' || ((cmd === 'write' || cmd === 'check') && path))) {
    log('usage: count-baseline.ts print | write <path> | check <path>')
    return 1
  }
  const base = cmd === 'check' ? (JSON.parse(readFileSync(path, 'utf8')) as { businessId: string; counts: Counts }) : null
  if (base && base.businessId !== DEV_SALON_BUSINESS_ID) {
    log('REFUSED: the baseline file is not a Dev Salon baseline')
    return 2
  }
  let counts: Counts
  try {
    counts = await count(c)
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    log(`REFUSED: ${e.message}`)
    return 2
  }
  if (!base) {
    log(table(Object.entries(counts).map(([id, { name, ...k }]) => ({ store: name, id, ...k }))))
    log(JSON.stringify(counts))
    if (cmd === 'write') {
      writeFileSync(path, JSON.stringify({ takenAt: new Date().toISOString(), businessId: DEV_SALON_BUSINESS_ID, counts }, null, 2) + '\n')
      log(`baseline written: ${path}`)
    }
    return 0
  }
  log(table(Object.entries(base.counts).flatMap(([scope, kinds]) =>
    Object.entries(kinds).filter(([, v]) => typeof v === 'number')
      .map(([kind, was]) => ({ store: kinds.name, kind, baseline: was, now: counts[scope]?.[kind] ?? 0 })))))
  const lines = breaches(base.counts, counts)
  lines.forEach((l) => log(l))
  if (lines.length) return 3
  log('BASELINE OK: no count fell')
  return 0
}

// Runs only as the CLI. No import.meta and a lazy client import, so the test loads this file
// under CI's CommonJS ts-node without the ESM client (tsx is not a repo dependency).
if (process.argv[1]?.endsWith('count-baseline.ts')) {
  const { SYNQED_CORE_URL: baseUrl, SYNQED_CORE_API_KEY: apiKey } = process.env
  if (!baseUrl || !apiKey) {
    console.error('set SYNQED_CORE_URL and SYNQED_CORE_API_KEY first (values are never printed)')
    process.exit(1)
  }
  import('@synqed-kk/client')
    .then(({ SynqedClient }) => run(process.argv.slice(2), new SynqedClient({ baseUrl, apiKey, businessId: DEV_SALON_BUSINESS_ID })))
    .then(
      (code) => process.exit(code),
      (e) => {
        console.error('count failed:', e instanceof Error ? e.message : String(e))
        process.exit(1)
      },
    )
}
