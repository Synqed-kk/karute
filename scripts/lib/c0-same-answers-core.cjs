'use strict'
/**
 * C0 same-answers — all logic (build order #1 § 3 / § 5 SAME; plan § 3 (2)).
 * Reads the Dev Salon the way every door reads it, before core's C0 SQL apply
 * and after its deploy, and proves every existing field of every answer is
 * unchanged. READ-ONLY: every request is a GET. The CLI (scripts/c0-same-answers.mjs)
 * owns argv, env, file IO and exit codes; this module owns everything else.
 */

/** The Dev Salon business (practice tenant) and its store テスト自由が丘店. */
const BUSINESS_ID = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
const STORE_ID = '0e8fd5dd-8da6-48c4-9ad2-2ab305aa907c'

const PAGE_CAP = 100
const TIMEOUT_MS = 30_000
const PIN_COUNT = 20
const CUSTOMER_PIN_COUNT = 3
// The crawl's own source value (core sync.service.ts:458 @7d2f629: source: 'QUICKRESERVE').
const CRAWL_SOURCE = 'QUICKRESERVE'
// Door page sizes, each copied from the door that sends it (cited at the query).
const APPT_RANGE_PAGE_SIZE = 500 // karute src/lib/appointments/by-date.ts:146 RANGE_PAGE_SIZE
const RESERVE_PAGE_SIZE = 500 // reserve api/_lib/core.ts APPOINTMENT_PAGE_SIZE
const CUSTOMER_PAGE_SIZE = 500 // karute src/business/lib/practice-door/door.ts:336
const SHIFT_PAGE_SIZE = 200 // core src/validations/staff-shift.ts:41 max(200) @7d2f629
const C0_NEW_FIELDS = ['hold_from', 'hold_until', 'holds_managed', 'revision']

// ── dates ──────────────────────────────────────────────────────────────────

/** The Dev Salon's zone is Asia/Tokyo: "today" is the JST calendar date of the clock. */
function jstToday(nowMs) {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10)
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** D1..D3 = today+7, +8, +9 (UTC calendar arithmetic on the JST date). */
function datesAfter(today) {
  return [addDays(today, 7), addDays(today, 8), addDays(today, 9)]
}

/** VOID unless D1 is still strictly after `today`. */
function guardDates(run, today) {
  const d1 = run && Array.isArray(run.dates) ? run.dates[0] : undefined
  if (typeof d1 !== 'string') return { ok: false, reason: 'the run carries no dates' }
  if (!(d1 > today)) return { ok: false, reason: `D1 ${d1} is no longer after today ${today}` }
  return { ok: true, reason: null }
}

// The JST day's first instant and last millisecond, as karute's day read builds them
// (src/lib/appointments/by-date.ts:36-37 `${dateStr}T00:00:00+09:00` / `T23:59:59.999+09:00`).
const jstStart = (ymd) => new Date(`${ymd}T00:00:00+09:00`).toISOString()
const jstEnd = (ymd) => new Date(`${ymd}T23:59:59.999+09:00`).toISOString()

// ── pins ───────────────────────────────────────────────────────────────────

function pickPins(rows, customers) {
  const byId = new Map()
  for (const r of rows || []) if (r && typeof r.id === 'string' && !byId.has(r.id)) byId.set(r.id, r)
  const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const chosen = new Set()
  const unmet = []
  const take = (row) => { if (row && chosen.size < PIN_COUNT) chosen.add(row.id) }
  const statuses = [...new Set(sorted.map((r) => r.status))].sort()
  for (const s of statuses) take(sorted.find((r) => r.status === s && !chosen.has(r.id)) || sorted.find((r) => r.status === s))
  const occ = sorted.find((r) => r.occupied_until !== null && r.occupied_until !== undefined)
  if (occ) take(occ); else unmet.push('a row with a non-null occupied_until')
  const crawled = sorted.find((r) => r.source === CRAWL_SOURCE)
  if (crawled) take(crawled); else unmet.push(`a crawled row (source ${CRAWL_SOURCE})`)
  for (const s of statuses) if (!sorted.some((r) => r.status === s && chosen.has(r.id))) unmet.push(`status ${s}`)
  for (const r of sorted) { if (chosen.size >= PIN_COUNT) break; chosen.add(r.id) }
  const customerIds = [...new Set((customers || []).map((c) => c && c.id).filter((id) => typeof id === 'string'))]
    .sort().slice(0, CUSTOMER_PIN_COUNT)
  return { appointment_ids: [...chosen].sort(), customer_ids: customerIds, unmet }
}

