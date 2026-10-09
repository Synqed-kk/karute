/**
 * @jest-environment jsdom
 *
 * ⚖ R52 (Liam 9/30) — カードの見た目's preview is the customer's card: its title is the SELECTED store's
 * name and the business name is NOWHERE on it, on ホーム and on お店ページ. Mounted as the route does it
 * (SettingsPage → settingsProps → the door, on the recorded Dev Salon answer set), the store-days-screen
 * pattern. The recorded business is 「Dev Salon」 and the recorded set ALSO holds a store named 「Dev Salon」
 * (STORE.devSalon) — so the pins use テスト東京店 / テスト横浜店, where the business name and the store
 * name differ.
 *
 * N1 (S44) — the cover's line 2 is Reserve's coverLines (member-ia.ts:458–479 @ 4db48b7): a store with
 * facts prints its shortName on line 2 and its address on line 3 (:468–469) — no equality test against
 * the title. Business feeds shortName = the store's name, so line 2 = the store's name; line 3 = the
 * address when Business holds one, nothing otherwise.
 */
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
    clientFor: (admitted: { businessId: string }) => (guard(admitted), jest.requireActual('./practice-door-recorded').recordedReads()),
    storeDaysWriterFor: () => { throw new Error('no writes in this suite') },
    auditWriterFor: () => { throw new Error('no writes in this suite') },
  }
})

import { render, fireEvent, act, cleanup, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { requireBusinessAdmission } from '@/business/lib/admission'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import { LOGIN, STORE, STORES, TENANT } from './practice-door-recorded'
import { STORE_A, business as fixtureBusiness, stores as fixtureStores } from '@/business/lib/fixtures'
import { readStoreAddress } from '@/business/lib/data'

const RECORDED_BUSINESS = 'Dev Salon' // practice-door-recorded.ts: `o.orgName ?? 'Dev Salon'`
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
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => null })) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const open = async (store: string) => {
  const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: 'reserve-store-page' }) })) as ReactElement
  render(el)
  await act(async () => {})
}
const phone = () => document.querySelector('.cl-phone') as HTMLElement
const text = (sel: string) => phone().querySelector(sel)?.textContent ?? null
const toStore = async () => {
  const btn = [...document.querySelectorAll('.cl-preview .sp-seg button')].find((b) => b.textContent === 'お店ページ') as HTMLButtonElement
  await act(async () => { fireEvent.click(btn) })
}
const nameOf = (id: string) => STORES.find((s) => s.id === id)!.name

describe('R52 — the preview card is the selected store\'s card, the business name nowhere', () => {
  it('the recorded set: the business name differs from the two pinned stores', () => {
    expect([nameOf(STORE.tokyo), nameOf(STORE.yokohama)]).toEqual(['テスト東京店', 'テスト横浜店'])
    expect(nameOf(STORE.tokyo)).not.toBe(RECORDED_BUSINESS)
  })

  it('(1) the card title (.mcard__wm) is the selected store\'s name, no branch line under it', async () => {
    await open(STORE.tokyo)
    expect(text('.mcard__wm')).toBe('テスト東京店')
    expect(text('.tcard__name')).toBe('テスト東京店')
    expect(phone().querySelector('.mcard__store')).toBeNull()
  })

  it('(2) the business name is nowhere on the card — ホーム, then お店ページ', async () => {
    await open(STORE.tokyo)
    expect(within(phone()).queryByText(RECORDED_BUSINESS)).toBeNull()
    expect(phone().textContent).not.toContain(RECORDED_BUSINESS)
    await toStore()
    expect(phone().querySelector('.salon-cover')).not.toBeNull()
    expect(text('.salon-cover__wm')).toBe('テスト東京店')
    expect(within(phone()).queryByText(RECORDED_BUSINESS)).toBeNull()
    expect(phone().textContent).not.toContain(RECORDED_BUSINESS)
  })

  it('(3) the other store selected → the other store\'s name is the title', async () => {
    await open(STORE.yokohama)
    expect(text('.mcard__wm')).toBe('テスト横浜店')
    expect(phone().textContent).not.toContain('テスト東京店')
  })
})

describe('N1 — the cover\'s lines 2 and 3 as Reserve\'s coverLines gives them (member-ia.ts:468–469 @ 4db48b7)', () => {
  it('no address held (the recorded set): line 2 = the store\'s name (its shortName), line 3 empty', async () => {
    await open(STORE.tokyo)
    await toStore()
    expect(text('.salon-cover__st')).toBe('テスト東京店')
    expect(text('.salon-cover__ad')).toBe('')
  })

  it('an address held (door OFF, the fixture store): line 2 = the store\'s name, line 3 = the address', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const address = await readStoreAddress(STORE_A)
    expect(address).toBeTruthy()
    const storeName = fixtureStores.find((s) => s.id === STORE_A)!.name
    expect(storeName).not.toBe(fixtureBusiness.name)
    await open(STORE_A)
    expect(text('.mcard__wm')).toBe(storeName)
    await toStore()
    expect(text('.salon-cover__wm')).toBe(storeName)
    expect(text('.salon-cover__st')).toBe(storeName)
    const lines = [...phone().querySelectorAll('.salon-cover__ad .block')].map((n) => n.textContent)
    expect(lines).toEqual(address!.replace(/\s+(?=[A-Z])/, '\n').split('\n'))
    expect(phone().textContent).not.toContain(fixtureBusiness.name)
  })
})
