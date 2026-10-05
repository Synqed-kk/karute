/**
 * @jest-environment jsdom
 *
 * S59 P7A — the room shows お店ページ. Harness copied from store-page-section.test.tsx (SettingsPage → settingsProps →
 * the door, on the recorded Dev Salon answer set).
 * T6 (C7): typing 「業種」 or a row name finds お店ページ in the room's search.
 */
const mockCore: { reaches: number; noStores: boolean; settings: Record<string, unknown> } = { reaches: 0, noStores: false, settings: {} }
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/practice-door/core-reach', () => {
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
    orgSettingsWriterFor: () => { throw new Error('no writes in this suite') },
    // S50 P3 — the org settings and the store list are the test's to set; every core reach is counted.
    clientFor: (admitted: { businessId: string }) => {
      mockCore.reaches++
      guard(admitted)
      const r = jest.requireActual('./practice-door-recorded').recordedReads()
      return {
        ...r,
        storesList: async () => (mockCore.noStores ? { stores: [] } : r.storesList()),
        orgSettingsGet: async () => {
          const got = await r.orgSettingsGet()
          return got && { ...got, settings: { ...got.settings, ...mockCore.settings } }
        },
      }
    },
    storeDaysWriterFor: () => { throw new Error('no writes in this suite') },
    auditWriterFor: () => { throw new Error('no writes in this suite') },
  }
})

import { render, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { requireBusinessAdmission } from '@/business/lib/admission'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import { LOGIN, STORE, TENANT } from './practice-door-recorded'
import { REG } from '@/business/lib/store-page/copy'

const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const realFetch = global.fetch

/** Stub a prototype property and return its exact undo (card-look-source-line.test.tsx's helper): an OWN
 *  descriptor the prototype had is put back; an absent one is DELETED, never re-defined. */
const stubProto = (proto: object, key: string, desc: PropertyDescriptor) => {
  const own = Object.getOwnPropertyDescriptor(proto, key)
  Object.defineProperty(proto, key, { configurable: true, ...desc })
  return () => { if (own) Object.defineProperty(proto, key, own); else delete (proto as Record<string, unknown>)[key] }
}
const SCROLL_INTO_VIEW_BEFORE = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
let undoScrollIntoView = () => {}
beforeAll(() => {
  const util = jest.requireActual('node:util')
  const web = jest.requireActual('node:stream/web')
  Object.assign(global, { TextEncoder: util.TextEncoder, TextDecoder: util.TextDecoder, ReadableStream: web.ReadableStream, WritableStream: web.WritableStream, TransformStream: web.TransformStream })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) })
  ;(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.scrollTo = () => {}
  undoScrollIntoView = stubProto(Element.prototype, 'scrollIntoView', { value: () => {}, writable: true })
})
// the prototype holds exactly what it held before this file (the own descriptor put back, or the stub deleted)
afterAll(() => {
  undoScrollIntoView()
  expect(Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')).toEqual(SCROLL_INTO_VIEW_BEFORE)
})
beforeEach(() => {
  Object.assign(mockCore, { reaches: 0, noStores: false, settings: {} })
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => null })) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const open = async (section?: string, store: string = STORE.tokyo) => {
  const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, ...(section ? { section } : {}) }) })) as ReactElement
  render(el)
  await act(async () => {})
}
const railNames = () => [...document.querySelectorAll('.st-rail-item')].map((b) => b.getAttribute('data-rail-id'))
const search = async (q: string) => {
  const box = document.querySelector('.st-rail input[type="search"]') as HTMLInputElement
  await act(async () => { fireEvent.change(box, { target: { value: q } }) })
}

describe('S59 P7A T6 (C7) — 業種 and the row names find お店ページ', () => {
  it.each(['業種', '機能', REG[0].ja, REG[REG.length - 1].ja])('search 「%s」 keeps the お店ページ row and names the hit', async (q) => {
    await open()
    await search(q)
    expect(railNames()).toContain('reserve-store-page')
    expect(document.querySelector('.st-rail-item[data-rail-id="reserve-store-page"] .st-rail-hit')?.textContent).toBe(q)
  })
})

