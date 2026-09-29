/**
 * @jest-environment jsdom
 *
 * ⚖ PKT-S30 F2 (mounted half) · Also-noted A · F10 (R-A) — the REAL 設定 screen, mounted in jsdom
 * through the ⚖ 9/27 rendered-test door (business-isolation.test.ts: a `*.test.tsx` directly under
 * this folder may import react-dom/client + @testing-library/react). The page is assembled exactly as
 * the route does it (SettingsPage → settingsProps → the door, on the recorded Dev Salon answer set);
 * the network is a stub of the two store-days routes. Prior art: opus-read-1/scripts/screen-attack.test.tsx.
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
import { requireBusinessAdmission } from '@/business/lib/admission'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import { CARD, LOGIN, STORE, TENANT, recordedReads } from './practice-door-recorded'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import type { ReactElement } from 'react'
import { STORE_A } from '@/business/lib/fixtures'
import { READ_FAILURE_LINE, READ_ONLY_NOTE } from '@/business/lib/data'
import { storeDaysLockedNote } from '@/app/[locale]/(business)/business/settings/settings-props'
import { screen, within } from '@testing-library/react'

type CD = { id: string; store_id: string; date: string; reason: string | null; created_by: string | null; created_at: string }
const C1: CD = { id: 'c1', store_id: STORE.tokyo, date: '2026-10-08', reason: '店内研修（テスト）', created_by: null, created_at: 'x' }
const C2: CD = { id: 'c2', store_id: STORE.tokyo, date: '2026-11-10', reason: '棚卸し', created_by: null, created_at: 'x' }

const mockUi = {
  special: [{ date: '2026-10-20', open: '10:00', close: '19:00' }] as Array<{ date: string; open: string; close: string }>,
  closures: [C1, C2] as CD[],
  getThrows: false,
  listThrows: false,
  granted: false,
  grantThrows: false,
  sheetOverride: {} as Record<string, unknown>,
  reads(): CoreReads {
    const base = recordedReads({ closedDays: { [STORE.tokyo]: mockUi.closures }, hqGranted: mockUi.granted })
    return {
      ...base,
      businessGrantsCheck: async (id: string) => { if (mockUi.grantThrows) throw new Error('core outage (grants)'); return base.businessGrantsCheck(id) },
      answerSheet: async (id: string) => (mockUi.sheetOverride[id] as Awaited<ReturnType<CoreReads['answerSheet']>>) ?? base.answerSheet(id),
      storePolicyGet: async (id: string) => {
        if (mockUi.getThrows) throw new Error('core outage (get)')
        const p = await base.storePolicyGet(id)
        return { ...p, special_open_days: id === STORE.tokyo ? mockUi.special.map((d) => ({ ...d })) : p.special_open_days }
      },
      storePolicyListClosedDays: async (id: string, range?: { from?: string }) => {
        if (mockUi.listThrows) throw new Error('core outage (list)')
        return { closed_days: (id === STORE.tokyo ? mockUi.closures : []).filter((c) => !range?.from || c.date >= range.from) }
      },
    }
  },
}

const fakeRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === null) throw new SyntaxError('not json'); return body } }) as unknown as Response
const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const realFetch = global.fetch
let fetchLog: Array<{ url: string; method: string; body: unknown }> = []
let reply: (url: string, method: string, body: unknown) => { status: number; body: unknown } = () => ({ status: 500, body: null })

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
  mockUi.special = [{ date: '2026-10-20', open: '10:00', close: '19:00' }]
  mockUi.closures = [C1, C2]
  mockUi.getThrows = false
  mockUi.listThrows = false
  mockUi.granted = false
  mockUi.grantThrows = false
  mockUi.sheetOverride = {}
  admission.mockResolvedValue({ userId: LOGIN.owner, email: null, businessId: TENANT })
  fetchLog = []
  reply = () => ({ status: 500, body: null })
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    fetchLog.push({ url, method, body })
    const r = reply(url, method, body)
    return fakeRes(r.status, r.body)
  }) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  global.fetch = realFetch
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function mount(store: string = STORE.tokyo) {
  const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: 'store-hours' }) })) as ReactElement
  const view = render(el)
  await act(async () => {})
  return view
}
const blockEl = (id: string) => document.getElementById(`st-blk-${id}`)
const rowsText = (id: string) => [...(blockEl(id)?.querySelectorAll('.st-coll-row') ?? [])].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim())
const addBtn = (id: string) => [...(blockEl(id)?.querySelectorAll('button.st-act') ?? [])].find((b) => /追加/.test(b.textContent ?? '')) as HTMLButtonElement | undefined
const input = (domId: string) => document.getElementById(domId) as HTMLInputElement | null
const settle = async () => { for (let k = 0; k < 5; k++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = (id: string) => (blockEl(id)?.textContent ?? '').replace(/\s+/g, ' ')
const unsavedMarks = () => [...document.querySelectorAll('.st-sr')].filter((n) => n.textContent === '未保存の変更があります').length
const typeSpecial = (date: string, open: string, close: string) => {
  fireEvent.change(input('store-hours.special-open-date')!, { target: { value: date } })
  fireEvent.change(input('store-hours.special-open-open')!, { target: { value: open } })
  fireEvent.change(input('store-hours.special-open-close')!, { target: { value: close } })
}

describe('m6 — the committed row is core’s own, never the echoed input', () => {
  it('臨時休業: core’s returned row (its date, its reason) is shown, in date order; the typed input never appears', async () => {
    await mount()
    reply = (url) => (url.includes('/closures') ? { status: 200, body: { ok: true, row: { id: 'srv-9', store_id: STORE.tokyo, date: '2026-10-01', reason: 'コアが保存した理由', created_by: CARD.owner, created_at: 'now' } } } : { status: 500, body: null })
    fireEvent.change(input('store-hours.closures-date')!, { target: { value: '2026-12-01' } })
    fireEvent.change(input('store-hours.closures-reason')!, { target: { value: '入力しただけの理由' } })
    await act(async () => { addBtn('store-hours.closures')!.click() })
    await settle()
    const rows = rowsText('store-hours.closures')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('10月1日')
    expect(rows[0]).toContain('コアが保存した理由')
    expect(rows.join('|')).not.toContain('入力しただけの理由')
    expect(rows.join('|')).not.toContain('12月1日')
  })
  it('特別営業日: core’s WHOLE array replaces the list — a row core dropped goes, the typed row is not added', async () => {
    await mount()
    expect(rowsText('store-hours.special-open').join('|')).toContain('10月20日')
    reply = (url) => (url.includes('/special') ? { status: 200, body: { ok: true, specialOpenDays: [{ date: '2026-12-05', open: '09:00', close: '17:00' }] } } : { status: 500, body: null })
    typeSpecial('2026-12-06', '10:00', '12:00')
    await act(async () => { addBtn('store-hours.special-open')!.click() })
    await settle()
    const rows = rowsText('store-hours.special-open')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('12月5日')
    expect(rows[0]).toContain('09:00〜17:00')
    expect(rows.join('|')).not.toContain('12月6日')
  })
})

describe('m15 — a failed write leaves the rows untouched', () => {
  const FAIL = { status: 503, body: { ok: false, reason: 'core', message: 'いまは保存できないため、時間をおいてもう一度保存してください（予定の一覧はこれまでのままです）。' } }
  it('臨時休業 add and remove both fail: the list is byte-for-byte what it was, and the line says so', async () => {
    await mount()
    const before = rowsText('store-hours.closures')
    reply = () => FAIL
    fireEvent.change(input('store-hours.closures-date')!, { target: { value: '2026-12-01' } })
    await act(async () => { addBtn('store-hours.closures')!.click() })
    await settle()
    await act(async () => { (blockEl('store-hours.closures')!.querySelector('button.st-coll-del') as HTMLButtonElement).click() })
    await settle()
    expect(rowsText('store-hours.closures')).toEqual(before)
    expect(text('store-hours.closures')).toContain('予定の一覧はこれまでのままです')
  })
  it('特別営業日 add fails: the list is what it was, the typed row never appears', async () => {
    await mount()
    const before = rowsText('store-hours.special-open')
    reply = () => FAIL
    typeSpecial('2026-12-06', '10:00', '12:00')
    await act(async () => { addBtn('store-hours.special-open')!.click() })
    await settle()
    expect(rowsText('store-hours.special-open')).toEqual(before)
  })
})

describe('Also-noted A — a `forbidden` answer at write time', () => {
  it('both blocks flip to read-only with the read-only line; no 追加 / 取り消す remain on either', async () => {
    await mount()
    expect(addBtn('store-hours.special-open')).toBeDefined()
    reply = () => ({ status: 403, body: { ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' } })
    typeSpecial('2026-12-06', '10:00', '12:00')
    await act(async () => { addBtn('store-hours.special-open')!.click() })
    await settle()
    for (const id of ['store-hours.special-open', 'store-hours.closures']) {
      expect(text(id)).toContain('変更には本部の権限が必要です。')
      expect(addBtn(id)).toBeUndefined()
      expect(blockEl(id)!.querySelectorAll('button.st-coll-del').length).toBe(0)
    }
  })
})

// ⚖ PKT-S33 F1 — an ok remove takes the door's refreshed `closures` list (its FRESH read), not a local drop.
describe('PKT-S33 F1 — 臨時休業 remove takes the door’s refreshed list', () => {
  const delFirst = async () => {
    await act(async () => { (blockEl('store-hours.closures')!.querySelector('button.st-coll-del') as HTMLButtonElement).click() })
    await settle()
  }
  it('ok:true with closures:[Y] (Y unknown to the screen) → the list is exactly [Y]', async () => {
    await mount()
    expect(rowsText('store-hours.closures')).toHaveLength(2)
    const Y = { id: 'srv-y', store_id: STORE.tokyo, date: '2026-12-15', reason: '他の管理者が追加', created_by: null, created_at: 'x' }
    reply = (url, method) => (url.includes('/closures') && method === 'DELETE' ? { status: 200, body: { ok: true, closures: [Y] } } : { status: 500, body: null })
    await delFirst()
    const rows = rowsText('store-hours.closures')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('12月15日')
    expect(rows[0]).toContain('他の管理者が追加')
    expect(rows.join('|')).not.toContain('10月8日')
    expect(rows.join('|')).not.toContain('11月10日')
  })
  it('defensive: ok:true without closures → the removed row goes, the rest is unchanged', async () => {
    await mount()
    const before = rowsText('store-hours.closures')
    reply = (url, method) => (url.includes('/closures') && method === 'DELETE' ? { status: 200, body: { ok: true } } : { status: 500, body: null })
    await delFirst()
    expect(rowsText('store-hours.closures')).toEqual([before[1]])
    expect(before[0]).toContain('10月8日')
  })
})

// ⚖ PKT-S33 F4 — an `invalid` refusal: the door's message is printed verbatim (the UI keeps no copy),
// the form keeps its values, and the block is NOT revoked.
describe('PKT-S33 F4 — an `invalid` refusal passes the door’s message through', () => {
  it.each([['過ぎた日付です'], ['特別営業日は366日までです']])('400 invalid 「%s」 → printed exactly, form kept, controls stay', async (message) => {
    await mount()
    const before = rowsText('store-hours.closures')
    reply = (url, method) => (url.includes('/closures') && method === 'POST' ? { status: 400, body: { ok: false, reason: 'invalid', message } } : { status: 500, body: null })
    fireEvent.change(input('store-hours.closures-date')!, { target: { value: '2026-12-01' } })
    fireEvent.change(input('store-hours.closures-reason')!, { target: { value: '入力した理由' } })
    await act(async () => { addBtn('store-hours.closures')!.click() })
    await settle()
    const err = blockEl('store-hours.closures')!.querySelector('p.st-coll-error') as HTMLParagraphElement | null
    expect(err).not.toBeNull()
    expect(err!.getAttribute('role')).toBe('status')
    expect(err!.textContent).toBe(message)
    expect(input('store-hours.closures-date')!.value).toBe('2026-12-01')
    expect(input('store-hours.closures-reason')!.value).toBe('入力した理由')
    expect(rowsText('store-hours.closures')).toEqual(before)
    for (const id of ['store-hours.closures', 'store-hours.special-open']) {
      expect(addBtn(id)).toBeDefined()
      expect(blockEl(id)!.querySelectorAll('button.st-coll-del').length).toBeGreaterThan(0)
      expect(text(id)).not.toContain(READ_ONLY_NOTE)
    }
  })
})

describe('F10 (R-A) — the OFF world: 特別営業日 is a local draft, like 臨時休業', () => {
  it('a draft add shows the row, counts as an unsaved change, sends nothing, and never refuses', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await mount(STORE_A)
    const marksBefore = unsavedMarks()
    typeSpecial('2026-12-01', '10:00', '12:00')
    await act(async () => { addBtn('store-hours.special-open')!.click() })
    await settle()
    expect(rowsText('store-hours.special-open').join('|')).toContain('12月1日')
    expect(unsavedMarks()).toBeGreaterThan(marksBefore)
    expect(text('store-hours.special-open')).not.toContain('追加できません')
    expect(fetchLog).toEqual([])
  })
  it('ON world, by contrast: a live 臨時休業 add is no unsaved change', async () => {
    await mount()
    reply = () => ({ status: 200, body: { ok: true, row: { id: 'srv-2', store_id: STORE.tokyo, date: '2026-12-01', reason: null, created_by: CARD.owner, created_at: 'now' } } })
    fireEvent.change(input('store-hours.closures-date')!, { target: { value: '2026-12-01' } })
    await act(async () => { addBtn('store-hours.closures')!.click() })
    await settle()
    expect(rowsText('store-hours.closures').join('|')).toContain('12月1日')
    expect(unsavedMarks()).toBe(0)
  })
})

// ⚖ PKT-S32 R14 — the page's R9 mapping reaches the SCREEN: a signed-in non-OWNER without the grant
// ('read-only') and a grant check that throws ('unknown') each show their ONE mapped line in BOTH
// blocks, with no 追加 and no 取り消す anywhere (m20: a screen that ignores lockedNote goes red here).
describe('R14 — locked actors: the mapped line in both blocks, no add / remove controls', () => {
  const nonOwner = () => {
    // the OWNER's own login, answered by core as an ADMIN (settings.manage + viewAll, no HQ grant)
    mockUi.sheetOverride = { [CARD.owner]: { staff_id: CARD.owner, role: 'manager', coarse_role: 'ADMIN', capabilities: ['settings.manage', 'stores.viewAll'], visible_store_ids: null, money_scope: null, version: '1.1' } }
  }
  it.each([
    ['read-only', () => { nonOwner() }, READ_ONLY_NOTE, READ_FAILURE_LINE],
    ['unknown', () => { nonOwner(); mockUi.grantThrows = true }, READ_FAILURE_LINE, READ_ONLY_NOTE],
  ] as const)("'%s' actor", async (state, arrange, line, otherLine) => {
    expect(storeDaysLockedNote(state)).toBe(line) // exactly the line the page maps for this state
    arrange()
    await mount()
    for (const id of ['store-hours.closures', 'store-hours.special-open']) {
      const blk = blockEl(id)!
      expect(blk).not.toBeNull()
      expect(within(blk).getAllByText(line, { exact: false }).length).toBeGreaterThanOrEqual(1)
      expect(text(id)).not.toContain(otherLine)
      expect(addBtn(id)).toBeUndefined()
      expect(blk.querySelectorAll('button.st-coll-del').length).toBe(0)
    }
    expect(document.body.textContent!.split(line).length - 1).toBe(2)
    expect(screen.queryByRole('button', { name: /追加/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /取り消す/ })).toBeNull()
  })
})
