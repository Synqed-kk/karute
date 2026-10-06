/**
 * C0 (CORE-59) — the same-answers tool (scripts/lib/c0-same-answers-core.cjs) against
 * the order's double: collect builds the run file; diff answers PASS / FAIL / VOID;
 * the CLI's diff subcommand end-to-end (exit 0 / 1 / 2 / 3). No network, no core key.
 */
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { CoreDouble } from './fixtures/c0/core-double'

type Run = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Diff = { verdict: 'PASS' | 'FAIL' | 'VOID'; reasons: string[]; notes: string[]; changed: Array<{ query: string; id?: string; path: string }>; new_fields: { paths: string[]; odd: string[]; verdict: string } }
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>
type CoreModule = {
  BUSINESS_ID: string; STORE_ID: string; MAX_DAYS_AHEAD: number
  collect(fetchImpl: unknown, cfg: Record<string, unknown>): Promise<Run>
  diff(before: Run, after: Run, opts?: { today?: string }): Diff
  summarize(result: Diff, before: Run, after: Run): string
  checkInputs(before: unknown, after: unknown): string | null
  pickPins(rows: unknown[], customers: unknown[]): { appointment_ids: string[]; customer_ids: string[]; unmet: string[] }
  datesAfter(today: string, daysAhead?: number): string[]
  guardDates(run: Run, today: string): { ok: boolean; reason: string | null }
  jstToday(ms: number): string
}

const ROOT = path.resolve(__dirname, '../../../..')
const core = createRequire(__filename)(path.join(ROOT, 'scripts/lib/c0-same-answers-core.cjs')) as CoreModule
const NOW = Date.parse('2026-10-07T03:00:00.000Z') // JST 2026-10-07 12:00
const LATER = NOW + 3600_000
const TODAY = '2026-10-07'
const BASE = 'http://core.double.invalid'
const OTHER_STORE = '50000000-0000-4000-8000-000000000002'

