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
// R-7: D1 = today + N (default 7). The widest N keeps D1..D3 inside every door's read window:
// Reserve's grid reads gridDays whole JST days (reserve api/_lib/storeRules.ts:169-170 windowCap,
// applied at api/public/availability.ts:178-180; gridDays = booking_open_days + 1, else 14 —
// storeRules.ts:122, :151-154), and the picker asks from today (availability.ts:77-82), so
// D3 = today + N + 2 <= today + 13 → N <= 11. karute's range read takes any from/to
// (src/lib/appointments/by-date.ts:229-245) — no tighter bound.
const DEFAULT_DAYS_AHEAD = 7
const MAX_DAYS_AHEAD = 11
const WATERMARK_KINDS = ['appointments', 'customers', 'staff_shifts']

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

/** D1..D3 = today+N, +N+1, +N+2, N default 7 (UTC calendar arithmetic on the JST date). */
function datesAfter(today, daysAhead = DEFAULT_DAYS_AHEAD) {
  return [addDays(today, daysAhead), addDays(today, daysAhead + 1), addDays(today, daysAhead + 2)]
}

const daysAheadOk = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_DAYS_AHEAD

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

const isObj = (v) => typeof v === 'object' && v !== null
const isListBody = (j, key) => isObj(j) && Array.isArray(j[key]) && Number.isInteger(j.total)

/** A stored error text never carries the key value or the auth header's name (R-11). */
function scrub(text, cfg) {
  let out = String(text)
  const headers = (cfg && cfg.headers) || {}
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === 'x-api-key' && v) out = out.split(String(v)).join('[key]')
  return out.replace(/x-api-key/gi, '[auth header]')
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
  return { status: 0, json: { network_error: scrub(lastErr && lastErr.message ? lastErr.message : lastErr, cfg) } }
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
    // A 200 that is not a list (an HTML wall, a proxy page, `{}`) is an error, never an empty page.
    if (!isListBody(r.json, listKey)) return { pages, error: { page, status: 200, json: 'not a list body' }, capped: false }
    pages.push(r.json)
    if (r.json[listKey].length === 0 || page * pageSize >= r.json.total) return { pages, error: null, capped: false }
  }
  return { pages, error: null, capped: true }
}

const rowsOf = (pages, key) => pages.flatMap((p) => (p && Array.isArray(p[key]) ? p[key] : []))

/** One single-row GET; anything but a 200 row with a string id is pushed to errors (R-3). */
async function single(fetchImpl, cfg, path, query, id, errors) {
  const r = await get(fetchImpl, cfg, path)
  if (r.status === 200 && isObj(r.json) && !Array.isArray(r.json) && typeof r.json.id === 'string') return r.json
  errors.push({ query, id, status: r.status, json: r.status === 200 ? 'not a single-row body' : r.json })
  return { status: r.status, json: r.json }
}

/** R-2: the business-wide list, per row — rows {id → updated_at} + the verbatim bodies. */
async function watermark(fetchImpl, cfg, path, pageSize, listKey) {
  const w = await walk(fetchImpl, cfg, path, [], pageSize, listKey)
  const rows = {}
  const bodies = {}
  for (const r of rowsOf(w.pages, listKey)) {
    if (!isObj(r) || typeof r.id !== 'string') continue
    rows[r.id] = r.updated_at === undefined ? null : r.updated_at
    bodies[r.id] = r
  }
  const first = w.pages[0]
  return {
    count: first ? first.total : 0,
    rows,
    bodies,
    pages_walked: w.pages.length,
    capped: w.capped,
    ...(w.error ? { error: w.error } : {}),
  }
}

