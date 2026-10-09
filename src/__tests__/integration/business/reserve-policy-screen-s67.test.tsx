/**
 * @jest-environment jsdom
 *
* Reserve S67 fix batch (F1–F10 + the JP rulings), on the S67 attack's harness (reads/attack-b2-tests). Original header:
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
  tokyo: null as null | (() => Promise<unknown>),
  reads(): CoreReads {
    const base = recordedReads()
    return { ...base, storePolicyGet: async (id: string) => (id === STORE.tokyo ? (mockUi.tokyo ? mockUi.tokyo() : { ...POLICIES[id], ...SIX, updated_at: '2026-10-07T01:00:00Z' }) : base.storePolicyGet(id)) } as CoreReads
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
  mockUi.tokyo = null
  cleanup()
  global.fetch = realFetch
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function mount(store: string = STORE.tokyo) {
  const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: 'reserve-acceptance' }) })) as ReactElement
  render(el)
  await act(async () => {})
}
const settle = async () => { for (let k = 0; k < 5; k++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const daysInput = () => document.getElementById('st-blk-reserve.window')!.querySelector('input[aria-label^="何日先まで受け付けるか"]') as HTMLInputElement
const saveBtn = () => [...document.querySelectorAll('button.st-save')].find((b) => /保存する/.test(b.textContent ?? '')) as HTMLButtonElement
const alertLine = () => document.querySelector('.st-act-error[role="alert"]')?.textContent ?? null
const press = async () => { await act(async () => { saveBtn().click() }); await settle() }
const DRAFT = { ...SIX, booking_open_days: 22 }
const STALE_LINE = 'この店舗のReserve 受付の設定が、このページを開いたあとにほかの画面や端末で保存されたため、保存できませんでした。変更していない項目は最新の内容に置き換えました。もう一度保存すると、変更した項目が保存されます。'


import { LATE_FROM_BOOKING_NOTE } from '@/business/lib/data'
import { minutesLabel } from '@/business/lib/settings'
import { opsConfig as FIXTURE_OPS } from '@/business/lib/fixtures-today'
const blk = (id: string) => document.getElementById(`st-blk-${id}`)!
// a locked control's accessible name carries its reason (「直前締切 — 保存しています」), so match the prefix
const inp = (aria: string) => document.querySelector(`input[aria-label^="${aria}"]`) as HTMLInputElement
const pressNoSettle = () => act(async () => { saveBtn().click() })


const STAMP = '2026-10-08T03:00:00Z'
const auditsOf = () => ['reserve.window', 'reserve.cancel'].map((id) => (blk(id).textContent ?? '').match(/最終変更: \d+月\d+日\(.\)/)?.[0] ?? null)
const set = (aria: string, v: string) => { fireEvent.change(inp(aria), { target: { value: v } }); fireEvent.blur(inp(aria)) }
const previewText = () => {
  const t = blk('reserve.cancel').textContent ?? ''
  return t.match(/(ご来店の[^。]*。)(期限を過ぎた[^。]*。)?(ご連絡のない[^。]*。)?/)?.[0] ?? null
}
const READ_FAIL_LINE = 'この店舗の受付ルールを、いま読み込めませんでした。表示しているのはサンプルの値のため、変更や保存はできません。時間をおいて開き直してください。'

describe('Reserve S67 — 受付 screen fix batch', () => {
  it('F1: the six are locked while the PUT is in flight; an edit cannot land; core’s saved values show after', async () => {
    await mount()
    let release!: (r: Response) => void
    global.fetch = jest.fn((_u: unknown, init?: RequestInit) => { fetchLog.push({ url: '', method: 'PUT', headers: {}, body: JSON.parse(String(init!.body)) }); return new Promise<Response>((r) => { release = r }) }) as unknown as typeof fetch
    fireEvent.change(daysInput(), { target: { value: '22' } })
    await pressNoSettle()
    expect(inp('直前締切').getAttribute('aria-disabled')).toBe('true')
    expect(inp('直前締切').getAttribute('aria-label')).toBe('直前締切 — 保存しています')
    fireEvent.change(inp('直前締切'), { target: { value: '60' } })
    expect(inp('直前締切').value).toBe('90')
    await act(async () => { release(fakeRes(200, { ok: true, row: { ...DRAFT, updated_at: STAMP }, basedOn: 'h1' })) })
    await settle()
    expect(fetchLog.length).toBe(1)
    expect(inp('直前締切').getAttribute('aria-disabled')).toBeNull()
    expect([daysInput().value, inp('直前締切').value]).toEqual(['22', '90'])
  })

  it('F2: the late note follows the draft before saving; 最終変更 follows core’s answer, no second GET', async () => {
    await mount()
    const has = () => (blk('reserve.cancel').textContent ?? '').includes(LATE_FROM_BOOKING_NOTE)
    expect(has()).toBe(true)
    set('当日キャンセル料', '0')
    expect(has()).toBe(false)
    expect(auditsOf()).toEqual(['最終変更: 10月7日(水)', '最終変更: 10月7日(水)'])
    replies = [{ status: 200, body: { ok: true, row: { ...SIX, cancel_late_pct: 0, updated_at: STAMP }, basedOn: 'h' } }]
    await press()
    expect(fetchLog.map((f) => f.method)).toEqual(['PUT'])
    expect(has()).toBe(false)
    expect(auditsOf()).toEqual(['最終変更: 10月8日(木)', '最終変更: 10月8日(木)'])
  })

  it('F3 (attack B1): stale merges — a field I never touched takes core’s 50 and the second press sends 50, never 100', async () => {
    await mount()
    fireEvent.change(daysInput(), { target: { value: '22' } })
    const theirs = { ...SIX, no_show_pct: 50 }
    replies = [{ status: 409, body: { ok: false, reason: 'stale', message: STALE_LINE, current: { ...theirs, updated_at: STAMP }, basedOn: policyHash(theirs) } }]
    await press()
    expect(alertLine()).toBe(STALE_LINE)
    expect([daysInput().value, inp('無断キャンセル料').value]).toEqual(['22', '50'])
    expect(auditsOf()).toEqual(['最終変更: 10月8日(木)', '最終変更: 10月8日(木)'])
    replies = [{ status: 200, body: { ok: true, row: { ...theirs, booking_open_days: 22 }, basedOn: 'h' } }]
    await press()
    expect(fetchLog[1].body.policy).toEqual({ ...SIX, booking_open_days: 22, no_show_pct: 50 })
    expect(fetchLog[1].body.basedOn).toBe(policyHash(theirs))
  })

  it('F3: a field both changed → mine wins', async () => {
    await mount()
    fireEvent.change(daysInput(), { target: { value: '22' } })
    const theirs = { ...SIX, booking_open_days: 40 }
    replies = [{ status: 409, body: { ok: false, reason: 'stale', message: STALE_LINE, current: { ...theirs, updated_at: STAMP }, basedOn: policyHash(theirs) } }]
    await press()
    expect(daysInput().value).toBe('22')
    replies = [{ status: 200, body: { ok: true, row: DRAFT, basedOn: 'h' } }]
    await press()
    expect(fetchLog[1].body.policy.booking_open_days).toBe(22)
  })

  it('F4: live and savable → the foot says 保存 reaches Reserve, never the demo line', async () => {
    await mount()
    const foot = [...document.querySelectorAll('.st-foot')].map((e) => e.textContent).join('|')
    expect(foot).toContain('保存すると、この店舗の受付ルールがReserveの予約ページに反映されます。「サンプル」の印がある項目は、この画面の中だけの保存になります。')
    expect(foot).not.toContain('保存はこの画面の中だけに反映されます')
  })

  it('F5: the locked 直前の空きは売らない row shows the DRAFT 直前締切', async () => {
    await mount()
    expect(inp('直前の空きは売らない').value).toBe('90')
    fireEvent.change(inp('直前締切'), { target: { value: '45' } })
    expect(inp('直前の空きは売らない').value).toBe('45')
  })

  it.each([
    ['0', '0', 'ご来店の時刻までは、無料でキャンセルできます。ご連絡のないキャンセルは、料金の100%です。'],
    ['0', '30', 'ご来店の時刻までは、無料でキャンセルできます。期限を過ぎたキャンセルは、料金の30%です。ご連絡のないキャンセルは、料金の100%です。'],
    // S68 — a 0 % 当日キャンセル料 is free up to the visit, whatever the deadline: never 「24時間前までは」
    ['24', '0', 'ご来店の時刻までは、無料でキャンセルできます。ご連絡のないキャンセルは、料金の100%です。'],
    ['24', '30', 'ご来店の24時間前までは、無料でキャンセルできます。期限を過ぎたキャンセルは、料金の30%です。ご連絡のないキャンセルは、料金の100%です。'],
  ])('F6: cancel preview reads naturally — free %sh × late %s%%', async (free, late, line) => {
    await mount()
    set('無料キャンセル期限', free)
    set('当日キャンセル料', late)
    expect(previewText()).toBe(line)
    process.stdout.write(`\n[S67 F6] ${free}h × ${late}% → ${previewText()}\n`)
  })

  it.each([
    ['3', '0', '50', 'ご来店の時刻までは、無料でキャンセルできます。ご連絡のないキャンセルは、料金の50%です。'],
    ['3', '30', '100', 'ご来店の3時間前までは、無料でキャンセルできます。期限を過ぎたキャンセルは、料金の30%です。ご連絡のないキャンセルは、料金の100%です。'],
    ['0', '0', '0', 'ご来店の時刻までは、無料でキャンセルできます。'],
  ])('S68 0%% preview: free %sh × late %s%% × no-show %s%%', async (free, late, noshow, line) => {
    await mount()
    set('無料キャンセル期限', free)
    set('当日キャンセル料', late)
    set('無断キャンセル料', noshow)
    expect(previewText()).toBe(line)
    process.stdout.write(`\n[S68 0%] ${free}h × ${late}% × ${noshow}% → ${previewText()}\n`)
  })

  it('S68 busy finally: a save whose network throws leaves the six unlocked and says so', async () => {
    await mount()
    global.fetch = jest.fn(async () => { throw new TypeError('network down') }) as unknown as typeof fetch
    fireEvent.change(daysInput(), { target: { value: '22' } })
    await press()
    expect(inp('直前締切').getAttribute('aria-disabled')).toBeNull()
    expect(alertLine()).not.toBeNull()
    fireEvent.change(inp('直前締切'), { target: { value: '60' } })
    expect(inp('直前締切').value).toBe('60')
  })

  it.each([[''], ['1.5'], ['abc']])('F7: 直前締切 = %j pressed without a blur → the range line, nothing sent', async (v) => {
    await mount()
    fireEvent.change(inp('直前締切'), { target: { value: v } })
    await press()
    expect(fetchLog).toEqual([])
    expect(alertLine()).toBe('設定できる範囲を超えた値があるため保存できず、受付ルールはこれまでのままです。')
  })

  it('F8: an unparseable updated_at prints no date line and does not throw', async () => {
    mockUi.tokyo = async () => ({ ...POLICIES[STORE.tokyo], ...SIX, updated_at: 'not-a-date' })
    await mount()
    expect(auditsOf()).toEqual([null, null])
  })

  it('F8 / S6: updated_at 2026-10-06T16:30:00Z is 10月7日(水) in JST', async () => {
    mockUi.tokyo = async () => ({ ...POLICIES[STORE.tokyo], ...SIX, updated_at: '2026-10-06T16:30:00Z' })
    await mount()
    expect(auditsOf()).toEqual(['最終変更: 10月7日(水)', '最終変更: 10月7日(水)'])
  })

  it('F9: the read fails for the admitted store → sample values, the read-fail line, the six locked, 0 PUTs, no 「まだつながっていません」', async () => {
    mockUi.tokyo = async () => { throw Object.assign(new Error('core 503'), { status: 503 }) }
    await mount()
    expect([daysInput().value, inp('直前締切').value]).toEqual(['30', '120'])
    for (const id of ['reserve.window', 'reserve.cancel']) expect(blk(id).textContent).toContain(READ_FAIL_LINE)
    // the six are connected (the read failed now): no 「not connected」 claim over them; the window block's part
    // mark still names only its own fixture rows (標準セッションの長さ …), which is true.
    expect(blk('reserve.cancel').textContent).not.toContain('実データはまだつながっていません')
    expect(blk('reserve.window').textContent).not.toContain('何日先まで受け付けるかはサンプルです')
    expect(daysInput().getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(daysInput(), { target: { value: '45' } })
    await press()
    expect(fetchLog).toEqual([])
  })

  it('F10: a row that fails the writer’s parse (open_days null) is a failed read, never an empty dial', async () => {
    mockUi.tokyo = async () => ({ ...POLICIES[STORE.tokyo], ...SIX, booking_open_days: null, updated_at: null })
    await mount()
    expect(blk('reserve.cancel').textContent).toContain(READ_FAIL_LINE)
    expect(daysInput().value).not.toBe('')
    await press()
    expect(fetchLog).toEqual([])
  })

  it('S68 grid 45 end to end: core 45 is SHOWN as 45, KEPT by a save that never touches it, SENT as 45', async () => {
    mockUi.tokyo = async () => ({ ...POLICIES[STORE.tokyo], ...SIX, reserve_start_grid_min: 45, updated_at: null })
    await mount()
    expect(blk('reserve.cancel').textContent).not.toContain(READ_FAIL_LINE)
    expect(inp('お客様が選べる開始時刻').value).toBe('45')
    fireEvent.change(daysInput(), { target: { value: '22' } })
    replies = [{ status: 200, body: { ok: true, row: { ...SIX, booking_open_days: 22, reserve_start_grid_min: 45, updated_at: STAMP }, basedOn: 'h' } }]
    await press()
    expect(fetchLog.length).toBe(1)
    expect(fetchLog[0].body.policy).toEqual({ ...SIX, booking_open_days: 22, reserve_start_grid_min: 45 })
    expect(inp('お客様が選べる開始時刻').value).toBe('45')
  })

  it('S68 L1: live store with grid 45 → the window facts carry no 「今日の運営」 grid line (今日の運営 reads the fixture)', async () => {
    mockUi.tokyo = async () => ({ ...POLICIES[STORE.tokyo], ...SIX, reserve_start_grid_min: 45, updated_at: null })
    await mount()
    expect(inp('お客様が選べる開始時刻').value).toBe('45')
    const w = blk('reserve.window').textContent ?? ''
    expect(w).not.toContain('今日の運営のお客様向け表示が読む値です')
  })

  it('S68 L1: a sample store (switch OFF) → the line prints the fixture grid, exactly as before S66', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await mount()
    const w = blk('reserve.window').textContent ?? ''
    expect(w).toContain(`お客様が選べる開始時刻の${minutesLabel(FIXTURE_OPS.reserveStartGridMin)}きざみは、今日の運営のお客様向け表示が読む値です。`)
  })

  it('JP rulings: 標準（30分） + its 初期値, the full-sentence lead lock, 来店時刻まで無料, the shorter R5 note', async () => {
    await mount()
    const w = blk('reserve.window').textContent ?? ''
    // S67 grid: a free whole-minutes field now (no 15/30/60 list); its 初期値 line below names 標準（30分）
    expect(blk('reserve.window').querySelector('input[aria-label="お客様が選べる開始時刻"]')).not.toBeNull()
    expect(w).toContain('初期値: 標準（30分）')
    expect(w).not.toContain('お店の標準')
    expect(w).toContain('上の「直前締切」と同じ値です。変えるときは「直前締切」を変更してください')
    set('無料キャンセル期限', '0')
    expect(blk('reserve.cancel').textContent).toContain('来店時刻まで無料')
    expect(LATE_FROM_BOOKING_NOTE).toBe('直前締切が無料キャンセル期限より短いため、期限を過ぎてから入った予約は、最初からキャンセル料の対象になります。')
  })
})

// S67 continuation — THE READ NEVER REJECTS A ROW CORE CAN HOLD: core takes any grid > 0 (store-policies.ts:76,
// CHECK 2026-09-15-store-policy-flexible-durations.sql:18), so 45 parses; 0 and a fraction never could.
describe('Reserve S67 — the grid is any positive whole minutes', () => {
  it('parseReservePolicy keeps 45 and null, refuses 0 / 12.5 / -15', async () => {
    const { parseReservePolicy, RESERVE_POLICY_DEFAULTS } = await import('@/business/lib/practice-door/reserve-policy')
    const at = (g: unknown) => parseReservePolicy({ ...RESERVE_POLICY_DEFAULTS, reserve_start_grid_min: g })?.reserve_start_grid_min
    expect([45, null, 0, 12.5, -15].map(at)).toEqual([45, null, undefined, undefined, undefined])
  })
  it('an empty grid box is core null on the wire; 45 is 45', async () => {
    const { reservePolicyOf } = await import('@/app/[locale]/(business)/business/settings/SettingsScreen')
    const six = { 'reserve.days': '30', 'reserve.cutoff': '0', 'reserve.free': '24', 'reserve.sameday': '0', 'reserve.noshow': '0' }
    expect([reservePolicyOf({ ...six, 'reserve.grid': '' }), reservePolicyOf({ ...six, 'reserve.grid': '45' })].map((p) => p.reserve_start_grid_min)).toEqual([null, 45])
  })
})
