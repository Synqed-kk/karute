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
// ⚖ S37 R42 (B2 act 1c fix 1) — a PASSTHROUGH spy on the one stamp formatter, so (h) can count the reads.
jest.mock('@/business/lib/clock', () => {
  const actual = jest.requireActual('@/business/lib/clock')
  return { ...actual, jstClock: jest.fn(actual.jstClock) }
})
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
import { cloneElement, StrictMode, type ReactElement } from 'react'
import { jstClock } from '@/business/lib/clock'
import type { SettingsSection } from '@/business/lib/settings'
import { STORE_A } from '@/business/lib/fixtures'
import { READ_FAILURE_LINE, READ_ONLY_NOTE } from '@/business/lib/data'
import { storeDaysLockedNote } from '@/app/[locale]/(business)/business/settings/settings-props'
import { screen, within } from '@testing-library/react'
import JA from '@/business/i18n/ja.json'

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
  admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
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

// ⚖ PKT-S33-B1B-FIX-2 (Greptile P2 on #1094) — the section's page-local footer (demoSaveLine,
// settings-props.ts) is FALSE while the door is ON (臨時休業 / 特別営業日 write to core), so the
// store-hours section drops it; the OFF world keeps it. The sample blocks keep their own markNote.
describe('PKT-S33-B1B-FIX-2 — the store-hours footer follows the door', () => {
  const DEMO_SAVE_LINE = '保存はこの画面の中だけに反映されます（実データ接続後に本保存）。'
  const footLines = () => [...document.querySelectorAll('.st-main p.st-foot')].map((p) => p.textContent)
  it('(a) ON world: no page-local footer; the sample blocks still carry their own sample line', async () => {
    await mount()
    expect(document.querySelector('.st-main')).not.toBeNull()
    expect(footLines()).not.toContain(DEMO_SAVE_LINE)
    expect(document.querySelector('.st-main')!.textContent).toContain(JA.sampleMark.markNote)
  })
  it('(b) OFF world: the page-local footer is there', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await mount(STORE_A)
    expect(footLines()).toContain(DEMO_SAVE_LINE)
  })
})

describe('S34 act 0 — 特別営業日 can close at 24:00 (the 24:00閉店 switch beside 閉店)', () => {
  const SPECIAL = 'store-hours.special-open'
  const midnightSwitch = () => within(blockEl(SPECIAL)!).getByRole('switch', { name: '24:00閉店' })
  const specialPosts = () => fetchLog.filter((f) => f.url.includes('/special') && f.method === 'POST')
  it('ON: the time field is replaced by a read-only 24:00 box, the door receives close "24:00", the saved row prints 10:00〜24:00', async () => {
    await mount()
    reply = (url) => (url.includes('/special') ? { status: 200, body: { ok: true, specialOpenDays: [{ date: '2026-11-17', open: '10:00', close: '24:00' }] } } : { status: 500, body: null })
    typeSpecial('2026-11-17', '10:00', '19:00')
    expect(midnightSwitch().getAttribute('aria-checked')).toBe('false')
    fireEvent.click(midnightSwitch())
    expect(midnightSwitch().getAttribute('aria-checked')).toBe('true')
    const box = input(`${SPECIAL}-close`)!
    expect(box.type).toBe('text')
    expect(box.readOnly).toBe(true)
    expect(box.getAttribute('aria-readonly')).toBe('true')
    expect(box.getAttribute('aria-label')).toBe('閉店 24:00')
    expect(box.value).toBe('24:00')
    await act(async () => { addBtn(SPECIAL)!.click() })
    await settle()
    expect(specialPosts().map((f) => f.body)).toEqual([expect.objectContaining({ date: '2026-11-17', open: '10:00', close: '24:00' })])
    const rows = rowsText(SPECIAL)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('11月17日')
    expect(rows[0]).toContain('10:00〜24:00')
    // reset after a successful add, like the other draft fields
    expect(midnightSwitch().getAttribute('aria-checked')).toBe('false')
    expect(input(`${SPECIAL}-close`)!.type).toBe('time')
  })
  it('ON then OFF: the time field comes back with its previous value, and that value is what the door receives', async () => {
    await mount()
    reply = (url) => (url.includes('/special') ? { status: 200, body: { ok: true, specialOpenDays: [{ date: '2026-11-17', open: '10:00', close: '19:00' }] } } : { status: 500, body: null })
    typeSpecial('2026-11-17', '10:00', '19:00')
    fireEvent.click(midnightSwitch())
    fireEvent.click(midnightSwitch())
    expect(midnightSwitch().getAttribute('aria-checked')).toBe('false')
    expect(input(`${SPECIAL}-close`)!.type).toBe('time')
    expect(input(`${SPECIAL}-close`)!.value).toBe('19:00')
    await act(async () => { addBtn(SPECIAL)!.click() })
    await settle()
    expect(specialPosts().map((f) => f.body)).toEqual([expect.objectContaining({ date: '2026-11-17', open: '10:00', close: '19:00' })])
  })
  it('the visible label is 24:00閉店 and the switch is a real, keyboard-reachable button', async () => {
    await mount()
    expect(text(SPECIAL)).toContain('24:00閉店')
    const sw = midnightSwitch()
    expect(sw.tagName).toBe('BUTTON')
    expect(sw.getAttribute('tabindex')).toBeNull()
  })
})

