/**
 * ⚖ PKT-S38 R3/R4 (Liam 9/25 「make it work」) — 予約の色分け's writer and route, mirrored from
 * practice-door-write.test.ts (the card-colour writer). Same recorded answer set (no network), same core-reach
 * mock: both guards' throws kept exactly, and a mock write-only handle so every core call is visible here.
 */

// The SDK ships raw ESM this jest setup does not transform (same stub as practice-door.test.ts).
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/practice-door/core-reach', () => {
  const actual = jest.requireActual('@/business/lib/practice-door/core-reach')
  const { practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  const guard = (admitted: { businessId: string }) => {
    const tenant = practiceTenant()
    if (tenant === null) throw new Error('practice door called with the switch unset')
    if (admitted.businessId !== tenant) throw new actual.PracticeTenantMismatch(admitted.businessId)
  }
  return {
    ...actual,
    clientFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.reads),
    orgSettingsWriterFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.writerFor(admitted), { orgSettings: { upsert: mockCore.upsert } }),
  }
})

import * as data from '@/business/lib/data'
import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { BOOKING_COLOR_DEFAULTS, BOOKING_PALETTE } from '@/business/lib/booking-colors'
import { PUT } from '@/app/api/business/booking-colors/route'
import { CARD, LOGIN, SHEETS, STORE, TENANT, recordedReads } from './practice-door-recorded'

const mockCore: { reads: CoreReads; upsert: jest.Mock; writerFor: jest.Mock } = {
  reads: recordedReads(),
  upsert: jest.fn(),
  writerFor: jest.fn(),
}
const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
type Spied = { [K in keyof CoreReads]: jest.Mock }
function withReads(settings: Record<string, unknown> = {}): Spied {
  const base = recordedReads()
  const spied = Object.fromEntries(Object.entries(base).map(([k, fn]) => [k, jest.fn(fn as (...a: unknown[]) => unknown)])) as unknown as Spied
  spied.orgSettingsGet.mockResolvedValue({ business_id: TENANT, name: 'Dev Salon', settings, created_at: 'x', updated_at: 'x' })
  mockCore.reads = spied as unknown as CoreReads
  return spied
}
const as = (userId: string, businessId: string = TENANT) => admission.mockResolvedValue({ userId, email: null, businessId })
/** Core's answer to a PUT: core's own shallow merge (org-settings.service.ts:50) of the sent keys over the row. */
let stored: Record<string, unknown> = {}
const coreRow = (settings: Record<string, unknown>) => ({ business_id: TENANT, name: 'Dev Salon', settings, created_at: 'x', updated_at: 'y' })

const S = STORE.tokyo
const hexOf = (label: string) => BOOKING_PALETTE.find((c) => c.label === label)!.hex
const PICK = { new: hexOf('青'), repeat: hexOf('紫'), ticket: hexOf('桃'), vip: hexOf('紺') }
/** Another store's entry and a junk entry: both must pass through byte-equal. */
const OTHERS = { [STORE.yokohama]: { new: '#8a8a93', repeat: '#8A8A93', ticket: 'navy', vip: '#8a8a93' }, junk: [1, 'two', { three: 3 }] }

const saved = process.env.BUSINESS_PRACTICE_TENANT
let info: jest.SpyInstance
let error: jest.SpyInstance
beforeEach(() => {
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  stored = { business_type: 'beauty', reserve_card_color: '#1C2247' }
  withReads(stored)
  mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => coreRow({ ...stored, ...input.settings }))
  mockCore.writerFor = jest.fn()
  admission.mockClear()
  as(LOGIN.owner)
  info = jest.spyOn(console, 'info').mockImplementation(() => {})
  error = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  if (saved === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
  else process.env.BUSINESS_PRACTICE_TENANT = saved
  info.mockRestore()
  error.mockRestore()
})
const seed = (settings: Record<string, unknown>) => {
  stored = settings
  return withReads(settings)
}

