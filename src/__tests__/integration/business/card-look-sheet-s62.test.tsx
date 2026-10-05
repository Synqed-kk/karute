/**
 * @jest-environment jsdom
 */
// ⚖ S62 P9-2 (R226 · R230 · R232 · R233) — at ≤ 899 the ONE preview is drawn in the room's Dialog in its sheet form,
// opened by the section's view button; 閉じる lives in the preview's head row only there; the strip's observer
// follows the strip's MOUNT. Strings are read from the DOM (selectors), never retyped here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ReserveCardLookSection, fitScale, type StoreView } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { focusablesIn } from '@/app/[locale]/(business)/business/settings/Dialog'
import { PALETTE } from '@/business/lib/reserve-card/palette'
import { seedRecord, type CapKey, type CapRecord } from '@/business/lib/store-page/model'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'

class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO
afterEach(cleanup)

type Slots = { main: ReactNode; preview: ReactNode; viewButton: ReactNode }
let last: Slots | null = null
const section = (narrow?: boolean, onPick: (hex: string) => void = () => {}) => (
  <ReserveCardLookSection
    look={{ storeLine: 'Test store', scopeLabel: 'all', value: PALETTE[0].hex, palette: PALETTE }}
    value={PALETTE[0].hex}
    onPick={onPick}
    reduced
    {...(narrow === undefined ? {} : { narrow })}
    render={(slots) => {
      last = slots
      return (
        <div className="page pg-settings">
          <div className="st-read">{slots.main}{slots.viewButton}</div>
          {slots.preview && <aside className="st-side-card">{slots.preview}</aside>}
        </div>
      )
    }}
  />
)
const dialog = () => document.querySelector('[role="dialog"]')
const btn = () => document.querySelector('.cl-viewbtn') as HTMLButtonElement
const closeBtn = () => document.querySelector('[role="dialog"] .cl-preview .st-sec-h .st-link') as HTMLButtonElement | null
const segs = () => [...document.querySelectorAll('.cl-preview .sp-seg button')] as HTMLButtonElement[]
const pressed = () => segs().findIndex((b) => b.getAttribute('aria-pressed') === 'true')
const open = () => fireEvent.click(btn())