describe('S34 act 0 — the OFF world: a 24:00 special day is a local draft too', () => {
  it('switch ON + 追加: the draft row prints 10:00〜24:00, one unsaved change, the switch resets to a time field, nothing sent', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await mount(STORE_A)
    const SPECIAL = 'store-hours.special-open'
    const midnightSwitch = () => within(blockEl(SPECIAL)!).getByRole('switch', { name: '24:00閉店' })
    expect(unsavedMarks()).toBe(0)
    typeSpecial('2026-11-17', '10:00', '19:00')
    fireEvent.click(midnightSwitch())
    expect(midnightSwitch().getAttribute('aria-checked')).toBe('true')
    await act(async () => { addBtn(SPECIAL)!.click() })
    await settle()
    const row = rowsText(SPECIAL).find((r) => r.includes('11月17日'))
    expect(row).toContain('10:00〜24:00')
    expect(unsavedMarks()).toBe(1)
    expect(midnightSwitch().getAttribute('aria-checked')).toBe('false')
    expect(input(`${SPECIAL}-close`)!.type).toBe('time')
    expect(fetchLog).toEqual([])
  })
})

// ⚖ S35 B2 act 1 — the two honest lines on 店舗情報・営業時間, per block, against the truth table:
// S1 (sample blocks) prints exactly where a sample mark prints; S2 (live blocks) prints only where a
// press really saves (door ON + a store, writable, the live read held).
describe('B2 act 1 honest lines', () => {
  const S1 = 'サンプルのため、ここで変更しても店舗の設定としては保存されません。実データがつながると、ここから設定できます。'
  const S2 = '「追加」「取り消す」を押すとすぐ保存されるため、この画面の「保存する」を押す必要はありません。'
  const CLOSURES = 'store-hours.closures'
  const SPECIAL = 'store-hours.special-open'
  const count = (line: string) => (document.querySelector('.st-main')?.textContent ?? '').split(line).length - 1
  const s1Blocks = () => [...document.querySelectorAll('.st-main section.st-block')].filter((s) => (s.textContent ?? '').includes(S1)).map((s) => s.id)
  // a block "carries a mark" when it prints a mark note other than S1 itself
  const markedBlocks = () => [...document.querySelectorAll('.st-main section.st-block')]
    .filter((s) => [...s.querySelectorAll('p.sample-mark-note')].some((p) => p.textContent !== S1)).map((s) => s.id)
  const facts = (id: string) => [...(blockEl(id)?.querySelectorAll('p.st-fact') ?? [])].map((p) => p.textContent)
  const nonOwner = () => {
    mockUi.sheetOverride = { [CARD.owner]: { staff_id: CARD.owner, role: 'manager', coarse_role: 'ADMIN', capabilities: ['settings.manage', 'stores.viewAll'], visible_store_ids: null, money_scope: null, version: '1.1' } }
  }
  it('door OFF: neither line anywhere', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await mount(STORE_A)
    expect(document.querySelector('.st-main')).not.toBeNull()
    expect(count(S1)).toBe(0)
    expect(count(S2)).toBe(0)
    expect(markedBlocks()).toEqual([])
  })
  it('door ON + a store, writable: S1 on the three sample blocks only, S2 first on 臨時休業 and 特別営業日', async () => {
    await mount()
    expect(s1Blocks()).toEqual(['st-blk-store-hours.info', 'st-blk-store-hours.hours', 'st-blk-store-hours.ops'])
    expect(s1Blocks()).toEqual(markedBlocks())
    expect(count(S2)).toBe(2)
    expect(facts(CLOSURES)[0]).toBe(S2)
    expect(facts(CLOSURES)[1]).toBe('臨時休業にすると、その日にすでに入っている予約へ店舗都合の連絡が必要になります。')
    expect(facts(SPECIAL)[0]).toBe(S2)
  })
  it('door ON + a store, read-only: S2 absent (the read-only line stands alone); S1 unchanged', async () => {
    nonOwner()
    await mount()
    expect(count(READ_ONLY_NOTE)).toBe(2)
    expect(count(S2)).toBe(0)
    expect(s1Blocks()).toEqual(['st-blk-store-hours.info', 'st-blk-store-hours.hours', 'st-blk-store-hours.ops'])
  })
  it('door ON + a store, 臨時休業 read failed: S2 absent on 臨時休業, still on 特別営業日 (its read held)', async () => {
    mockUi.listThrows = true
    await mount()
    expect(text(CLOSURES)).toContain(READ_FAILURE_LINE)
    expect(facts(CLOSURES)).not.toContain(S2)
    expect(facts(SPECIAL)[0]).toBe(S2)
  })
  it('door ON + a store, both reads failed: S2 absent on both', async () => {
    mockUi.listThrows = true
    mockUi.getThrows = true
    await mount()
    expect(count(S2)).toBe(0)
    expect(text(SPECIAL)).toContain(READ_FAILURE_LINE)
  })
  // (the all-stores lens is not drivable here: `defaultStoreId` clamps any ?store= to a store the
  // actor sees, and a storeless actor is the only route to it — its S2 gate is saveStoreDays === undefined.)
  // Row 6 (storeDaysRead === null → 臨時休業 is itself a sample) cannot be reached through the real
  // routing (dials === null returns early), so this CONSTRUCTED case pins SettingsScreen's guard as
  // written: the real ON page element, saveStoreDays SET, with 臨時休業 re-dressed as a sample block
  // (mark + markLine, collection kept) and 特別営業日 left as the router built it.
  it('row 6 (constructed): 臨時休業 carries a sample mark under a live door → S2 on neither block, S1 on 臨時休業', async () => {
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'store-hours' }) })) as ReactElement<{ sections: SettingsSection[]; saveStoreDays?: unknown }>
    expect(el.props.saveStoreDays).toBeDefined()
    const hours = el.props.sections.find((x) => x.id === 'store-hours')!
    const mark = hours.blocks.find((x) => x.id === 'store-hours.info')!.sample
    expect(mark).toBeDefined()
    const sections = el.props.sections.map((x) => (x.id !== 'store-hours' ? x : {
      ...x,
      blocks: x.blocks.map((b) => (b.id === CLOSURES ? { ...b, sample: mark, markLine: S1 } : b)),
    }))
    expect(sections.find((x) => x.id === 'store-hours')!.blocks.find((b) => b.id === CLOSURES)!.collection).not.toBeNull()
    render(cloneElement(el, { sections }))
    await act(async () => {})
    expect(facts(CLOSURES)).not.toContain(S2)
    expect(facts(SPECIAL)).not.toContain(S2)
    expect(count(S2)).toBe(0)
    expect(text(CLOSURES)).toContain(S1)
    expect(s1Blocks()).toContain('st-blk-store-hours.closures')
  })
})

