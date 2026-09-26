/**
 * ⚖ PKT-S38 R3/R4 (Liam 9/25 「make it work」) — 予約の色分け's writer and route, mirrored from
 * practice-door-write.test.ts (the card-colour writer). Same recorded answer set (no network), same core-reach
 * mock: both guards' throws kept exactly, and a mock write-only handle so every core call is visible here.
 * ⚖ PKT-S41 R-S41-1 (Liam 9/25 A) — ONE KEY PER STORE: a save sends `booking_colors:<storeId>` alone; the legacy
 * `booking_colors` map is a read-only fallback, never written, never a refusal reason for the write.
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
import { BOOKING_COLOR_DEFAULTS, BOOKING_PALETTE, bookingColorsKeyFor } from '@/business/lib/booking-colors'
import { PUT } from '@/app/api/business/booking-colors/route'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import { bookingColorsOf, putBookingColors } from '@/app/[locale]/(business)/business/settings/SettingsScreen'
import { bookingColorsFor } from '@/business/lib/today-board'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
const K = bookingColorsKeyFor
const hexOf = (label: string) => BOOKING_PALETTE.find((c) => c.label === label)!.hex
const PICK = { new: hexOf('青'), repeat: hexOf('紫'), ticket: hexOf('桃'), vip: hexOf('紺') }
/** A LEGACY map holding another store's entry and a junk entry: never sent, never changed by a save. */
const OTHERS = { [STORE.yokohama]: { new: '#8a8a93', repeat: '#8A8A93', ticket: 'navy', vip: '#8a8a93' }, junk: [1, 'two', { three: 3 }] }
/** Core's own shallow top-level merge (org-settings.service.ts:50), STATEFUL: every PUT lands in `stored`. */
const coreMerges = () => {
  mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => {
    stored = { ...stored, ...input.settings }
    return coreRow(stored)
  })
}

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
  it('happy path: EXACTLY one PUT of { settings: { [\'booking_colors:\' + store]: four } } — nothing else — and core’s answer comes back', async () => {
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { ['booking_colors:' + S]: PICK } }]])
    expect(Object.keys((mockCore.upsert.mock.calls[0][0] as { settings: object }).settings)).toEqual(['booking_colors:' + S])
    expect(mockCore.writerFor).toHaveBeenCalledWith({ businessId: TENANT })
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toBe('[business booking colours]')
    expect(JSON.parse(info.mock.calls[0][1] as string)).toEqual({
      business_id: TENANT, actor: CARD.owner, store_id: S, key: 'booking_colors:' + S, old: null, new: PICK, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    })
  })

  it('the LEGACY map (another store’s entry + a junk entry) is never sent and stays BYTE-IDENTICAL after a save', async () => {
    seed({ business_type: 'beauty', booking_colors: OTHERS })
    coreMerges()
    const legacyBefore = JSON.stringify(stored.booking_colors)
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
    expect(JSON.stringify(stored.booking_colors)).toBe(legacyBefore)
    expect(stored).toEqual({ business_type: 'beauty', booking_colors: OTHERS, [K(S)]: PICK })
  })

  it('THE RACE (Greptile T1 on #1049): two stores save in the same instant — both reads land before either write — and BOTH keys survive', async () => {
    seed({ business_type: 'beauty', booking_colors: { [STORE.yokohama]: BOOKING_COLOR_DEFAULTS } })
    coreMerges()
    const PICK_Y = { new: hexOf('桃'), repeat: hexOf('茶'), ticket: hexOf('青緑'), vip: hexOf('灰') }
    // Both reads answer the state BEFORE either write (the same instant), and are held until both saves are in flight.
    const beforeEither = coreRow({ ...stored })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let reads = 0
    const spy = withReads(stored)
    spy.orgSettingsGet.mockImplementation(async () => {
      reads += 1
      await gate
      return beforeEither
    })
    const tokyo = data.writeBookingColors(S, PICK)
    const yokohama = data.writeBookingColors(STORE.yokohama, PICK_Y)
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setTimeout(r, 0))
    expect(reads).toBeGreaterThanOrEqual(1) // the reads are held (the mock client's once-per-actor slot may share one)…
    expect(mockCore.upsert).not.toHaveBeenCalled() // …and neither save has written
    release()
    expect(await Promise.all([tokyo, yokohama])).toEqual([{ ok: true, colors: PICK }, { ok: true, colors: PICK_Y }])
    expect(mockCore.upsert).toHaveBeenCalledTimes(2)
    for (const [call] of mockCore.upsert.mock.calls) expect(Object.keys((call as { settings: object }).settings)).toHaveLength(1)
    // neither store's save was lost: each resolves to its own four from what core now holds
    expect(bookingColorsFor(S, stored)).toEqual(PICK)
    expect(bookingColorsFor(STORE.yokohama, stored)).toEqual(PICK_Y)
    expect(stored[K(S)]).toEqual(PICK)
    expect(stored[K(STORE.yokohama)]).toEqual(PICK_Y)
    expect(stored.booking_colors).toEqual({ [STORE.yokohama]: BOOKING_COLOR_DEFAULTS }) // legacy untouched
    expect(stored.business_type).toBe('beauty')
  })

  it('uppercase palette hexes are accepted and sent lowercase', async () => {
    const upper = { new: PICK.new.toUpperCase(), repeat: PICK.repeat.toUpperCase(), ticket: PICK.ticket, vip: PICK.vip.toUpperCase() }
    expect(await data.writeBookingColors(S, upper)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
  })

  it('every one of the eleven is accepted, for every category', async () => {
    for (const c of BOOKING_PALETTE) {
      seed({})
      const four = { new: c.hex, repeat: c.hex, ticket: c.hex, vip: c.hex }
      expect(await data.writeBookingColors(S, four)).toEqual({ ok: true, colors: four })
    }
    expect(mockCore.upsert).toHaveBeenCalledTimes(11)
  })

  it('equal value (the store’s own key already holds exactly these four, lowercase) → no PUT, no audit line', async () => {
    const spy = seed({ booking_colors: { ...OTHERS, [S]: { ...PICK } }, [K(S)]: { ...PICK } })
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
  ])('not exactly equal (%s) → the four are sent, the store’s key is replaced by exactly them', async (_label, entry) => {
    seed({ [K(S)]: entry })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
  })

  it('the legacy entry alone already holds these four → still ONE PUT of the store’s own key (the legacy map is not the write’s truth)', async () => {
    seed({ booking_colors: { [S]: { ...PICK } } })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
  })

  it.each([
    ['an array', ['#3b6fd4']],
    ['a string', 'blue'],
    ['a number', 7],
    ['a boolean', true],
  ])('the store’s own key holding something that is not a colour set (%s) → core, logged, and NOTHING is overwritten', async (_label, raw) => {
    seed({ [K(S)]: raw })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(`[business booking colours] stored booking_colors:${S} is not a colour set; refusing to overwrite`)
  })

  it.each([
    ['an array', ['#3b6fd4']],
    ['a string', 'blue'],
    ['a number', 7],
  ])('a LEGACY booking_colors that is not a map (%s) no longer blocks the save: one PUT of the store’s key, the legacy value untouched', async (_label, raw) => {
    seed({ booking_colors: raw })
    coreMerges()
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
    expect(stored.booking_colors).toEqual(raw)
  })

  it('a stored null under the store’s key is an absent key: the four are sent', async () => {
    seed({ [K(S)]: null, booking_colors: null })
    expect(await data.writeBookingColors(S, PICK)).toEqual({ ok: true, colors: PICK })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
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
    ['the all-stores lens', 'all-stores'],
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
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
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
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: BOOKING_COLOR_DEFAULTS } }]])
  })
})

