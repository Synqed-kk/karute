// P4 follow-up: the sheet's per-visit date columns → core PAST APPOINTMENTS.
// Core's customer.update silently drops visit_count/last_visit_at (verified),
// but appointments are the system's native visit records — 前回/（N日前）,
// 来店N回 (pastAppointmentCount) and the 離客 alert math all derive from them
// through the existing single-source paths. Idempotent via notes tag.
// Run: node --env-file=.env scripts/import/import-visits.mjs
import { SynqedClient } from '@synqed-kk/client'
import { readFileSync } from 'fs'

const TAG = 'sheet-import'
const plan = JSON.parse(readFileSync('/tmp/import-plan.json', 'utf8'))
const synqed = new SynqedClient({
  baseUrl: process.env.SYNQED_CORE_URL,
  apiKey: process.env.SYNQED_CORE_API_KEY,
  businessId: plan.businessId,
})

// staff map (synqed ids, verified earlier)
const { staff } = await synqed.staff.list({ page: 1, page_size: 200 })
const findId = (pref) => staff.find((s) => ((s.name || s.full_name || '')).replace(/[\s　]/g, '').startsWith(pref))?.id
const MAP = { 原: findId('原田'), 篠原: findId('篠原'), 鈴木: findId('鈴木'), 堀川: findId('堀川') }
const fallbackStaff = staff[0]?.id // only used if a row's staff is unmapped AND null is rejected

// sheet staff per row
import { execSync } from 'child_process'
const sheetStaff = JSON.parse(execSync(`python3 -c "
import csv, json
rows = list(csv.reader(open('/Users/liam/Downloads/2026 La Estro 代官山 - 顧客管理.csv', encoding='utf-8-sig')))
out = {}
for r in rows[8:]:
    n = (r[4] if len(r) > 4 else '').strip()
    if n: out[n] = (r[5] or '').strip()
print(json.dumps(out, ensure_ascii=False))
"`, { encoding: 'utf8' }))

// existing customers + already-imported visit set (idempotency)
const all = []
for (let page = 1; page <= 10; page++) {
  const { customers } = await synqed.customers.list({ page, page_size: 200 })
  all.push(...customers)
  if (customers.length < 200) break
}
const norm = (s) => (s || '').replace(/[\s　]/g, '')
const cidByName = {}
for (const c of all) cidByName[norm(c.name)] = c.id

const appts = []
for (let page = 1; page <= 30; page++) {
  const { appointments } = await synqed.appointments.list({ page, page_size: 200 })
  appts.push(...appointments)
  if (appointments.length < 200) break
}
const already = new Set(
  appts.filter((a) => (a.notes || '').includes(TAG)).map((a) => `${a.customer_id}|${a.starts_at.slice(0, 10)}`),
)
console.log('existing appointments:', appts.length, '| already-imported visits:', already.size)

const rows = []
for (const m of plan.matched) rows.push({ cid: m.app_id, name: m.sheet_name, dates: m.visit_dates || [], pack: m.pack })
for (const s of plan.sheet_only) {
  const cid = cidByName[norm(s.create_name)]
  if (cid) rows.push({ cid, name: s.sheet_name, dates: s.visit_dates || [], pack: s.pack })
}

const slotIdx = new Map() // staffId|ymd → next slot (avoid same-staff overlap)
const log = { created: 0, skipped: 0, errors: 0 }
for (const row of rows) {
  const staffId = MAP[sheetStaff[row.name]] ?? null
  const title = row.pack?.kind === 'pack' ? `${row.pack.size}回券` : row.pack?.raw ?? '来店'
  for (const d of row.dates) {
    if (already.has(`${row.cid}|${d}`)) { log.skipped++; continue }
    const sKey = `${staffId ?? 'none'}|${d}`
    const idx = slotIdx.get(sKey) ?? 0
    slotIdx.set(sKey, idx + 1)
    let ok = false
    for (let attempt = 0; attempt < 24 && !ok; attempt++) {
      // wrap within 07:00-21:55 — slot 13+ on a busy day must not march past
      // midnight (the Invalid-time bug on 2026-06-06)
      const minutes = (7 * 60) + (((idx + attempt) * 65) % (15 * 60))
      const h = String(Math.floor(minutes / 60)).padStart(2, '0')
      const mm = String(minutes % 60).padStart(2, '0')
      const starts = new Date(`${d}T${h}:${mm}:00+09:00`)
      const ends = new Date(starts.getTime() + 60 * 60000)
      try {
        await synqed.appointments.create({
          customer_id: row.cid,
          staff_id: staffId ?? fallbackStaff,
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
          duration_minutes: 60,
          title,
          notes: TAG,
        })
        ok = true
        log.created++
      } catch (e) {
        if (attempt === 23) {
          log.errors++
          if (log.errors < 6) console.log('ERR', row.name, d, e.message?.slice(0, 70))
        }
      }
    }
  }
  if ((log.created + log.skipped) % 300 < row.dates.length) console.log('progress:', JSON.stringify(log))
}
console.log('FINAL:', JSON.stringify(log))
