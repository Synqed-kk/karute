/**
 * C0 (CORE-59) — the contract reader against the order's double
 * (build order #1 § 4; rulings OR-1…OR-3). A fresh double per test.
 */
import {
  C0ContractError, hasC0Fields, listOverlaps, readC0Fields, readStoreLessSwitches, readStoreSwitches, walkOverlaps,
  SWITCH_KEYS, type C0Cursor, type CoreHttp,
} from '@/lib/core-contract/c0'
import { CoreDouble, DOUBLE_ACTOR_HEADER } from './fixtures/c0/core-double'

let core: CoreDouble
let http: CoreHttp
const STORE = '50000000-0000-4000-8000-000000000001'
const W = { overlaps_from: '2026-10-20T01:00:00.000Z', overlaps_to: '2026-10-20T03:00:00.000Z' }

beforeEach(() => {
  core = new CoreDouble({ storeIds: [STORE] })
  http = core.asCoreHttp()
})

const codeOf = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return e instanceof C0ContractError ? { code: e.code, field: e.field, error: e.error, status: e.status } : { thrown: String(e) } }
  return { code: 'NONE' }
}
const idsOf = (rows: unknown[]) => rows.map((r) => (r as { id: string }).id)

describe('readC0Fields / hasC0Fields', () => {
  it('reads the four typed fields from a served row, without stripping today\'s fields', async () => {
    const row = core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z', occupied_until: '2026-10-20T02:15:00.000Z' })
    const served = (await http.request('GET', `/v1/appointments/${row.id}`)).json as Record<string, unknown>
    expect(readC0Fields(served)).toEqual({ hold_from: '2026-10-20T01:00:00.000Z', hold_until: '2026-10-20T02:15:00.000Z', holds_managed: false, revision: 0 })
    expect(served.starts_at).toBe('2026-10-20T01:00:00.000Z')
    expect(hasC0Fields(served)).toBe(true)
  })
  it('hasC0Fields is false on an old-shape row', () => {
    expect(hasC0Fields({ id: 'x', starts_at: '2026-10-20T01:00:00.000Z' })).toBe(false)
  })
  it('FIELD_MISSING names the missing field', () => {
    expect(() => readC0Fields({ hold_from: null, hold_until: null, holds_managed: false })).toThrow(expect.objectContaining({ code: 'FIELD_MISSING', field: 'revision' }))
  })
  it('FIELD_TYPE names the mistyped field', () => {
    expect(() => readC0Fields({ hold_from: null, hold_until: null, holds_managed: 'no', revision: 0 })).toThrow(expect.objectContaining({ code: 'FIELD_TYPE', field: 'holds_managed' }))
    expect(() => readC0Fields({ hold_from: null, hold_until: null, holds_managed: false, revision: -1 })).toThrow(expect.objectContaining({ code: 'FIELD_TYPE', field: 'revision' }))
    expect(() => readC0Fields({ hold_from: 'tomorrow', hold_until: null, holds_managed: false, revision: 0 })).toThrow(expect.objectContaining({ code: 'FIELD_TYPE', field: 'hold_from' }))
  })
})