describe('⚖ PKT-S41 — the door hands back exactly the colour keys the leaf names (door.ts spells them; this pins them together)', () => {
  it('readBookingColors → the legacy map + every per-store key, values untouched (same references), and nothing else', async () => {
    const legacy = { [S]: PICK }
    const tokyo = { ...PICK }
    const yokohama = { ...BOOKING_COLOR_DEFAULTS }
    seed({
      business_type: 'beauty', reserve_card_color: '#1C2247', booking_colors_note: 'a Karute key sharing the stem', 'x-booking_colors:1': 1,
      booking_colors: legacy, [K(S)]: tokyo, [K(STORE.yokohama)]: yokohama,
    })
    const got = (await data.readBookingColors()) as Record<string, unknown>
    expect(Object.keys(got).sort()).toEqual(['booking_colors', K(S), K(STORE.yokohama)].sort())
    expect(got.booking_colors).toBe(legacy)
    expect(got[K(S)]).toBe(tokyo)
    expect(got[K(STORE.yokohama)]).toBe(yokohama)
  })
  it('no colour key at all → an empty subset; the settings absent → null', async () => {
    seed({ business_type: 'beauty' })
    expect(await data.readBookingColors()).toEqual({})
    withReads().orgSettingsGet.mockResolvedValue(null)
    expect(await data.readBookingColors()).toBeNull()
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
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { [K(S)]: PICK } }]])
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

  it('503 — core failed (reported, not swallowed); 503 — the store’s key holds something that is not a colour set', async () => {
    mockCore.upsert.mockRejectedValueOnce(new Error('503 from core'))
    expect(await answer(await put())).toEqual({ status: 503, body: { ok: false, reason: 'core' } })
    seed({ [K(S)]: 'blue' })
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

// ── the page + the screen (R7) ───────────────────────────────────────────────────────────────
type El = { props: { saveBookingColors?: unknown; saveCardColor?: unknown; sections: Array<{ id: string; lead: string; blocks: Array<{ id: string; rows: Array<{ controls: Array<{ id: string; value: unknown }> }> }> }> } }
const render = async (store: string = S) =>
  (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: 'language-display' }) })) as unknown as El
