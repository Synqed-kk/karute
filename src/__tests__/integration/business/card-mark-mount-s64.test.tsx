/**
 * @jest-environment jsdom
 *
 * S64 P8b-3 (R241, R242, R243, R191, R239) — ReserveCardLookSection holds the picked mark, mounts CardMarkBlock in its
 * reading column and feeds the picture; the mark never enters the room's values or any request. Room harness copied
 * from store-page-save-s61.test.tsx lines 7-87, verbatim (only the testing-library and react import lines widened).
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

import { render, fireEvent, act, cleanup } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
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

// ---- S64 P8b-3 — the mount (R241 · R242 · R243)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SettingsScreen } from '@/app/[locale]/(business)/business/settings/SettingsScreen'
import { ReserveCardLookSection } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { MARK_REAL_LINE } from '@/app/[locale]/(business)/business/settings/CardMarkBlock'
import { focusablesIn } from '@/app/[locale]/(business)/business/settings/Dialog'
import { PALETTE } from '@/business/lib/reserve-card/palette'

type ScreenProps = Parameters<typeof SettingsScreen>[0]
const SP = 'reserve-store-page'
const COLOUR = '/api/business/card-color'
const propsFor = async (store: string): Promise<ScreenProps> =>
  ((await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: SP }) })) as ReactElement<ScreenProps>).props
const count = () => document.querySelector('.st-save-count')?.textContent
const pickOther = async () => {
  const other = [...document.querySelectorAll('.cl-swatch')].find((el) => el.getAttribute('aria-checked') !== 'true') as HTMLElement
  await act(async () => { fireEvent.click(other) })
}
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }
/** s61's seam (global.fetch = jest.fn): every call recorded; the colour PUT answered ok. */
const stub = () => {
  const calls: Call[] = []
  global.fetch = jest.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ url: String(url), headers: init.headers, body })
    return { ok: true, status: 200, json: async () => ({ ok: true, color: body.color ?? null, record: body.record }) }
  }) as unknown as typeof fetch
  return calls
}
const screenFor = (p: ScreenProps, key: string) => <SettingsScreen key={key} {...p} saveCardColor={{ businessId: TENANT, canSave: true }} />
const mount = async (p: ScreenProps) => {
  render(screenFor(p, 'one'))
  await act(async () => {})
}
const press = async () => {
  await act(async () => { fireEvent.click(document.querySelector('.st-save') as HTMLButtonElement) })
  await act(async () => {})
}

// ---- the block's own way to a good pick, without its `measure` seam: URL and Image are stubbed (jsdom decodes nothing)
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0] // GIF89a → refused by its bytes
const fileOf = (head: number[], name: string) => {
  const bytes = new Uint8Array(head.length)
  bytes.set(head)
  return new File([bytes], name, { type: 'image/png' })
}
let made = 0
const created: string[] = []
const revoked: string[] = []
const URL_BEFORE = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
const IMAGE_BEFORE = window.Image
class SquareImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 512
  naturalHeight = 512
  set src(_url: string) { setTimeout(() => this.onload?.(), 0) }
}
beforeEach(() => {
  made = 0; created.length = 0; revoked.length = 0
  Object.assign(URL, {
    createObjectURL: () => { const u = `blob:mark-${++made}`; created.push(u); return u },
    revokeObjectURL: (u: string) => { revoked.push(u) },
  })
  window.Image = SquareImage as unknown as typeof Image
})
afterEach(() => {
  cleanup()
  Object.assign(URL, URL_BEFORE)
  window.Image = IMAGE_BEFORE
})
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) })
const choose = async (f: File) => {
  const input = document.querySelector('[data-testid="card-mark-file"]')
  expect(input).not.toBeNull()
  await act(async () => { fireEvent.change(input as Element, { target: { files: [f] } }) })
  await settle()
}
const goodPick = () => choose(fileOf(PNG_HEAD, 'mark.png'))
const logos = () => [...document.querySelectorAll('[data-logo]')]
const segs = () => [...document.querySelectorAll('.cl-preview .sp-seg button')] as HTMLButtonElement[]

type Slots = { main: ReactNode; preview: ReactNode; viewButton: ReactNode }
const section = (practice: boolean, narrow = false) => (
  <ReserveCardLookSection
    look={{ storeLine: 'Test store', scopeLabel: 'all', value: '', palette: PALETTE, practice }}
    value=""
    onPick={() => {}}
    reduced
    narrow={narrow}
    render={(s: Slots) => (
      <div className="page pg-settings">
        <div className="st-read">{s.main}{s.viewButton}</div>
        {s.preview && <aside className="st-side-card">{s.preview}</aside>}
      </div>
    )}
  />
)