describe('listOverlaps / walkOverlaps', () => {
  it('excludes a voided row', async () => {
    const r = core.seedAppointment({ starts_at: '2026-10-20T01:30:00.000Z', ends_at: '2026-10-20T02:00:00.000Z' })
    expect((await http.request('DELETE', `/v1/appointments/${r.id}`)).status).toBe(200)
    const page = await listOverlaps(http, W)
    expect(page.appointments).toEqual([])
    expect(page.total).toBe(0)
  })
  it('finds a row overlapping only by occupied_until', async () => {
    const r = core.seedAppointment({ starts_at: '2026-10-20T00:00:00.000Z', ends_at: '2026-10-20T00:50:00.000Z', occupied_until: '2026-10-20T01:10:00.000Z' })
    expect(idsOf((await listOverlaps(http, W)).appointments)).toEqual([r.id])
  })
  it('never returns an inverted row (empty range)', async () => {
    core.seedAppointment({ starts_at: '2026-10-20T02:00:00.000Z', ends_at: '2026-10-20T01:30:00.000Z' })
    expect((await listOverlaps(http, W)).appointments).toEqual([])
  })
  it('equal bounds = an empty page', async () => {
    core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z' })
    const page = await listOverlaps(http, { overlaps_from: '2026-10-20T01:30:00.000Z', overlaps_to: '2026-10-20T01:30:00.000Z' })
    expect(page).toEqual({ appointments: [], total: 0, page: 1, page_size: 200, next_cursor: null })
  })
  it('a window touching only hold_until is not returned (half-open)', async () => {
    core.seedAppointment({ starts_at: '2026-10-20T00:00:00.000Z', ends_at: '2026-10-20T01:00:00.000Z' })
    expect((await listOverlaps(http, W)).appointments).toEqual([])
  })
  it('walks 3 pages via next_cursor: no duplicates, page always 1, total constant', async () => {
    const seeded = Array.from({ length: 7 }, (_, i) => core.seedAppointment({ starts_at: `2026-10-20T01:${String(i * 5).padStart(2, '0')}:00.000Z`, ends_at: '2026-10-20T02:30:00.000Z' }).id)
    const pages = []
    for await (const p of walkOverlaps(http, { ...W, page_size: 3 })) pages.push(p)
    expect(pages).toHaveLength(3)
    expect(pages.map((p) => p.page)).toEqual([1, 1, 1])
    expect(pages.map((p) => p.total)).toEqual([7, 7, 7])
    const ids = pages.flatMap((p) => idsOf(p.appointments))
    expect(new Set(ids).size).toBe(7)
    expect(ids.sort()).toEqual(seeded.sort())
    expect(pages[2].next_cursor).toBeNull()
    const sent = core.requests.filter((r) => r.path === '/v1/appointments')
    expect(sent.every((r) => r.query.page === undefined && r.query.from === undefined && r.query.to === undefined)).toBe(true)
  })
  it('the type forbids from/to/page (and a smuggled one is never sent); the double answers each 400; the reader turns a 400 into BAD_REQUEST', async () => {
    const smuggled = await listOverlaps(http, {
      ...W,
      // @ts-expect-error — `from` is not an overlap-read parameter
      from: '2026-10-20T00:00:00.000Z',
    })
    expect(smuggled.page).toBe(1)
    expect(core.requests[core.requests.length - 1].query.from).toBeUndefined()
    const raw = (q: Record<string, string>) => http.request('GET', '/v1/appointments', { query: q })
    expect((await raw({ ...W, from: '2026-10-20T00:00:00.000Z' })).status).toBe(400)
    expect((await raw({ ...W, page: '1' })).status).toBe(400)
    expect((await raw({ overlaps_from: W.overlaps_to, overlaps_to: W.overlaps_from })).status).toBe(400)
    expect((await raw({ cursor: 'abc' })).status).toBe(400)
    const unreadable = await codeOf(listOverlaps(http, { ...W, cursor: 'not-issued' as C0Cursor }))
    expect(unreadable.code).toBe('BAD_REQUEST')
    expect(unreadable.error).toBe('unreadable cursor')
    expect((await codeOf(listOverlaps(http, { overlaps_from: W.overlaps_to, overlaps_to: W.overlaps_from }))).code).toBe('BAD_REQUEST')
  })
  it('from/to with page keep today\'s meaning (no next_cursor key)', async () => {
    core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z' })
    const r = await http.request('GET', '/v1/appointments', { query: { from: '2026-10-20T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z', page: 1, page_size: 200 } })
    expect(Object.keys(r.json as object).sort()).toEqual(['appointments', 'page', 'page_size', 'total'])
  })
})

describe('switches', () => {
  it('a store reads all six keys OFF at generation 0', async () => {
    const s = await readStoreSwitches(http, STORE)
    expect(s.generation).toBe(0)
    expect(Object.keys(s.switches).sort()).toEqual([...SWITCH_KEYS].sort())
    expect(Object.values(s.switches).every((v) => v === 'OFF')).toBe(true)
  })
  it('the store-less read is served by core: generation 0, all OFF', async () => {
    expect(await readStoreLessSwitches(http)).toEqual({ generation: 0, switches: Object.fromEntries(SWITCH_KEYS.map((k) => [k, 'OFF'])) })
  })
  it('a core answering five keys is a SHAPE error, never a door-local default', async () => {
    core.switchKeys = core.switchKeys.filter((k) => k !== 'money_settle')
    expect(await codeOf(readStoreSwitches(http, STORE))).toEqual(expect.objectContaining({ code: 'SHAPE', field: 'money_settle' }))
  })
  it('a PUT through the raw port is refused 409 SWITCH_NOT_BUILT', async () => {
    const r = await http.request('PUT', `/v1/stores/${STORE}/switches/holds`, { body: { state: 'ON' } })
    expect(r).toEqual({ status: 409, json: expect.objectContaining({ code: 'SWITCH_NOT_BUILT', key: 'holds' }) })
  })
})