// ── network ────────────────────────────────────────────────────────────────

function qs(params) {
  const sp = new URLSearchParams()
  for (const [k, v] of params) if (v !== undefined && v !== null) sp.append(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** One GET; one immediate retry on a network error only (never on an HTTP answer). */
async function get(fetchImpl, cfg, pathAndQuery) {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}${pathAndQuery}`
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    try {
      const res = await fetchImpl(url, { method: 'GET', headers: cfg.headers || {}, signal: ac.signal })
      let json = null
      try { json = await res.json() } catch { json = null }
      return { status: res.status, json }
    } catch (err) {
      lastErr = err
    } finally {
      clearTimeout(timer)
    }
  }
  return { status: 0, json: { network_error: String(lastErr && lastErr.message ? lastErr.message : lastErr) } }
}

/**
 * Walks a paged list: stops at an empty page or when page * page_size >= total;
 * page cap 100 → capped. A non-200 stops the walk and is recorded.
 */
async function walk(fetchImpl, cfg, path, params, pageSize, listKey) {
  const pages = []
  for (let page = 1; page <= PAGE_CAP; page++) {
    const r = await get(fetchImpl, cfg, `${path}${qs([...params, ['page', page], ['page_size', pageSize]])}`)
    if (r.status !== 200) return { pages, error: { page, status: r.status, json: r.json }, capped: false }
    pages.push(r.json)
    const rows = r.json && Array.isArray(r.json[listKey]) ? r.json[listKey] : []
    const total = r.json && typeof r.json.total === 'number' ? r.json.total : 0
    if (rows.length === 0 || page * pageSize >= total) return { pages, error: null, capped: false }
  }
  return { pages, error: null, capped: true }
}

const rowsOf = (pages, key) => pages.flatMap((p) => (p && Array.isArray(p[key]) ? p[key] : []))

function maxOf(rows, field) {
  let m = null
  for (const r of rows) {
    const v = r ? r[field] : undefined
    if (v === undefined || v === null) continue
    if (m === null || v > m) m = v
  }
  return m
}

async function watermark(fetchImpl, cfg, path, pageSize, listKey) {
  const w = await walk(fetchImpl, cfg, path, [], pageSize, listKey)
  const rows = rowsOf(w.pages, listKey)
  const first = w.pages[0]
  const hasRevision = rows.some((r) => r && 'revision' in r)
  return {
    count: first && typeof first.total === 'number' ? first.total : rows.length,
    max_updated_at: maxOf(rows, 'updated_at'),
    max_revision: hasRevision ? maxOf(rows, 'revision') : null,
    pages_walked: w.pages.length,
    capped: w.capped,
    ...(w.error ? { error: w.error } : {}),
  }
}

/**
 * Collects one run. cfg = { baseUrl, headers, now (ms), run: 'before'|'after', before? (the before run, for 'after') }.
 * Returns the run object (the CLI writes it). Errors on list queries are recorded in run.errors.
 */
async function collect(fetchImpl, cfg) {
  const now = typeof cfg.now === 'number' ? cfg.now : Date.now()
  const today = jstToday(now)
  const run = cfg.run || 'before'
  const dates = run === 'after' && cfg.before ? cfg.before.dates.slice() : datesAfter(today)
  const [D1, D2, D3] = dates
  const errors = []
  const capped = []
  const listed = (name, w) => {
    if (w.error) errors.push({ query: name, ...w.error })
    if (w.capped) capped.push(name)
    return w.pages
  }

  // Watermark first (business-wide, no date filter), each list walked at the door's maximum page size.
  const wm = {
    appointments: await watermark(fetchImpl, cfg, '/v1/appointments', APPT_RANGE_PAGE_SIZE, 'appointments'),
    customers: await watermark(fetchImpl, cfg, '/v1/customers', CUSTOMER_PAGE_SIZE, 'customers'),
    // core's staff-shift list has a business-wide form (store_id optional,
    // src/validations/staff-shift.ts:38 @7d2f629) — no per-store walk needed.
    staff_shifts: await watermark(fetchImpl, cfg, '/v1/staff-shifts', SHIFT_PAGE_SIZE, 'shifts'),
  }
  for (const [k, w] of Object.entries(wm)) {
    if (w.capped) capped.push(`watermark.${k}`)
    if (w.error) errors.push({ query: `watermark.${k}`, ...w.error })
  }

  const window12 = [['from', jstStart(D1)], ['to', jstEnd(D2)]]
  // Q1 — karute's range read: from/to + page + page_size RANGE_PAGE_SIZE + store_id
  // (src/lib/appointments/by-date.ts:238-245 @origin/main; JST day bounds as :36-37).
  const Q1 = listed('Q1', await walk(fetchImpl, cfg, '/v1/appointments', [...window12, ['store_id', STORE_ID]], APPT_RANGE_PAGE_SIZE, 'appointments'))
  // Q2 — the same read business-wide (no store_id: the practice door's viewAll lens,
  // src/business/lib/practice-door/door.ts:105-107 passes store_id only for a store lens).
  const Q2 = listed('Q2', await walk(fetchImpl, cfg, '/v1/appointments', window12, APPT_RANGE_PAGE_SIZE, 'appointments'))
  // Q3 — Q1 with core's status exclusion in the form core accepts
  // (status_not repeated: core src/routes/appointments.ts:31 getAll + src/validations/appointment.ts:85-86 @7d2f629).
  // No door sends status_not today (karute drops terminal rows client-side, by-date.ts:80).
  const Q3 = listed('Q3', await walk(fetchImpl, cfg, '/v1/appointments',
    [...window12, ['store_id', STORE_ID], ['status_not', 'CANCELLED'], ['status_not', 'NO_SHOW']], APPT_RANGE_PAGE_SIZE, 'appointments'))

  // Q6 — the customers list as the practice door walks it (door.ts:336: page + page_size 500, no store_id under viewAll).
  const Q6list = listed('Q6', await walk(fetchImpl, cfg, '/v1/customers', [], CUSTOMER_PAGE_SIZE, 'customers'))

  const pins = run === 'after' && cfg.before
    ? JSON.parse(JSON.stringify(cfg.before.pins))
    : pickPins([...rowsOf(Q1, 'appointments'), ...rowsOf(Q2, 'appointments')], rowsOf(Q6list, 'customers'))

  // Q4 — GET /v1/appointments/:id (the client's appointments.get) for every pinned id.
  const Q4 = {}
  for (const id of pins.appointment_ids) {
    const r = await get(fetchImpl, cfg, `/v1/appointments/${encodeURIComponent(id)}`)
    Q4[id] = r.status === 200 ? r.json : { status: r.status, json: r.json }
  }

  // Q5 — Reserve's read: listAllAppointments (reserve api/_lib/core.ts, page + page_size 500)
  // with store_id + from/to as ISO instants (api/public/availability.ts:183-187), over D1..D3.
  const Q5 = listed('Q5', await walk(fetchImpl, cfg, '/v1/appointments',
    [['from', jstStart(D1)], ['to', jstEnd(D3)], ['store_id', STORE_ID]], RESERVE_PAGE_SIZE, 'appointments'))

  // Q6 — GET /v1/customers/:id for the pinned customers.
  const Q6customers = {}
  for (const id of pins.customer_ids) {
    const r = await get(fetchImpl, cfg, `/v1/customers/${encodeURIComponent(id)}`)
    Q6customers[id] = r.status === 200 ? r.json : { status: r.status, json: r.json }
  }

  // Q7 — staff shifts per day D1..D3 (core GET /v1/staff-shifts?date=, src/validations/staff-shift.ts:37-41 @7d2f629).
  // karute has no staff-shift core module (no door lists shifts from core today) — the route's own shape.
  const Q7 = []
  for (const d of dates) {
    Q7.push(...listed(`Q7:${d}`, await walk(fetchImpl, cfg, '/v1/staff-shifts', [['date', d], ['store_id', STORE_ID]], SHIFT_PAGE_SIZE, 'shifts')))
  }

  let coreHost = null
  try { coreHost = new URL(cfg.baseUrl).host } catch { coreHost = null }

  return {
    run,
    written_at: new Date(now).toISOString(),
    core_host: coreHost,
    business_id: BUSINESS_ID,
    store_id: STORE_ID,
    today,
    dates,
    pins,
    watermark: wm,
    answers: { Q1, Q2, Q3, Q4, Q5, Q6: { list: Q6list, customers: Q6customers }, Q7 },
    thin: rowsOf(Q1, 'appointments').length === 0,
    capped,
    errors,
  }
}

// ── diff ───────────────────────────────────────────────────────────────────

const isObj = (v) => typeof v === 'object' && v !== null
const canon = (v) => JSON.stringify(v === undefined ? null : sortKeys(v))
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  return v
}

/** Every leaf of `v` as [pathArray, value]; an empty object/array counts as a leaf. */
function leaves(v, path = [], out = []) {
  if (isObj(v) && Object.keys(v).length > 0) {
    for (const k of Object.keys(v)) leaves(v[k], [...path, k], out)
  } else out.push([path, v])
  return out
}

function at(root, path) {
  let cur = root
  for (const k of path) {
    if (!isObj(cur) || !(k in cur)) return { found: false }
    cur = cur[k]
  }
  return { found: true, value: cur }
}

/** The id of the innermost object on the path that carries a string `id`. */
function rowIdOf(root, path) {
  let cur = root
  let id = null
  for (const k of path) {
    if (!isObj(cur)) break
    if (typeof cur.id === 'string') id = cur.id
    cur = cur[k]
  }
  if (isObj(cur) && typeof cur.id === 'string') id = cur.id
  return id
}

// Array indices → [], and the id keys of Q4 / Q6.customers → {id}, so one new field reads as one path.
const pattern = (path) => path
  .map((k, i) => (/^\d+$/.test(k) ? '[]' : (path[0] === 'Q4' && i === 1) || (path[0] === 'Q6' && path[1] === 'customers' && i === 2) ? '{id}' : k))
  .join('.')

/** Every appointment object of every query of a run. */
function appointmentObjects(answers) {
  const out = []
  for (const q of ['Q1', 'Q2', 'Q3', 'Q5']) for (const p of answers[q] || []) if (p && Array.isArray(p.appointments)) out.push(...p.appointments)
  for (const v of Object.values(answers.Q4 || {})) if (isObj(v) && typeof v.id === 'string' && !('json' in v && 'status' in v)) out.push(v)
  return out
}

function hasCapped(run) {
  if (Array.isArray(run.capped) && run.capped.length) return true
  return Object.values(run.watermark || {}).some((w) => w && w.capped)
}

function diff(before, after, opts = {}) {
  const reasons = []
  const today = opts.today
  // VOID first.
  for (const k of ['appointments', 'customers', 'staff_shifts']) {
    const b = (before.watermark || {})[k] || {}
    const a = (after.watermark || {})[k] || {}
    if (b.count !== a.count) reasons.push(`the ${k} count moved (${b.count} → ${a.count})`)
    if (b.max_updated_at !== a.max_updated_at) reasons.push(`the ${k} newest updated_at moved (${b.max_updated_at} → ${a.max_updated_at})`)
  }
  if (hasCapped(before) || hasCapped(after)) reasons.push('a read hit the 100-page cap')
  if ((before.errors || []).length || (after.errors || []).length) reasons.push('a list query answered an error (not run)')
  if (canon(before.dates) !== canon(after.dates)) reasons.push('the two runs read different dates')
  if (canon(before.pins) !== canon(after.pins)) reasons.push('the two runs pinned different ids')
  if (today !== undefined) {
    const g = guardDates(after, today)
    if (!g.ok) reasons.push(g.reason)
  }
  const result = { verdict: 'PASS', reasons, changed: [], new_fields: { expected: true, paths: [] } }
  if (reasons.length) { result.verdict = 'VOID'; return result }

  // Every path in BEFORE must be byte-equal in AFTER; first difference per row, all rows.
  const seen = new Set()
  for (const [path, value] of leaves(before.answers)) {
    const query = path[0]
    const got = at(after.answers, path)
    if (got.found && canon(got.value) === canon(value)) continue
    const id = rowIdOf(before.answers, path)
    const key = `${query}|${id || path.join('.')}`
    if (seen.has(key)) continue
    seen.add(key)
    result.changed.push({ query, ...(id ? { id } : {}), path: path.join('.'), before: value, after: got.found ? got.value : '(missing)' })
  }

  // Paths only in AFTER → new fields (never a failure).
  const newPatterns = new Set()
  const newNames = new Set()
  for (const [path] of leaves(after.answers)) {
    // walk down to the first path prefix absent in BEFORE
    for (let i = 1; i <= path.length; i++) {
      const pre = path.slice(0, i)
      if (!at(before.answers, pre).found) {
        // only object-key additions count as new fields; a new array element is a row difference already caught above
        const parent = at(after.answers, pre.slice(0, -1))
        if (parent.found && !Array.isArray(parent.value)) { newPatterns.add(pattern(pre)); newNames.add(pre[pre.length - 1]) }
        break
      }
    }
  }
  result.new_fields.paths = [...newPatterns].sort()
  if (newNames.size === 0) {
    result.new_fields.expected = false
  } else {
    const onlyC0 = [...newNames].every((n) => C0_NEW_FIELDS.includes(n))
    const everywhere = appointmentObjects(after.answers).every((o) => C0_NEW_FIELDS.every((f) => f in o))
    result.new_fields.expected = onlyC0 && everywhere
    if (!result.new_fields.expected) {
      result.new_fields.odd = result.new_fields.paths.filter((p) => !C0_NEW_FIELDS.includes(p.split('.').pop()))
    }
  }
  if (result.changed.length) {
    result.verdict = 'FAIL'
    reasons.push(`${result.changed.length} existing answer(s) changed`)
  }
  return result
}

/** The plain-English block Liam reads. */
function summarize(result, before, after) {
  const lines = [`SAME-ANSWERS VERDICT: ${result.verdict}`]
  if (result.verdict === 'PASS') lines.push('Every existing field of every answer is unchanged.')
  for (const r of result.reasons) lines.push(`- ${r}`)
  for (const c of result.changed.slice(0, 50)) lines.push(`  changed: ${c.query} ${c.id || ''} at ${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`)
  if (result.changed.length > 50) lines.push(`  … and ${result.changed.length - 50} more (see the JSON)`)
  if (result.new_fields.paths.length) {
    lines.push(`New fields: ${result.new_fields.expected ? 'exactly the four C0 fields, on every appointment' : 'NOT only the four C0 fields on every appointment'}`)
    for (const p of (result.new_fields.odd || [])) lines.push(`  odd: ${p}`)
  } else lines.push('New fields: none')
  const wm = (run) => run && run.watermark
    ? `appointments ${run.watermark.appointments && run.watermark.appointments.count}, customers ${run.watermark.customers && run.watermark.customers.count}, staff shifts ${run.watermark.staff_shifts && run.watermark.staff_shifts.count}`
    : '(none)'
  lines.push(`Counts before: ${wm(before)}`)
  lines.push(`Counts after:  ${wm(after)}`)
  return lines.join('\n')
}

const EXIT = { PASS: 0, FAIL: 1, VOID: 2, USAGE: 3 }

module.exports = {
  BUSINESS_ID, STORE_ID, PAGE_CAP, TIMEOUT_MS, PIN_COUNT, CUSTOMER_PIN_COUNT, CRAWL_SOURCE, C0_NEW_FIELDS, EXIT,
  jstToday, datesAfter, guardDates, pickPins, collect, diff, summarize,
}
