/**
 * @jest-environment jsdom
 *
 * S48 E1 — カードの見た目 becomes the first BLOCK of a Reserve設定 section 「お店ページ」 (switchboard mock
 * v2 :728-790). Behaviour pins, mounted as the route does it (SettingsPage → settingsProps → the door, on
 * the recorded Dev Salon answer set — card-look-title.test.tsx's harness): the rail, the ?section= id,
 * the block heading + chip, the staff gate, and the room's search for both words.
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
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => null })) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  global.fetch = realFetch
})

const open = async (section?: string, store: string = STORE.tokyo) => {
  const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, ...(section ? { section } : {}) }) })) as ReactElement
  render(el)
  await act(async () => {})
}
const railNames = () => [...document.querySelectorAll('.st-rail-item')].map((b) => b.getAttribute('data-rail-id'))
const railLabels = () => [...document.querySelectorAll('.st-rail-item .st-rail-name')].map((n) => n.firstChild?.textContent ?? '')
const search = async (q: string) => {
  const box = document.querySelector('.st-rail input[type="search"]') as HTMLInputElement
  await act(async () => { fireEvent.change(box, { target: { value: q } }) })
}

describe('S48 E1 — お店ページ: the section that holds カードの見た目', () => {
  it('the rail shows お店ページ between Reserve 受付 and 通知, and no カードの見た目 row', async () => {
    await open()
    const ids = railNames()
    expect(ids.indexOf('reserve-store-page')).toBe(ids.indexOf('reserve-acceptance') + 1)
    expect(ids.indexOf('notifications')).toBe(ids.indexOf('reserve-store-page') + 1)
    expect(ids).not.toContain('reserve-card-look')
    expect(railLabels()).toContain('お店ページ')
    expect(railLabels()).not.toContain('カードの見た目')
  })

  it('?section=reserve-store-page selects it: title お店ページ, today\'s lead, the カードの見た目 block with its 全店共通 chip', async () => {
    await open('reserve-store-page')
    expect(document.querySelector('.st-rail-item[aria-current="page"]')?.getAttribute('data-rail-id')).toBe('reserve-store-page')
    expect(document.querySelector('h2')?.textContent).toBe('お店ページ')
    expect(document.body.textContent).toContain('「カードの見た目」の設定は、すべての店舗に共通で適用されます。')
    const head = document.getElementById('clLookHead')!
    expect(head.tagName).toBe('H3')
    expect(head.textContent).toBe('カードの見た目')
    const chip = head.parentElement!.querySelector('.st-scope')!
    expect(chip.textContent).toBe('全店共通')
    expect(chip.getAttribute('title')).toBe('この事業者のすべての店舗に適用されます')
    expect(document.querySelectorAll('.cl-swatches [role="radio"]')).toHaveLength(12)
  })

  it('the old id is not an alias: ?section=reserve-card-look does not open お店ページ', async () => {
    await open('reserve-card-look')
    expect(document.querySelector('.st-rail-item[aria-current="page"]')?.getAttribute('data-rail-id')).not.toBe('reserve-store-page')
  })

  it('a staff reader (no settings.manage) gets the gate: 権限がありません, no card data shipped', async () => {
    admission.mockResolvedValue({ userId: LOGIN.perry, email: null, displayName: null, businessId: TENANT })
    await open('reserve-store-page')
    const row = document.querySelector('.st-rail-item[data-rail-id="reserve-store-page"]')!
    expect(row.textContent).toContain('権限がありません')
    expect(document.querySelector('.cl-swatches')).toBeNull()
    expect(document.getElementById('clLookHead')).toBeNull()
  })

  it.each(['お店ページ', 'カードの見た目'])('search 「%s」 finds the section', async (q) => {
    await open()
    await search(q)
    // the open section (店舗情報・営業時間 by default) stays shown with 表示中; every other row is filtered
    expect(railNames().filter((id) => id !== 'store-hours')).toEqual(['reserve-store-page'])
    const hit = document.querySelector('.st-rail-item[data-rail-id="reserve-store-page"] .st-rail-hit')?.textContent ?? null
    expect(hit).toBe(q === 'お店ページ' ? null : 'カードの見た目') // the rail label answers itself; the block heading is named
  })

  it('a query that is on neither drops the row (the filter is live)', async () => {
    await open()
    await search('カードの形')
    expect(railNames()).not.toContain('reserve-store-page')
  })
})