async function watermarks(fetchImpl, cfg) {
  return {
    appointments: await watermark(fetchImpl, cfg, '/v1/appointments', APPT_RANGE_PAGE_SIZE, 'appointments'),
    customers: await watermark(fetchImpl, cfg, '/v1/customers', CUSTOMER_PAGE_SIZE, 'customers'),
    // core's staff-shift list has a business-wide form (store_id optional,
    // src/validations/staff-shift.ts:38 @7d2f629) — no per-store walk needed.
    staff_shifts: await watermark(fetchImpl, cfg, '/v1/staff-shifts', SHIFT_PAGE_SIZE, 'shifts'),
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
  if (run === 'after' && !cfg.before) throw Object.assign(new Error('An after run needs the before run file.'), { code: 'USAGE' })
  const daysAhead = run === 'after' ? cfg.before.days_ahead : cfg.daysAhead === undefined ? DEFAULT_DAYS_AHEAD : cfg.daysAhead
  if (run === 'before' && !daysAheadOk(daysAhead)) throw Object.assign(new Error(`--days-ahead must be a whole number from 1 to ${MAX_DAYS_AHEAD}.`), { code: 'USAGE' })
  const dates = run === 'after' ? cfg.before.dates.slice() : datesAfter(today, daysAhead)
  const [D1, D2, D3] = dates
  const errors = []
  const capped = []
  const listed = (name, w) => {
    if (w.error) errors.push({ query: name, ...w.error })
    if (w.capped) capped.push(name)
    return w.pages
  }

  const noteWalls = (wm, label) => {
    for (const [k, w] of Object.entries(wm)) {
      if (w.capped) capped.push(`${label}.${k}`)
      if (w.error) errors.push({ query: `${label}.${k}`, ...w.error })
    }
  }
  // Watermark at the START (business-wide, no date filter), each list walked at the door's maximum page size.
  const wm = await watermarks(fetchImpl, cfg)
  noteWalls(wm, 'watermark')

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
  for (const id of pins.appointment_ids) Q4[id] = await single(fetchImpl, cfg, `/v1/appointments/${encodeURIComponent(id)}`, 'Q4', id, errors)

  // Q5 — Reserve's read: listAllAppointments (reserve api/_lib/core.ts, page + page_size 500)
  // with store_id + from/to as ISO instants (api/public/availability.ts:183-187), over D1..D3.
  const Q5 = listed('Q5', await walk(fetchImpl, cfg, '/v1/appointments',
    [['from', jstStart(D1)], ['to', jstEnd(D3)], ['store_id', STORE_ID]], RESERVE_PAGE_SIZE, 'appointments'))

  // Q6 — GET /v1/customers/:id for the pinned customers.
  const Q6customers = {}
  for (const id of pins.customer_ids) Q6customers[id] = await single(fetchImpl, cfg, `/v1/customers/${encodeURIComponent(id)}`, 'Q6', id, errors)

  // Q7 — staff shifts per day D1..D3 (core GET /v1/staff-shifts?date=, src/validations/staff-shift.ts:37-41 @7d2f629).
  // karute has no staff-shift core module (no door lists shifts from core today) — the route's own shape.
  const Q7 = []
  for (const d of dates) {
    Q7.push(...listed(`Q7:${d}`, await walk(fetchImpl, cfg, '/v1/staff-shifts', [['date', d], ['store_id', STORE_ID]], SHIFT_PAGE_SIZE, 'shifts')))
  }

  // Watermark again at the END: any difference from the start = a write landed mid-run (VOID).
  const wmEnd = await watermarks(fetchImpl, cfg)
  noteWalls(wmEnd, 'watermark_end')
  const watermarkEnd = Object.fromEntries(Object.entries(wmEnd).map(([k, w]) => [k, { count: w.count, rows: w.rows, pages_walked: w.pages_walked, capped: w.capped }]))

  let coreHost = null
  try { coreHost = new URL(cfg.baseUrl).host } catch { coreHost = null }

  return {
    run,
    written_at: new Date(now).toISOString(),
    core_host: coreHost,
    business_id: BUSINESS_ID,
    store_id: STORE_ID,
    today,
    days_ahead: daysAhead,
    dates,
    pins,
    watermark: wm,
    watermark_end: watermarkEnd,
    answers: { Q1, Q2, Q3, Q4, Q5, Q6: { list: Q6list, customers: Q6customers }, Q7 },
    thin: rowsOf(Q1, 'appointments').length === 0,
    capped,
    errors,
  }
}

// ── diff ───────────────────────────────────────────────────────────────────

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

const RUN_KEYS = ['run', 'written_at', 'core_host', 'business_id', 'store_id', 'dates', 'pins', 'watermark', 'answers']

/** R-4: null when the two files are a before run and a later after run of the same read; else one plain sentence. */
function checkInputs(before, after) {
  for (const [name, r] of [['before', before], ['after', after]]) {
    if (!isObj(r) || Array.isArray(r)) return `The ${name} file is not a run file (it is not a JSON object).`
    const missing = RUN_KEYS.filter((k) => !(k in r))
    if (missing.length) return `The ${name} file is not a run file (it lacks ${missing.join(', ')}).`
  }
  if (before.run !== 'before') return `The --before file is a "${before.run}" run, not a "before" run.`
  if (after.run !== 'after') return `The --after file is a "${after.run}" run, not an "after" run.`
  if (!(Date.parse(after.written_at) > Date.parse(before.written_at))) return 'The after file\'s written_at is not later than the before file\'s written_at.'
  for (const k of ['core_host', 'business_id', 'store_id']) {
    if (before[k] !== after[k]) return `The two files read a different ${k}.`
  }
  if (canon(before.dates) !== canon(after.dates)) return 'The two files read different dates.'
  if (canon(before.pins) !== canon(after.pins)) return 'The two files carry different pins (pinned ids).'
  return null
}

/** Why ONE run cannot be trusted on its own: errors, a cap, or a write between its start and end watermark. */
function runVoidReasons(run) {
  const out = []
  const name = run.run || 'a'
  const errors = Array.isArray(run.errors) ? run.errors : []
  if (errors.length) out.push(`the ${name} run had ${errors.length} request(s) answer an error or a wrong shape (${errors.slice(0, 5).map((e) => `${e.query}${e.id ? ` ${e.id}` : ''} → ${e.status}`).join('; ')})`)
  const capped = (Array.isArray(run.capped) && run.capped.length) || Object.values(run.watermark || {}).some((w) => w && w.capped)
  if (capped) out.push(`the ${name} run hit the 100-page cap`)
  const end = run.watermark_end
  if (!isObj(end)) out.push(`the ${name} run carries no end-of-run watermark`)
  else {
    for (const k of WATERMARK_KINDS) {
      const s = (run.watermark || {})[k] || {}
      const e = end[k] || {}
      if (s.count !== e.count || canon(s.rows) !== canon(e.rows)) out.push(`the Dev Salon's ${k} changed while the ${name} run was reading (a write landed mid-run)`)
    }
  }
  return out
}

const LIST_QUERIES = [['Q1', 'appointments'], ['Q2', 'appointments'], ['Q3', 'appointments'], ['Q5', 'appointments'], ['Q7', 'shifts']]
const APPT_GROUPS = new Set(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'watermark:appointments'])
// Which watermark kind each answer group's rows belong to (R2-2: a crawl-only updated_at move is the crawl's, not a changed answer).
const GROUP_KIND = { Q1: 'appointments', Q2: 'appointments', Q3: 'appointments', Q4: 'appointments', Q5: 'appointments', Q6: 'customers', 'Q6:customers': 'customers', Q7: 'staff_shifts' }