describe('S64 P8b-3 — RCL holds the mark, mounts the block, feeds the picture', () => {
  it('n1 the block sits in the colour section right after .cl-state, never in the preview; narrow + sheet open: not in the dialog', () => {
    const a = render(section(true))
    const block = document.querySelector('.cm-block') as HTMLElement
    expect(block).not.toBeNull()
    const sec = block.parentElement as HTMLElement
    expect(sec.matches('section.st-block')).toBe(true)
    expect(sec.querySelector('#clPickHead')).not.toBeNull()
    expect(sec.querySelector('.cl-state')!.nextElementSibling).toBe(block)
    expect(block.closest('.cl-preview')).toBeNull()
    a.unmount()
    render(section(true, true))
    fireEvent.click(document.querySelector('.cl-viewbtn') as HTMLButtonElement)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelectorAll('.cm-block')).toHaveLength(1)
    expect(document.querySelector('.cm-block')!.closest('[role="dialog"]')).toBeNull()
  })

  it('n2 a good pick: home → two marks in .cl-phone (big card, small card) with the created URL; store view → the cover\'s one', async () => {
    render(section(true))
    await goodPick()
    expect(created).toEqual(['blob:mark-1'])
    const inPhone = () => [...document.querySelectorAll('.cl-phone img[data-logo]')].map((i) => [i.className, i.getAttribute('src')])
    expect(inPhone()).toEqual([['mcard__emb', 'blob:mark-1'], ['tcard__emb', 'blob:mark-1']])
    expect(logos()).toHaveLength(2)
    await act(async () => { fireEvent.click(segs()[1]) })
    expect(inPhone()).toEqual([['salon-cover__emb', 'blob:mark-1']])
    expect(logos()).toHaveLength(1)
  })

  it('n3 remove clears the mark; a held mark then a refused pick clears it too, the alert on screen', async () => {
    render(section(true))
    await goodPick()
    expect(logos()).toHaveLength(2)
    await act(async () => { fireEvent.click(document.querySelector('.cm-rm') as HTMLButtonElement) })
    expect(logos()).toHaveLength(0)
    await goodPick()
    expect(logos()).toHaveLength(2)
    await choose(fileOf(GIF_HEAD, 'bad.png'))
    expect(document.querySelector('.cm-block [role="alert"]')).not.toBeNull()
    expect(logos()).toHaveLength(0)
  })

  it('n4 practice false: the L7 line, no picker, no mark', () => {
    render(section(false))
    const block = document.querySelector('.cm-block') as HTMLElement
    expect(block).not.toBeNull()
    expect(block.querySelector('.st-block-note')?.textContent).toBe(MARK_REAL_LINE)
    expect(block.querySelectorAll('button, input')).toHaveLength(0)
    expect(logos()).toHaveLength(0)
  })

  it('n5 the flip: a held mark is dropped at once and the block remounts (URL revoked, its ok line gone)', async () => {
    const r = render(section(true))
    await goodPick()
    expect(logos()).toHaveLength(2)
    const okLine = document.querySelector('.cm-state--ok span')!.textContent as string
    r.rerender(section(false))
    expect(logos()).toHaveLength(0)
    expect(revoked).toContain('blob:mark-1')
    r.rerender(section(true))
    expect(logos()).toHaveLength(0)
    expect(document.querySelector('.cm-state--ok')).toBeNull()
    expect(document.querySelector('.cm-block')!.textContent).not.toContain(okLine)
  })

  it('n6 R243: narrow, sheet open, a mark held, store view: the trap list is close + the two view buttons; the mark sits in the aria-hidden phone', async () => {
    render(section(true, true))
    await goodPick()
    fireEvent.click(document.querySelector('.cl-viewbtn') as HTMLButtonElement)
    const d = document.querySelector('[role="dialog"]') as HTMLElement
    fireEvent.click(segs()[1])
    const close = d.querySelector('.cl-preview .st-sec-h .st-link')
    expect(close).not.toBeNull()
    expect(focusablesIn(d)).toEqual([close, segs()[0], segs()[1]])
    const marks = [...d.querySelectorAll('img[data-logo]')]
    expect(marks).toHaveLength(1)
    expect(marks[0].closest('.cl-phone[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('S64 P8b-3 — the room: the mark never reaches the save path (SENSITIVE)', () => {
  it('n7 door ON: a mark alone raises no change; pick colour + save sends deep-equal requests with and without a mark', async () => {
    const flow = async (withMark: boolean) => {
      const calls = stub()
      await mount(await propsFor(STORE.tokyo))
      if (withMark) {
        const before = count() // the unchanged room's own count line, read before the pick
        await goodPick()
        expect(logos().length).toBeGreaterThan(0)
        expect((document.querySelector('.st-save') as HTMLButtonElement).disabled).toBe(true) // an unchanged room: save disabled
        expect(count()).toBe(before)
      }
      await pickOther()
      await press()
      cleanup()
      return calls
    }
    const held = await flow(true)
    const none = await flow(false)
    expect(held.map((c) => c.url)).toEqual([COLOUR])
    expect(held).toEqual(none)
  })

  it('n8 a mark held for one store, then the screen for another (keyed by store, as page.tsx does): no mark, the URL revoked', async () => {
    stub()
    const r = render(screenFor(await propsFor(STORE.tokyo), STORE.tokyo))
    await act(async () => {})
    await goodPick()
    expect(logos().length).toBeGreaterThan(0)
    const other = await propsFor(STORE.yokohama)
    r.rerender(screenFor(other, STORE.yokohama))
    await act(async () => {})
    expect(logos()).toHaveLength(0)
    expect(revoked).toContain('blob:mark-1')
  })

  it('n9 the payload: cardLook.practice is true with the door ON and with the door OFF; the source line', async () => {
    const lookOf = (p: ScreenProps) => p.sections.find((s) => s.cardLook)!.cardLook!
    const on = await propsFor(STORE.tokyo)
    expect(mockCore.reaches).toBeGreaterThan(0) // the door is ON: core was reached
    expect(lookOf(on).practice).toBe(true)
    delete process.env.BUSINESS_PRACTICE_TENANT
    mockCore.reaches = 0
    const off = await propsFor(STORE.tokyo)
    expect(mockCore.reaches).toBe(0) // the door is OFF: sample data, core never reached
    expect(lookOf(off).practice).toBe(true)
    const src = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/settings-props.ts'), 'utf8')
    expect(src).toMatch(/^\s+practice: !STORE_CAPABILITIES_REAL_MODE \|\| ctx\.doorOn,$/m)
  })
})
