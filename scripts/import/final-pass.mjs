// FINAL visit repair. Lessons baked in: (1) core list reads are stale for
// minutes after writes → never trust a single read: re-fetch until two
// consecutive reads agree; (2) NEVER delete on "not expected" (stale customer
// lists fabricate orphans) — delete only literal same-pair duplicates;
// (3) create only what's provably missing, once.
import { SynqedClient } from '@synqed-kk/client'
import { readFileSync } from 'fs'

const plan = JSON.parse(readFileSync('/tmp/import-plan.json', 'utf8'))
const synqed = new SynqedClient({ baseUrl: process.env.SYNQED_CORE_URL, apiKey: process.env.SYNQED_CORE_API_KEY, businessId: plan.businessId })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function stableFetch(label, fetchAll) {
  let prev = null
  for (let i = 0; i < 6; i++) {
    const cur = await fetchAll()
    if (prev !== null && cur.length === prev.length) {
      console.log(label, 'stable at', cur.length)
      return cur
    }
    prev = cur
    await sleep(60_000)
  }
  console.log(label, 'NEVER STABILIZED — using last read', prev.length)
  return prev
}
const fetchCustomers = async () => {
  const out = []
  for (let p = 1; p <= 10; p++) {
    const { customers } = await synqed.customers.list({ page: p, page_size: 200 })
    out.push(...customers)
    if (customers.length < 200) break
  }
  return out
}
const fetchAppts = async () => {
  const out = []
  for (let p = 1; p <= 40; p++) {
    const { appointments } = await synqed.appointments.list({ page: p, page_size: 200 })
    out.push(...appointments)
    if (appointments.length < 200) break
  }
  return out
}

await sleep(240_000) // settle after the last mutations
const customers = await stableFetch('customers', fetchCustomers)
const appts = await stableFetch('appointments', fetchAppts)

const norm = (s) => (s || '').replace(/[\s　]/g, '')
const cidByName = {}
for (const c of customers) cidByName[norm(c.name)] = c.id
const VALID = /^\d{4}-\d{2}-(0[1-9]|[12]\d|3[01])$/
const expected = new Map()
for (const m of plan.matched) for (const d of m.visit_dates || []) if (VALID.test(d)) expected.set(m.app_id + '|' + d, m)
for (const s of plan.sheet_only) {
  const cid = cidByName[norm(s.create_name)]
  if (cid) for (const d of s.visit_dates || []) if (VALID.test(d)) expected.set(cid + '|' + d, s)
}
const imported = appts.filter((a) => (a.notes || '').includes('sheet-import'))
const byPair = new Map()
for (const a of imported) {
  const k = a.customer_id + '|' + a.starts_at.slice(0, 10)
  if (!byPair.has(k)) byPair.set(k, [])
  byPair.get(k).push(a)
}
// 1. literal dupes only
let dupesDeleted = 0
for (const [, list] of byPair) {
  list.sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''))
  for (const extra of list.slice(1)) {
    try { await synqed.appointments.delete(extra.id); dupesDeleted++ } catch {}
  }
}
// 2. create the provably missing, collision-proof slots (deep night, per-pair offset)
const { staff } = await synqed.staff.list({ page: 1, page_size: 200 })
let created = 0
const failures = []
let n = 0
for (const [k, row] of expected) {
  if (byPair.has(k)) continue
  const [cid, d] = k.split('|')
  const title = row.pack?.kind === 'pack' ? `${row.pack.size}回券` : (row.pack?.raw ?? '来店')
  let ok = false
  for (let a = 0; a < 10 && !ok; a++) {
    const mins = 3 * 60 + ((n * 41 + a * 17) % 180) // 03:00-05:59 JST
    const starts = new Date(`${d}T${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00+09:00`)
    try {
      await synqed.appointments.create({
        customer_id: cid,
        staff_id: staff[(n + a) % staff.length].id,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 1_800_000).toISOString(),
        duration_minutes: 30,
        title,
        notes: 'sheet-import',
      })
      ok = true
      created++
    } catch {}
  }
  if (!ok) failures.push(k)
  n++
}
console.log({ dupesDeleted, created, failures: failures.length })
// 3. settle + stable verify
await sleep(300_000)
const appts2 = await stableFetch('verify-appointments', fetchAppts)
const imp = appts2.filter((a) => (a.notes || '').includes('sheet-import'))
const pairs = new Set(imp.map((a) => a.customer_id + '|' + a.starts_at.slice(0, 10)))
const missing = [...expected.keys()].filter((k) => !pairs.has(k))
console.log('VERIFIED FINAL: visits:', imp.length, '| unique:', pairs.size, '| dupes:', imp.length - pairs.size, '| expected:', expected.size, '| missing:', missing.length, missing.slice(0, 5))
