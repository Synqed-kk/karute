// P4 follow-up: carry the sheet's 担当者 / 最終来店日 / 来店回数 onto the
// synqed customers (the import wrote packs/lifecycle but not these three —
// they feed 担当, the staff stripe, 来店N回, 前回/N日前 AND the 離客 alert
// math). Idempotent + conservative: never overwrites an existing value.
// Run: node --env-file=.env scripts/import/repair-fields.mjs
import { SynqedClient } from '@synqed-kk/client'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const plan = JSON.parse(readFileSync('/tmp/import-plan.json', 'utf8'))
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const synqed = new SynqedClient({
  baseUrl: process.env.SYNQED_CORE_URL,
  apiKey: process.env.SYNQED_CORE_API_KEY,
  businessId: plan.businessId,
})

// sheet 担当者 → current staff profile (former staff stay unmapped, reported)
const { data: profiles } = await sb
  .from('profiles').select('id, full_name').eq('customer_id', plan.businessId)
const byPrefix = {}
for (const p of profiles) for (const pref of ['原田', '篠原', '鈴木', '堀川', '牧之瀬'])
  if ((p.full_name || '').startsWith(pref)) byPrefix[pref] = p.id
const MAP = { 原: byPrefix['原田'], 篠原: byPrefix['篠原'], 鈴木: byPrefix['鈴木'], 堀川: byPrefix['堀川'] }
console.log('staff map:', Object.fromEntries(Object.entries(MAP).map(([k, v]) => [k, v?.slice(0, 8)])))

// sheet rows keyed for both matched + created; need 担当 from the raw sheet
import { execSync } from 'child_process'
const csvDump = JSON.parse(execSync(`python3 -c "
import csv, json, re, unicodedata
rows = list(csv.reader(open('/Users/liam/Downloads/2026 La Estro 代官山 - 顧客管理.csv', encoding='utf-8-sig')))
def jdate(s):
    m = re.match(r'(\\\\d{4})/(\\\\d{1,2})/(\\\\d{1,2})', (s or '').strip())
    return f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}' if m else None
out = {}
for r in rows[8:]:
    n = (r[4] if len(r) > 4 else '').strip()
    if not n: continue
    out[n] = {'staff': (r[5] or '').strip(), 'last_visit': jdate(r[14] if len(r)>14 else ''),
              'visit_count': int(r[16]) if len(r)>16 and (r[16] or '').strip().isdigit() else None}
print(json.dumps(out, ensure_ascii=False))
"`, { encoding: 'utf8' }))

// resolve created customers' ids by name
const all = []
for (let page = 1; page <= 10; page++) {
  const { customers } = await synqed.customers.list({ page, page_size: 200 })
  all.push(...customers)
  if (customers.length < 200) break
}
const norm = (s) => (s || '').replace(/[\s　]/g, '')
const cidByName = {}
for (const c of all) cidByName[norm(c.name)] = c
const byId = {}
for (const c of all) byId[c.id] = c

const targets = []
for (const m of plan.matched) targets.push({ cid: m.app_id, sheet: csvDump[m.sheet_name], name: m.sheet_name })
for (const s of plan.sheet_only) {
  const c = cidByName[norm(s.create_name)]
  if (c) targets.push({ cid: c.id, sheet: csvDump[s.sheet_name], name: s.sheet_name })
}
const log = { updated: 0, skippedNoChange: 0, formerStaff: 0, errors: [] }
for (const t of targets) {
  if (!t.sheet) continue
  const cur = byId[t.cid] || {}
  const upd = {}
  const sid = MAP[t.sheet.staff]
  if (sid && !cur.assigned_staff_id) upd.assigned_staff_id = sid
  if (!sid && t.sheet.staff) log.formerStaff++
  if (t.sheet.last_visit && !cur.last_visit_at) upd.last_visit_at = t.sheet.last_visit + 'T00:00:00+09:00'
  if (t.sheet.visit_count && t.sheet.visit_count > (cur.visit_count ?? 0)) upd.visit_count = t.sheet.visit_count
  if (!Object.keys(upd).length) { log.skippedNoChange++; continue }
  try { await synqed.customers.update(t.cid, upd); log.updated++ }
  catch (e) { log.errors.push(`${t.name}: ${e.message?.slice(0, 60)}`) }
}
console.log(JSON.stringify(log, null, 1))