// S60 P7A-R2b — the mount. T5/T10 render SettingsScreen itself with the page's own props (no page-level key), so the
// only thing that can remount お店ページ on a store change is the room's own `sp.storeId` key (C6 / R184).
import { SettingsScreen } from '@/app/[locale]/(business)/business/settings/SettingsScreen'
import { RESET as SP_RESET } from '@/business/lib/store-page/copy'
import { labelOf } from '@/business/lib/store-page/type-labels'

type ScreenProps = Parameters<typeof SettingsScreen>[0]
const SP = 'reserve-store-page'
const propsFor = async (store: string): Promise<ScreenProps> =>
  ((await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: SP }) })) as ReactElement<ScreenProps>).props
const spOf = (p: ScreenProps) => p.sections.find((s) => s.id === SP)!.storePage!
const rowSwitches = () => document.querySelectorAll('.spr .spr-rows [role="switch"], .spr .spr-rows input[type="checkbox"]')
const host = () => document.querySelector('.pg-settings > .st-toast') as HTMLElement

describe('S60 P7A-R2b — the seed, the room state, the mount', () => {
  it('T1 store lens → 業種 + 機能 with 16 rows; all-stores lens → the noStore sentence, no blocks, the card look as today', async () => {
    await open(SP)
    expect(document.querySelector('.sp-type')).not.toBeNull()
    expect(document.querySelector('.spr')).not.toBeNull()
    expect(rowSwitches().length).toBe(16)
    expect(document.querySelector('.st-save-count')?.textContent).toBe('変更はありません')
    // the seed (C1): the room's `saved` holds the 業種, so a pick and the pick back count 1 then 0
    const sel = document.querySelector('.sp-type-select') as HTMLSelectElement
    const was = sel.value
    const other = [...sel.options].map((o) => o.value).find((v) => v !== was)!
    await act(async () => { fireEvent.change(sel, { target: { value: other } }) })
    expect(document.querySelector('.st-save-count')?.textContent).toBe('変更した設定 1件')
    await act(async () => { fireEvent.change(sel, { target: { value: was } }) })
    expect(document.querySelector('.st-save-count')?.textContent).toBe('変更はありません')
    document.body.innerHTML = ''
    mockCore.noStores = true // the lens with no store (settings-props.ts:177 defaultStoreId → null → :1985)
    const all = await propsFor('all-stores')
    const sec = all.sections.find((s) => s.id === SP)!
    expect(sec.storePage).toBeUndefined()
    render(<SettingsScreen {...all} />)
    await act(async () => {})
    expect(document.querySelector('.sp-type')).toBeNull()
    expect(document.querySelector('.spr')).toBeNull()
    expect([...document.querySelectorAll('.st-main .st-block-note')].map((p) => p.textContent)).toContain(sec.storePageNoStore)
    expect(document.querySelector('.st-main')?.textContent).toContain('カードの色')
  })

  it('T5 an ask open on store A, re-rendered with store B → no dialog, change count 0; through the page, B values', async () => {
    const a = await propsFor(STORE.tokyo)
    const b = await propsFor(STORE.yokohama)
    expect(spOf(a).storeId).not.toBe(spOf(b).storeId)
    const { rerender } = render(<SettingsScreen {...a} />)
    await act(async () => {})
    await act(async () => { fireEvent.click(document.querySelector('.sp-type-reset')!) })
    expect(document.querySelector('#spTypeDlgTitle')).not.toBeNull()
    await act(async () => { rerender(<SettingsScreen {...b} />) })
    expect(document.querySelector('#spTypeDlgTitle')).toBeNull()
    expect(document.querySelector('.st-save-count')?.textContent).toBe('変更はありません')
    // the page's own path (page.tsx keys the screen by store): B's values are B's own
    document.body.innerHTML = ''
    const page = async (store: string) => (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: SP }) })) as ReactElement
    const r2 = render(await page(STORE.tokyo))
    await act(async () => {})
    await act(async () => { fireEvent.click(document.querySelector('.sp-type-reset')!) })
    const elB = await page(STORE.yokohama)
    await act(async () => { r2.rerender(elB) })
    expect(document.querySelector('#spTypeDlgTitle')).toBeNull()
    expect((document.querySelector('.sp-type-select') as HTMLSelectElement).value).toBe(spOf(b).saved.business_type)
    expect(document.querySelector('.st-save-count')?.textContent).toBe('変更はありません')
  })

  it('T8 a type reset confirmed through the room → the host shows RESET.toast(label) with is-on; empty before', async () => {
    {
      await open(SP)
      expect(host()).not.toBeNull()
      expect(host().textContent).toBe('')
      expect(host().classList.contains('is-on')).toBe(false)
      const type = (document.querySelector('.sp-type-select') as HTMLSelectElement).value
      // a hand flip away from the type's default (an OFF switch turned ON), so the reset has something to put back
      const off = [...rowSwitches()].find((el) => el.getAttribute('aria-checked') === 'false') as HTMLElement
      await act(async () => { fireEvent.click(off) })
      expect(host().textContent).toBe('')
      await act(async () => { fireEvent.click(document.querySelector('.sp-type-reset')!) })
      const go = document.querySelector('.sp-type-acts .btn.primary') as HTMLButtonElement
      expect(go.disabled).toBe(false)
      await act(async () => { fireEvent.click(go) })
      expect(host().textContent).toBe(SP_RESET.toast(labelOf(type as Parameters<typeof labelOf>[0])))
      expect(host().classList.contains('is-on')).toBe(true)
    }
  })

  it('T10 (R208) a disconnected payload → both blocks render, every control locked, no crash', async () => {
    const p = await propsFor(STORE.tokyo)
    const sections = p.sections.map((s) => (s.id === SP ? { ...s, storePage: { ...s.storePage!, disconnected: true } } : s))
    render(<SettingsScreen {...p} sections={sections} />)
    await act(async () => {})
    expect((document.querySelector('.sp-type-select') as HTMLSelectElement).disabled).toBe(true)
    expect((document.querySelector('.sp-type-reset') as HTMLButtonElement).disabled).toBe(true)
    expect(rowSwitches().length).toBe(16)
    for (const el of rowSwitches()) expect((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true').toBe(true)
  })
})