describe('S62 P9-2 — the preview in a sheet at ≤ 899', () => {
  it('s1 no `narrow`: the preview is inline, no dialog, no close button, and its DOM equals narrow={false}', () => {
    const a = render(section())
    const inline = a.container.querySelector('.st-side-card > .cl-preview') as HTMLElement
    expect(inline).not.toBeNull()
    expect(dialog()).toBeNull()
    expect(inline.querySelectorAll('.st-sec-h button')).toHaveLength(0)
    expect(inline.querySelector('.st-sec-h')!.children).toHaveLength(2)
    const html = inline.outerHTML
    a.unmount()
    const b = render(section(false))
    expect(b.container.querySelector('.cl-preview')!.outerHTML).toBe(html)
  })

  it('s2 `narrow`: slots.preview is null; the button opens the ONE preview in the sheet, focus on the close button', () => {
    render(section(true))
    expect(last!.preview).toBeNull()
    expect(document.querySelectorAll('.cl-preview')).toHaveLength(0)
    expect(btn().disabled).toBe(false)
    open()
    const d = dialog() as HTMLElement
    expect(d).not.toBeNull()
    expect(d.classList.contains('st-sheet')).toBe(true)
    expect(document.querySelectorAll('.cl-preview')).toHaveLength(1)
    const pv = d.querySelector('.cl-preview') as HTMLElement
    expect(pv.querySelector('#clPvHead')).not.toBeNull()
    expect(pv.querySelector('.st-sec-h .st-chip')).not.toBeNull()
    expect(closeBtn()).not.toBeNull()
    expect(pv.querySelectorAll('.sp-seg button')).toHaveLength(2)
    expect(pv.querySelector('.cl-strip > .cl-frame > .cl-phone')).not.toBeNull()
    expect(document.activeElement).toBe(closeBtn())
  })

  it('s3 the close button closes it and focus is back on the opener · Esc closes it', () => {
    render(section(true))
    btn().focus() // this test is about focus: a real press focuses the opener before its click
    open()
    fireEvent.click(closeBtn()!)
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(btn())
    open()
    expect(dialog()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dialog()).toBeNull()
  })

  it('s4 the view survives closing; a colour pick while closed reopens on the first view (home)', () => {
    const picked: string[] = []
    render(section(true, (h) => picked.push(h)))
    open()
    fireEvent.click(segs()[1])
    expect(pressed()).toBe(1)
    fireEvent.click(closeBtn()!)
    open()
    expect(pressed()).toBe(1)
    fireEvent.click(closeBtn()!)
    fireEvent.click(document.querySelectorAll('.cl-swatch')[3])
    expect(picked).toEqual([PALETTE[3].hex])
    open()
    expect(pressed()).toBe(0)
  })

  it('s5 open, then narrow → wide: no dialog, the preview inline; narrow again: the sheet stays closed', () => {
    const r = render(section(true))
    open()
    expect(dialog()).not.toBeNull()
    r.rerender(section(false))
    expect(dialog()).toBeNull()
    expect(document.querySelectorAll('.cl-preview')).toHaveLength(1)
    expect(document.querySelector('.st-side-card > .cl-preview')).not.toBeNull()
    r.rerender(section(true))
    expect(dialog()).toBeNull()
    expect(document.querySelectorAll('.cl-preview')).toHaveLength(0)
  })

  it('s6 the strip in the sheet is scaled at mount and observed; closing disconnects that observer', () => {
    class SpyRO {
      static all: SpyRO[] = []
      observed = new Set<Element>()
      disconnected = false
      constructor(readonly cb: () => void) { SpyRO.all.push(this) }
      observe(el: Element) { this.observed.add(el) }
      unobserve(el: Element) { this.observed.delete(el) }
      disconnect() { this.observed.clear(); this.disconnected = true }
    }
    const g = globalThis as unknown as { ResizeObserver: unknown }
    const was = g.ResizeObserver
    g.ResizeObserver = SpyRO
    const proto = HTMLElement.prototype
    const own = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cl-strip') ? 300 : 0 } })
    try {
      render(section(true))
      expect(SpyRO.all).toHaveLength(0)
      open()
      const strip = document.querySelector('[role="dialog"] .cl-strip') as HTMLElement
      expect(strip.style.getPropertyValue('--cl-scale')).toBe(String(fitScale(300)))
      const ro = SpyRO.all.find((r) => r.observed.has(strip))
      expect(ro).toBeDefined()
      fireEvent.click(closeBtn()!)
      expect(ro!.disconnected).toBe(true)
    } finally {
      if (own) Object.defineProperty(proto, 'clientWidth', own)
      else delete (proto as unknown as Record<string, unknown>).clientWidth
      g.ResizeObserver = was
    }
  })

  it("s7 the button carries the preview's own guide pair and is never disabled", () => {
    render(section())
    const pv = document.querySelector('.cl-preview') as HTMLElement
    expect(btn().disabled).toBe(false)
    expect(pv.getAttribute('data-guide-title')).toBeTruthy()
    expect(pv.getAttribute('data-guide')).toBeTruthy()
    expect(btn().getAttribute('data-guide-title')).toBe(pv.getAttribute('data-guide-title'))
    expect(btn().getAttribute('data-guide')).toBe(pv.getAttribute('data-guide'))
  })

  it('s8 unmounting while the sheet is open leaves no dialog and throws nothing', () => {
    const r = render(section(true))
    open()
    expect(dialog()).not.toBeNull()
    expect(() => act(() => r.unmount())).not.toThrow()
    expect(dialog()).toBeNull()
  })

  it('s9 CSS: the button is hidden outside the ONE 899 block and shown inside it, with the inline-preview hide', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/settings.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const head = '@media (max-width: 899px)'
    expect(css.split(head)).toHaveLength(2)
    const start = css.indexOf(head)
    let i = css.indexOf('{', start) + 1
    for (let depth = 1; depth > 0; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0
    const inside = css.slice(start, i)
    const outside = css.slice(0, start) + css.slice(i)
    expect(inside).toMatch(/\.biz \.pg-settings \.cl-viewbtn \{ display: flex; \}/)
    expect(inside).toMatch(/\.biz \.pg-settings \.st-side-card:has\(> \.cl-preview\) \{ display: none; \}/)
    expect(outside).not.toMatch(/:has\(> \.cl-preview\)/)
    const base = /\.biz \.pg-settings \.cl-viewbtn \{([^}]*)\}/.exec(outside)
    expect(base).not.toBeNull()
    expect(base![1]).toMatch(/(^|[\s;])display: none;/)
    expect(outside).not.toMatch(/\.cl-viewbtn \{[^}]*display: flex/)
  })
})