describe('⚖ PKT-S38 R3 — the second writer: data.writeBookingColors → door', () => {
  it('happy path: EXACTLY one PUT of { settings: { booking_colors: { [store]: four } } } and core’s answer comes back', async () => {
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { booking_colors: { [S]: PICK } } }]])
    expect(mockCore.writerFor).toHaveBeenCalledWith({ businessId: TENANT })
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toBe('[business booking colours]')
    expect(JSON.parse(info.mock.calls[0][1] as string)).toEqual({
      business_id: TENANT, actor: CARD.owner, store_id: S, old: null, new: PICK, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    })
  })

  it('every other store’s entry (and a junk entry) passes through UNTOUCHED, byte-equal — core replaces the whole key', async () => {
    seed({ business_type: 'beauty', booking_colors: OTHERS })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    const sent = mockCore.upsert.mock.calls[0][0] as { settings: { booking_colors: Record<string, unknown> } }
    expect(Object.keys(sent.settings)).toEqual(['booking_colors'])
    expect(sent).toEqual({ settings: { booking_colors: { ...OTHERS, [S]: PICK } } })
    for (const k of Object.keys(OTHERS)) expect(JSON.stringify(sent.settings.booking_colors[k])).toBe(JSON.stringify((OTHERS as Record<string, unknown>)[k]))
  })

  it('uppercase palette hexes are accepted and sent lowercase', async () => {
    const upper = { new: PICK.new.toUpperCase(), repeat: PICK.repeat.toUpperCase(), ticket: PICK.ticket, vip: PICK.vip.toUpperCase() }
    expect(await data.writeBookingColors(S, upper)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { booking_colors: { [S]: PICK } } }]])
  })

  it('every one of the eleven is accepted, for every category', async () => {
    for (const c of BOOKING_PALETTE) {
      seed({})
      const four = { new: c.hex, repeat: c.hex, ticket: c.hex, vip: c.hex }
      expect(await data.writeBookingColors(S, four)).toEqual({ ok: true, colors: four })
    }
    expect(mockCore.upsert).toHaveBeenCalledTimes(11)
  })

  it('equal value (the entry already holds exactly these four, lowercase) → no PUT, no audit line', async () => {
    const spy = seed({ booking_colors: { ...OTHERS, [S]: { ...PICK } } })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(spy.orgSettingsGet).toHaveBeenCalledTimes(1)
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it.each([
    ['stored uppercase', { ...PICK, new: PICK.new.toUpperCase() }],
    ['stored with an extra key', { ...PICK, renewal: '#7a5bd4' }],
    ['stored with a key missing', { new: PICK.new, repeat: PICK.repeat, ticket: PICK.ticket }],
  ])('not exactly equal (%s) → the four are sent, the entry is replaced by exactly them', async (_label, entry) => {
    seed({ booking_colors: { [S]: entry } })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { booking_colors: { [S]: PICK } } }]])
  })

  it.each([
    ['an array', ['#3b6fd4']],
    ['a string', 'blue'],
    ['a number', 7],
    ['a boolean', true],
  ])('a stored booking_colors that is not a map (%s) → core, logged, and NOTHING is overwritten', async (_label, raw) => {
    seed({ booking_colors: raw })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('[business booking colours] stored booking_colors is not a map; refusing to overwrite')
  })

  it('a stored null is an absent key: the map starts empty', async () => {
    seed({ booking_colors: null })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { booking_colors: { [S]: PICK } } }]])
  })

  it.each([
    ['five keys', { ...PICK, renewal: PICK.new }],
    ['three keys', { new: PICK.new, repeat: PICK.repeat, ticket: PICK.ticket }],
    ['the old vocabulary (pack for ticket)', { new: PICK.new, repeat: PICK.repeat, pack: PICK.ticket, vip: PICK.vip }],
    ['a 3-digit hex', { ...PICK, new: '#abc' }],
    ['an off-palette hex', { ...PICK, repeat: '#285643' }],
    ['a colour name', { ...PICK, ticket: 'blue' }],
    ['a padded hex', { ...PICK, vip: ` ${PICK.vip}` }],
    ['a number value', { ...PICK, vip: 42 }],
    ['null', null],
    ['an array', [PICK.new, PICK.repeat, PICK.ticket, PICK.vip]],
    ['a string', PICK.new],
    ['undefined', undefined],
    ['an object with a prototype', Object.assign(Object.create({ inherited: true }), PICK)],
  ])('invalid colours (%s) → invalid, with ZERO core calls and no admission', async (_label, colors) => {
    const spy = withReads()
    expect(await data.writeBookingColors(S, colors)).toEqual({ ok: false, reason: 'invalid' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(admission).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it.each([['empty', ''], ['a number', 42 as unknown as string], ['null', null as unknown as string]])('invalid store id (%s) → invalid, zero core calls', async (_label, id) => {
    const spy = withReads()
    expect(await data.writeBookingColors(id, PICK)).toEqual({ ok: false, reason: 'invalid' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
    ['an inactive store of this business', STORE.closed],
    ['a store of another business', '11111111-2222-4333-8444-555555555555'],
  ])('a store the operator cannot see (%s) → forbidden, no read of the colours, no PUT', async (_label, id) => {
    const spy = withReads()
    expect(await data.writeBookingColors(id, PICK)).toEqual({ ok: false, reason: 'forbidden' })
    expect(spy.orgSettingsGet).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('⚖ 8/17 store isolation: a branch manager WITH settings.manage saves its own store, never another', async () => {
    as(LOGIN.goro) // visible: テスト東京店 + テスト横浜店
    withReads().answerSheet.mockResolvedValue({ ...SHEETS[CARD.goro], capabilities: ['customers.view', 'settings.manage'] })
    expect(await data.writeBookingColors(STORE.devSalon, PICK)).toEqual({ ok: false, reason: 'forbidden' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
    withReads().answerSheet.mockResolvedValue({ ...SHEETS[CARD.goro], capabilities: ['customers.view', 'settings.manage'] })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { booking_colors: { [S]: PICK } } }]])
  })

  it('forbidden: an operator whose sheet lacks settings.manage → forbidden, no read of the colours, no PUT', async () => {
    as(LOGIN.goro)
    const spy = withReads()
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'forbidden' })
    expect(spy.orgSettingsGet).not.toHaveBeenCalled()
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('another business → tenant, refused before any read', async () => {
    as(LOGIN.owner, '00000000-0000-4000-8000-00000000dead')
    const spy = withReads()
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'tenant' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('core throws on the PUT → core (reported, not swallowed, not retried)', async () => {
    mockCore.upsert.mockRejectedValueOnce(new Error('503 from core'))
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(info).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('[business booking colours] core did not save:', '503 from core')
  })

  it('core throws on the read-before-write → core, and no PUT', async () => {
    withReads().orgSettingsGet.mockRejectedValue(new Error('core down'))
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('the actor’s staff read fails → core, logged, never a throw', async () => {
    withReads().staffList.mockRejectedValue(new Error('boom'))
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'core' })
    expect(error).toHaveBeenCalledWith('[business booking colours] core did not answer:', 'boom')
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('switch OFF → tenant: no writer, nothing called', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const spy = withReads()
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'tenant' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(admission).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('the defaults are palette members: saving them for a store is a real, normal save', async () => {
    expect(await data.writeBookingColors(S, { ...BOOKING_COLOR_DEFAULTS })).toEqual({ ok: true, colors: BOOKING_COLOR_DEFAULTS })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { booking_colors: { [S]: BOOKING_COLOR_DEFAULTS } } }]])
  })
})

// ── the route (R4): PUT /api/business/booking-colors ─────────────────────────────────────────
const HOST = 'business.example.test'
function put(opts: { origin?: string | null; site?: string; host?: string; forwarded?: string; expected?: string | null; body?: string; scheme?: 'http' | 'https' } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: opts.host ?? HOST }
  if (opts.forwarded) headers['x-forwarded-host'] = opts.forwarded
  const origin = opts.origin === undefined ? `https://${HOST}` : opts.origin
  if (origin !== null) headers.origin = origin
  if (opts.site) headers['sec-fetch-site'] = opts.site
  const expected = opts.expected === undefined ? TENANT : opts.expected
  if (expected !== null) headers['x-expected-business'] = expected
  return PUT(new Request(`${opts.scheme ?? 'https'}://${HOST}/api/business/booking-colors`, { method: 'PUT', headers, body: opts.body ?? JSON.stringify({ storeId: S, colors: PICK }) }))
}
const answer = async (r: Response) => ({ status: r.status, body: await r.json() })

describe('⚖ PKT-S38 R4 — the route: the card route’s twin, body exactly { storeId, colors }', () => {
  it('200: the admitted business, same origin, { storeId, colors } → the door → core’s answer', async () => {
    expect(await answer(await put())).toEqual({ status: 200, body: { ok: true, colors: PICK } })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { booking_colors: { [S]: PICK } } }]])
  })

  it('200 for Sec-Fetch-Site: same-origin when the browser sent no Origin', async () => {
    expect((await put({ origin: null, site: 'same-origin' })).status).toBe(200)
  })

  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['no Origin and no Sec-Fetch-Site', { origin: null }],
    ['no Origin, cross-site fetch', { origin: null, site: 'cross-site' }],
    ['a malformed Origin', { origin: 'not a url' }],
    ['Origin = a spoofed X-Forwarded-Host, the Host differs', { origin: 'https://evil.example', forwarded: 'evil.example' }],
    ['an http:// Origin for an https request', { origin: `http://${HOST}` }],
  ])('403 — refused before admission or the door (%s)', async (_label, opts) => {
    expect(await answer(await put(opts as Parameters<typeof put>[0]))).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    expect(admission).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['a different business', '00000000-0000-4000-8000-00000000dead'],
    ['no header', null],
  ])('409 — X-Expected-Business is not the admitted business (%s), before the door', async (_label, expected) => {
    const spy = withReads()
    expect(await answer(await put({ expected }))).toEqual({ status: 409, body: { ok: false, reason: 'tenant' } })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{storeId:'],
    ['an array', JSON.stringify([S, PICK])],
    ['null', 'null'],
    ['a third key', JSON.stringify({ storeId: S, colors: PICK, extra: 1 })],
    ['a settings blob', JSON.stringify({ settings: { booking_colors: { [S]: PICK } } })],
    ['no colors', JSON.stringify({ storeId: S, other: PICK })],
    ['no storeId', JSON.stringify({ store: S, colors: PICK })],
    ['storeId a number', JSON.stringify({ storeId: 1, colors: PICK })],
    ['colors null', JSON.stringify({ storeId: S, colors: null })],
    ['colors an array', JSON.stringify({ storeId: S, colors: [PICK.new] })],
    ['colors a string', JSON.stringify({ storeId: S, colors: PICK.new })],
    ['colors off the palette (the door’s check)', JSON.stringify({ storeId: S, colors: { ...PICK, new: '#285643' } })],
    ['colors with five keys (the door’s check)', JSON.stringify({ storeId: S, colors: { ...PICK, renewal: PICK.new } })],
  ])('400 — the body is not exactly { storeId, colors: four palette hexes } (%s), and nothing is written', async (_label, body) => {
    expect(await answer(await put({ body }))).toEqual({ status: 400, body: { ok: false, reason: 'invalid' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('403 — an operator without settings.manage; 403 — a store the operator cannot see', async () => {
    as(LOGIN.goro)
    expect(await answer(await put())).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    as(LOGIN.owner)
    expect(await answer(await put({ body: JSON.stringify({ storeId: '__proto__', colors: PICK }) }))).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('503 — core failed (reported, not swallowed); 503 — a stored value that is not a map', async () => {
    mockCore.upsert.mockRejectedValueOnce(new Error('503 from core'))
    expect(await answer(await put())).toEqual({ status: 503, body: { ok: false, reason: 'core' } })
    seed({ booking_colors: 'blue' })
    expect(await answer(await put())).toEqual({ status: 503, body: { ok: false, reason: 'core' } })
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
  })

  it('409 — switch OFF: the door has no writer', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(await answer(await put())).toEqual({ status: 409, body: { ok: false, reason: 'tenant' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('a refused reader never learns the route exists: admission’s own refusal propagates (Next answers 404)', async () => {
    admission.mockRejectedValueOnce(Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }))
    await expect(put()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })
})