describe('THE REVISION RULE (order § 4 (d))', () => {
  const seed = () => core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z' })
  const put = async (id: string, body: Record<string, unknown>) => (await http.request('PUT', `/v1/appointments/${id}`, { body })).json as Record<string, unknown>
  it('an UPDATE changing a counted value moves revision by one', async () => {
    const r = seed()
    expect((await put(r.id, { title: 'カット' })).revision).toBe(1)
  })
  it('a restate that changes nothing counted leaves revision unmoved (status_set_at moved)', async () => {
    const r = seed()
    const first = await put(r.id, { status: 'CONFIRMED', status_reason: 'x', acting_staff_id: 's1' })
    const again = await put(r.id, { status: 'CONFIRMED', status_reason: 'x', acting_staff_id: 's1' })
    expect(first.revision).toBe(1)
    expect(again.revision).toBe(1)
    expect(again.status_set_at).not.toBe(first.status_set_at)
  })
  it('a restate with a different reason moves it', async () => {
    const r = seed()
    await put(r.id, { status: 'CONFIRMED', status_reason: 'x', acting_staff_id: 's1' })
    expect((await put(r.id, { status: 'CONFIRMED', status_reason: 'y', acting_staff_id: 's1' })).revision).toBe(2)
  })
  it('a written revision = OLD+1 is kept; OLD+5 is ignored', () => {
    const r = seed()
    expect(core.update(r.id, { revision: 1 }).revision).toBe(1)
    expect(core.update(r.id, { revision: 6 }).revision).toBe(1)
  })
  it('the back-fill of a NULL hold row (touching only hold_*) leaves revision unmoved', () => {
    const r = core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z' }, { preApply: true })
    expect(r.hold_from).toBeNull()
    const after = core.update(r.id, { hold_from: null })
    expect(after.hold_from).toBe('2026-10-20T01:00:00.000Z')
    expect(after.hold_until).toBe('2026-10-20T02:00:00.000Z')
    expect(after.revision).toBe(0)
  })
})