function seededDouble(): CoreDouble {
  const d = new CoreDouble({ businessId: core.BUSINESS_ID, storeIds: [core.STORE_ID, OTHER_STORE] })
  d.c0Fields = false // the "before" core
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+09:00`).toISOString()
  const [D1, D2] = core.datesAfter(TODAY)
  const statuses = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'SCHEDULED', 'SCHEDULED']
  statuses.forEach((status, i) => d.seedAppointment({ store_id: core.STORE_ID, status, starts_at: at(i % 2 ? D2 : D1, `1${i}:00`), ends_at: at(i % 2 ? D2 : D1, `1${i}:45`) }))
  d.seedAppointment({ store_id: core.STORE_ID, starts_at: at(D1, '17:00'), ends_at: at(D1, '17:30'), occupied_until: at(D1, '17:45') })
  d.seedAppointment({ store_id: core.STORE_ID, source: 'QUICKRESERVE', starts_at: at(D2, '18:00'), ends_at: at(D2, '18:30') })
  d.seedAppointment({ store_id: OTHER_STORE, starts_at: at(D1, '11:00'), ends_at: at(D1, '12:00') })
  for (let i = 0; i < 4; i++) d.seedCustomer({ email: `c${i}@example.test` }) // four customers, one name: core's sort has ties
  for (const day of core.datesAfter(TODAY)) d.seedShift({ store_id: core.STORE_ID, staff_id: 'st-1', date: day })
  return d
}

const collectWith = (fetchImpl: unknown, run: 'before' | 'after', before?: Run, extra: Record<string, unknown> = {}) =>
  core.collect(fetchImpl, { baseUrl: BASE, headers: {}, run, before, now: run === 'after' ? LATER : NOW, ...extra })
const collect = (d: CoreDouble, run: 'before' | 'after', before?: Run) => collectWith(d.asFetch(), run, before)
const clone = (r: Run): Run => JSON.parse(JSON.stringify(r))
const afterC0 = async () => { d.c0Fields = true; return clone(await collect(d, 'after', before)) }
const judge = (after: Run, b: Run = before) => core.diff(b, after, { today: TODAY })

let d: CoreDouble
let before: Run
beforeEach(async () => {
  d = seededDouble()
  before = await collect(d, 'before')
})

describe('collect', () => {
  it('builds the run file: seven queries, the per-row watermark at start and end, pins and dates — all GETs', async () => {
    expect(Object.keys(before.answers).sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'])
    expect(before.dates).toEqual(['2026-10-14', '2026-10-15', '2026-10-16'])
    expect(before.days_ahead).toBe(7)
    expect(before.today).toBe(TODAY)
    expect(before.core_host).toBe('core.double.invalid')
    expect(before.watermark.appointments).toEqual(expect.objectContaining({ count: 10, capped: false }))
    expect(Object.keys(before.watermark.appointments.rows)).toHaveLength(10)
    expect(before.watermark.customers.count).toBe(4)
    expect(before.watermark.staff_shifts.count).toBe(3)
    expect(before.watermark_end.appointments.rows).toEqual(before.watermark.appointments.rows)
    expect(before.thin).toBe(false)
    expect(before.errors).toEqual([])
    expect(before.answers.Q1[0].appointments).toHaveLength(9)
    expect(before.answers.Q2[0].appointments).toHaveLength(10)
    expect(before.answers.Q3[0].appointments.map((a: Run) => a.status)).not.toEqual(expect.arrayContaining(['CANCELLED']))
    expect(Object.keys(before.answers.Q4)).toEqual(before.pins.appointment_ids)
    expect(Object.keys(before.answers.Q6.customers)).toHaveLength(3)
    expect(before.answers.Q7).toHaveLength(3)
    expect(d.requests.every((r) => r.method === 'GET')).toBe(true)
  })
  it('pins cover every status, a non-null occupied_until and a crawled row', () => {
    const pinned = before.pins.appointment_ids.map((id: string) => before.answers.Q4[id])
    expect(new Set(pinned.map((a: Run) => a.status))).toEqual(new Set(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']))
    expect(pinned.some((a: Run) => a.occupied_until !== null)).toBe(true)
    expect(pinned.some((a: Run) => a.source === 'QUICKRESERVE')).toBe(true)
    expect(before.pins.unmet).toEqual([])
    expect(core.pickPins([{ id: 'a', status: 'SCHEDULED', occupied_until: null, source: 'KARUTE' }], []).unmet).toHaveLength(2)
  })
  it('R-7: --days-ahead N moves D1 to today+N; 0 and MAX+1 are refused; the after run takes the before file\'s dates', async () => {
    expect(core.MAX_DAYS_AHEAD).toBe(11)
    expect((await collectWith(d.asFetch(), 'before', undefined, { daysAhead: 11 })).dates).toEqual(['2026-10-18', '2026-10-19', '2026-10-20'])
    await expect(collectWith(d.asFetch(), 'before', undefined, { daysAhead: 12 })).rejects.toMatchObject({ code: 'USAGE' })
    await expect(collectWith(d.asFetch(), 'before', undefined, { daysAhead: 0 })).rejects.toMatchObject({ code: 'USAGE' })
    const short = await collectWith(d.asFetch(), 'before', undefined, { daysAhead: 1 })
    expect((await collect(d, 'after', short)).dates).toEqual(['2026-10-08', '2026-10-09', '2026-10-10'])
  })
  it('R-11 (NIT-7): an after collect without the before run file is refused (USAGE)', async () => {
    await expect(collect(d, 'after')).rejects.toMatchObject({ code: 'USAGE' })
  })
  it('R-11 (N1): a thrown fetch message is stored scrubbed of the key value and the auth header name', async () => {
    const KEY = 'sk-fake-0123456789'
    const throwing = async () => { throw new Error(`GET ${BASE}/v1/appointments failed: x-api-key: ${KEY} refused`) }
    const run = await core.collect(throwing, { baseUrl: BASE, headers: { 'x-api-key': KEY }, run: 'before', now: NOW })
    const text = JSON.stringify(run)
    expect(run.errors.length).toBeGreaterThan(0)
    expect(text).not.toContain(KEY)
    expect(text.toLowerCase()).not.toContain('x-api-key')
    expect(text).toContain('[key]')
  })
})

describe('diff — R-1 the appointment JSON gains exactly the four fields', () => {
  it('exactly the four on every appointment → PASS', async () => {
    const r = judge(await afterC0())
    expect(r.verdict).toBe('PASS')
    expect(r.new_fields.paths).toEqual(expect.arrayContaining(['Q1.{id}.revision', 'Q4.{id}.hold_from', 'watermark:appointments.{id}.holds_managed']))
    expect(r.new_fields.odd).toEqual([])
  })
  it('no new field at all → FAIL', async () => {
    const r = judge(await collect(d, 'after', before))
    expect(r.verdict).toBe('FAIL')
    expect(r.reasons.join(' ')).toContain('no new field at all')
  })
  it.each([
    ['a fifth field on one appointment', (a: Run) => { a.answers.Q2[0].appointments[0].surprise = 1 }, 'Q2.{id}.surprise'],
    ['voided_at on every appointment', (a: Run) => { for (const p of a.answers.Q1) for (const x of p.appointments) x.voided_at = null }, 'Q1.{id}.voided_at'],
    ['deleted_by on every listed customer', (a: Run) => { for (const p of a.answers.Q6.list) for (const x of p.customers) x.deleted_by = null }, 'Q6.{id}.deleted_by'],
    ['a fifth field on a shift', (a: Run) => { a.watermark.staff_shifts.bodies[Object.keys(a.watermark.staff_shifts.bodies)[0]].revision = 0 }, 'watermark:staff_shifts.{id}.revision'],
  ])('%s → FAIL naming the path', async (_name, mutate, odd) => {
    const after = await afterC0()
    mutate(after)
    const r = judge(after)
    expect(r.verdict).toBe('FAIL')
    expect(r.new_fields.odd).toContain(odd)
  })
  it('the four missing on one row → FAIL', async () => {
    const after = await afterC0()
    delete after.answers.Q1[0].appointments[0].revision
    const r = judge(after)
    expect(r.verdict).toBe('FAIL')
    expect(r.reasons.join(' ')).toContain('missing on 1 appointment object')
  })
})

describe('diff — the answers', () => {
  it.each([
    ['Q1', (a: Run) => { a.answers.Q1[0].appointments[2].title = 'changed' }],
    ['Q2', (a: Run) => { a.answers.Q2[0].appointments[0].title = 'changed' }],
    ['Q3', (a: Run) => { a.answers.Q3[0].appointments[0].title = 'changed' }],
    ['Q4', (a: Run) => { a.answers.Q4[a.pins.appointment_ids[0]].title = 'changed' }],
    ['Q5', (a: Run) => { a.answers.Q5[0].appointments[0].status = 'CANCELLED' }],
    ['Q6', (a: Run) => { a.answers.Q6.list[0].customers[0].name = 'changed' }],
    ['Q6:customers', (a: Run) => { a.answers.Q6.customers[a.pins.customer_ids[0]].name = 'changed' }],
    ['Q7', (a: Run) => { a.answers.Q7[0].shifts[0].start = 0 }],
  ])('one changed leaf in %s → FAIL naming the query and the row', async (query, mutate) => {
    const after = await afterC0()
    mutate(after)
    const r = judge(after)
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query, id: expect.any(String) })])
  })
  it('R-6: two same-name customers in the other order → PASS + "order changed, rows equal"', async () => {
    d.customerTiesReversed = true
    const after = await afterC0()
    expect(after.answers.Q6.list[0].customers.map((c: Run) => c.id)).not.toEqual(before.answers.Q6.list[0].customers.map((c: Run) => c.id))
    const r = judge(after)
    expect(r.verdict).toBe('PASS')
    expect(r.notes).toContain('Q6: order changed, rows equal')
    expect(core.summarize(r, before, after)).toContain('order changed, rows equal')
  })
  it.each([
    ['the watermark count moved', (a: Run) => { a.watermark.appointments.count += 1 }],
    ['a read was capped', (a: Run) => { a.watermark.staff_shifts.capped = true }],
    ['the dates differ', (a: Run) => { a.dates = ['2026-10-15', '2026-10-16', '2026-10-17'] }],
    ['the pins differ', (a: Run) => { a.pins.appointment_ids = a.pins.appointment_ids.slice(1) }],
    ['a list query answered an error', (a: Run) => { a.errors = [{ query: 'Q1', page: 1, status: 500 }] }],
  ])('%s → VOID', async (_name, mutate) => {
    const after = await afterC0()
    mutate(after)
    expect(judge(after).verdict).toBe('VOID')
  })
  it('guardDates: today on or after D1 → VOID; datesAfter is strictly after today', async () => {
    expect(core.guardDates(before, '2026-10-14').ok).toBe(false)
    expect(core.guardDates(before, '2026-10-20').ok).toBe(false)
    expect(core.guardDates(before, '2026-10-13').ok).toBe(true)
    expect(core.diff(before, await afterC0(), { today: '2026-10-14' }).verdict).toBe('VOID')
    for (const today of ['2026-12-31', '2027-02-28', TODAY]) expect(core.datesAfter(today).every((x) => x > today)).toBe(true)
    expect(core.jstToday(Date.parse('2026-10-07T15:30:00.000Z'))).toBe('2026-10-08')
  })
})

describe('diff — R-2 the watermark per row', () => {
  const apptOf = (pred: (a: Run) => boolean) => [...d.appts.values()].find(pred)!
  it('a write between the start and the end of one run → VOID (mid-run)', async () => {
    const base = d.asFetch()
    let n = 0
    const racing: FetchLike = async (url, init) => {
      n += 1
      if (n === 4) d.applyPatch(apptOf((a) => a.source === 'KARUTE').id, { title: 'mid-run' })
      return base(url, init)
    }
    d.c0Fields = true
    const r = judge(await collectWith(racing, 'after', before))
    expect(r.verdict).toBe('VOID')
    expect(r.reasons.join(' ')).toContain('a write landed mid-run')
  })
  it('a row present in one run only → VOID', async () => {
    d.seedAppointment({ store_id: core.STORE_ID, starts_at: '2026-11-01T01:00:00.000Z', ends_at: '2026-11-01T02:00:00.000Z' })
    const r = judge(await afterC0())
    expect(r.verdict).toBe('VOID')
    expect(r.reasons.join(' ')).toContain('in one run only')
  })
  it('a field other than updated_at changed on a row → VOID (a real write)', async () => {
    d.applyPatch(apptOf((a) => a.source === 'KARUTE').id, { notes: 'written' })
    const r = judge(await afterC0())
    expect(r.verdict).toBe('VOID')
    expect(r.reasons.join(' ')).toContain('a field other than updated_at')
  })
  it('only updated_at moved on a QUICKRESERVE row → VOID, "the sync wrote" on stdout', async () => {
    apptOf((a) => a.source === 'QUICKRESERVE').updated_at = '2026-10-07T03:30:00.000Z'
    const after = await afterC0()
    const r = judge(after)
    expect(r.verdict).toBe('VOID')
    expect(core.summarize(r, before, after)).toContain('the sync wrote; run again with the sync paused')
  })
  it('only updated_at moved on any other row → FAIL (the back-fill moved it)', async () => {
    apptOf((a) => a.source === 'KARUTE' && a.store_id === OTHER_STORE).updated_at = '2026-10-07T03:30:00.000Z'
    const r = judge(await afterC0())
    expect(r.verdict).toBe('FAIL')
    expect(r.reasons.join(' ')).toContain('the back-fill must move updated_at on no row')
  })
})

describe('diff — R-3 errors are never silent', () => {
  const failingSingles = (base: FetchLike): FetchLike => async (url, init) =>
    /^\/v1\/appointments\/[^/]+$/.test(new URL(url).pathname) ? { status: 500, ok: false, json: async () => ({ error: 'boom' }) } : base(url, init)
  it('a failing Q4 single in one run → VOID; in both → VOID', async () => {
    d.c0Fields = true
    const badAfter = await collectWith(failingSingles(d.asFetch()), 'after', before)
    expect(badAfter.errors).toEqual(expect.arrayContaining([expect.objectContaining({ query: 'Q4', status: 500 })]))
    expect(judge(badAfter).verdict).toBe('VOID')
    d.c0Fields = false
    const badBefore = await collectWith(failingSingles(d.asFetch()), 'before')
    d.c0Fields = true
    expect(judge(badAfter, badBefore).verdict).toBe('VOID')
    expect(judge(await collect(d, 'after', badBefore), badBefore).verdict).toBe('VOID')
  })
  it('an HTML 200 (a body that is not JSON) → errors recorded → VOID', async () => {
    const html: FetchLike = async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } })
    const after = await collectWith(html, 'after', before)
    expect(after.errors.length).toBeGreaterThan(0)
    expect(judge(after).verdict).toBe('VOID')
  })
})

describe('the CLI diff subcommand (exit codes)', () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), 'c0-same-answers-'))
  const cli = (b: string, a: string) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/c0-same-answers.mjs'), 'diff', '--before', b, '--after', a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' } })
  it('exits 0 PASS · 1 FAIL · 2 VOID on saved run files', async () => {
    const after = await afterC0()
    const tmp = dir()
    const write = (name: string, run: Run) => { const p = path.join(tmp, name); writeFileSync(p, JSON.stringify(run)); return p }
    const b = write('before.json', before)
    const fail = clone(after); fail.answers.Q5[0].appointments[0].status = 'CANCELLED'
    const voided = clone(after); voided.watermark.appointments.count += 1
    const pass = cli(b, write('after-pass.json', after))
    expect(pass.status).toBe(0)
    expect(pass.stdout).toContain('SAME-ANSWERS VERDICT: PASS')
    expect(cli(b, write('after-fail.json', fail)).status).toBe(1)
    expect(cli(b, write('after-void.json', voided)).status).toBe(2)
  })
  it('R-4: {} vs {} · a file vs itself · null · an after written first → exit 3 with one plain sentence', async () => {
    const after = await afterC0()
    const tmp = dir()
    const write = (name: string, body: string) => { const p = path.join(tmp, name); writeFileSync(p, body); return p }
    const empty = write('empty.json', '{}')
    const a = write('after.json', JSON.stringify(after))
    const b = write('before.json', JSON.stringify(before))
    const early = write('early.json', JSON.stringify({ ...after, written_at: before.written_at }))
    for (const [x, y] of [[empty, empty], [a, a], [b, b], [write('null.json', 'null'), a], [b, early]]) {
      const r = cli(x, y)
      expect(r.status).toBe(3)
      expect(r.stderr.split('\n')[0]).toMatch(/^The .+\.$/)
    }
    expect(core.checkInputs(before, after)).toBeNull()
  })
})

describe('diff — R2-1 the verdict precedence (errors → mid-run → real write → FAIL → crawl-only → PASS)', () => {
  const AT = '2026-10-07T03:30:00.000Z'
  const firstOf = <T,>(m: Map<string, T>, pred: (x: T) => boolean = () => true) => [...m.values()].find(pred)!
  const aFail = (a: Run) => { a.answers.Q5[0].appointments[0].status = 'CANCELLED' }
  const none = () => {}
  type World = (d: CoreDouble) => void
  it.each<[string, World, (a: Run) => void, 'PASS' | 'FAIL' | 'VOID', string[]]>([
    ['nothing moved', none, none, 'PASS', []],
    ['a changed answer leaf alone', none, aFail, 'FAIL', ['existing answer(s) changed']],
    ['an error + a FAIL (errors win)', none, (a) => { aFail(a); a.errors = [{ query: 'Q1', page: 1, status: 500 }] }, 'VOID', ['answer an error']],
    ['a mid-run write + a FAIL', none, (a) => { aFail(a); const rows = a.watermark_end.appointments.rows; rows[Object.keys(rows)[0]] = AT }, 'VOID', ['a write landed mid-run']],
    ['a row in one run only + a FAIL', (x) => { x.seedAppointment({ store_id: core.STORE_ID, starts_at: '2026-11-01T01:00:00.000Z', ends_at: '2026-11-01T02:00:00.000Z' }) }, aFail, 'VOID', ['in one run only']],
    ['a non-updated_at change + a FAIL', (x) => { x.applyPatch(firstOf(x.appts, (a) => a.source === 'KARUTE').id, { notes: 'written' }) }, aFail, 'VOID', ['a field other than updated_at']],
    ['E6: a back-fill rewrites updated_at on every appointment (one QUICKRESERVE row among them)', (x) => { for (const a of x.appts.values()) a.updated_at = AT }, none, 'FAIL', ['the back-fill must move updated_at on no row', 'the sync wrote; run again with the sync paused']],
    ['only the QUICKRESERVE row moved', (x) => { firstOf(x.appts, (a) => a.source === 'QUICKRESERVE').updated_at = AT }, none, 'VOID', ['the sync wrote; run again with the sync paused']],
    ['a crawl-only move + a FAIL (the FAIL is never hidden)', (x) => { firstOf(x.appts, (a) => a.source === 'QUICKRESERVE').updated_at = AT }, aFail, 'FAIL', ['existing answer(s) changed', 'the sync wrote']],
    ['an error + a crawl-only move', (x) => { firstOf(x.appts, (a) => a.source === 'QUICKRESERVE').updated_at = AT }, (a) => { a.errors = [{ query: 'Q1', page: 1, status: 500 }] }, 'VOID', ['answer an error']],
  ])('%s', async (_name, world, edit, verdict, says) => {
    world(d)
    const after = await afterC0()
    edit(after)
    const r = judge(after)
    expect(r.verdict).toBe(verdict)
    const text = core.summarize(r, before, after)
    for (const s of says) expect(text).toContain(s)
    if (verdict === 'FAIL' && says.some((s) => s.includes('the sync wrote'))) expect(r.reasons.indexOf(r.reasons.find((x) => x.includes('the sync wrote'))!)).toBeGreaterThan(0)
  })
})

describe('diff — R2-2 the rows the crawl touches (QUICKRESERVE appointments, every customer; never a shift)', () => {
  const AT = '2026-10-07T03:30:00.000Z'
  it('a customer with only updated_at moved → the crawl note, not a FAIL (VOID)', async () => {
    ;[...d.customers.values()][0].updated_at = AT
    const after = await afterC0()
    const r = judge(after)
    expect(r.verdict).toBe('VOID')
    expect(r.changed).toEqual([])
    expect(core.summarize(r, before, after)).toContain('crawled customers row(s) (the QuickReserve crawl rewrites the matched customer on every reservation): the sync wrote')
  })
  it('a shift with only updated_at moved → FAIL', async () => {
    ;[...d.shifts.values()][0].updated_at = AT
    const r = judge(await afterC0())
    expect(r.verdict).toBe('FAIL')
    expect(r.reasons.join(' ')).toContain('staff_shifts row(s) whose every other field is equal — the back-fill must move updated_at on no row')
  })
  it('both together → FAIL, with the customer note printed under it', async () => {
    ;[...d.customers.values()][0].updated_at = AT
    ;[...d.shifts.values()][0].updated_at = AT
    const after = await afterC0()
    const r = judge(after)
    expect(r.verdict).toBe('FAIL')
    expect(core.summarize(r, before, after)).toContain('crawled customers row(s)')
  })
  // S-1: the crawl-only skip covers the updated_at leaf of a crawled row and nothing more.
  type Page = { appointments: Array<Record<string, unknown>> }
  const q2Row = (a: Run, pick: (r: Record<string, unknown>) => boolean) => (a.answers.Q2 as Page[]).flatMap((p) => p.appointments).find(pick)!
  it('S-1: a QUICKRESERVE row whose updated_at moved AND another leaf changed in a Q answer → FAIL, the changed line names the row', async () => {
    const qr = [...d.appts.values()].find((a) => a.source === 'QUICKRESERVE')!
    qr.updated_at = AT
    const after = await afterC0()
    const row = q2Row(after, (r) => r.id === qr.id)
    const was = row.status
    row.status = was === 'CANCELLED' ? 'SCHEDULED' : 'CANCELLED'
    const r = judge(after)
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query: 'Q2', id: qr.id, path: 'status' })])
    const text = core.summarize(r, before, after)
    expect(text).toContain('1 existing answer(s) changed')
    expect(text).toContain(`changed: Q2 ${qr.id} at status`)
    expect(text).toContain('the sync wrote; run again with the sync paused')
  })
  it('S-1: a non-QUICKRESERVE appointment with only updated_at changed in a Q answer (watermark equal) → FAIL', async () => {
    const after = await afterC0()
    const row = q2Row(after, (r) => r.source !== 'QUICKRESERVE')
    row.updated_at = AT
    const r = judge(after)
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query: 'Q2', id: row.id, path: 'updated_at' })])
    const text = core.summarize(r, before, after)
    expect(text).toContain('1 existing answer(s) changed')
    expect(text).toContain(`changed: Q2 ${String(row.id)} at updated_at`)
    expect(text).not.toContain('the sync wrote')
  })
  it('S-1: a customer with only updated_at changed in the Q6 answer (watermark equal) → FAIL', async () => {
    const after = await afterC0()
    const row = after.answers.Q6.list[0].customers[0]
    row.updated_at = AT
    const r = judge(after)
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query: 'Q6', id: row.id, path: 'updated_at' })])
    const text = core.summarize(r, before, after)
    expect(text).toContain('1 existing answer(s) changed')
    expect(text).toContain(`changed: Q6 ${String(row.id)} at updated_at`)
    expect(text).not.toContain('the sync wrote')
  })
  it('NIT N-2: an array that grows inside a row is a new path → FAIL', async () => {
    const after = await afterC0()
    const b = clone(before)
    const id = b.pins.appointment_ids[0]
    b.answers.Q4[id].zz_list = ['x']
    after.answers.Q4[id].zz_list = ['x', 'y']
    const r = judge(after, b)
    expect(r.verdict).toBe('FAIL')
    expect(r.new_fields.odd).toContain('Q4.{id}.zz_list.[]')
  })
})

describe('the CLI — R2-3 every checkInputs branch → exit 3 naming the field · R2-4 the usage text', () => {
  const cli = (args: string[]) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/c0-same-answers.mjs'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' } })
  it.each<[string, (b: Run, a: Run) => void, RegExp]>([
    ['before.run is not "before"', (b) => { b.run = 'after' }, /^The --before file is a "after" run, not a "before" run\.$/],
    ['after.run is not "after"', (_b, a) => { a.run = 'before' }, /^The --after file is a "before" run, not an "after" run\.$/],
    ['after.written_at is not later', (b, a) => { a.written_at = b.written_at }, /written_at is not later/],
    ['core_host differs', (_b, a) => { a.core_host = 'other.invalid' }, /different core_host\.$/],
    ['business_id differs', (_b, a) => { a.business_id = 'other' }, /different business_id\.$/],
    ['store_id differs', (_b, a) => { a.store_id = 'other' }, /different store_id\.$/],
    ['dates differ', (_b, a) => { a.dates = ['2026-10-15', '2026-10-16', '2026-10-17'] }, /different dates\.$/],
    ['pins differ', (_b, a) => { a.pins = { ...a.pins, appointment_ids: a.pins.appointment_ids.slice(1) } }, /different pins/],
  ])('%s → exit 3, the sentence names it', async (_name, edit, says) => {
    const after = await afterC0()
    const b = clone(before)
    edit(b, after)
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'c0-same-answers-'))
    writeFileSync(path.join(tmp, 'b.json'), JSON.stringify(b))
    writeFileSync(path.join(tmp, 'a.json'), JSON.stringify(after))
    const r = cli(['diff', '--before', path.join(tmp, 'b.json'), '--after', path.join(tmp, 'a.json')])
    expect(r.status).toBe(3)
    expect(r.stderr.split('\n')[0]).toMatch(says)
  })
  it('R2-4: the --days-ahead usage says 11 is conservative from the requested day, and booking_open_days can lower it', () => {
    const r = cli([])
    expect(r.status).toBe(3)
    expect(r.stderr).toContain(`${core.MAX_DAYS_AHEAD} is a conservative ceiling derived from Reserve's default grid (14 days when the store sets no 予約受付期間), measured from the requested day.`)
    expect(r.stderr).toContain("A store's own 予約受付期間 (booking_open_days) can make the real limit lower (N <= booking_open_days - 2): the operator checks it.")
  })
})