/** R-6: every list answer as {id → row} (pages and order dropped) + its id order; singles as they are. */
function normalize(run) {
  const ans = isObj(run.answers) ? run.answers : {}
  const groups = {}
  const order = {}
  const list = (name, pages, key) => {
    const rows = {}
    const seq = []
    for (const p of Array.isArray(pages) ? pages : []) {
      for (const r of isObj(p) && Array.isArray(p[key]) ? p[key] : []) {
        const id = isObj(r) && typeof r.id === 'string' ? r.id : `#${seq.length}`
        rows[id] = r
        seq.push(id)
      }
    }
    groups[name] = rows
    order[name] = seq
  }
  for (const [q, key] of LIST_QUERIES) list(q, ans[q], key)
  list('Q6', isObj(ans.Q6) ? ans.Q6.list : [], 'customers')
  groups.Q4 = isObj(ans.Q4) ? ans.Q4 : {}
  groups['Q6:customers'] = isObj(ans.Q6) && isObj(ans.Q6.customers) ? ans.Q6.customers : {}
  for (const k of WATERMARK_KINDS) {
    const w = (run.watermark || {})[k]
    groups[`watermark:${k}`] = isObj(w) && isObj(w.bodies) ? w.bodies : {}
  }
  return { groups, order }
}

const shape = (group, path) => `${group}.{id}${path.map((k) => (/^\d+$/.test(k) ? '.[]' : `.${k}`)).join('')}`
const isAppointmentRow = (group, row) => APPT_GROUPS.has(group) && isObj(row) && typeof row.id === 'string' && !('status' in row && 'json' in row && Object.keys(row).length === 2)
const listIds = (ids, n = 5) => `${ids.slice(0, n).join(', ')}${ids.length > n ? ` and ${ids.length - n} more` : ''}`