describe('the operation primitive on the create (order § 4 (e))', () => {
  const body = { starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z', title: 'カット' }
  const create = (b: object) => http.request('POST', '/v1/appointments', { body: b, headers: { 'Idempotency-Key': 'k-1' } })
  it('replays the same body with 200 and the same id', async () => {
    const a = await create(body)
    const b = await create(body)
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect((b.json as { id: string }).id).toBe((a.json as { id: string }).id)
  })
  it('a different body under the same key → 409 IDEMPOTENCY_PAYLOAD_MISMATCH', async () => {
    await create(body)
    expect(await create({ ...body, title: 'カラー' })).toEqual({ status: 409, json: expect.objectContaining({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' }) })
  })
  it('a replay after the row is voided → 409 IDEMPOTENT_REPLAY_GONE; status events kept', async () => {
    const a = await create(body)
    const id = (a.json as { id: string }).id
    await http.request('DELETE', `/v1/appointments/${id}`)
    expect(await create(body)).toEqual({ status: 409, json: expect.objectContaining({ code: 'IDEMPOTENT_REPLAY_GONE' }) })
    expect((await http.request('GET', `/v1/appointments/${id}`)).status).toBe(404)
    expect((await http.request('DELETE', `/v1/appointments/${id}`)).status).toBe(404)
    expect(core.appts.get(id)?.voided_by).toBeNull()
    expect(core.events.get(id)?.length).toBeGreaterThan(0)
  })
})

describe('customer delete (order § 4 (b), OR-1)', () => {
  it('hard delete is soft; bookings intact; a second delete is not found; a create with her email → 201 her record', async () => {
    const c = core.seedCustomer({ email: 'hanako@example.test' })
    const appt = core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z', customer_id: c.id })
    expect((await http.request('DELETE', `/v1/customers/${c.id}`)).status).toBe(200)
    expect(core.customers.get(c.id)?.deleted_at).not.toBeNull()
    expect((await http.request('GET', `/v1/appointments/${appt.id}`)).status).toBe(200)
    // As core today: 500 {error:'Customer not found'} (customer.service.ts:426 → index.ts:97-100 @7d2f629).
    expect(await http.request('DELETE', `/v1/customers/${c.id}`)).toEqual({ status: 500, json: { error: 'Customer not found' } })
    expect(await http.request('DELETE', '/v1/customers/c0000000-0000-4000-8000-999999999999')).toEqual({ status: 500, json: { error: 'Customer not found' } })
    const again = await http.request('POST', '/v1/customers', { body: { name: '花子', email: 'hanako@example.test' } })
    expect(again.status).toBe(201)
    expect(again.json).toEqual(expect.objectContaining({ id: c.id, deleted_at: expect.any(String) }))
  })
})

describe('shift delete (order § 4 (c))', () => {
  it('a void is excluded; the same day can be re-entered; voided_by = the actor', async () => {
    const actor = { [DOUBLE_ACTOR_HEADER]: 'staff-owner' }
    const s = core.seedShift({ staff_id: 'st-1', date: '2026-10-20' })
    expect((await http.request('DELETE', `/v1/staff-shifts/${s.id}`, { headers: actor })).status).toBe(200)
    expect(core.shifts.get(s.id)?.voided_by).toBe('staff-owner')
    expect((await http.request('GET', `/v1/staff-shifts/${s.id}`)).status).toBe(404)
    expect(((await http.request('GET', '/v1/staff-shifts', { query: { date: '2026-10-20' } })).json as { total: number }).total).toBe(0)
    const re = await http.request('POST', '/v1/staff-shifts', { body: { staff_id: 'st-1', date: '2026-10-20' }, headers: actor })
    expect(re.status).toBe(201)
  })
})

// ── fix round 1 (RULINGS-BUILD-S23) ─────────────────────────────────────────

const OK = { hold_from: '2026-10-20T01:00:00.000Z', hold_until: '2026-10-20T02:00:00.000Z', holds_managed: false, revision: 0 }
const okRow = (id: string) => ({ id, ...OK })
const fixed = (answer: (n: number) => unknown): CoreHttp & { calls: () => number } => {
  let n = 0
  return { request: async () => ({ status: 200, json: answer(++n) }), calls: () => n }
}
const ENV = { appointments: [okRow('a')], total: 1, page: 1, page_size: 200, next_cursor: null }
const messageOf = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return e instanceof C0ContractError ? `${e.code}: ${e.message}` : `other: ${String(e)}` }
  return 'NONE'
}
const drain = async (h: CoreHttp) => {
  const pages: unknown[] = []
  for await (const page of walkOverlaps(h, W)) pages.push(page)
  return pages
}

describe('R-8 the reader is strict', () => {
  it.each([
    ['revision as a numeric string', { ...OK, revision: '3' }, 'revision'],
    ['revision 1.5', { ...OK, revision: 1.5 }, 'revision'],
    ['revision NaN', { ...OK, revision: NaN }, 'revision'],
    ['revision above int4', { ...OK, revision: 2147483648 }, 'revision'],
    ['a calendar date that does not exist (Feb 30)', { ...OK, hold_from: '2026-02-30T00:00:00Z' }, 'hold_from'],
    ['hour 24', { ...OK, hold_until: '2026-10-20T24:00:00Z' }, 'hold_until'],
    ['exactly one of the pair null', { ...OK, hold_from: null }, 'hold_until'],
    ['an inverted envelope', { ...OK, hold_from: '2026-10-20T03:00:00.000Z' }, 'hold_until'],
    ['a non-object answer', 'x', 'appointment'],
  ])('%s → FIELD_TYPE', (_name, row, field) => {
    expect(() => readC0Fields(row)).toThrow(expect.objectContaining({ code: 'FIELD_TYPE', field }))
  })
  it('accepts int4 max, an offset instant and an equal pair', () => {
    expect(readC0Fields({ ...OK, revision: 2147483647 }).revision).toBe(2147483647)
    expect(hasC0Fields({ ...OK, hold_from: '2026-10-20T10:00:00+09:00', hold_until: '2026-10-20T01:00:00.000Z' })).toBe(true)
    expect(hasC0Fields({ ...OK, hold_from: null, hold_until: null })).toBe(true)
  })
  it.each([
    ['page 2', { ...ENV, page: 2 }],
    ['an extra key', { ...ENV, extra: 1 }],
    ['next_cursor missing', { appointments: ENV.appointments, total: 1, page: 1, page_size: 200 }],
    ['next_cursor 5', { ...ENV, next_cursor: 5 }],
    ['next_cursor empty', { ...ENV, next_cursor: '' }],
    ['total -1', { ...ENV, total: -1 }],
    ['total below the rows on the page', { ...ENV, total: 0 }],
    ['page_size 0', { ...ENV, page_size: 0 }],
    ['appointments not an array', { ...ENV, appointments: 'x' }],
    ['a cursor with an empty page', { ...ENV, appointments: [], total: 0, next_cursor: 'x' }],
    ['a row without an id', { ...ENV, appointments: [OK] }],
    ['an id twice on one page', { ...ENV, appointments: [okRow('a'), okRow('a')], total: 2 }],
  ])('listOverlaps: %s → SHAPE', async (_name, json) => {
    expect(await codeOf(listOverlaps(fixed(() => json), W))).toEqual(expect.objectContaining({ code: 'SHAPE' }))
  })
  it('listOverlaps: a row lacking a field → FIELD_MISSING; a non-object row → FIELD_TYPE', async () => {
    expect(await codeOf(listOverlaps(fixed(() => ({ ...ENV, appointments: [{ id: 'a', hold_from: null, hold_until: null, holds_managed: false }] })), W))).toEqual(expect.objectContaining({ code: 'FIELD_MISSING', field: 'revision' }))
    expect(await codeOf(listOverlaps(fixed(() => ({ ...ENV, appointments: [7] })), W))).toEqual(expect.objectContaining({ code: 'FIELD_TYPE' }))
  })
  it('switches: an extra envelope key or an extra switch key → SHAPE (strict both ways)', async () => {
    const all = Object.fromEntries(SWITCH_KEYS.map((k) => [k, 'OFF']))
    expect(await codeOf(readStoreLessSwitches(fixed(() => ({ generation: 0, switches: all, extra: 1 }))))).toEqual(expect.objectContaining({ code: 'SHAPE' }))
    core.switchKeys = [...core.switchKeys, 'later']
    expect(await codeOf(readStoreSwitches(http, STORE))).toEqual(expect.objectContaining({ code: 'SHAPE', field: 'later' }))
  })
})

describe('R-5 cursor safety: every walk ends', () => {
  it('a core repeating its cursor (the double\'s test mode) → SHAPE', async () => {
    core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z' })
    core.repeatCursor = true
    expect(await messageOf(drain(http))).toMatch(/^SHAPE: .*next_cursor repeated/)
  })
  it('next_cursor "" → SHAPE', async () => {
    expect(await messageOf(drain(fixed(() => ({ ...ENV, next_cursor: '' }))))).toMatch(/^SHAPE: .*next_cursor empty/)
  })
  it('a non-null cursor with an empty page → SHAPE', async () => {
    expect(await messageOf(drain(fixed((n) => (n === 1 ? { ...ENV, next_cursor: 'c1' } : { ...ENV, appointments: [], next_cursor: 'c2' }))))).toMatch(/^SHAPE: .*empty page/)
  })
  it('an id seen on an earlier page → SHAPE', async () => {
    expect(await messageOf(drain(fixed((n) => ({ ...ENV, next_cursor: n === 1 ? 'c1' : null }))))).toMatch(/^SHAPE: .*repeated across the walk/)
  })
  it('more than 1000 pages → SHAPE, after exactly 1000 requests', async () => {
    const h = fixed((n) => ({ ...ENV, appointments: [okRow(`r${n}`)], next_cursor: `c${n}` }))
    expect(await messageOf(drain(h))).toMatch(/^SHAPE: .*more than 1000 pages/)
    expect(h.calls()).toBe(1000)
  })
})

describe('R-11 (NIT-1) the overlap read is half-open on both sides', () => {
  it('a row starting exactly at overlaps_to is not returned', async () => {
    core.seedAppointment({ starts_at: W.overlaps_to, ends_at: '2026-10-20T04:00:00.000Z' })
    expect((await listOverlaps(http, W)).appointments).toEqual([])
  })
})

describe('R-10 the double matches core', () => {
  it('an update that changes a counted column AND supplies revision → OLD+1, the supplied value ignored', () => {
    const r = core.seedAppointment({ starts_at: '2026-10-20T01:00:00.000Z', ends_at: '2026-10-20T02:00:00.000Z' })
    expect(core.update(r.id, { title: 'x', revision: 6 }).revision).toBe(1)
    expect(core.update(r.id, { title: 'y', revision: 2 }).revision).toBe(2)
  })
  it('a shift delete moves updated_at', async () => {
    const s = core.seedShift({ staff_id: 'st-1', date: '2026-10-21' })
    expect((await http.request('DELETE', `/v1/staff-shifts/${s.id}`, { headers: { [DOUBLE_ACTOR_HEADER]: 'staff-owner' } })).status).toBe(200)
    expect((core.shifts.get(s.id)?.updated_at ?? "") > s.updated_at).toBe(true)
  })
})
