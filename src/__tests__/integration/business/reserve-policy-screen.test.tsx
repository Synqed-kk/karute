/**
 * @jest-environment jsdom
 *
 * Reserve S66 T6 — 受付's one 保存 for the six booking rules, mounted in jsdom through the 9/27 rendered-test
 * door, modelled on the booking-colours / store-days screen suites: the page is assembled as the route does it
 * (SettingsPage → settingsProps → the door, on the recorded Dev Salon answer set); the network is a stub of
 * /api/business/reserve-policy. ok · stale (draft kept, basedOn from the 409, a second press saves) · invalid ·
 * the route's message-less 409/400 → the screen's own fallback line.
 */
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/practice-door/core-reach', () => {
  // self-contained: the real module drags next/cache (Request/Response) into jsdom
  const { practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  class PracticeTenantMismatch extends Error {
    businessId: string
    constructor(businessId: string) { super(`practice switch refused business ${businessId}`); this.name = 'PracticeTenantMismatch'; this.businessId = businessId }
  }
  const guard = (admitted: { businessId: string }) => {
    const tenant = practiceTenant()
    if (tenant === null) throw new Error('practice door called with the switch unset')
    if (admitted.businessId !== tenant) throw new PracticeTenantMismatch(admitted.businessId)
  }
  return {
    PracticeTenantMismatch,
    orgSettingsWriterFor: () => { throw new Error('no writes in the screen suite') },
    clientFor: (admitted: { businessId: string }) => (guard(admitted), mockUi.reads()),
    storeDaysWriterFor: () => { throw new Error('the screen suite never writes through the door') },
    auditWriterFor: () => { throw new Error('the screen suite never writes through the door') },
  }
})

import { render, fireEvent, act, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'
import { requireBusinessAdmission } from '@/business/lib/admission'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import { LOGIN, POLICIES, STORE, TENANT, recordedReads } from './practice-door-recorded'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { policyHash } from '@/business/lib/practice-door/reserve-policy'

const SIX = { booking_open_days: 21, cutoff_minutes: 90, reserve_start_grid_min: 15 as const, cancel_free_until_hours: 12, cancel_late_pct: 30, no_show_pct: 100 }
const mockUi = {
  reads(): CoreReads {
    const base = recordedReads()
    return { ...base, storePolicyGet: async (id: string) => (id === STORE.tokyo ? { ...POLICIES[id], ...SIX, updated_at: '2026-10-07T01:00:00Z' } : base.storePolicyGet(id)) } as CoreReads
  },
}

const fakeRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === null) throw new SyntaxError('not json'); return body } }) as unknown as Response
const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const realFetch = global.fetch
let fetchLog: Array<{ url: string; method: string; headers: Record<string, string>; body: { storeId: string; policy: typeof SIX; basedOn: string } }> = []
let replies: Array<{ status: number; body: unknown }> = []

