/**
 * @jest-environment jsdom
 *
 * S62 P9-3 — the room's wiring of the preview sheet (R226, R230; spec D13): SettingsScreen passes `narrow` to the
 * card-look section and places `slots.viewButton` LAST in the reading column. Harness copied from
 * store-page-room-s60.test.tsx lines 7-87; its matchMedia stub (:65) answers `(max-width: 899px)` with NARROW here.
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
import { SettingsScreen } from '@/app/[locale]/(business)/business/settings/SettingsScreen'
import { LOGIN, STORE, TENANT } from './practice-door-recorded'

const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const realFetch = global.fetch
let NARROW = false

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
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: q === '(max-width: 899px)' ? NARROW : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) })
  ;(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.scrollTo = () => {}
  undoScrollIntoView = stubProto(Element.prototype, 'scrollIntoView', { value: () => {}, writable: true })
})
afterAll(() => {
  undoScrollIntoView()
  expect(Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')).toEqual(SCROLL_INTO_VIEW_BEFORE)
})
beforeEach(() => {
  NARROW = false
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

type ScreenProps = Parameters<typeof SettingsScreen>[0]
const SP = 'reserve-store-page'
const propsFor = async (store: string): Promise<ScreenProps> =>
  ((await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: SP }) })) as ReactElement<ScreenProps>).props

const viewBtn = () => document.querySelector('.cl-viewbtn') as HTMLButtonElement
const dialog = () => document.querySelector('[role="dialog"]')
const count = () => document.querySelector('.st-save-count')?.textContent
const saveState = () => (document.querySelector('.st-save') as HTMLButtonElement | null)?.disabled
const postsShown = () => (document.querySelector('.cl-phone') as HTMLElement).querySelector('[data-cap="posts"]') !== null
// the home / store seg, by position (store-page-save-s61.test.tsx:556's selector)
const storeView = async () => { await act(async () => { fireEvent.click(document.querySelectorAll('.cl-preview .sp-seg button')[1]) }) }
const flip = async (key: string) => {
  await act(async () => { fireEvent.click(document.querySelector(`.spr-row[data-key="${key}"] [role="switch"]`)!) })
  const commit = document.querySelector('.spr-commit') // an OFF with a count asks first (spec D27)
  if (commit) await act(async () => { fireEvent.click(commit) })
}
/** Mount the room; at narrow the rail is the page, so the store-page section is opened from its rail row. */
const mount = async (p: ScreenProps, narrow: boolean) => {
  NARROW = narrow
  const r = render(<SettingsScreen {...p} />)
  await act(async () => {})
  if (narrow) await act(async () => { fireEvent.click(document.querySelector(`[data-rail-id="${SP}"]`)!) })
  return r
}
const openSheet = async () => { await act(async () => { fireEvent.click(viewBtn()) }) }

describe('S62 P9-3 — the room wires the preview sheet', () => {
  it('r1 narrow, the store-page section open: the button follows the switches block (.spr) and is the reading column\'s LAST element; no preview and no side card holding one', async () => {
    await mount(await propsFor(STORE.tokyo), true)
    const btn = viewBtn()
    expect(btn).not.toBeNull()
    const column = btn.parentElement!
    expect(column.classList.contains('st-main')).toBe(true)
    expect(column.lastElementChild).toBe(btn)
    const rows = document.querySelector('.spr')!
    expect(rows).not.toBeNull()
    expect(rows.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('.cl-preview')).toBeNull()
    expect([...document.querySelectorAll('.st-side-card')].filter((c) => c.querySelector('.cl-preview'))).toEqual([])
    expect(dialog()).toBeNull()
  })

  it('r2 narrow: a switch flipped, then the sheet opened → its store view shows the DRAFT; the count line and the save button are untouched by open / close', async () => {
    await mount(await propsFor(STORE.tokyo), true)
    await openSheet()
    await storeView()
    const was = postsShown()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(dialog()).toBeNull()
    await flip('posts')
    const after = { count: count(), save: saveState() }
    await openSheet()
    expect(dialog()!.querySelector('.cl-preview')).not.toBeNull()
    expect(postsShown()).toBe(!was)
    expect({ count: count(), save: saveState() }).toEqual(after)
    await act(async () => { fireEvent.click(dialog()!.querySelector('.st-sec-h .st-link')!) })
    expect(dialog()).toBeNull()
    expect({ count: count(), save: saveState() }).toEqual(after)
    await flip('posts')
    await openSheet()
    expect(postsShown()).toBe(was)
  })

  it('r3 wide: the preview is inline in the side card, and no dialog (the button, CSS-hidden, opens nothing)', async () => {
    await mount(await propsFor(STORE.tokyo), false)
    expect(document.querySelector('.st-side-card .cl-preview')).not.toBeNull()
    expect(dialog()).toBeNull()
    await openSheet()
    expect(dialog()).toBeNull()
    expect(document.querySelectorAll('.cl-preview')).toHaveLength(1)
  })

  it('r4 narrow, a reader who may not save (canSave false, as S60 F-5): the button is not disabled and opens the sheet all the same (D13)', async () => {
    const p = await propsFor(STORE.tokyo)
    await mount({ ...p, saveCardColor: { businessId: TENANT, canSave: false } }, true)
    expect(document.querySelector('.st-save')).toBeNull()
    expect(viewBtn().disabled).toBe(false)
    await openSheet()
    expect(dialog()!.querySelector('.cl-preview')).not.toBeNull()
  })

  it('r5 the sheet open, then back to the list → no dialog; open again, then a store switch → no dialog', async () => {
    const r = await mount(await propsFor(STORE.tokyo), true)
    await openSheet()
    expect(dialog()).not.toBeNull()
    await act(async () => { fireEvent.click(document.querySelector('.st-back')!) })
    expect(dialog()).toBeNull()
    await act(async () => { fireEvent.click(document.querySelector(`[data-rail-id="${SP}"]`)!) })
    await openSheet()
    expect(dialog()).not.toBeNull()
    r.rerender(<SettingsScreen {...(await propsFor(STORE.yokohama))} />)
    await act(async () => {})
    expect(dialog()).toBeNull()
  })
})