// ⚖ S36 R35 — B2 act 1b: the bar's 保存する under the door commits the SAMPLE blocks only (page
// state; nothing is sent), so its stamp says so. ONE predicate drives the stamp AND the hidden footer.
describe('B2 act 1b honest stamp', () => {
  const PAGE_ONLY = '✓ この画面だけに反映しました'
  const FOOT = '保存はこの画面の中だけに反映されます（実データ接続後に本保存）。'
  const HOURS = 'store-hours.hours'
  // ⚖ B2 act 1c — the stamp's time is the PRESS time; the suite's fake clock (beforeEach) is pinned at
  // 2026-09-29T03:00:00Z and never advanced here, so every press in this describe prints 12:00 JST.
  const stampTime = () => '12:00'
  const mountT = async (store: string) => {
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: 'store-hours' }) })) as ReactElement
    render(el)
    await act(async () => {})
  }
  const stamps = () => [...document.querySelectorAll('.st-save-line [role="status"]')].map((n) => n.textContent ?? '')
  const mainText = () => document.querySelector('.st-main')?.textContent ?? ''
  const footerShown = () => [...document.querySelectorAll('p.st-foot')].some((p) => p.textContent === FOOT)
  const saveBtn = () => [...document.querySelectorAll('button.st-save')].find((b) => /保存する/.test(b.textContent ?? '')) as HTMLButtonElement
  // one edit in the 営業時間 sample block: the first enabled time field moves by a minute
  const editHours = () => {
    const f = [...(blockEl(HOURS)?.querySelectorAll('input[type="time"]') ?? [])].find((i) => !(i as HTMLInputElement).disabled) as HTMLInputElement
    expect(f).toBeDefined()
    fireEvent.change(f, { target: { value: f.value === '09:01' ? '09:02' : '09:01' } })
  }
  const editAndSave = async () => {
    editHours()
    expect(stamps()[0]).toMatch(/^変更した設定 \d+件$/)
    const sent = fetchLog.length
    await act(async () => { saveBtn().click() })
    await settle()
    return fetchLog.length - sent
  }
  it('(a) door ON: 保存する stamps 「この画面だけに反映しました <time>」, never 「保存しました」, sends nothing', async () => {
    await mountT(STORE.tokyo)
    const sent = await editAndSave()
    expect(sent).toBe(0)
    expect(stamps()).toHaveLength(1)
    expect(stamps()[0]).toBe(`${PAGE_ONLY} ${stampTime()}`)
    expect(mainText()).not.toContain('✓ 保存しました')
    expect(document.body.textContent).not.toContain('✓ 保存しました')
    expect(stamps()[0]).not.toMatch(/変更した設定/)
  })
  // ⚖ B2 act 2a (S38) — pin edited: door OFF every save is page-only, so the stamp is the honest one
  // (R35's door-ON-only scope superseded; Liam 9/30 screenshot). The footer still shows.
  it('(b) door OFF: the same edit + 保存する → 「✓ この画面だけに反映しました <time>」, the footer shows, 保存しました absent', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await mountT(STORE_A)
    const sent = await editAndSave()
    expect(sent).toBe(0)
    expect(stamps()[0]).toBe(`${PAGE_ONLY} ${stampTime()}`)
    expect(footerShown()).toBe(true)
    expect(document.body.textContent).not.toContain('✓ 保存しました')
  })
  // (c) — the ON worlds where the footer shows today. Neither is reachable through the routing in this
  // suite (every store the owner can open, La Estro included, renders 臨時休業 under the door — probed
  // S36), so both are CONSTRUCTED from the real ON page element, as the act 1 row-6 case is:
  // c1 = the all-stores lens's gate (saveStoreDays undefined, R32); c2 = the door ON over a 営業時間
  // section that holds no 臨時休業 block (the untwinned / no-closures world).
  const onElement = async () => {
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'store-hours' }) })) as ReactElement<{ sections: SettingsSection[]; saveStoreDays?: unknown }>
    return el
  }
  // ⚖ B2 act 2a — pin edited: these worlds have no writer for the bar either, so the stamp is the honest one.
  it('(c) door ON, the worlds where the footer shows (constructed): footer present, the stamp is the honest one', async () => {
    const el = await onElement()
    expect(el.props.saveStoreDays).toBeDefined()
    render(cloneElement(el, { saveStoreDays: undefined }))
    await act(async () => {})
    expect(footerShown()).toBe(true)
    await editAndSave()
    expect(stamps()[0]).toBe(`${PAGE_ONLY} ${stampTime()}`)
    expect(document.body.textContent).not.toContain('✓ 保存しました')
    cleanup()
    const el2 = await onElement()
    const sections = el2.props.sections.map((x) => (x.id !== 'store-hours' ? x : { ...x, blocks: x.blocks.filter((b) => b.id !== 'store-hours.closures') }))
    render(cloneElement(el2, { sections }))
    await act(async () => {})
    expect(blockEl('store-hours.closures')).toBeNull()
    expect(footerShown()).toBe(true)
    await editAndSave()
    expect(stamps()[0]).toBe(`${PAGE_ONLY} ${stampTime()}`)
    expect(document.body.textContent).not.toContain('✓ 保存しました')
  })
  // ⚖ B2 act 2a — pin edited: the stamp no longer follows the footer; a page-only save is honest ON and OFF.
  it('(d) truth table, same render: the bar’s page-only save is honest ON and OFF; the footer follows the door', async () => {
    for (const on of [true, false]) {
      if (on) process.env.BUSINESS_PRACTICE_TENANT = TENANT
      else delete process.env.BUSINESS_PRACTICE_TENANT
      await mountT(on ? STORE.tokyo : STORE_A)
      await editAndSave()
      const stamp = stamps()[0]
      expect(stamp).toBe(`${PAGE_ONLY} ${stampTime()}`)
      expect(footerShown()).toBe(!on)
      cleanup()
    }
  })
  it('(e) the string has one home: absent from SettingsScreen.tsx, present in the i18n file', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs')
    const path = jest.requireActual('node:path') as typeof import('node:path')
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/[locale]/(business)/business/settings/SettingsScreen.tsx'), 'utf8')
    const i18n = fs.readFileSync(path.join(process.cwd(), 'src/business/i18n/ja.json'), 'utf8')
    expect(src).not.toContain(PAGE_ONLY)
    expect(i18n).toContain(`"pageOnlyStamp": "${PAGE_ONLY}"`)
    expect(JA.sampleMark.pageOnlyStamp).toBe(PAGE_ONLY)
    // ⚖ R37 — one predicate, two sites: a second copy of the expression at either site would pass every behaviour test (attack M5); the SHAPE is pinned here — the name and the callback parameter are free (Greptile #1098 thread).
    const expr = /\.blocks\.some\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.id\s*===\s*STORE_HOURS_CLOSURES_ID\s*\)/g
    const homes = src.match(expr) ?? []
    expect(homes).toHaveLength(1)
    const homeLine = src.split('\n').find((l) => l.includes(homes[0]!))
    const name = homeLine?.match(/\bconst\s+(\w+)\s*=/)?.[1]
    expect(name).toBeDefined()
    // ⚖ B2 act 2a — pin edited 3 → 2: the stamp no longer reads the door (definition + the footer ternary).
    expect(src.split(new RegExp(`\\b${name}\\b`)).length - 1).toBe(2)
  })
  // ⚖ R37 (attack M7) — the honest stamp is a COMMITTED stamp: before any press the bar says 変更はありません.
  it('(f) door ON, no edit, no save: 「変更はありません」, the page-only string absent', async () => {
    await mountT(STORE.tokyo)
    expect(stamps()).toEqual(['変更はありません'])
    expect(document.body.textContent).not.toContain(PAGE_ONLY)
  })
  // ⚖ R37 (attack M9/M10) — a live block that cannot write (revoked mid-session, or locked from the start)
  // does not make the bar's commit real: it still reaches the sample blocks only, so the stamp stays honest.
  const honestAfterSave = async () => {
    const sent = await editAndSave()
    expect(sent).toBe(0)
    expect(stamps()).toEqual([`${PAGE_ONLY} ${stampTime()}`])
    expect(document.body.textContent).not.toContain('✓ 保存しました')
  }
  it('(g) door ON, the write revoked mid-session (403 → storeDaysRevoked): sample edit + 保存する → the honest stamp', async () => {
    await mountT(STORE.tokyo)
    reply = () => ({ status: 403, body: { ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' } })
    fireEvent.change(input('store-hours.closures-date')!, { target: { value: '2026-12-01' } })
    await act(async () => { addBtn('store-hours.closures')!.click() })
    await settle()
    expect(addBtn('store-hours.closures')).toBeUndefined()
    expect(text('store-hours.closures')).toContain(READ_ONLY_NOTE)
    await honestAfterSave()
  })
  it('(h) door ON, saveStoreDays.lockedNote set (the actor may not write): sample edit + 保存する → the honest stamp', async () => {
    mockUi.sheetOverride = { [CARD.owner]: { staff_id: CARD.owner, role: 'manager', coarse_role: 'ADMIN', capabilities: ['settings.manage', 'stores.viewAll'], visible_store_ids: null, money_scope: null, version: '1.1' } }
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'store-hours' }) })) as ReactElement<{ saveStoreDays?: { lockedNote: string | null } }>
    expect(el.props.saveStoreDays?.lockedNote).toBe(READ_ONLY_NOTE)
    render(el)
    await act(async () => {})
    await honestAfterSave()
  })
})

