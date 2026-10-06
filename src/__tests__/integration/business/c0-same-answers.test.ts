/**
 * C0 (CORE-59) — the same-answers tool (scripts/lib/c0-same-answers-core.cjs) against
 * the order's double: collect builds the run file; diff answers PASS / FAIL / VOID;
 * the CLI's diff subcommand end-to-end (exit 0 / 1 / 2). No network, no core key.
 */
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { CoreDouble } from './fixtures/c0/core-double'

type Run = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Diff = { verdict: 'PASS' | 'FAIL' | 'VOID'; reasons: string[]; changed: Array<{ query: string; id?: string; path: string }>; new_fields: { expected: boolean; paths: string[]; odd?: string[] } }
type CoreModule = {
  BUSINESS_ID: string; STORE_ID: string
  collect(fetchImpl: unknown, cfg: Record<string, unknown>): Promise<Run>
  diff(before: Run, after: Run, opts?: { today?: string }): Diff
  pickPins(rows: unknown[], customers: unknown[]): { appointment_ids: string[]; customer_ids: string[]; unmet: string[] }
  datesAfter(today: string): string[]
  guardDates(run: Run, today: string): { ok: boolean; reason: string | null }
  jstToday(ms: number): string
}

const ROOT = path.resolve(__dirname, '../../../..')
const core = createRequire(__filename)(path.join(ROOT, 'scripts/lib/c0-same-answers-core.cjs')) as CoreModule
const NOW = Date.parse('2026-10-07T03:00:00.000Z') // JST 2026-10-07 12:00
const BASE = 'http://core.double.invalid'
const OTHER_STORE = '50000000-0000-4000-8000-000000000002'

