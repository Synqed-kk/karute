/**
 * ⚖ A2 (Liam 9/24) — the ONE Business writer: the Reserve card colour (PKT-A2-CORE-WRITE §1.5).
 * Same recorded answer set as practice-door-on.test.ts (no network). The core-reach mock keeps both
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
import { saveReserveCardColor } from '@/app/[locale]/(business)/business/settings/save-card-color'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
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

describe('⚖ A2 — the server entry and the page', () => {
  it('saveReserveCardColor: a different expected business → tenant before the door; the admitted one → the door', async () => {
    expect(await saveReserveCardColor('00000000-0000-4000-8000-00000000dead', KON)).toEqual({ ok: false, reason: 'tenant' })
    expect(mockCore.upsert).not.toHaveBeenCalled()
    expect(await saveReserveCardColor(TENANT, KON)).toEqual({ ok: true, color: KON })
    expect(mockCore.upsert.mock.calls).toEqual([[{ settings: { reserve_card_color: KON } }]])
  })

  const render = () => SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({}) })

  it('page.tsx ON: the screen gets the save action and the ADMITTED business id', async () => {
    expect(data.practiceDoorOn()).toBe(true)
    const el = await render()
    expect(el.props.saveCardColor).toEqual({ businessId: TENANT, save: saveReserveCardColor })
  })

  it('page.tsx OFF: no save action reaches the screen — today’s page-local commit', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const el = await render()
    expect(el.props.saveCardColor).toBeUndefined()
    expect(mockCore.upsert).not.toHaveBeenCalled()
  })
})