// S60 P7A-R2c — the section's 元に戻す (R209), the R210 skip, and the toast leaving inside the room.
import { UNDO } from '@/business/lib/store-page/copy'
import { TOAST_MS } from '@/app/[locale]/(business)/business/settings/Toast'

const undoBtn = () => [...document.querySelectorAll('button')].find((b) => b.textContent === UNDO.button) as HTMLButtonElement | undefined
const count = () => document.querySelector('.st-save-count')?.textContent
const ons = () => [...rowSwitches()].map((el) => el.getAttribute('aria-checked'))
const swatchOn = () => [...document.querySelectorAll('.cl-swatch')].findIndex((el) => el.getAttribute('aria-checked') === 'true')
const flipTwo = async () => {
  for (const i of [0, 5]) await act(async () => { fireEvent.click(rowSwitches()[i]) })
}
const pickOtherColour = async () => {
  const other = [...document.querySelectorAll('.cl-swatch')].find((el) => el.getAttribute('aria-checked') !== 'true') as HTMLElement
  await act(async () => { fireEvent.click(other) })
}

describe('S60 P7A-R2c — 元に戻す (R209)', () => {
  it('Tu1 two switches + a type + a colour → 元に戻す → count 0, every control saved, the phone view and colour saved, the toast', async () => {
    await open(SP)
    const sel = () => document.querySelector('.sp-type-select') as HTMLSelectElement
    const before = { ons: ons(), type: sel().value, swatch: swatchOn(), view: document.querySelector('.cl-preview')!.innerHTML }
    await flipTwo()
    const other = [...sel().options].map((o) => o.value).find((v) => v !== before.type)!
    await act(async () => { fireEvent.change(sel(), { target: { value: other } }) })
    await pickOtherColour()
    expect(count()).not.toBe('変更はありません')
    expect(swatchOn()).not.toBe(before.swatch)
    expect(host().textContent).toBe('')
    await act(async () => { fireEvent.click(undoBtn()!) })
    expect(count()).toBe('変更はありません')
    expect(ons()).toEqual(before.ons)
    expect(sel().value).toBe(before.type)
    expect(swatchOn()).toBe(before.swatch)
    expect(document.querySelector('.cl-preview')!.innerHTML).toBe(before.view)
    expect(host().textContent).toBe(UNDO.toast)
    expect(host().classList.contains('is-on')).toBe(true)
  })

  it('Tu2 元に戻す is aria-disabled at 0 changes and enabled at 1, and sits immediately before 保存する', async () => {
    await open(SP)
    expect(undoBtn()!.getAttribute('aria-disabled')).toBe('true')
    expect(undoBtn()!.nextElementSibling).toBe(document.querySelector('.st-save'))
    await act(async () => { fireEvent.click(rowSwitches()[0]) })
    expect(count()).toBe('変更した設定 1件')
    expect(undoBtn()!.getAttribute('aria-disabled')).toBe('false')
  })

  it('Tu3 another section of the room (言語・表示, language-display) has 保存する and NO 元に戻す', async () => {
    await open('language-display')
    expect(document.querySelector('.st-save')).not.toBeNull()
    expect(undoBtn()).toBeUndefined()
  })
})

