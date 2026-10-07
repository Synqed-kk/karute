/**
 * Reserve S66 (DESIGN-BUILD2 §9 R10) — the 受付ルール route, the booking-colours route's twin. The door itself
 * (door-reserve-policy.ts) is pinned in door-writes.test.ts, through data.ts; here the data seam is stubbed and only the route's own contract is checked.
 */
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/data', () => ({ setReservePolicy: jest.fn() }))

import { requireBusinessAdmission } from '@/business/lib/admission'
import { setReservePolicy } from '@/business/lib/data'
import { PUT } from '@/app/api/business/reserve-policy/route'

const TENANT = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
const S = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f'
const HOST = 'karute.test'
const POLICY = { booking_open_days: 21, cutoff_minutes: 90, reserve_start_grid_min: 15, cancel_free_until_hours: 12, cancel_late_pct: 30, no_show_pct: 100 }
const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const door = setReservePolicy as jest.MockedFunction<typeof setReservePolicy>

function put(opts: { origin?: string | null; expected?: string | null; body?: string; site?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json' }
  const origin = opts.origin === undefined ? `https://${HOST}` : opts.origin
  if (origin !== null) headers.origin = origin
  if (opts.site) headers['sec-fetch-site'] = opts.site
  const expected = opts.expected === undefined ? TENANT : opts.expected
  if (expected !== null) headers['x-expected-business'] = expected
  return PUT(new Request(`https://${HOST}/api/business/reserve-policy`, { method: 'PUT', headers, body: opts.body ?? JSON.stringify({ storeId: S, policy: POLICY, basedOn: '30|0|null|24|0|0' }) }))
}

beforeEach(() => {
  admission.mockReset().mockResolvedValue({ userId: 'login-owner', email: null, displayName: null, businessId: TENANT })
  door.mockReset()
})

describe('Reserve S66 — PUT /api/business/reserve-policy', () => {
  it('ok: the door gets (storeId, policy, basedOn) exactly and its answer comes back 200', async () => {
    door.mockResolvedValueOnce({ ok: true, row: { ...POLICY, reserve_start_grid_min: 15, updated_at: 'x' }, basedOn: '21|90|15|12|30|100' })
    const res = await put()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, basedOn: '21|90|15|12|30|100' })
    expect(door.mock.calls).toEqual([[S, POLICY, '30|0|null|24|0|0']])
  })

  it('200 for Sec-Fetch-Site: same-origin when the browser sent no Origin', async () => {
    door.mockResolvedValueOnce({ ok: true, row: { ...POLICY, reserve_start_grid_min: 15, updated_at: 'x' }, basedOn: '21|90|15|12|30|100' })
    expect((await put({ origin: null, site: 'same-origin' })).status).toBe(200)
    expect(door).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no Origin and no Sec-Fetch-Site', { origin: null }],
    ['no Origin, cross-site fetch', { origin: null, site: 'cross-site' }],
  ])('403 without a same-origin proof (%s), before admission or the door', async (_n, opts) => {
    expect((await put(opts)).status).toBe(403)
    expect(admission).not.toHaveBeenCalled()
    expect(door).not.toHaveBeenCalled()
  })

  it('a refused reader never learns the route exists: admission’s own refusal propagates (Next answers 404)', async () => {
    admission.mockRejectedValueOnce(Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }))
    await expect(put()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    expect(door).not.toHaveBeenCalled()
  })

  it('a foreign origin → 403, nothing reaches the door', async () => {
    expect((await put({ origin: 'https://evil.test' })).status).toBe(403)
    expect(door).not.toHaveBeenCalled()
  })

  it('X-Expected-Business missing or another business → 409 tenant, nothing reaches the door', async () => {
    expect((await put({ expected: null })).status).toBe(409)
    expect((await put({ expected: 'another-business' })).status).toBe(409)
    expect(door).not.toHaveBeenCalled()
  })

  it.each([
    ['not json', '{'],
    ['an extra key', JSON.stringify({ storeId: S, policy: POLICY, basedOn: 'x', lead_time_min: 5 })],
    ['basedOn missing', JSON.stringify({ storeId: S, policy: POLICY })],
    ['basedOn not a string', JSON.stringify({ storeId: S, policy: POLICY, basedOn: 1 })],
    ['storeId not a string', JSON.stringify({ storeId: 1, policy: POLICY, basedOn: 'x' })],
  ])('body %s → 400 invalid, nothing reaches the door', async (_n, body) => {
    expect((await put({ body })).status).toBe(400)
    expect(door).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403],
    ['tenant', 409],
    ['stale', 409],
    ['invalid', 400],
    ['core', 503],
  ] as const)('the door’s %s → %i, with its line', async (reason, status) => {
    door.mockResolvedValueOnce({ ok: false, reason, message: `line-${reason}` })
    const res = await put()
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ ok: false, reason, message: `line-${reason}` })
  })
})
