/**
 * @jest-environment jsdom
 *
 * S60 P7A-R2d — the room's guide pairs (R211), the disabled door (R212), T2 / T3. Harness copied from
 * store-page-room-s59.test.tsx lines 8-100 (which copied store-page-section.test.tsx's), verbatim.
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
// ---- G1 / Tg (R211)
import { SettingsScreen } from '@/app/[locale]/(business)/business/settings/SettingsScreen'
import { spotTargets } from '@/business/lib/guide'
import { BLOCK_GUIDES } from '@/business/lib/store-page/copy'

type ScreenProps = Parameters<typeof SettingsScreen>[0]
const SP = 'reserve-store-page'
const propsFor = async (store: string): Promise<ScreenProps> =>
  ((await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: SP }) })) as ReactElement<ScreenProps>).props
const pairs = () => spotTargets(document).map((t) => ({ title: t.dataset.guideTitle, guide: t.dataset.guide }))

describe('S60 P7A-R2d Tg (R211, R247) — the guide walk holds the card look, then logo, then 業種, then 機能', () => {
  it('under a store lens: the card look and logo pairs, then the payload pairs in order, on .sp-type and the 機能 head', async () => {
    await open(SP)
    // jsdom draws nothing, and spotTargets keeps only drawn targets (guide.ts:84-89): every element gets a 10x10 box
    const undo = stubProto(Element.prototype, 'getBoundingClientRect', { value: () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10, toJSON() {} }), writable: true })
    let walk: ReturnType<typeof pairs>
    try { walk = pairs() } finally { undo() }
    const card = walk.findIndex((p) => p.title === document.querySelector('.cl-swatches')?.closest('[data-guide-title]')?.getAttribute('data-guide-title'))
    expect(card).toBeGreaterThanOrEqual(0)
    expect(walk.slice(card + 1, card + 4)).toEqual([
      { title: 'ロゴ', guide: 'お店のロゴ画像を選びます。選ぶと、見本では店名の前にそのロゴが付きます。保存はされず、お客様のアプリにも反映されません。' },
      ...BLOCK_GUIDES.map((g) => ({ title: g.title, guide: g.guide })),
    ])
    expect(document.querySelector('.sp-type')!.getAttribute('data-guide-title')).toBe(BLOCK_GUIDES[0].title)
    expect(document.querySelector('.spr > .st-block-head')!.getAttribute('data-guide-title')).toBe(BLOCK_GUIDES[1].title)
  })
})

// ---- R212 — the disabled door looks disabled, with 保存する's own disabled values
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const CSS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/settings.css'), 'utf8')
const body = (sel: string) => CSS.match(new RegExp(`\\.biz \\.pg-settings ${sel.replace(/[.:[\]"]/g, (c) => '\\' + c)} \\{([^}]*)\\}`))?.[1].trim()

describe('S60 P7A-R2d R212 · R216 — .st-link[aria-disabled="true"]', () => {
  it('exists, carries .st-save:disabled\'s declarations exactly, cursor default included', () => {
    expect(body('.st-link[aria-disabled="true"]')).toBeDefined()
    expect(body('.st-link[aria-disabled="true"]')).toBe(body('.st-save:disabled'))
    expect(body('.st-link[aria-disabled="true"]')).toContain('cursor: default')
  })
})

// ---- T2 / T3
import { STORES } from '@/business/lib/reserve-card/store-page-sample'
import { seedRecord } from '@/business/lib/store-page/model'
const count = () => document.querySelector('.st-save-count')?.textContent
const viewBtn = (label: string) => [...document.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === label) as HTMLButtonElement
const phone = () => document.querySelector('.cl-phone') as HTMLElement
const postsShown = () => phone().querySelector('[data-cap="posts"]') !== null
const flip = async (key: string) => {
  await act(async () => { fireEvent.click(document.querySelector(`.spr-row[data-key="${key}"] [role="switch"]`)!) })
  const commit = document.querySelector('.spr-commit') // an OFF with a count asks first (spec D27)
  if (commit) await act(async () => { fireEvent.click(commit) })
}

describe('S60 P7A-R2d T2 / T3', () => {
  it('T2 a switch flipped in 機能 → the count moves, the phone gains / loses that block, the view stays', async () => {
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} />)
    await act(async () => {})
    const label = p.sections.find((s) => s.id === SP)!.title
    await act(async () => { fireEvent.click(viewBtn(label)) })
    expect(viewBtn(label).getAttribute('aria-pressed')).toBe('true')
    const was = { count: count(), shown: postsShown() }
    await flip('posts')
    expect(count()).not.toBe(was.count)
    expect(postsShown()).toBe(!was.shown)
    expect(viewBtn(label).getAttribute('aria-pressed')).toBe('true')
    await flip('posts')
    expect(count()).toBe(was.count)
    expect(postsShown()).toBe(was.shown)
    expect(viewBtn(label).getAttribute('aria-pressed')).toBe('true')
  })

  it('T3 sampleKey force draws the FORCE sample; an unsaved 業種 pick leaves the sample as it was', async () => {
    const p = await propsFor(STORE.tokyo)
    const gym = seedRecord('personal_gym')
    const saved = { ...gym, switches: { ...gym.switches, classes: { ...gym.switches.classes, on: true } } }
    const sections = p.sections.map((s) => (s.id === SP ? { ...s, storePage: { ...s.storePage!, saved, counts: STORES.force.counts, sampleKey: 'force' as const } } : s))
    render(<SettingsScreen {...p} sections={sections} />)
    await act(async () => {})
    const label = p.sections.find((s) => s.id === SP)!.title
    await act(async () => { fireEvent.click(viewBtn(label)) })
    expect(phone().textContent).toContain(STORES.force.rv.classes[0].nm)
    const before = phone().innerHTML
    const sel = document.querySelector('.sp-type-select') as HTMLSelectElement
    const other = [...sel.options].map((o) => o.value).find((v) => v !== sel.value)!
    await act(async () => { fireEvent.change(sel, { target: { value: other } }) })
    expect(phone().innerHTML).toBe(before)
  })
})

// ---- S60 P7A-R3 — the fix round (R214, R215, R216 and the owed tests)
import { UNDO } from '@/business/lib/store-page/copy'
const saveBtn = () => document.querySelector('.st-save') as HTMLButtonElement
const undoBtn = () => [...document.querySelectorAll('button')].find((b) => b.textContent === UNDO.button) as HTMLButtonElement | undefined
const saveCard = () => document.querySelector('.st-save-card')?.textContent ?? ''
const firstSwitch = () => document.querySelector('.spr .spr-rows [role="switch"]') as HTMLElement
const swatchOn = () => [...document.querySelectorAll('.cl-swatch')].findIndex((el) => el.getAttribute('aria-checked') === 'true')
const pickOther = async () => {
  const other = [...document.querySelectorAll('.cl-swatch')].find((el) => el.getAttribute('aria-checked') !== 'true') as HTMLElement
  await act(async () => { fireEvent.click(other) })
}
const recordFetch = () => {
  const calls: string[] = []
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    calls.push(String(url))
    // S61 P7B-2 — branch on the URL: the capabilities route echoes the sent record, the colour route the colour
    if (String(url).includes('store-capabilities')) return { ok: true, status: 200, json: async () => ({ ok: true, record: JSON.parse(init!.body!).record }) }
    return { ok: true, status: 200, json: async () => ({ ok: true, color: init?.body ? JSON.parse(init.body).color ?? null : null }) }
  }) as unknown as typeof fetch
  return calls
}

describe('S60 P7A-R3 F-1 (R214 → S61 P7B-2 R219) — a switch-only press is a real save with the door ON, a page-only commit with it OFF', () => {
  it.each([['ON'], ['OFF']])('card door %s: ONLY a switch flipped → 保存する enabled; ON: one capabilities PUT, 0 changes, the stamp; OFF: no request, count 1, no ✓ stamp', async (door) => {
    const calls = recordFetch()
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} saveCardColor={door === 'ON' ? { businessId: TENANT, canSave: true } : undefined} />)
    await act(async () => {})
    await act(async () => { fireEvent.click(firstSwitch()) })
    expect(count()).toBe('変更した設定 1件')
    expect(saveBtn().disabled).toBe(false)
    await act(async () => { fireEvent.click(saveBtn()) })
    await act(async () => {})
    if (door === 'ON') {
      expect(calls).toEqual(['/api/business/store-capabilities'])
      expect(count()).toMatch(/^✓ 保存しました /)
    } else {
      expect(calls).toEqual([])
      expect(count()).toBe('変更した設定 1件')
      expect(saveCard()).not.toContain('✓ 保存しました')
      await act(async () => { fireEvent.click(firstSwitch()) })
      expect(count()).not.toMatch(/^変更した設定/)
      expect(count()).not.toMatch(/^✓ 保存しました/) // a page-only commit never claims core holds it
    }
  })
})

describe('S60 P7A-R3 F-2 (R215) — 元に戻す does nothing while the colour save is in flight', () => {
  it('door ON: a colour picked, 保存する pending → 元に戻す → no toast, the pick stays; the answer lands → the normal after-save state', async () => {
    let release: (r: unknown) => void = () => {}
    let sent: unknown = null
    const calls: string[] = []
    global.fetch = jest.fn((url: string, init?: { body?: string }) => {
      calls.push(String(url))
      sent = init?.body ? JSON.parse(init.body).color ?? null : null
      return new Promise((res) => { release = res })
    }) as unknown as typeof fetch
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} saveCardColor={{ businessId: TENANT, canSave: true }} />)
    await act(async () => {})
    const toastHost = () => document.querySelector('.pg-settings > .st-toast') as HTMLElement
    const before = swatchOn()
    await pickOther()
    const picked = swatchOn()
    expect(picked).not.toBe(before)
    await act(async () => { fireEvent.click(saveBtn()) })
    expect(calls).toEqual(['/api/business/card-color'])
    await act(async () => { fireEvent.click(undoBtn()!) })
    expect(toastHost().textContent).toBe('')
    expect(swatchOn()).toBe(picked)
    await act(async () => { release({ ok: true, status: 200, json: async () => ({ ok: true, color: sent }) }) })
    await act(async () => {})
    expect(swatchOn()).toBe(picked)
    expect(count()).toMatch(/^✓ 保存しました /)
    expect(toastHost().textContent).toBe('')
  })

  it('S61 P7B-2 (R221): a SWITCHES save in flight also blocks 元に戻す and a second press; the answer lands → the stamp', async () => {
    let release: (r: unknown) => void = () => {}
    let sent: unknown = null
    const calls: string[] = []
    global.fetch = jest.fn((url: string, init?: { body?: string }) => {
      calls.push(String(url))
      sent = init?.body ? JSON.parse(init.body).record : null
      return new Promise((res) => { release = res })
    }) as unknown as typeof fetch
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} saveCardColor={{ businessId: TENANT, canSave: true }} />)
    await act(async () => {})
    const toastHost = () => document.querySelector('.pg-settings > .st-toast') as HTMLElement
    const before = firstSwitch().getAttribute('aria-checked')
    await act(async () => { fireEvent.click(firstSwitch()) })
    const flipped = firstSwitch().getAttribute('aria-checked')
    expect(flipped).not.toBe(before)
    await act(async () => { fireEvent.click(saveBtn()) })
    expect(calls).toEqual(['/api/business/store-capabilities'])
    await act(async () => { fireEvent.click(saveBtn()) })
    expect(calls).toEqual(['/api/business/store-capabilities'])
    await act(async () => { fireEvent.click(undoBtn()!) })
    expect(toastHost().textContent).toBe('')
    expect(firstSwitch().getAttribute('aria-checked')).toBe(flipped)
    await act(async () => { release({ ok: true, status: 200, json: async () => ({ ok: true, record: sent }) }) })
    await act(async () => {})
    expect(firstSwitch().getAttribute('aria-checked')).toBe(flipped)
    expect(count()).toMatch(/^✓ 保存しました /)
  })
})

describe('S60 P7A-R3 F-3 (R216) — 元に戻す stays focusable and does nothing at 0 changes', () => {
  it('at 0 changes: aria-disabled, not disabled, tabIndex not −1; a click shows no toast and changes nothing', async () => {
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} />)
    await act(async () => {})
    const toastHost = () => document.querySelector('.pg-settings > .st-toast') as HTMLElement
    expect(count()).toBe('変更はありません')
    expect(undoBtn()!.getAttribute('aria-disabled')).toBe('true')
    expect(undoBtn()!.disabled).toBe(false)
    expect(undoBtn()!.tabIndex).not.toBe(-1)
    await act(async () => { fireEvent.click(undoBtn()!) })
    expect(toastHost().textContent).toBe('')
    expect(count()).toBe('変更はありません')
  })
})

describe('S60 P7A-R3 F-5 (attack F3) — the may-save half of canEdit', () => {
  it('saveCardColor canSave false → both blocks locked, no 保存する, no 元に戻す', async () => {
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} saveCardColor={{ businessId: TENANT, canSave: false }} />)
    await act(async () => {})
    const switches = document.querySelectorAll('.spr .spr-rows [role="switch"], .spr .spr-rows input[type="checkbox"]')
    expect((document.querySelector('.sp-type-select') as HTMLSelectElement).disabled).toBe(true)
    expect((document.querySelector('.sp-type-reset') as HTMLButtonElement).disabled).toBe(true)
    expect(switches.length).toBe(16)
    for (const el of switches) expect((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true').toBe(true)
    expect(document.querySelector('.st-save')).toBeNull()
    expect(undoBtn()).toBeUndefined()
  })
})

describe('S60 P7A-R3 F-6 (attack F5) — 元に戻す clears the colour\'s refusal line', () => {
  it('door ON: the colour PUT refused → the alert shows → a switch flipped → 元に戻す → the alert is gone', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ ok: false }) })) as unknown as typeof fetch
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} saveCardColor={{ businessId: TENANT, canSave: true }} />)
    await act(async () => {})
    await pickOther()
    await act(async () => { fireEvent.click(saveBtn()) })
    await act(async () => {})
    expect(document.querySelector('.st-act-error[role="alert"]')).not.toBeNull()
    await act(async () => { fireEvent.click(firstSwitch()) })
    expect(document.querySelector('.st-act-error[role="alert"]')).not.toBeNull()
    await act(async () => { fireEvent.click(undoBtn()!) })
    expect(document.querySelector('.st-act-error[role="alert"]')).toBeNull()
  })
})

describe('S60 P7A-R3 F-8 (attack N3, R211) — the guide pairs by heading, never by index', () => {
  it('storePageGuides REVERSED → 業種 keeps 業種\'s pair and 機能\'s head 機能\'s', async () => {
    const p = await propsFor(STORE.tokyo)
    const sections = p.sections.map((s) => (s.id === SP ? { ...s, storePageGuides: [...s.storePageGuides!].reverse() } : s))
    expect(sections.find((s) => s.id === SP)!.storePageGuides!.map((g) => g.title)).toEqual([BLOCK_GUIDES[1].title, BLOCK_GUIDES[0].title])
    render(<SettingsScreen {...p} sections={sections} />)
    await act(async () => {})
    const type = document.querySelector('.sp-type')!
    const head = document.querySelector('.spr > .st-block-head')!
    expect([type.getAttribute('data-guide-title'), type.getAttribute('data-guide')]).toEqual([BLOCK_GUIDES[0].title, BLOCK_GUIDES[0].guide])
    expect([head.getAttribute('data-guide-title'), head.getAttribute('data-guide')]).toEqual([BLOCK_GUIDES[1].title, BLOCK_GUIDES[1].guide])
  })
})