/**
 * R2-1 THE VERDICT, in this order and nowhere else:
 *   (1) an error in either run (or a capped read) → VOID
 *   (2) the watermark moved between the START and the END of either run (a write mid-run) → VOID
 *   (3) a row in one run only, or a non-updated_at field changed on any row (a real write;
 *       the dates/pins/count/date-guard mismatches sit here too: the two runs are not one read) → VOID
 *   (4) ANY FAIL (R-1 new fields · a changed answer leaf · updated_at alone on a row the crawl
 *       does not touch) → FAIL, the crawl-only notes still printed under it
 *   (5) only crawl-only updated_at moves → VOID 「the sync wrote; run again with the sync paused」
 *   (6) else PASS. A FAIL is never hidden by a crawl-only VOID.
 */
function diff(before, after, opts = {}) {
  const voids = [] // (1)–(3)
  const fails = [] // (4)
  const crawlNotes = [] // (5)
  const notes = []
  const today = opts.today

  // VOID: either run on its own, then the two runs against each other.
  voids.push(...runVoidReasons(before), ...runVoidReasons(after))
  if (canon(before.dates) !== canon(after.dates)) voids.push('the two runs read different dates')
  if (canon(before.pins) !== canon(after.pins)) voids.push('the two runs pinned different ids')
  if (today !== undefined) {
    const g = guardDates(after, today)
    if (!g.ok) voids.push(g.reason)
  }

  // R-2: the watermark per row (business-wide), always compared.
  // R2-2 the rows the crawl touches with updated_at alone (core @7d2f629):
  //  - an appointment whose source is QUICKRESERVE: the crawl rewrites it on every pass
  //    (sync.service.ts:891-894, Prisma @updatedAt);
  //  - ANY customer: every crawled reservation runs findOrCreateCustomer (sync.service.ts:445),
  //    a matched customer goes through reconcileExisting (:770-806), which always calls
  //    prisma.customer.update (:798, retry :804) with externalRefs.quickreserve set — so
  //    updated_at moves with every other field equal; customers carry no `source`.
  //  Staff shifts have no crawl (only staff-shift.service.ts writes them): updated_at alone = FAIL.
  const crawlIds = { appointments: new Set(), customers: new Set(), staff_shifts: new Set() }
  const moves = []
  for (const k of WATERMARK_KINDS) {
    const b = (before.watermark || {})[k] || {}
    const a = (after.watermark || {})[k] || {}
    if (b.count !== a.count) voids.push(`the ${k} count moved (${b.count} → ${a.count})`)
    const bRows = isObj(b.rows) ? b.rows : {}
    const aRows = isObj(a.rows) ? a.rows : {}
    const oneSide = []
    const realWrite = []
    const crawled = []
    const backfill = []
    for (const id of new Set([...Object.keys(bRows), ...Object.keys(aRows)])) {
      if (!(id in bRows) || !(id in aRows)) { oneSide.push(id); continue }
      const bb = (b.bodies || {})[id]
      const ab = (a.bodies || {})[id]
      const other = Object.keys(isObj(bb) ? bb : {}).find((f) => f !== 'updated_at' && canon(bb[f]) !== canon(isObj(ab) ? ab[f] : undefined))
      if (other !== undefined) { realWrite.push(`${id} (${other})`); continue }
      if (canon(bRows[id]) === canon(aRows[id])) continue
      if (k === 'customers' || (k === 'appointments' && isObj(bb) && bb.source === CRAWL_SOURCE)) { crawled.push(id); crawlIds[k].add(id) } else backfill.push(id)
      moves.push({ kind: k, id, before: bRows[id], after: aRows[id], source: isObj(bb) ? bb.source : undefined })
    }
    if (oneSide.length) voids.push(`${oneSide.length} ${k} row(s) exist in one run only — a real write; run the check again (${listIds(oneSide)})`)
    if (realWrite.length) voids.push(`${realWrite.length} ${k} row(s) changed a field other than updated_at — a real write; run the check again (${listIds(realWrite)})`)
    const why = k === 'customers' ? 'the QuickReserve crawl rewrites the matched customer on every reservation' : `source ${CRAWL_SOURCE}`
    if (crawled.length) crawlNotes.push(`only updated_at moved on ${crawled.length} crawled ${k} row(s) (${why}): the sync wrote; run again with the sync paused (${listIds(crawled)})`)
    if (backfill.length) fails.push(`updated_at moved on ${backfill.length} ${k} row(s) whose every other field is equal — the back-fill must move updated_at on no row (${listIds(backfill)})`)
  }

  // The answers: every BEFORE leaf byte-equal in AFTER; lists as sets keyed by id; first difference per row.
  const B = normalize(before)
  const A = normalize(after)
  const changed = []
  for (const group of Object.keys(B.groups)) {
    if (group.startsWith('watermark:')) continue
    const bg = B.groups[group]
    const ag = A.groups[group] || {}
    for (const id of Object.keys(bg)) {
      if (!(id in ag)) { changed.push({ query: group, id, path: '(row)', before: 'present', after: '(missing)' }); continue }
      const crawlOnly = crawlIds[GROUP_KIND[group]] && crawlIds[GROUP_KIND[group]].has(id)
      for (const [path, value] of leaves(bg[id])) {
        const got = at(ag[id], path)
        if (got.found && canon(got.value) === canon(value)) continue
        if (crawlOnly && path.length === 1 && path[0] === 'updated_at') continue // the crawl's move, noted above
        changed.push({ query: group, id, path: path.join('.'), before: value, after: got.found ? got.value : '(missing)' })
        break
      }
    }
    for (const id of Object.keys(ag)) if (!(id in bg)) changed.push({ query: group, id, path: '(row)', before: '(missing)', after: 'present' })
    if (B.order[group] && canon(B.order[group]) !== canon(A.order[group]) && canon([...B.order[group]].sort()) === canon([...(A.order[group] || [])].sort())) {
      notes.push(`${group}: order changed, rows equal`)
    }
  }
  if (changed.length) fails.push(`${changed.length} existing answer(s) changed`)

  // R-1: the appointment JSON gains EXACTLY the four C0 fields, on every appointment, and nothing else changes shape.
  const newPaths = new Set()
  const odd = new Set()
  const lacking = []
  for (const group of Object.keys(A.groups)) {
    const bg = B.groups[group] || {}
    const ag = A.groups[group]
    for (const id of Object.keys(ag)) {
      if (isAppointmentRow(group, ag[id]) && !C0_NEW_FIELDS.every((f) => f in ag[id])) lacking.push(`${group} ${id}`)
      if (!(id in bg)) continue
      for (const [path] of leaves(ag[id])) {
        for (let i = 1; i <= path.length; i++) {
          const pre = path.slice(0, i)
          if (at(bg[id], pre).found) continue
          const parent = at(ag[id], pre.slice(0, -1))
          if (parent.found) { // an array that grows is a new path too (NIT N-2)
            const p = shape(group, pre)
            newPaths.add(p)
            if (!(APPT_GROUPS.has(group) && pre.length === 1 && C0_NEW_FIELDS.includes(pre[0]))) odd.add(p)
          }
          break
        }
      }
    }
  }
  if (newPaths.size === 0) fails.push('no new field at all — the deploy does not serve the new shape')
  if (odd.size) fails.push(`a field other than the four C0 fields appeared: ${[...odd].sort().join(', ')}`)
  if (lacking.length) fails.push(`the four C0 fields are missing on ${lacking.length} appointment object(s) — the deploy does not serve the new shape (${listIds(lacking)})`)

  const verdict = voids.length ? 'VOID' : fails.length ? 'FAIL' : crawlNotes.length ? 'VOID' : 'PASS'
  return {
    verdict,
    reasons: [...voids, ...fails, ...crawlNotes],
    crawl: crawlNotes,
    changed,
    notes,
    watermark_moves: moves,
    new_fields: { paths: [...newPaths].sort(), odd: [...odd].sort(), verdict: odd.size || lacking.length || !newPaths.size ? 'FAIL' : 'PASS' },
  }
}

