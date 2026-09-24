/**
 * ⚖ A2 (Liam 9/24) — the ONE Business writer: the Reserve card colour (PKT-A2-CORE-WRITE §1.5).
 * Same recorded answer set as practice-door-on.test.ts (no network). The route (R-A2-13) is driven with
 * real Request objects. The core-reach mock keeps both
 * guards' throws exactly (switch unset; another business → PracticeTenantMismatch) and hands the door a
 * mock write-only handle, so every core call the writer makes is visible here.
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
import { PALETTE } from '@/business/lib/reserve-card/palette'
import { PUT } from '@/app/api/business/card-color/route'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CARD, LOGIN, TENANT, recordedReads } from './practice-door-recorded'

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
/** Core's answer to a PUT: the merged row (other keys kept), the sent key as core stored it. */
const coreRow = (settings: Record<string, unknown>) => ({ business_id: TENANT, name: 'Dev Salon', settings, created_at: 'x', updated_at: 'y' })

const KON = PALETTE[0].hex // 紺
const SHIRO = PALETTE.find((c) => c.name === '白')!.hex
const saved = process.env.BUSINESS_PRACTICE_TENANT
let info: jest.SpyInstance
let error: jest.SpyInstance
beforeEach(() => {
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  withReads({ business_type: 'beauty', pack_presets: [] })
  mockCore.upsert = jest.fn(async (input: { settings: Record<string, unknown> }) => coreRow({ business_type: 'beauty', pack_presets: [], ...input.settings }))
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

describe('⚖ A2 — the one writer: data.writeReserveCardColor → door', () => {
  it('happy path: EXACTLY one PUT of { settings: { reserve_card_color } } — nothing else — and core’s answer comes back', async () => {
    mockCore.upsert.mockResolvedValueOnce(coreRow({ business_type: 'beauty', reserve_card_color: '#1c2247' })) // core's own spelling
    expect(await data.writeReserveCardColor(KON)).toEqual({ ok: true, color: '#1C2247' }) // normalised from the ROW, not the input
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(mockCore.upsert.mock.calls[0]).toEqual([{ settings: { reserve_card_color: KON } }])
    expect(mockCore.writerFor).toHaveBeenCalledWith({ businessId: TENANT })
    // R-A2-4 — one structured audit line: business, actor, old (the read-before-write), new, ISO time
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toBe('[business card colour]')
    const line = JSON.parse(info.mock.calls[0][1] as string)
    expect(line).toEqual({ business_id: TENANT, actor: CARD.owner, old: null, new: '#1C2247', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) })
  })

  it('null clears: the PUT is exactly { settings: { reserve_card_color: null } }', async () => {
    withReads({ reserve_card_color: KON })
    expect(await data.writeReserveCardColor(null)).toEqual({ ok: true, color: null })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { reserve_card_color: null } }]])
    expect(JSON.parse(info.mock.calls[0][1] as string)).toMatchObject({ old: KON, new: null })
  })

  it('a legacy colour outside the 12 is replaced only by an explicit pick (the owner’s click is the overwrite)', async () => {
    withReads({ reserve_card_color: '#285643' })
    expect(await data.writeReserveCardColor(SHIRO)).toEqual({ ok: true, color: SHIRO })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { reserve_card_color: SHIRO } }]])
  })

  it('G6 — a legacy value is really cleared: stored navy + { color: null } → the null PUT is sent', async () => {
    withReads({ reserve_card_color: 'navy' })
    expect(await data.writeReserveCardColor(null)).toEqual({ ok: true, color: null })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { reserve_card_color: null } }]])
  })

  it.each([
    ['equal value', { reserve_card_color: KON }, KON],
    ['equal value, stored lowercase', { reserve_card_color: '#1c2247' }, KON],
    ['null onto an absent key', {}, null],
    ['null onto a stored null', { reserve_card_color: null }, null],
  ])('idempotent (%s): no PUT, no audit line, ok with the value', async (_label, settings, next) => {
    const spy = withReads(settings)
    expect(await data.writeReserveCardColor(next)).toEqual({ ok: true, color: next })
    expect(spy.orgSettingsGet).toHaveBeenCalledTimes(1)
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it.each([
    ['lowercase palette hex', '#1c2247'],
    ['off-palette hex', '#285643'],
    ['7 hex digits', '#1C22470'],
    ['3-digit hex', '#FFF'],
    ['a colour name', 'navy'],
    ['empty string', ''],
    ['padded', ' #1C2247'],
    ['a number', 42],
    ['an object', { hex: '#1C2247' }],
    ['undefined', undefined],
  ])('invalid (%s) → invalid, with ZERO core calls and no admission', async (_label, next) => {
    const spy = withReads()
    expect(await data.writeReserveCardColor(next as string)).toEqual({ ok: false, reason: 'invalid' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(admission).not.toHaveBeenCalled()
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('every one of the 12 is accepted exactly as the palette stores it', async () => {
    for (const c of PALETTE) {
      withReads()
      expect(await data.writeReserveCardColor(c.hex)).toEqual({ ok: true, color: c.hex })
    }
    expect(mockCore.upsert).toHaveBeenCalledTimes(12)
  })

  it('forbidden: an operator whose sheet lacks settings.manage → forbidden, no read of the colour, no PUT', async () => {
    as(LOGIN.goro) // manager preset in the recorded sheets, without settings.manage
    const spy = withReads()
    expect(await data.writeReserveCardColor(KON)).toEqual({ ok: false, reason: 'forbidden' })
    expect(spy.orgSettingsGet).not.toHaveBeenCalled()
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('another business → tenant (409-class), refused before any read', async () => {
    as(LOGIN.owner, '00000000-0000-4000-8000-00000000dead')
    const spy = withReads()
    expect(await data.writeReserveCardColor(KON)).toEqual({ ok: false, reason: 'tenant' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('core throws on the PUT → core (reported, not swallowed, not retried)', async () => {
    mockCore.upsert.mockRejectedValueOnce(new Error('503 from core'))
    expect(await data.writeReserveCardColor(KON)).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).toHaveBeenCalledTimes(1)
    expect(info).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('[business card colour] core did not save:', '503 from core')
  })

  it('core throws on the read-before-write → core, and no PUT', async () => {
    withReads().orgSettingsGet.mockRejectedValue(new Error('core down'))
    expect(await data.writeReserveCardColor(KON)).toEqual({ ok: false, reason: 'core' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('G5 — readCanManageCardColor is the writer’s own check: owner yes, the manager without settings.manage no', async () => {
    expect(await data.readCanManageCardColor()).toBe(true)
    as(LOGIN.goro)
    expect(await data.readCanManageCardColor()).toBe(false)
    expect(await data.writeReserveCardColor(KON)).toEqual({ ok: false, reason: 'forbidden' }) // the two agree
  })

  it('G5 — readCanManageCardColor never throws to the page: another business / a failed read / OFF → false', async () => {
    as(LOGIN.owner, '00000000-0000-4000-8000-00000000dead')
    expect(await data.readCanManageCardColor()).toBe(false)
    expect(error).not.toHaveBeenCalled()
    as(LOGIN.owner)
    withReads().answerSheet.mockRejectedValue(new Error('boom'))
    expect(await data.readCanManageCardColor()).toBe(false)
    expect(error).toHaveBeenCalledWith('[business card colour] core did not answer:', 'boom')
    delete process.env.BUSINESS_PRACTICE_TENANT
    const spy = withReads()
    expect(await data.readCanManageCardColor()).toBe(false)
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
  })

  it('switch OFF → tenant: no writer, nothing called, and the page offers no real save', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const spy = withReads()
    expect(data.practiceDoorOn()).toBe(false)
    expect(await data.writeReserveCardColor(KON)).toEqual({ ok: false, reason: 'tenant' })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(admission).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })
})

// ── the route (R-A2-13): PUT /api/business/card-color ─────────────────────────────────────────
const HOST = 'business.example.test'
function put(opts: { origin?: string | null; site?: string; host?: string; forwarded?: string; expected?: string | null; body?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: opts.host ?? HOST }
  if (opts.forwarded) headers['x-forwarded-host'] = opts.forwarded
  const origin = opts.origin === undefined ? `https://${HOST}` : opts.origin
  if (origin !== null) headers.origin = origin
  if (opts.site) headers['sec-fetch-site'] = opts.site
  const expected = opts.expected === undefined ? TENANT : opts.expected
  if (expected !== null) headers['x-expected-business'] = expected
  return PUT(new Request(`https://${HOST}/api/business/card-color`, { method: 'PUT', headers, body: opts.body ?? JSON.stringify({ color: KON }) }))
}
const answer = async (r: Response) => ({ status: r.status, body: await r.json() })

describe('⚖ A2 — the route: strict same-origin, 409 on the wrong business, exact { color } body, one code per answer', () => {
  it('200: the admitted business, same origin, { color } → the door → core’s answer', async () => {
    expect(await answer(await put())).toEqual({ status: 200, body: { ok: true, color: KON } })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { reserve_card_color: KON } }]])
  })

  it('200 for null (clear), and for Sec-Fetch-Site: same-origin when the browser sent no Origin', async () => {
    withReads({ reserve_card_color: KON })
    expect(await answer(await put({ body: JSON.stringify({ color: null }) }))).toEqual({ status: 200, body: { ok: true, color: null } })
    withReads()
    expect((await put({ origin: null, site: 'same-origin' })).status).toBe(200)
  })

  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['another origin claiming same-origin', { origin: 'https://evil.example', site: 'same-origin' }],
    ['no Origin and no Sec-Fetch-Site', { origin: null }],
    ['no Origin, cross-site fetch', { origin: null, site: 'cross-site' }],
    ['a malformed Origin', { origin: 'not a url' }],
    ['no Host to compare against', { host: '' }],
    ['Origin = a spoofed X-Forwarded-Host, the Host differs', { origin: 'https://evil.example', forwarded: 'evil.example' }],
  ])('403 — refused before admission or the door (%s)', async (_label, opts) => {
    expect(await answer(await put(opts as Parameters<typeof put>[0]))).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    expect(admission).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('200 — the Host the server received decides: Origin = Host passes with a foreign X-Forwarded-Host present', async () => {
    expect(await answer(await put({ forwarded: 'evil.example' }))).toEqual({ status: 200, body: { ok: true, color: KON } })
  })

  it.each([
    ['a different business', '00000000-0000-4000-8000-00000000dead'],
    ['no header', null],
    ['the tenant in capitals', TENANT.toUpperCase()],
  ])('409 — X-Expected-Business is not the admitted business (%s), before the door', async (_label, expected) => {
    const spy = withReads()
    expect(await answer(await put({ expected }))).toEqual({ status: 409, body: { ok: false, reason: 'tenant' } })
    for (const fn of Object.values(spy)) expect(fn).not.toHaveBeenCalled()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{color:'],
    ['an array', '["#1C2247"]'],
    ['a bare string', '"#1C2247"'],
    ['null', 'null'],
    ['an extra key', JSON.stringify({ color: KON, name: 'x' })],
    ['a settings blob', JSON.stringify({ settings: { reserve_card_color: KON } })],
    ['no color key', JSON.stringify({})],
    ['a number', JSON.stringify({ color: 1 })],
    ['off the palette', JSON.stringify({ color: '#285643' })],
    ['lowercase', JSON.stringify({ color: '#1c2247' })],
  ])('400 — the body is not exactly { color: palette | null } (%s), and nothing is written', async (_label, body) => {
    expect(await answer(await put({ body }))).toEqual({ status: 400, body: { ok: false, reason: 'invalid' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('403 — an operator without settings.manage', async () => {
    as(LOGIN.goro)
    expect(await answer(await put())).toEqual({ status: 403, body: { ok: false, reason: 'forbidden' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })

  it('503 — core failed (reported, not swallowed)', async () => {
    mockCore.upsert.mockRejectedValueOnce(new Error('503 from core'))
    expect(await answer(await put())).toEqual({ status: 503, body: { ok: false, reason: 'core' } })
  })

  it.each(['staffList', 'answerSheet'] as const)('503 — the actor’s %s read fails while the save is prepared: core, never a 500, and no PUT', async (read) => {
    withReads()[read].mockRejectedValue(new Error('boom'))
    expect(await answer(await put())).toEqual({ status: 503, body: { ok: false, reason: 'core' } })
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('[business card colour] core did not answer:', 'boom')
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

describe('⚖ A2 — the screen speaks the route’s contract (source pin; the click-through is the live proof)', () => {
  const SCREEN = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/SettingsScreen.tsx'), 'utf8')
  it('PUT /api/business/card-color with X-Expected-Business and exactly { color }', () => {
    expect(SCREEN).toContain("const CARD_SAVE_URL = '/api/business/card-color'")
    expect(SCREEN).toContain("method: 'PUT',")
    expect(SCREEN).toContain("headers: { 'content-type': 'application/json', 'x-expected-business': card.businessId },")
    expect(SCREEN).toContain('body: JSON.stringify({ color: next }),')
  })
  it('G5 — core’s sheet says no (canSave false): the card section renders no 保存する and its foot is the forbidden line', () => {
    expect(SCREEN).toContain('type CardSave = { businessId: string; canSave: boolean }')
    expect(SCREEN).toContain('{props.saveCardColor ? (props.saveCardColor.canSave ? CARD_SAVE_NOTE : CARD_SAVE_FAIL.forbidden) : props.demoSaveLine}')
    expect(SCREEN).toContain('{props.saveCardColor?.canSave === false ? null : roomSave(section)}')
  })
  it('G7 — an old refusal is cleared by a new pick and by every section change (source pin: territory cannot mount a React tree)', () => {
    const at = (needle: string) => { const i = SCREEN.indexOf(needle); expect(i).toBeGreaterThan(-1); return SCREEN.slice(i, SCREEN.indexOf('}', SCREEN.indexOf('setPicked(', i) + 1) + 1) }
    expect(SCREEN).toMatch(/onPick=\{\(hex\) => \{\s*setCardFail\(null\)[^\n]*\n\s*setValue\(CARD_COLOR_ID, hex\)/)
    expect(at('const openSection = useCallback(')).toContain('setCardFail(null)')
    expect(at('const backToList = useCallback(')).toContain('setCardFail(null)')
    expect(SCREEN.match(/setPicked\(/g)).toHaveLength(2) // openSection + backToList are the only section switches
  })
  it('the JP lines are JP-COPY-A2-FINAL’s, byte for byte, by id', () => {
    for (const line of [
      "'色は事業全体の設定として保存され、お客様が次にReserveのお店ページを開くと表示されます。' // save.note.card",
      "forbidden: '設定を変更できる権限がないため保存できず、Reserveのカードはこれまでの色のままです。', // save.fail.forbidden",
      "tenant: 'ここからはこの事業の設定を保存できないため、Reserveのカードはこれまでの色のままです。', // save.fail.tenant",
      "invalid: '選んだ色が12色に含まれていないため保存できず、Reserveのカードはこれまでの色のままです。', // save.fail.invalid",
      "core: 'いまは保存できないため、時間をおいてもう一度保存してください（Reserveのカードはこれまでの色のままです）。', // save.fail.core",
    ]) expect(SCREEN).toContain(line)
    expect(SCREEN).not.toContain('反映されます')
  })
})

describe('⚖ A2 — the page', () => {
  const render = () => SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({}) })

  it('page.tsx ON: the screen is told the ADMITTED business (the route’s X-Expected-Business) and core’s yes', async () => {
    expect(data.practiceDoorOn()).toBe(true)
    const el = await render()
    expect(el.props.saveCardColor).toEqual({ businessId: TENANT, canSave: true })
  })

  it('page.tsx ON, a sheet without settings.manage (G5): canSave false — the screen offers no save the writer would refuse', async () => {
    as(LOGIN.goro)
    const el = await render()
    expect(el.props.saveCardColor).toEqual({ businessId: TENANT, canSave: false })
  })

  it('page.tsx OFF: no save action reaches the screen — today’s page-local commit', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const el = await render()
    expect(el.props.saveCardColor).toBeUndefined()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })
})
