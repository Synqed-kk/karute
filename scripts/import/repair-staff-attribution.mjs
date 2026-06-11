// Sheet-true staff attribution repair (Liam-approved): 浜野(→Ginza)/江間/鶴窪
// are REAL current people — register them, repoint every sheet-import visit to
// the staff the sheet actually names (fixes the Liam's-Salon fallback + the
// retry-rotation pollution), and set 担当 where unset. Idempotent.
import { SynqedClient } from '@synqed-kk/client'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const plan = JSON.parse(readFileSync('/tmp/import-plan.json', 'utf8'))
const synqed = new SynqedClient({ baseUrl: process.env.SYNQED_CORE_URL, apiKey: process.env.SYNQED_CORE_API_KEY, businessId: plan.businessId })

// 1. ensure the three exist
const { staff } = await synqed.staff.list({ page: 1, page_size: 200 })
const byName = (pref) => staff.find((s) => ((s.name || s.full_name || '')).replace(/[\s　]/g, '').startsWith(pref))
const ensure = async (name) => {
  const hit = byName(name)
  if (hit) return hit.id
  const created = await synqed.staff.create({ name })
  console.log('created staff:', name, created.id.slice(0, 8))
  return created.id
}
const MAP = {
  原: byName('原田')?.id,
  篠原: byName('篠原')?.id,
  鈴木: byName('鈴木')?.id,
  堀川: byName('堀川')?.id,
  浜野: await ensure('浜野'),
  江間: await ensure('江間'),
  鶴窪: await ensure('鶴窪'),
}
console.log('map:', Object.fromEntries(Object.entries(MAP).map(([k, v]) => [k, v?.slice(0, 8) ?? 'NONE'])))

// 2. sheet 担当者 per customer name
const sheetStaff = JSON.parse(execSync(`python3 -c "
import csv, json
rows = list(csv.reader(open('/Users/liam/Downloads/2026 La Estro 代官山 - 顧客管理.csv', encoding='utf-8-sig')))
out = {}
for r in rows[8:]:
    n = (r[4] if len(r) > 4 else '').strip()
    if n: out[n] = (r[5] or '').strip()
print(json.dumps(out, ensure_ascii=False))
"`, { encoding: 'utf8' }))

// customer id ↔ sheet row
const all = []
for (let p = 1; p <= 10; p++) { const { customers } = await synqed.customers.list({ page: p, page_size: 200 }); all.push(...customers); if (customers.length < 200) break }
const norm = (s) => (s || '').replace(/[\s　]/g, '')
const cidByName = {}
for (const c of all) cidByName[norm(c.name)] = c
const staffByCid = {}
for (const m of plan.matched) { const sid = MAP[sheetStaff[m.sheet_name]]; if (sid) staffByCid[m.app_id] = sid }
for (const s of plan.sheet_only) { const c = cidByName[norm(s.create_name)]; const sid = MAP[sheetStaff[s.sheet_name]]; if (c && sid) staffByCid[c.id] = sid }

// 3. repoint imported appointments to the sheet-true staff
const appts = []
for (let p = 1; p <= 40; p++) { const { appointments } = await synqed.appointments.list({ page: p, page_size: 200 }); appts.push(...appointments); if (appointments.length < 200) break }
let repointed = 0, ok = 0, errs = 0
for (const a of appts.filter((x) => (x.notes || '').includes('sheet-import'))) {
  const want = staffByCid[a.customer_id]
  if (!want || a.staff_id === want) { ok++; continue }
  try { await synqed.appointments.update(a.id, { staff_id: want }); repointed++ }
  catch (e) { errs++; if (errs < 3) console.log('ERR appt', e.message?.slice(0, 60)) }
}

// 4. 担当 (assigned_staff_id) where unset
let assigned = 0
for (const [cid, sid] of Object.entries(staffByCid)) {
  const c = all.find((x) => x.id === cid)
  if (!c || c.assigned_staff_id) continue
  try { await synqed.customers.update(cid, { assigned_staff_id: sid }); assigned++ } catch {}
}
console.log({ repointed, alreadyCorrect: ok, assigned, errs })
