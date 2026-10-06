/**
 * @jest-environment jsdom
 *
 * S48 E1 — カードの見た目 becomes the first BLOCK of a Reserve設定 section 「お店ページ」 (switchboard mock
 * v2 :728-790). Behaviour pins, mounted as the route does it (SettingsPage → settingsProps → the door, on
 * the recorded Dev Salon answer set — card-look-title.test.tsx's harness): the rail, the ?section= id,
 * the block heading + chip, the staff gate, and the room's search for both words.
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
import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import { controlIdsOf, type SettingsSection } from '@/business/lib/settings'
import { CAP_KEYS, recordHash, seedRecord, serializeRecord, type CapRecord } from '@/business/lib/store-page/model'
import { practiceCounts } from '@/business/lib/store-page/practice-counts'

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

// ── S50 P3 — the section payload (PACKETS-S50-WAVE3 「THE SHARED SHAPE」) ─────────────────────────────────────
const KEY = (id: string) => `reserve_store_capabilities:${id}`
const page = async (store: string): Promise<SettingsSection> =>
  (await settingsProps({ locale: 'ja', store })).props.sections.find((x) => x.id === 'reserve-store-page')!
/** A gym-family record (yoga_studio) with one OWNER key — differs from every type's seed. */
const GYM_SAVED: CapRecord = (() => {
  const seed = seedRecord('yoga_studio')
  return { ...seed, switches: { ...seed.switches, packs: { on: true, source: 'OWNER', changed_at: '2026-09-30T01:00:00.000Z', changed_by: 'staff-1' } } }
})()
const LA_ESTRO = { packs: 3, classes: 0, care: 2, posts: 4, questions: 3, products: 3, resources: 0 } // mock :938
const STUDIO_FORCE = { packs: 0, classes: 12, care: 1, posts: 2, questions: 0, products: 0, resources: 24 } // mock :979

describe('S50 P3 — お店ページ payload: the per-store record, counts, ids and words', () => {
  it('the lead is B3 verbatim, and 業種 / 機能 each carry their guide pair', async () => {
    const s = await page(STORE.tokyo)
    expect(s.lead).toBe('お客様のアプリに出るお店のページを、機能ごとに出す・出さないで決めます。業種を選ぶと標準の組み合わせになり、あとから一つずつ変えられます。プレビューは、いまの設定でお客様に見えるページです。「カードの見た目」の設定は、すべての店舗に共通で適用されます。')
    expect(s.storePageGuides?.map((g) => g.title)).toEqual(['業種', '機能'])
    expect(s.storePageGuides?.every((g) => g.guide.length > 0)).toBe(true)
  })

  it('saved present: the parsed record, hasSaved, its hash, and counts by the SAVED family (GYM → STUDIO FORCE)', async () => {
    mockCore.settings = { [KEY(STORE.tokyo)]: serializeRecord(GYM_SAVED) }
    const p = (await page(STORE.tokyo)).storePage!
    expect(p).toMatchObject({ storeId: STORE.tokyo, hasSaved: true, startFamily: 'SALON', disconnected: false })
    expect(p.saved).toEqual(GYM_SAVED) // the PARSED record (internal keys), not the R121 wire value
    expect(p.basedOn).toBe(recordHash(GYM_SAVED))
    expect(p.basedOn).not.toBe(recordHash(null))
    expect(p.counts).toEqual(STUDIO_FORCE)
  })

  it('saved absent: the seed of the store\'s family, the hash of null, La Estro counts', async () => {
    const p = (await page(STORE.tokyo)).storePage!
    expect(p).toMatchObject({ hasSaved: false, startFamily: 'SALON', disconnected: false })
    expect(p.saved).toEqual(seedRecord('beauty_chiropractic')) // テスト東京店's twin STORE_A (fixtures.ts:42)
    expect(p.basedOn).toBe(recordHash(seedRecord('beauty_chiropractic'))) // S75: the hash of the seed shown, not of null
    expect(p.counts).toEqual(LA_ESTRO)
  })

  it('saved unreadable (wrong type inside) reads as absent: the seed, never the stored text (R90)', async () => {
    mockCore.settings = { [KEY(STORE.tokyo)]: { v: 1, business_type: 'yoga_studio', switches: { packs: { on: 'yes', source: 'OWNER' } } } }
    const p = (await page(STORE.tokyo)).storePage!
    expect(p).toMatchObject({ hasSaved: false, basedOn: recordHash(seedRecord('beauty_chiropractic')) })
    expect(p.saved).toEqual(seedRecord('beauty_chiropractic'))
  })

  it('another store\'s record is never this store\'s; a gym store starts GYM with the STUDIO FORCE counts', async () => {
    mockCore.settings = { [KEY(STORE.tokyo)]: serializeRecord(GYM_SAVED) }
    const p = (await page(STORE.gym)).storePage!
    expect(p).toMatchObject({ storeId: STORE.gym, hasSaved: false, startFamily: 'GYM' })
    expect(p.saved).toEqual(seedRecord('personal_gym')) // テスト恵比寿ジム's twin STORE_C (fixtures.ts:44)
    expect(p.counts).toEqual(STUDIO_FORCE)
  })

  it('practiceCounts reads the record\'s TYPE KEY: the gym family → STUDIO FORCE, every other family → La Estro (R91)', () => {
    for (const t of ['yoga_studio', 'pilates_studio', 'personal_gym', 'training_school'] as const) expect(practiceCounts(t)).toEqual(STUDIO_FORCE)
    for (const t of ['hair_salon', 'beauty_chiropractic', 'chiropractic', 'veterinary', 'other'] as const) expect(practiceCounts(t)).toEqual(LA_ESTRO)
  })

  it('controlIdsOf: the card colour + the 業種 + one id per CAP key (17 new ids)', async () => {
    const ids = controlIdsOf(await page(STORE.tokyo))
    expect(ids).toEqual(['reserve-card-look.color', 'reserve-store-page.family', ...CAP_KEYS.map((k) => `reserve-store-page.sw.${k}`)])
    expect(new Set(ids).size).toBe(18)
  })

  it('all-stores lens: no per-store part, the room\'s noStore sentence in its place, no store id counted', async () => {
    mockCore.noStores = true
    const s = await page(STORE.tokyo)
    expect(s.storePage).toBeUndefined()
    expect(s.storePageNoStore).toBe('お店の設定は店舗ごとの値です。左上の店舗の切替でどの店舗を見るか選ぶと、その店舗の値が表示されます。')
    expect(controlIdsOf(s)).toEqual(['reserve-card-look.color'])
  })

  it('door OFF (real mode): disconnected, seed, no counts — and core is never reached', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    mockCore.settings = { [KEY(STORE.tokyo)]: serializeRecord(GYM_SAVED) }
    const s = await page('store-test-ginza')
    expect(mockCore.reaches).toBe(0)
    expect(s.storePage).toMatchObject({ hasSaved: false, disconnected: true, basedOn: recordHash(s.storePage!.saved) })
    expect(s.storePage?.counts).toEqual({})
  })

  it('a shut gate ships no per-store part', async () => {
    admission.mockResolvedValue({ userId: LOGIN.perry, email: null, displayName: null, businessId: TENANT })
    mockCore.settings = { [KEY(STORE.devSalon)]: serializeRecord(GYM_SAVED) }
    const s = await page(STORE.devSalon)
    expect(s.storePage).toBeUndefined()
    expect(s.storePageGuides).toBeUndefined()
  })
})