// ⚖ S63 R235 — the real sheet: in the store view the phone picture (aria-hidden) holds tab buttons with
// tabIndex -1; the trap must cycle the sheet's own controls only. Store input built as the attack's scratch did.
const rec = (on: readonly CapKey[]): CapRecord => {
  const s = seedRecord('hair_salon')
  return { ...s, switches: Object.fromEntries(Object.keys(s.switches).map((k) => [k, { on: on.includes(k as CapKey), source: 'TYPE_DEFAULT' }])) as CapRecord['switches'] }
}
const SV: StoreView = { draft: rec(['checkin_qr', 'packs', 'homecare']), counts: STORES.laestro.counts, sampleKey: 'laestro' }
const storeSection = () => (
  <ReserveCardLookSection
    look={{ storeLine: 'Test store', scopeLabel: 'all', value: PALETTE[0].hex, palette: PALETTE }}
    value={PALETTE[0].hex}
    onPick={() => {}}
    reduced
    narrow
    storeView={SV}
    render={(slots) => <div className="page pg-settings"><div className="st-read">{slots.main}{slots.viewButton}</div></div>}
  />
)

describe('S63 R235 — the real sheet traps Tab in every view', () => {
  it('t4 store view: the list = close + the two view buttons; Shift+Tab from close → the second view button; Tab from it → close', () => {
    render(storeSection())
    open()
    fireEvent.click(segs()[1])
    expect(document.querySelectorAll('[role="dialog"] .cl-phone button').length).toBeGreaterThan(0)
    expect(focusablesIn(dialog() as HTMLElement)).toEqual([closeBtn(), segs()[0], segs()[1]])
    closeBtn()!.focus()
    expect(fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(segs()[1])
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(closeBtn())
  })
  it('t5 home view: Tab from the second view button is still trapped, back on close', () => {
    render(storeSection())
    open()
    segs()[1].focus()
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(closeBtn())
  })
})

// ⚖ S63 R236 — where ResizeObserver does not exist, the strip's ref still writes the scale once and throws nothing
// (adapted from the attack's c4: inline AND in the sheet).
describe('S63 R236 — no ResizeObserver', () => {
  it('c4 inline mount and an opened sheet: no throw, `--cl-scale` written, unmount safe', () => {
    const g = globalThis as unknown as { ResizeObserver?: unknown }
    const was = g.ResizeObserver
    const proto = HTMLElement.prototype
    const own = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cl-strip') ? 300 : 0 } })
    delete g.ResizeObserver
    try {
      expect(typeof ResizeObserver).toBe('undefined')
      let wide: ReturnType<typeof render> | null = null
      expect(() => { wide = render(section()) }).not.toThrow()
      const inline = document.querySelector('.st-side-card .cl-strip') as HTMLElement
      expect(inline.style.getPropertyValue('--cl-scale')).toBe(String(fitScale(300)))
      expect(() => act(() => wide!.unmount())).not.toThrow()
      render(section(true))
      expect(() => open()).not.toThrow()
      const sheet = document.querySelector('[role="dialog"] .cl-strip') as HTMLElement
      expect(sheet.style.getPropertyValue('--cl-scale')).toBe(String(fitScale(300)))
      expect(() => fireEvent.click(closeBtn()!)).not.toThrow()
      expect(dialog()).toBeNull()
    } finally {
      if (own) Object.defineProperty(proto, 'clientWidth', own)
      else delete (proto as unknown as Record<string, unknown>).clientWidth
      g.ResizeObserver = was
    }
  })
})

// ⚖ S63 R237 — the two gaps the attack's M30 and M32 left open.
describe('S63 R237 — reduced-motion press pin and the sheet\'s name', () => {
  it('p1 CSS: under reduced motion `.cl-viewbtn:active` is in a `transform: none` rule\'s selector list', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/settings.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const head = '@media (prefers-reduced-motion: reduce)'
    const lists: string[][] = []
    for (let start = css.indexOf(head); start !== -1; start = css.indexOf(head, start + 1)) {
      let i = css.indexOf('{', start) + 1
      const from = i
      for (let depth = 1; depth > 0; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0
      for (const m of css.slice(from, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (m[2].trim() === 'transform: none;') lists.push(m[1].split(',').map((s) => s.trim()))
      }
    }
    expect(lists.length).toBeGreaterThan(0)
    expect(lists.some((l) => l.includes('.biz .pg-settings .cl-viewbtn:active'))).toBe(true)
  })
  it('p2 the open sheet is named by an element INSIDE it whose text is the inline preview\'s own title', () => {
    const wide = render(section())
    const inline = document.querySelector('.st-side-card > .cl-preview') as HTMLElement
    const title = document.getElementById(inline.getAttribute('aria-labelledby')!)!.textContent
    expect(title).toBeTruthy()
    wide.unmount()
    render(section(true))
    open()
    const d = dialog() as HTMLElement
    const named = document.getElementById(d.getAttribute('aria-labelledby') ?? '')
    expect(named).not.toBeNull()
    expect(d.contains(named)).toBe(true)
    expect(named!.textContent).toBe(title)
  })
})