/** The plain-English block Liam reads. */
function summarize(result, before, after) {
  const lines = [`SAME-ANSWERS VERDICT: ${result.verdict}`]
  if (result.verdict === 'PASS') lines.push('Every existing field of every answer is unchanged, and the appointments gained exactly the four C0 fields.')
  if (result.verdict === 'VOID') lines.push('Not run: the check could not be trusted this time (reasons below).')
  for (const r of result.reasons) lines.push(`- ${r}`)
  for (const n of result.notes) lines.push(`  note: ${n}`)
  for (const c of result.changed.slice(0, 50)) lines.push(`  changed: ${c.query} ${c.id || ''} at ${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`)
  if (result.changed.length > 50) lines.push(`  … and ${result.changed.length - 50} more (see the JSON)`)
  lines.push(`New fields: ${result.new_fields.paths.length ? result.new_fields.paths.join(', ') : 'none'} — ${result.new_fields.verdict}`)
  const wm = (run) => run && run.watermark
    ? WATERMARK_KINDS.map((k) => `${k.replace('_', ' ')} ${run.watermark[k] && run.watermark[k].count}`).join(', ')
    : '(none)'
  lines.push(`Counts before: ${wm(before)}`)
  lines.push(`Counts after:  ${wm(after)}`)
  if ((before && before.thin) || (after && after.thin)) lines.push('Thin: the store list (Q1) returned no bookings on D1..D2 — the check still ran, but proves less.')
  return lines.join('\n')
}

const EXIT = { PASS: 0, FAIL: 1, VOID: 2, USAGE: 3 }

module.exports = {
  BUSINESS_ID, STORE_ID, PAGE_CAP, TIMEOUT_MS, PIN_COUNT, CUSTOMER_PIN_COUNT, CRAWL_SOURCE, C0_NEW_FIELDS, EXIT,
  DEFAULT_DAYS_AHEAD, MAX_DAYS_AHEAD,
  jstToday, datesAfter, daysAheadOk, guardDates, pickPins, collect, checkInputs, runVoidReasons, diff, summarize,
}