describe('diff — R3-3 a container kind is part of the answer (array ↔ object, array length)', () => {
  const withZz = async (b: unknown, a: unknown) => {
    const after = await afterC0()
    const bb = clone(before)
    const id = bb.pins.appointment_ids[0]
    bb.answers.Q4[id].zz_breaks = b
    after.answers.Q4[id].zz_breaks = a
    return { r: judge(after, bb), id }
  }
  it('[600, 900] → {"0": 600, "1": 900} → FAIL naming the path', async () => {
    const { r, id } = await withZz([600, 900], { 0: 600, 1: 900 })
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query: 'Q4', id, path: 'zz_breaks (container: array of 2 → object)' })])
  })
  it('{"0": 600, "1": 900} → [600, 900] → FAIL naming the path', async () => {
    const { r, id } = await withZz({ 0: 600, 1: 900 }, [600, 900])
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query: 'Q4', id, path: 'zz_breaks (container: object → array of 2)' })])
  })
  it('an array that grows → FAIL as a changed leaf, not only a new path', async () => {
    const { r } = await withZz([600], [600, 900])
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query: 'Q4', path: 'zz_breaks (container: array of 1 → array of 2)' })])
  })
  it('the same content on both sides → PASS', async () => {
    expect((await withZz([600, 900], [600, 900])).r.verdict).toBe('PASS')
    expect((await withZz({ 0: 600, 1: 900 }, { 0: 600, 1: 900 })).r.verdict).toBe('PASS')
  })
})