const langOf = (el: El) => el.props.sections.find((x) => x.id === 'language-display')!
const dialOf = (el: El) =>
  Object.fromEntries(langOf(el).blocks.find((b) => b.id === 'lang.colors')!.rows.flatMap((r) => r.controls).map((c) => [c.id.replace('lang.color-', ''), c.value]))

describe('⚖ PKT-S38 R7 — the page: 予約の色分け is live while the door is ON', () => {
  it('ON, no key: the lens store gets the dial seeded with the four defaults, and the save prop (the admitted business, the store, canSave, colors)', async () => {
    const el = await render()
    expect(el.props.saveBookingColors).toEqual({ businessId: TENANT, storeId: S, canSave: true, colors: BOOKING_COLOR_DEFAULTS })
    expect(dialOf(el)).toEqual(BOOKING_COLOR_DEFAULTS)
    // テスト東京店 has a fixture twin (store-test-ginza): its sample language rows stay, the colours are live
    expect(langOf(el).blocks.map((b) => b.id)).toEqual(['lang.language', 'lang.colors'])
    // a live store with NO fixture twin (Dev Salon): ONLY the colours block; the rest keeps サンプル設定なし
    const bare = await render(STORE.devSalon)
    expect(langOf(bare).blocks.map((b) => b.id)).toEqual(['lang.colors'])
    expect(langOf(bare).lead).toBe('サンプル設定なし')
    expect(dialOf(bare)).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(bare.props.saveBookingColors).toEqual({ businessId: TENANT, storeId: STORE.devSalon, canSave: true, colors: BOOKING_COLOR_DEFAULTS })
  })

  it('ON, a saved map: the lens store’s dial is seeded with ITS saved four; another store keeps the defaults', async () => {
    seed({ booking_colors: { [S]: PICK } })
    expect(dialOf(await render())).toEqual(PICK)
    seed({ booking_colors: { [S]: PICK } })
    expect(dialOf(await render(STORE.yokohama))).toEqual(BOOKING_COLOR_DEFAULTS)
  })

  it('ON, the store’s own key AND a legacy entry: the own key seeds the dial (present wins whole)', async () => {
    seed({ booking_colors: { [S]: BOOKING_COLOR_DEFAULTS }, [K(S)]: PICK })
    expect(dialOf(await render())).toEqual(PICK)
    seed({ booking_colors: { [S]: BOOKING_COLOR_DEFAULTS }, [K(S)]: PICK })
    expect(dialOf(await render(STORE.yokohama))).toEqual(BOOKING_COLOR_DEFAULTS)
  })

  it('ON, a sheet without settings.manage: canSave false — the SAME answer as the card colour (one sheet read)', async () => {
    as(LOGIN.goro)
    const spy = withReads()
    const el = await render()
    expect(el.props.saveBookingColors).toEqual({ businessId: TENANT, storeId: S, canSave: false, colors: BOOKING_COLOR_DEFAULTS })
    expect(el.props.saveCardColor).toEqual({ businessId: TENANT, canSave: false })
    void spy
    // the page asks core's sheet ONCE (readCanManageCardColor) and hands the same answer to both saves
    const PAGE = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/page.tsx'), 'utf8')
    expect(PAGE.match(/readCanManageCardColor\(\)/g)).toHaveLength(1)
    expect(PAGE).toContain('canSave: saveCardColor.canSave, colors: bookingColors }')
  })

  it('OFF: no save prop and no core read — the dial is the sample plane, seeded from the fixture store', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const spy = withReads()
    const el = await render('store-ginza')
    expect(el.props.saveBookingColors).toBeUndefined()
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
  })

  it('P6 — after a save through the route, a FRESH render (a new request = a new client and org read) seeds the saved four; the board resolves them for that store only', async () => {
    seed({ business_type: 'beauty', booking_colors: { [STORE.yokohama]: BOOKING_COLOR_DEFAULTS } })
    mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => {
      stored = { ...stored, ...input.settings } // core's shallow merge
      return coreRow(stored)
    })
    expect(await answer(await put())).toEqual({ status: 200, body: { ok: true, colors: PICK } })
    withReads().orgSettingsGet.mockImplementation(async () => coreRow(stored)) // the next request
    expect(dialOf(await render())).toEqual(PICK)
    expect(bookingColorsFor(S, stored)).toEqual(PICK)
    expect(bookingColorsFor(STORE.yokohama, stored)).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(stored.business_type).toBe('beauty')
    expect(await data.readBookingColors()).toEqual({ booking_colors: { [STORE.yokohama]: BOOKING_COLOR_DEFAULTS }, [K(S)]: PICK })
  })
})