beforeAll(() => {
  // jsdom lacks these; Next's server helpers touch them at module load (lazy core-reach import).
  const util = jest.requireActual('node:util')
  const web = jest.requireActual('node:stream/web')
  Object.assign(global, { TextEncoder: util.TextEncoder, TextDecoder: util.TextDecoder, ReadableStream: web.ReadableStream, WritableStream: web.WritableStream, TransformStream: web.TransformStream })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) })
  ;(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.scrollTo = () => {}
  Element.prototype.scrollIntoView = () => {}
})
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime'] }).setSystemTime(new Date('2026-09-29T03:00:00Z'))
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
  fetchLog = []
  replies = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchLog.push({ url: String(input), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null })
    const r = replies.shift() ?? { status: 500, body: null }
    return fakeRes(r.status, r.body)
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  global.fetch = realFetch
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function mount() {
  const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'reserve-acceptance' }) })) as ReactElement
  render(el)
  await act(async () => {})
}
const settle = async () => { for (let k = 0; k < 5; k++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const daysInput = () => document.getElementById('st-blk-reserve.window')!.querySelector('input[aria-label="何日先まで受け付けるか"]') as HTMLInputElement
const saveBtn = () => [...document.querySelectorAll('button.st-save')].find((b) => /保存する/.test(b.textContent ?? '')) as HTMLButtonElement
const alertLine = () => document.querySelector('.st-act-error[role="alert"]')?.textContent ?? null
const press = async () => { await act(async () => { saveBtn().click() }); await settle() }
const B0 = policyHash(SIX)
const DRAFT = { ...SIX, booking_open_days: 22 }
const STALE_LINE = 'この店舗の予約と確保の設定が、このページを開いたあとにほかの画面や端末で保存されたため、保存できませんでした。最新の設定を確認してから、もう一度変更してください。'

describe('Reserve S66 — 受付’s 保存 (door ON, テスト東京店, live)', () => {
  it('ok: ONE PUT of exactly the six with the read basedOn; core’s row is taken, no refusal line', async () => {
    await mount()
    expect(daysInput().value).toBe('21')
    fireEvent.change(daysInput(), { target: { value: '22' } })
    replies = [{ status: 200, body: { ok: true, row: { ...DRAFT, updated_at: '2026-10-08T01:00:00Z' }, basedOn: 'h1' } }]
    await press()
    expect(fetchLog.map((f) => [f.url, f.method, f.headers['x-expected-business']])).toEqual([['/api/business/reserve-policy', 'PUT', TENANT]])
    expect(fetchLog[0].body).toEqual({ storeId: STORE.tokyo, policy: DRAFT, basedOn: B0 })
    expect(alertLine()).toBeNull()
    expect(daysInput().value).toBe('22')
    expect([...document.querySelectorAll('[role="status"]')].map((n) => n.textContent ?? '')).toContainEqual(expect.stringMatching(/^✓ 保存しました \d+:\d+$/)) // the ok line, never a modal
    // a second change is measured against core's answer, not the first read
    fireEvent.change(daysInput(), { target: { value: '23' } })
    replies = [{ status: 200, body: { ok: true, row: { ...DRAFT, booking_open_days: 23 }, basedOn: 'h2' } }]
    await press()
    expect(fetchLog[1].body.basedOn).toBe('h1')
  })

  it('stale: the line shows, the draft stays, basedOn moves to the 409’s; a second press saves the draft', async () => {
    await mount()
    fireEvent.change(daysInput(), { target: { value: '22' } })
    replies = [{ status: 409, body: { ok: false, reason: 'stale', message: STALE_LINE, current: { ...SIX, booking_open_days: 40, updated_at: 'x' }, basedOn: 'fresh' } }]
    await press()
    expect(alertLine()).toBe(STALE_LINE)
    expect(daysInput().value).toBe('22') // never replaced by core's current
    replies = [{ status: 200, body: { ok: true, row: DRAFT, basedOn: 'h3' } }]
    await press()
    expect(fetchLog.map((f) => f.body)).toEqual([
      { storeId: STORE.tokyo, policy: DRAFT, basedOn: B0 },
      { storeId: STORE.tokyo, policy: DRAFT, basedOn: 'fresh' },
    ])
    expect(alertLine()).toBeNull()
  })

  it('invalid: the door’s own line, verbatim; nothing committed', async () => {
    await mount()
    fireEvent.change(daysInput(), { target: { value: '22' } })
    const line = '直前締切が受け付ける日数より長く、予約できる枠がなくなるため、保存できませんでした。'
    replies = [{ status: 400, body: { ok: false, reason: 'invalid', message: line } }]
    await press()
    expect(alertLine()).toBe(line)
    expect(daysInput().value).toBe('22')
  })

  it.each([
    [409, { ok: false, reason: 'tenant' }, 'ここからはこの事業の設定を保存できないため、受付ルールはこれまでのままです。'],
    [400, { ok: false, reason: 'invalid' }, '設定できる範囲を超えた値があるため保存できず、受付ルールはこれまでのままです。'],
    [500, null, 'いまは保存できないため、時間をおいてもう一度保存してください（受付ルールはこれまでのままです）。'],
  ])('the route’s message-less %s → the screen’s own fallback line', async (status, body, line) => {
    await mount()
    fireEvent.change(daysInput(), { target: { value: '22' } })
    replies = [{ status, body }]
    await press()
    expect(alertLine()).toBe(line)
  })

  it('six unchanged: 保存する sends nothing', async () => {
    await mount()
    await press()
    expect(fetchLog).toEqual([])
    expect(alertLine()).toBeNull()
  })
})