describe('S60 P7A-R2c — T9 (R210): 保存する never saves a switch', () => {
  it.each([['ON'], ['OFF']])('card door %s: switch + colour → 保存する → no capabilities request, the switch still counted, no stamp, the colour saved', async (door) => {
    const p = await propsFor(STORE.tokyo)
    const calls: { url: string; body: unknown }[] = []
    global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : null
      calls.push({ url: String(url), body })
      return { ok: true, status: 200, json: async () => ({ ok: true, color: (body as { color?: unknown })?.color ?? null }) }
    }) as unknown as typeof fetch
    render(<SettingsScreen {...p} saveCardColor={door === 'ON' ? { businessId: TENANT, canSave: true } : undefined} />)
    await act(async () => {})
    const savedSwatch = swatchOn()
    const savedOns = ons()
    await act(async () => { fireEvent.click(rowSwitches()[0]) })
    await pickOtherColour()
    const picked = swatchOn()
    expect(count()).toBe('変更した設定 2件')
    await act(async () => { fireEvent.click(document.querySelector('.st-save')!) })
    expect(calls.filter((c) => c.url.includes('store-capabilities'))).toEqual([])
    expect(calls.map((c) => c.url)).toEqual(door === 'ON' ? ['/api/business/card-color'] : [])
    expect(count()).toBe('変更した設定 1件')
    expect(document.querySelector('.st-save-card')?.textContent ?? '').not.toContain('保存しました')
    // the colour is saved exactly as today: 元に戻す puts the switch back and keeps the picked colour
    await act(async () => { fireEvent.click(undoBtn()!) })
    expect(ons()).toEqual(savedOns)
    expect(swatchOn()).toBe(picked)
    expect(picked).not.toBe(savedSwatch)
    expect(count()).not.toMatch(/^変更した設定/) // 0 changes left: the switch was never in `saved`, the colour is
  })
})

describe('S60 P7A-R2c — Tt: the toast leaves, in the room', () => {
  afterEach(() => { jest.useRealTimers() })
  it('Tt fake timers before the press; a type reset confirmed → is-on; TOAST_MS later → is-on gone, the sentence stays', async () => {
    jest.useFakeTimers()
    await open(SP)
    const type = (document.querySelector('.sp-type-select') as HTMLSelectElement).value
    const off = [...rowSwitches()].find((el) => el.getAttribute('aria-checked') === 'false') as HTMLElement
    await act(async () => { fireEvent.click(off) })
    await act(async () => { fireEvent.click(document.querySelector('.sp-type-reset')!) })
    await act(async () => { fireEvent.click(document.querySelector('.sp-type-acts .btn.primary')!) })
    const said = SP_RESET.toast(labelOf(type as Parameters<typeof labelOf>[0]))
    expect(host().textContent).toBe(said)
    expect(host().classList.contains('is-on')).toBe(true)
    act(() => { jest.advanceTimersByTime(TOAST_MS) })
    expect(host().classList.contains('is-on')).toBe(false)
    expect(host().textContent).toBe(said)
  })
})
