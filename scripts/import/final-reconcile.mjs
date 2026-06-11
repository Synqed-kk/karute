// Wait out the core API's read lag, then ONE reconcile: delete pair-dupes +
// any sheet-import appointment whose customer+date isn't in the plan truth.
import { SynqedClient } from '@synqed-kk/client'
import { readFileSync } from 'fs'
await new Promise((r) => setTimeout(r, 300_000)) // 5 min consistency wait
const plan = JSON.parse(readFileSync('/tmp/import-plan.json', 'utf8'))
const synqed = new SynqedClient({ baseUrl: process.env.SYNQED_CORE_URL, apiKey: process.env.SYNQED_CORE_API_KEY, businessId: plan.businessId })
const all = []
for (let page = 1; page <= 10; page++) {
  const { customers } = await synqed.customers.list({ page, page_size: 200 })
  all.push(...customers)
  if (customers.length < 200) break
}
const norm = (s) => (s || '').replace(/[\s　]/g, '')
const cidByName = {}
for (const c of all) cidByName[norm(c.name)] = c.id
const expected = new Set()
for (const m of plan.matched) for (const d of m.visit_dates || []) expected.add(m.app_id + '|' + d)
for (const s of plan.sheet_only) {
  const cid = cidByName[norm(s.create_name)]
  if (cid) for (const d of s.visit_dates || []) expected.add(cid + '|' + d)
}
const appts = []
for (let page = 1; page <= 40; page++) {
  const { appointments } = await synqed.appointments.list({ page, page_size: 200 })
  appts.push(...appointments)
  if (appointments.length < 200) break
}
const imported = appts.filter((a) => (a.notes || '').includes('sheet-import'))
const byPair = new Map()
for (const a of imported) {
  const k = a.customer_id + '|' + a.starts_at.slice(0, 10)
  if (!byPair.has(k)) byPair.set(k, [])
  byPair.get(k).push(a)
}
let dupesDeleted = 0, orphansDeleted = 0, errs = 0
for (const [k, list] of byPair) {
  list.sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''))
  const keep = expected.has(k) ? 1 : 0
  for (const extra of list.slice(keep)) {
    try {
      await synqed.appointments.delete(extra.id)
      if (keep) dupesDeleted++
      else orphansDeleted++
    } catch { errs++ }
  }
  if (!keep) console.log('orphan pair removed:', k.slice(0, 14), list.length, 'rows')
}
console.log({ dupesDeleted, orphansDeleted, errs })
// verify after another settle
await new Promise((r) => setTimeout(r, 240_000))
const appts2 = []
for (let page = 1; page <= 40; page++) {
  const { appointments } = await synqed.appointments.list({ page, page_size: 200 })
  appts2.push(...appointments)
  if (appointments.length < 200) break
}
const imp = appts2.filter((a) => (a.notes || '').includes('sheet-import'))
const pairs = new Set(imp.map((a) => a.customer_id + '|' + a.starts_at.slice(0, 10)))
const missing = [...expected].filter((k) => !pairs.has(k)).length
console.log('VERIFIED FINAL: visits:', imp.length, '| unique:', pairs.size, '| dupes:', imp.length - pairs.size, '| expected:', expected.size, '| missing:', missing)
