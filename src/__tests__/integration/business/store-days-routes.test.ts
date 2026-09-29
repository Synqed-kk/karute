/**
 * @jest-environment node
 */
/**
 * ⚖ PKT-S31 R10 — the two store-days routes (closures/route.ts + special/route.ts), mirroring the
 * card-colour route test (practice-door-write.test.ts): strict same-origin → 403 · a wrong
 * X-Expected-Business → 409 · an extra body key → 400 · a door refusal → its mapped status + the
 * door's Japanese line · DELETE travels as query params · the happy path calls the door exactly once
 * with the parsed body. The door itself is mocked here — its own behaviour is door-writes.test.ts's.
 */
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/data', () => ({
  addStoreClosedDay: jest.fn(),
  removeStoreClosedDay: jest.fn(),
  addStoreSpecialOpenDay: jest.fn(),
  removeStoreSpecialOpenDay: jest.fn(),
}))

import { requireBusinessAdmission } from '@/business/lib/admission'
import * as data from '@/business/lib/data'
import * as closures from '@/app/api/business/store-days/closures/route'
import * as special from '@/app/api/business/store-days/special/route'

const TENANT = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
const STORE_ID = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f'
const CLOSURE_ID = 'c2c2c2c2-0000-4000-8000-000000000002'
const HOST = 'localhost:3000'
const door = data as unknown as Record<'addStoreClosedDay' | 'removeStoreClosedDay' | 'addStoreSpecialOpenDay' | 'removeStoreSpecialOpenDay', jest.Mock>

function req(path: string, method: string, opts: { origin?: string; business?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { host: HOST, 'x-expected-business': opts.business ?? TENANT, 'content-type': 'application/json' }
  headers.origin = opts.origin ?? `http://${HOST}`
  return new Request(`http://${HOST}/api/business/store-days/${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
}

beforeEach(() => {
  ;(requireBusinessAdmission as jest.Mock).mockResolvedValue({ userId: 'login-owner', email: null, businessId: TENANT })
  for (const k of ['addStoreClosedDay', 'removeStoreClosedDay', 'addStoreSpecialOpenDay', 'removeStoreSpecialOpenDay'] as const) door[k].mockReset()
})

const CLOSURE_ADD = { storeId: STORE_ID, date: '2026-11-20', reason: '棚卸し' }
const SPECIAL_ADD = { storeId: STORE_ID, date: '2026-11-20', open: '10:00', close: '19:00' }
const cases = [
  { name: 'closures POST', call: (o: Parameters<typeof req>[2]) => closures.POST(req('closures', 'POST', { body: CLOSURE_ADD, ...o })), fn: 'addStoreClosedDay' as const, args: [STORE_ID, { date: '2026-11-20', reason: '棚卸し' }], extra: { ...CLOSURE_ADD, x: 1 } },
  { name: 'closures DELETE', call: (o: Parameters<typeof req>[2]) => closures.DELETE(req(`closures?storeId=${STORE_ID}&id=${CLOSURE_ID}`, 'DELETE', o)), fn: 'removeStoreClosedDay' as const, args: [STORE_ID, CLOSURE_ID], extra: null },
  { name: 'special POST', call: (o: Parameters<typeof req>[2]) => special.POST(req('special', 'POST', { body: SPECIAL_ADD, ...o })), fn: 'addStoreSpecialOpenDay' as const, args: [STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' }], extra: { ...SPECIAL_ADD, x: 1 } },
  { name: 'special DELETE', call: (o: Parameters<typeof req>[2]) => special.DELETE(req(`special?storeId=${STORE_ID}&date=2026-11-20`, 'DELETE', o)), fn: 'removeStoreSpecialOpenDay' as const, args: [STORE_ID, '2026-11-20'], extra: null },
]

describe.each(cases)('$name', ({ call, fn, args, extra }) => {
  it('cross-origin → 403, the door never asked', async () => {
    const r = await call({ origin: 'https://evil.example' })
    expect(r.status).toBe(403)
    expect(door[fn]).not.toHaveBeenCalled()
  })
  it('a wrong X-Expected-Business → 409, the door never asked', async () => {
    const r = await call({ business: '00000000-0000-4000-8000-000000000000' })
    expect(r.status).toBe(409)
    expect(door[fn]).not.toHaveBeenCalled()
  })
  it('a door refusal → its mapped status + the door’s Japanese line', async () => {
    door[fn].mockResolvedValue({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    const r = await call({})
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    door[fn].mockResolvedValue({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect((await call({})).status).toBe(403)
    door[fn].mockResolvedValue({ ok: false, reason: 'core', message: 'x' })
    expect((await call({})).status).toBe(503)
  })
  it('the happy path calls the door exactly once with the parsed input', async () => {
    door[fn].mockResolvedValue({ ok: true })
    const r = await call({})
    expect(r.status).toBe(200)
    expect(door[fn]).toHaveBeenCalledTimes(1)
    expect(door[fn]).toHaveBeenCalledWith(...args)
  })
  if (extra) {
    it('an extra body key → 400, the door never asked', async () => {
      const r = await call({ body: extra })
      expect(r.status).toBe(400)
      expect(door[fn]).not.toHaveBeenCalled()
    })
  }
})

it('closures DELETE without the id query param → 400 (DELETE travels as query params, never a body)', async () => {
  const r = await closures.DELETE(req(`closures?storeId=${STORE_ID}`, 'DELETE', { body: { id: CLOSURE_ID } }))
  expect(r.status).toBe(400)
  expect(door.removeStoreClosedDay).not.toHaveBeenCalled()
})

it('special DELETE without the date query param → 400 (DELETE travels as query params, never a body)', async () => {
  const r = await special.DELETE(req(`special?storeId=${STORE_ID}`, 'DELETE', { body: { date: '2026-11-20' } }))
  expect(r.status).toBe(400)
  expect(door.removeStoreSpecialOpenDay).not.toHaveBeenCalled()
})