function seededDouble(): CoreDouble {
  const d = new CoreDouble({ businessId: core.BUSINESS_ID, storeIds: [core.STORE_ID, OTHER_STORE] })
  d.c0Fields = false // the "before" core
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+09:00`).toISOString()
  const [D1, D2] = core.datesAfter('2026-10-07')
  const statuses = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'SCHEDULED', 'SCHEDULED']
  statuses.forEach((status, i) => d.seedAppointment({ store_id: core.STORE_ID, status, starts_at: at(i % 2 ? D2 : D1, `1${i}:00`), ends_at: at(i % 2 ? D2 : D1, `1${i}:45`) }))
  d.seedAppointment({ store_id: core.STORE_ID, starts_at: at(D1, '17:00'), ends_at: at(D1, '17:30'), occupied_until: at(D1, '17:45') })
  d.seedAppointment({ store_id: core.STORE_ID, source: 'QUICKRESERVE', starts_at: at(D2, '18:00'), ends_at: at(D2, '18:30') })
  d.seedAppointment({ store_id: OTHER_STORE, starts_at: at(D1, '11:00'), ends_at: at(D1, '12:00') })
  for (let i = 0; i < 4; i++) d.seedCustomer({ email: `c${i}@example.test` })
  for (const day of core.datesAfter('2026-10-07')) d.seedShift({ store_id: core.STORE_ID, staff_id: 'st-1', date: day })
  return d
}

const collect = (d: CoreDouble, run: 'before' | 'after', before?: Run, now = NOW) =>
  core.collect(d.asFetch(), { baseUrl: BASE, headers: {}, run, before, now })
const clone = (r: Run): Run => JSON.parse(JSON.stringify(r))

let d: CoreDouble
let before: Run
beforeEach(async () => {
  d = seededDouble()
  before = await collect(d, 'before')
})

describe('collect', () => {
  it('builds the run file: seven queries, the watermark, pins and dates — all GETs', async () => {
    expect(Object.keys(before.answers).sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'])
    expect(before.dates).toEqual(['2026-10-14', '2026-10-15', '2026-10-16'])
    expect(before.today).toBe('2026-10-07')
    expect(before.core_host).toBe('core.double.invalid')
    expect(before.watermark.appointments).toEqual(expect.objectContaining({ count: 10, capped: false, max_revision: null }))
    expect(before.watermark.customers.count).toBe(4)
    expect(before.watermark.staff_shifts.count).toBe(3)
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
})

describe('diff', () => {
  it('identical runs → PASS, no new fields', async () => {
    const r = core.diff(before, await collect(d, 'after', before), { today: '2026-10-07' })
    expect(r.verdict).toBe('PASS')
    expect(r.new_fields.paths).toEqual([])
  })
  it('the four C0 fields added on every appointment → PASS + expected', async () => {
    d.c0Fields = true
    const r = core.diff(before, await collect(d, 'after', before), { today: '2026-10-07' })
    expect(r.verdict).toBe('PASS')
    expect(r.new_fields.expected).toBe(true)
    expect(r.new_fields.paths).toEqual(expect.arrayContaining(['Q1.[].appointments.[].revision', 'Q4.{id}.hold_from']))
  })
  it('a fifth new field → PASS + expected false, the path named', async () => {
    d.c0Fields = true
    const after = clone(await collect(d, 'after', before))
    after.answers.Q2[0].appointments[0].surprise = 1
    const r = core.diff(before, after, { today: '2026-10-07' })
    expect(r.verdict).toBe('PASS')
    expect(r.new_fields.expected).toBe(false)
    expect(r.new_fields.odd).toEqual(['Q2.[].appointments.[].surprise'])
  })
  it('one changed leaf → FAIL naming the query and the row id', async () => {
    const after = clone(await collect(d, 'after', before))
    after.answers.Q1[0].appointments[2].title = 'changed'
    const r = core.diff(before, after, { today: '2026-10-07' })
    expect(r.verdict).toBe('FAIL')
    expect(r.changed).toEqual([expect.objectContaining({ query: 'Q1', id: before.answers.Q1[0].appointments[2].id })])
  })
  it.each([
    ['the watermark count moved', (a: Run) => { a.watermark.appointments.count += 1 }],
    ['max_updated_at moved', (a: Run) => { a.watermark.customers.max_updated_at = '2099-01-01T00:00:00.000Z' }],
    ['a read was capped', (a: Run) => { a.watermark.staff_shifts.capped = true }],
    ['the dates differ', (a: Run) => { a.dates = ['2026-10-15', '2026-10-16', '2026-10-17'] }],
    ['the pins differ', (a: Run) => { a.pins.appointment_ids = a.pins.appointment_ids.slice(1) }],
  ])('%s → VOID', async (_name, mutate) => {
    const after = clone(await collect(d, 'after', before))
    mutate(after)
    expect(core.diff(before, after, { today: '2026-10-07' }).verdict).toBe('VOID')
  })
  it('guardDates: today on or after D1 → VOID; datesAfter is strictly after today', async () => {
    expect(core.guardDates(before, '2026-10-14').ok).toBe(false)
    expect(core.guardDates(before, '2026-10-20').ok).toBe(false)
    expect(core.guardDates(before, '2026-10-13').ok).toBe(true)
    expect(core.diff(before, await collect(d, 'after', before), { today: '2026-10-14' }).verdict).toBe('VOID')
    for (const today of ['2026-12-31', '2027-02-28', '2026-10-07']) expect(core.datesAfter(today).every((x) => x > today)).toBe(true)
    expect(core.jstToday(Date.parse('2026-10-07T15:30:00.000Z'))).toBe('2026-10-08')
  })
})

describe('the CLI diff subcommand (exit codes)', () => {
  it('exits 0 PASS · 1 FAIL · 2 VOID on saved run files', async () => {
    d.c0Fields = true
    const after = await collect(d, 'after', before)
    const dir = mkdtempSync(path.join(os.tmpdir(), 'c0-same-answers-'))
    const write = (name: string, run: Run) => { const p = path.join(dir, name); writeFileSync(p, JSON.stringify(run)); return p }
    const b = write('before.json', before)
    const fail = clone(after); fail.answers.Q5[0].appointments[0].status = 'CANCELLED'
    const voided = clone(after); voided.watermark.appointments.count += 1
    const run = (a: string) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/c0-same-answers.mjs'), 'diff', '--before', b, '--after', a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' } })
    const pass = run(write('after-pass.json', after))
    expect(pass.status).toBe(0)
    expect(pass.stdout).toContain('SAME-ANSWERS VERDICT: PASS')
    expect(run(write('after-fail.json', fail)).status).toBe(1)
    expect(run(write('after-void.json', voided)).status).toBe(2)
  })
})