// ⚖ S37 R41 — B2 act 1c: every save stamp prints the time 保存する was PRESSED, not the time the page
// rendered. The clock is faked (Date only; the beforeEach pins it) and moved between render and press;
// jest forces TZ=UTC while the stamp is JST, so every expected time below is a LITERAL.
describe('B2 act 1c stamp time', () => {
  const T1 = new Date('2026-11-18T14:59:00Z') // 23:59 JST — the render
  const T2 = new Date('2026-11-18T18:10:00Z') // 03:10 JST — the press
  const T3 = new Date('2026-11-18T18:25:00Z') // 03:25 JST — a second press
  const PAGE_ONLY = '✓ この画面だけに反映しました'
  const HOURS = 'store-hours.hours'
  const open = async (store: string, section = 'store-hours') => {
    jest.setSystemTime(T1)
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section }) })) as ReactElement
    render(el)
    await act(async () => {})
  }
  const stamps = () => [...document.querySelectorAll('.st-save-line [role="status"]')].map((n) => n.textContent ?? '')
  const saveBtn = () => [...document.querySelectorAll('button.st-save')].find((b) => /保存する/.test(b.textContent ?? '')) as HTMLButtonElement
  const editHours = () => {
    const f = [...(blockEl(HOURS)?.querySelectorAll('input[type="time"]') ?? [])].find((i) => !(i as HTMLInputElement).disabled) as HTMLInputElement
    expect(f).toBeDefined()
    fireEvent.change(f, { target: { value: f.value === '09:01' ? '09:02' : '09:01' } })
  }
  const pressAt = async (at: Date) => {
    editHours()
    expect(stamps()[0]).toMatch(/^変更した設定 \d+件$/)
    jest.setSystemTime(at)
    await act(async () => { saveBtn().click() })
    await settle()
  }
  it('(a) door ON: rendered 23:59, pressed 03:10 → 「✓ この画面だけに反映しました 03:10」', async () => {
    await open(STORE.tokyo)
    await pressAt(T2)
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(document.body.textContent).not.toContain('23:59')
  })
  // ⚖ B2 act 2a — pin edited: door OFF the save is page-only, so the stamp is the honest one.
  it('(b) door OFF: rendered 23:59, pressed 03:10 → 「✓ この画面だけに反映しました 03:10」', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await open(STORE_A)
    await pressAt(T2)
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(document.body.textContent).not.toContain('23:59')
  })
  // the persist-local path (自分の表示設定 saves on the press of a choice, no 保存する): opened by its
  // section id, then one segmented choice pressed at t2 — no other test in the suite reaches that site.
  it('(c) 自分の表示設定: a choice pressed at 03:10 → 「✓ この端末に保存しました 03:10」', async () => {
    await open(STORE.tokyo, 'my-display')
    const state = () => document.querySelector('p.st-save-state')?.textContent ?? ''
    expect(state()).toBe('押すとすぐ保存されます')
    const choice = [...document.querySelectorAll('button')].find((b) => b.textContent === 'コンパクト') as HTMLButtonElement
    expect(choice).toBeDefined()
    jest.setSystemTime(T2)
    await act(async () => { fireEvent.click(choice) })
    await settle()
    expect(state()).toBe('✓ この端末に保存しました 03:10')
    expect(document.body.textContent).not.toContain('23:59')
  })
  it('(d) midnight: pressed at 2026-11-18T15:00:00Z → 「00:00」, never 「24:00」', async () => {
    await open(STORE.tokyo)
    await pressAt(new Date('2026-11-18T15:00:00Z'))
    expect(stamps()).toEqual([`${PAGE_ONLY} 00:00`])
    // the stamp only: the page legitimately prints 24:00 elsewhere (特別営業日's close bound)
    expect(stamps()[0]).not.toContain('24:00')
  })
  it('(e) two presses: 03:10 then 03:25 → the stamp is replaced, 「03:25」', async () => {
    await open(STORE.tokyo)
    await pressAt(T2)
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    await pressAt(T3)
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:25`])
    expect(document.body.textContent).not.toContain('03:10')
  })
  it('(g) seconds: pressed at 18:10:59.500Z → 「03:10」 (the minute is read, never rounded up)', async () => {
    await open(STORE.tokyo)
    await pressAt(new Date('2026-11-18T18:10:59.500Z'))
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
  })
  // ⚖ R42 — the clock is read ONCE per commit, in the event callback, never inside a state updater
  // (React runs updaters during render, and twice under StrictMode in dev).
  it('(h) StrictMode: one 保存する press → jstClock once; one 自分の表示設定 choice → once more', async () => {
    const spy = jstClock as jest.MockedFunction<typeof jstClock>
    const strict = async (section: string) => {
      jest.setSystemTime(T1)
      const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section }) })) as ReactElement
      render(<StrictMode>{el}</StrictMode>)
      await act(async () => {})
    }
    await strict('store-hours')
    editHours()
    spy.mockClear()
    jest.setSystemTime(T2)
    await act(async () => { saveBtn().click() })
    await settle()
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(spy).toHaveBeenCalledTimes(1)
    cleanup()
    await strict('my-display')
    spy.mockClear()
    jest.setSystemTime(T2)
    const choice = [...document.querySelectorAll('button')].find((b) => b.textContent === 'コンパクト') as HTMLButtonElement
    await act(async () => { fireEvent.click(choice) })
    await settle()
    expect(document.querySelector('p.st-save-state')?.textContent).toBe('✓ この端末に保存しました 03:10')
    expect(spy).toHaveBeenCalledTimes(1)
  })
  // ⚖ R42 — a core-backed save commits on core's yes, so its stamp is THAT instant: pressed 03:10,
  // core answered 03:17 → 「03:17」. The card-colour PUT is held open while the fake clock moves.
  it('(i) カードの見た目, door ON: pressed 03:10, core says yes at 03:17 → 「✓ 保存しました 03:17」', async () => {
    await open(STORE.tokyo, 'reserve-store-page')
    let answer: (r: Response) => void = () => {}
    let sentColor: unknown = null
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/business/card-color')
      sentColor = JSON.parse(String(init?.body)).color
      return new Promise<Response>((r) => { answer = r })
    }) as unknown as typeof fetch
    const swatch = [...document.querySelectorAll('.cl-swatches [role="radio"]')].find((b) => b.getAttribute('aria-checked') !== 'true') as HTMLButtonElement
    expect(swatch).toBeDefined()
    fireEvent.click(swatch)
    expect(stamps()[0]).toMatch(/^変更した設定 \d+件$/)
    jest.setSystemTime(T2)
    await act(async () => { saveBtn().click() })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    jest.setSystemTime(new Date('2026-11-18T18:17:00Z'))
    await act(async () => { answer(fakeRes(200, { ok: true, color: sentColor })) })
    await settle()
    expect(stamps()).toEqual(['✓ 保存しました 03:17'])
  })
  // S40 1b-1 N1 — the source line follows core's confirmed colour after a save, without a reload.
  it('(i2) カードの見た目, door ON: the source line follows each confirmed save (紺 → 深緑 → 紺)', async () => {
    await open(STORE.tokyo, 'reserve-store-page')
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/business/card-color')
      return Promise.resolve(fakeRes(200, { ok: true, color: JSON.parse(String(init?.body)).color }))
    }) as unknown as typeof fetch
    const line = () => document.querySelector('.cl-state')?.textContent ?? null
    const saveAs = async (name: string) => {
      fireEvent.click(document.querySelector(`.cl-swatches [role="radio"][aria-label="${name}"]`) as HTMLButtonElement)
      await act(async () => { saveBtn().click() })
      await settle()
    }
    await saveAs('標準（紺）')
    expect(line()).toBe('標準の色')
    await saveAs('深緑')
    expect(line()).toBe(null)
    await saveAs('標準（紺）')
    expect(line()).toBe('標準の色')
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })
  it('(i3) カードの見た目, door ON: core echoes a different colour → the source line follows the echo, not the pick', async () => {
    await open(STORE.tokyo, 'reserve-store-page')
    let sent: unknown = null
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/business/card-color')
      sent = JSON.parse(String(init?.body)).color
      return Promise.resolve(fakeRes(200, { ok: true, color: '#1C2247' }))
    }) as unknown as typeof fetch
    fireEvent.click(document.querySelector('.cl-swatches [role="radio"][aria-label="深緑"]') as HTMLButtonElement)
    await act(async () => { saveBtn().click() })
    await settle()
    expect(sent).toBe('#1F3D33')
    expect(document.querySelector('.cl-state')?.textContent ?? null).toBe('標準の色')
  })
  // ⚖ R43 (Greptile P2) — 予約の色分け commits on core's yes through the same commitSection; its own PUT
  // is held open while the clock moves, so a press-time stamp on this path goes red too.
  it('(j) 予約の色分け, door ON: pressed 03:10, core says yes at 03:17 → 「✓ 保存しました 03:17」', async () => {
    await open(STORE.tokyo, 'language-display')
    let answer: (r: Response) => void = () => {}
    let sentColors: unknown = null
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/business/booking-colors')
      expect(init?.method).toBe('PUT')
      sentColors = JSON.parse(String(init?.body)).colors
      return new Promise<Response>((r) => { answer = r })
    }) as unknown as typeof fetch
    const group = document.querySelector('.st-swatches[aria-label="新規予約の色"]')
    expect(group).not.toBeNull()
    const swatch = [...group!.querySelectorAll('button.st-swatch')].find((b) => b.getAttribute('aria-pressed') !== 'true') as HTMLButtonElement
    expect(swatch).toBeDefined()
    fireEvent.click(swatch)
    expect(stamps()[0]).toMatch(/^変更した設定 \d+件$/)
    jest.setSystemTime(T2)
    await act(async () => { saveBtn().click() })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    jest.setSystemTime(new Date('2026-11-18T18:17:00Z'))
    await act(async () => { answer(fakeRes(200, { ok: true, colors: sentColors })) })
    await settle()
    expect(stamps()).toEqual(['✓ 保存しました 03:17'])
  })
  it('(f) source pin: jstClock( twice in the screen, the render-time stamp prop gone from the screen and from src/', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs')
    const path = jest.requireActual('node:path') as typeof import('node:path')
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/[locale]/(business)/business/settings/SettingsScreen.tsx'), 'utf8')
    expect(src.split('jstClock(').length - 1).toBe(2)
    const needle = ['save', 'Stamp', 'Time'].join('') // spelled apart so this file does not hold it
    expect(src).not.toContain(`props.${needle}`)
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx|js|jsx|json)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes(needle)) hits.push(p)
      }
    }
    walk(path.join(process.cwd(), 'src'))
    expect(hits).toEqual([])
  })
})

// ⚖ B2 act 2a (S38) — ONE truth for the bar's stamp: 「✓ 保存しました」 only when THIS commit made a core
// write and core said yes; every page-only commit (door OFF for any section; door ON without a writer)
// says 「✓ この画面だけに反映しました」. Door OFF, page.tsx hands no saveCardColor / saveBookingColors, so
// カードの見た目 / 予約の色分け commit locally and NOTHING is sent (asserted: zero write requests).
describe('B2 act 2a honest stamp every page-only save', () => {
  const PAGE_ONLY = JA.sampleMark.pageOnlyStamp
  const T1 = new Date('2026-11-18T14:59:00Z') // 23:59 JST — the render
  const T2 = new Date('2026-11-18T18:10:00Z') // 03:10 JST — the press
  const open = async (store: string, section: string) => {
    jest.setSystemTime(T1)
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section }) })) as ReactElement
    render(el)
    await act(async () => {})
  }
  const stamps = () => [...document.querySelectorAll('.st-save-line [role="status"]')].map((n) => n.textContent ?? '')
  const saveBtn = () => [...document.querySelectorAll('button.st-save')].find((b) => /保存する/.test(b.textContent ?? '')) as HTMLButtonElement
  const writes = () => fetchLog.filter((r) => r.method !== 'GET')
  const press = async () => {
    expect(stamps()[0]).toMatch(/^変更した設定 \d+件$/)
    jest.setSystemTime(T2)
    await act(async () => { saveBtn().click() })
    await settle()
  }
  const pickCard = () => {
    const swatch = [...document.querySelectorAll('.cl-swatches [role="radio"]')].find((b) => b.getAttribute('aria-checked') !== 'true') as HTMLButtonElement
    expect(swatch).toBeDefined()
    fireEvent.click(swatch)
  }
  const pickBooking = () => {
    const group = document.querySelector('.st-swatches[aria-label="新規予約の色"]')
    expect(group).not.toBeNull()
    const swatch = [...group!.querySelectorAll('button.st-swatch')].find((b) => b.getAttribute('aria-pressed') !== 'true') as HTMLButtonElement
    expect(swatch).toBeDefined()
    fireEvent.click(swatch)
  }
  it('(a) door OFF, 営業時間 sample value saved → 「✓ この画面だけに反映しました 03:10」, nothing sent', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await open(STORE_A, 'store-hours')
    const f = [...(blockEl('store-hours.hours')?.querySelectorAll('input[type="time"]') ?? [])].find((i) => !(i as HTMLInputElement).disabled) as HTMLInputElement
    fireEvent.change(f, { target: { value: f.value === '09:01' ? '09:02' : '09:01' } })
    await press()
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(writes()).toEqual([])
    expect(document.body.textContent).not.toContain('✓ 保存しました')
  })
  it('(b) door OFF, カードの見た目 colour saved → the honest stamp AND zero write requests (no PUT to /api/business/card-color)', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await open(STORE_A, 'reserve-store-page')
    pickCard()
    await press()
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(writes()).toEqual([])
    expect(fetchLog.some((r) => r.url.includes('/api/business/card-color'))).toBe(false)
    expect(document.body.textContent).not.toContain('✓ 保存しました')
  })
  it('(c) door OFF, 予約の色分け saved → the honest stamp, zero write requests', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    await open(STORE_A, 'language-display')
    pickBooking()
    await press()
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(writes()).toEqual([])
    expect(fetchLog.some((r) => r.url.includes('/api/business/booking-colors'))).toBe(false)
  })
  // ⚖ PR #1102 fix round 1 — (d) REPLACED: the old (d) repeated 1c (i). This pins the null branch
  // rendered (no colour changed → sendBookingColors returns null → no PUT → page only), which the
  // source regex alone did not guard (attack mutant `false→true` there passed the file 49/49).
  it('(d) door ON, 言語・表示, only この画面の言語 changed → zero PUT, 「✓ この画面だけに反映しました 03:10」', async () => {
    jest.setSystemTime(T1)
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'language-display' }) })) as ReactElement<{ saveBookingColors?: unknown }>
    expect(el.props.saveBookingColors).toBeDefined()
    render(<StrictMode>{el}</StrictMode>)
    await act(async () => {})
    const sel = document.querySelector('select[aria-label="この画面の言語"]') as HTMLSelectElement
    expect(sel).not.toBeNull()
    fireEvent.change(sel, { target: { value: [...sel.options].find((o) => !o.selected)!.value } })
    expect(stamps()).toEqual(['変更した設定 1件'])
    ;(jstClock as jest.Mock).mockClear()
    await press()
    expect(writes()).toEqual([])
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(jstClock).toHaveBeenCalledTimes(1)
  })
  it('(e) door ON, a section without a writer (営業時間 sample) → the honest stamp, nothing sent', async () => {
    await open(STORE.tokyo, 'store-hours')
    const f = [...(blockEl('store-hours.hours')?.querySelectorAll('input[type="time"]') ?? [])].find((i) => !(i as HTMLInputElement).disabled) as HTMLInputElement
    fireEvent.change(f, { target: { value: f.value === '09:01' ? '09:02' : '09:01' } })
    await press()
    expect(stamps()).toEqual([`${PAGE_ONLY} 03:10`])
    expect(writes()).toEqual([])
  })
  it('(f) door ON, the card PUT fails → no stamp (still the pending count), the existing error line', async () => {
    await open(STORE.tokyo, 'reserve-store-page')
    reply = (url, method) => (url === '/api/business/card-color' && method === 'PUT' ? { status: 500, body: { ok: false, reason: 'core' } } : { status: 500, body: null })
    pickCard()
    await press()
    expect(writes().map((r) => r.url)).toEqual(['/api/business/card-color'])
    expect(stamps()[0]).toMatch(/^変更した設定 \d+件$/)
    expect(document.body.textContent).not.toContain('✓ 保存しました')
    expect(document.body.textContent).not.toContain(PAGE_ONLY)
    expect(document.body.textContent).toContain('いまは保存できないため、時間をおいてもう一度保存してください')
  })
})