describe('collect — R3-4 an incomplete or doubled list read is an error (→ VOID), never a short answer', () => {
  const errs = (run: Run) => (run.errors as Array<{ query: string; json: unknown }>).map((e) => `${e.query}: ${String(e.json)}`)
  it('honest paging at 2 rows a page (the double ignores page_size 500) → no error, and PASS', async () => {
    d.pageRowsCap = 2
    const b = await collect(d, 'before')
    expect(b.errors).toEqual([])
    expect(b.watermark.appointments.pages_walked).toBe(5)
    d.c0Fields = true
    expect(judge(clone(await collect(d, 'after', b)), b).verdict).toBe('PASS')
  })
  it('(a) an empty page before total rows were read → error → VOID', async () => {
    d.pageRowsCap = 2
    d.shortPage = true
    d.c0Fields = true
    const after = await collect(d, 'after', before)
    expect(errs(after)).toEqual(expect.arrayContaining(['watermark.appointments: an empty page before total rows were read (2 of 10)']))
    expect(judge(after).verdict).toBe('VOID')
    expect(judge(after).reasons.join('\n')).toContain('an empty page before total rows were read')
  })
  it('(b) an id repeated on one page → error → VOID', async () => {
    d.repeatRow = 'onPage'
    d.c0Fields = true
    const after = await collect(d, 'after', before)
    expect(errs(after).some((e) => /^watermark\.appointments: id \S+ repeats/.test(e))).toBe(true)
    expect(judge(after).verdict).toBe('VOID')
  })
  it('(b) an id repeated across pages → error → VOID', async () => {
    d.pageRowsCap = 2
    d.repeatRow = 'acrossPages'
    d.c0Fields = true
    const after = await collect(d, 'after', before)
    expect(errs(after).some((e) => /^watermark\.appointments: id \S+ repeats/.test(e))).toBe(true)
    expect(judge(after).verdict).toBe('VOID')
  })
  it('(c) more unique rows than total → error; fewer (total one higher) → error → VOID', async () => {
    d.c0Fields = true
    d.totalSkew = -1
    const more = await collect(d, 'after', before)
    expect(errs(more)).toEqual(expect.arrayContaining(['watermark.appointments: the walk read 10 unique rows, total says 9']))
    expect(judge(more).verdict).toBe('VOID')
    d.totalSkew = 1
    const fewer = await collect(d, 'after', before)
    expect(errs(fewer)).toEqual(expect.arrayContaining(['watermark.appointments: an empty page before total rows were read (10 of 11)']))
    expect(judge(fewer).verdict).toBe('VOID')
  })
  it('(d) the 100-page cap → capped AND an error line → VOID', async () => {
    for (let i = 0; i < 101; i++) d.seedCustomer({ email: `cap${i}@example.test` })
    d.pageRowsCap = 1
    d.c0Fields = true
    const after = await collect(d, 'after', before)
    expect(after.capped).toEqual(expect.arrayContaining(['watermark.customers', 'Q6']))
    expect(errs(after)).toEqual(expect.arrayContaining(['Q6: the 100-page cap was hit with 100 of 105 rows read']))
    expect(judge(after).verdict).toBe('VOID')
  })
})