describe('⚖ PKT-S38 R7 — the screen speaks the route’s contract', () => {
  const SAVE = { businessId: TENANT, storeId: S, canSave: true, colors: BOOKING_COLOR_DEFAULTS }
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })
  const reply = (status: number, body: unknown) => { const f = jest.fn(async () => new Response(JSON.stringify(body), { status })); global.fetch = f as unknown as typeof fetch; return f }

  it('bookingColorsOf reads the dial’s four swatches (control ids lang.color-<category>)', () => {
    expect(bookingColorsOf({ 'lang.color-new': PICK.new, 'lang.color-repeat': PICK.repeat, 'lang.color-ticket': PICK.ticket, 'lang.color-vip': PICK.vip, 'lang.ui': 'ja' })).toEqual(PICK)
  })

  it('PUT /api/business/booking-colors with X-Expected-Business and exactly { storeId, colors }; 200 → core’s four', async () => {
    const f = reply(200, { ok: true, colors: PICK })
    expect(await putBookingColors(SAVE, PICK)).toEqual({ ok: true, colors: PICK })
    expect(f.mock.calls).toEqual([['/api/business/booking-colors', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-expected-business': TENANT }, body: JSON.stringify({ storeId: S, colors: PICK }) }]])
  })

  it.each([
    [403, { ok: false, reason: 'forbidden' }, 'forbidden'],
    [409, { ok: false, reason: 'tenant' }, 'tenant'],
    [400, { ok: false, reason: 'invalid' }, 'invalid'],
    [503, { ok: false, reason: 'core' }, 'core'],
    [404, '<html>', 'core'],
    [200, { ok: true, colors: { new: PICK.new } }, 'core'],
    [500, { ok: false, reason: 'surprise' }, 'core'],
  ])('%s %j → %s', async (status, body, reason) => {
    reply(status as number, body)
    expect(await putBookingColors(SAVE, PICK)).toEqual({ ok: false, reason })
  })

  it('a network failure → core', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await putBookingColors(SAVE, PICK)).toEqual({ ok: false, reason: 'core' })
  })

  const SCREEN = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/SettingsScreen.tsx'), 'utf8')
  it('source pins: 保存する routes 言語・表示 to the real save only with the prop; canSave false → no 保存する + the forbidden foot; a pick / section change clears an old refusal', () => {
    expect(SCREEN).toContain("const LANG_SECTION_ID = 'language-display'")
    expect(SCREEN).toContain(': section.id === LANG_SECTION_ID && props.saveBookingColors ? void saveBookingSection(section, props.saveBookingColors) : commitSection(section))}')
    expect(SCREEN).toContain('const liveColors = section?.id === LANG_SECTION_ID ? props.saveBookingColors : undefined')
    expect(SCREEN).toContain('{liveColors.canSave === false ? null : roomSave(section)}')
    expect(SCREEN).toContain('<p className="st-foot">{liveColors.canSave ? BOOKING_SAVE_NOTE : BOOKING_SAVE_FAIL.forbidden}</p>')
    expect(SCREEN).toContain('{bookingFail && <p className="st-act-error" role="alert">{BOOKING_SAVE_FAIL[bookingFail]}</p>}')
    expect(SCREEN).toContain('onChange={liveColors ? (id, next) => { setBookingFail(null); setValue(id, next) } : setValue}')
    expect(SCREEN.match(/setBookingFail\(null\)/g)).toHaveLength(4) // the save itself, a pick, openSection, backToList
  })
})

