/**
 * @jest-environment jsdom
 */
// S64 P8b-2 (R240 as amended by R244, R243) — the phone picture shows the business's square mark BEFORE the name
// on the big card, the small card and the cover; without a mark (absent or '') the DOM is today's. The verbatim
// measure blocks are untouched: the probe carries `withemb` (36 px of padding in the CSS), so both long decisions
// read the mark's room through the probe they already measure, and the cover's mark is placed by CSS alone.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, cleanup } from '@testing-library/react'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'

const NAME = 'La Estro'
const MARK = 'blob:http://localhost/mark-1'
const ALL = ['checkin_qr', 'packs', 'intake', 'posts', 'read_points', 'reactions']
type View = 'home' | 'store'

const mount = (view: View, markUrl?: string, body = false) =>
  render(
    <ReserveCardPreview
      name={NAME}
      storeLine="Daikanyama"
      cardColor="#1a6b55"
      view={view}
      {...(markUrl === undefined ? {} : { markUrl })}
      {...(body ? { on: new Set(ALL), sample: STORES.laestro } : {})}
    />,
  ).container

const expectMark = (el: Element | null | undefined, cls: string) => {
  expect(el?.tagName).toBe('IMG')
  expect(el?.className).toBe(cls)
  expect(el?.getAttribute('data-logo')).toBe('1')
  expect(el?.getAttribute('alt')).toBe('')
  expect(el?.getAttribute('aria-hidden')).toBe('true')
  expect(el?.getAttribute('src')).toBe(MARK)
  expect(el?.getAttribute('style')).toBeNull()
}

// layout stubs (jsdom lays nothing out) — each undo restores an own descriptor or deletes the stub
const undo: Array<() => void> = []
const stub = (proto: object, key: string, get: (this: HTMLElement) => unknown) => {
  const own = Object.getOwnPropertyDescriptor(proto, key)
  Object.defineProperty(proto, key, { configurable: true, get })
  undo.push(() => { if (own) Object.defineProperty(proto, key, own); else delete (proto as Record<string, unknown>)[key] })
}
afterEach(() => { cleanup(); while (undo.length) undo.pop()!(); jest.restoreAllMocks() })

const TEXT = 300 // the name's own width; the column is 380 − 2 × 25 = 330 → 301 fits; 336 + 1 does not
const layout = () => {
  stub(HTMLElement.prototype, 'offsetWidth', function () {
    return this.classList.contains('salon-cover__wm-probe') ? TEXT + (this.classList.contains('withemb') ? 36 : 0) : 0
  })
  stub(HTMLElement.prototype, 'offsetLeft', function () { return this.classList.contains('salon-cover__wm') ? 25 : 0 })
  stub(HTMLElement.prototype, 'offsetParent', function () { return this.parentElement })
  stub(Element.prototype, 'clientWidth', function () { return this.classList.contains('mcard__hd') ? 330 : 380 })
  const real = window.getComputedStyle.bind(window)
  jest.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const s = real(el, pseudo)
    return new Proxy(s, {
      get: (t, k) => {
        if (k === 'columnGap') return '8px'
        const v = Reflect.get(t, k, t)
        return typeof v === 'function' ? v.bind(t) : v
      },
    })
  })
}
const isLong = (c: HTMLElement, view: View) =>
  view === 'home'
    ? c.querySelector('.mcard')!.classList.contains('mcard--long')
    : c.querySelector('.salon-cover__wm')!.classList.contains('salon-cover__wm--long')

describe('P8b-2 — the mark in the picture', () => {
  it.each([['home'], ['store']] as const)('p1 %s: no markUrl and markUrl="" draw no [data-logo] and no .withemb (a URL does)', (view) => {
    for (const m of [undefined, '']) {
      const c = mount(view, m)
      expect(c.querySelector('[data-logo]')).toBeNull()
      expect(c.querySelector('.withemb')).toBeNull()
      cleanup()
    }
    // the contrast that makes this a pin and not a tautology: the same view WITH a URL draws the mark
    expect(mount(view, MARK).querySelector('[data-logo]')).not.toBeNull()
  })

  it('p2 home + mark: the big card mark leads .mcard__hd before the name; the small card mark leads .tcard__body', () => {
    const c = mount('home', MARK)
    const big = c.querySelector('.mcard__hd')!.firstElementChild
    expectMark(big, 'mcard__emb')
    expect(big?.nextElementSibling?.className).toBe('mcard__wm')
    expect(big?.nextElementSibling?.textContent).toBe(NAME)
    const small = c.querySelector('.tcard__body')!.firstElementChild
    expectMark(small, 'tcard__emb')
    expect(small?.nextElementSibling?.className).toBe('tcard__name withemb')
    expect(small?.nextElementSibling?.textContent).toBe(NAME)
  })

  it("p3′ store + mark: the mark is the cover name's FIRST child; the name, the region label and the probe keep the name", () => {
    const c = mount('store', MARK)
    expect(c.querySelectorAll('[data-logo]')).toHaveLength(1)
    const wm = c.querySelector('.salon-cover__wm')!
    expect(wm.classList.contains('withemb')).toBe(true)
    expectMark(wm.firstElementChild, 'salon-cover__emb')
    expect(wm.textContent).toBe(NAME)
    expect(c.querySelector('.salon-cover__in')!.getAttribute('aria-label')).toBe(NAME)
    const probe = c.querySelector('.salon-cover__wm-probe')!
    expect(probe.classList.contains('withemb')).toBe(true)
    expect(probe.textContent).toBe(NAME)
  })

  it("p4′ home + mark: the big card's probe carries withemb; without a mark no probe does (both views)", () => {
    expect(mount('home', MARK).querySelector('.mcard .salon-cover__wm-probe')!.classList.contains('withemb')).toBe(true)
    cleanup()
    for (const view of ['home', 'store'] as const) {
      const c = mount(view)
      expect(c.querySelector('.salon-cover__wm-probe')).not.toBeNull()
      expect(c.querySelector('.salon-cover__wm-probe.withemb')).toBeNull()
      cleanup()
    }
  })

  it.each([['home'], ['store']] as const)('p5′ %s: a name that fits is not long; the mark widens the probe by 36 px → long', (view) => {
    layout()
    expect(isLong(mount(view), view)).toBe(false)
    cleanup()
    expect(isLong(mount(view, MARK), view)).toBe(true)
  })

  it('p6 the CSS: the six new rules to the value, ONE shared 36 px rule, :966 unchanged, no object-fit / mask on a new mark', () => {
    const css = readFileSync(join(process.cwd(), 'src/business/lib/reserve-card/reserve-card.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      sel: m[1].trim().replace(/\s+/g, ' '),
      decls: m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.replace(/\s*:\s*/, ':')),
    }))
    const of = (sel: string) => rules.filter((r) => r.sel === sel).map((r) => r.decls)
    expect(of('.member-ground .tcard__body .tcard__emb')).toEqual([['display:block', 'position:absolute', 'left:0', 'top:.625px', 'width:20px', 'height:20px']])
    expect(of('.member-ground .tcard__name.withemb')).toEqual([['padding-left:28px']])
    expect(of('.member-ground .salon-cover__wm.withemb, .member-ground .salon-cover__wm-probe.withemb')).toEqual([['padding-left:36px']])
    expect(of('.member-ground .salon-cover__wm.withemb')).toEqual([['box-sizing:content-box']])
    expect(of('.member-ground .salon-cover .salon-cover__wm--long.withemb')).toEqual([['max-width:calc(100% - 86px)']])
    expect(of('.member-ground .salon-cover__wm .salon-cover__emb')).toEqual([['display:block', 'position:absolute', 'left:0', 'top:calc((1lh - 28px) / 2)', 'width:28px', 'height:28px']])
    expect(rules.filter((r) => r.decls.includes('padding-left:36px'))).toHaveLength(1)
    expect(of('.member-ground .mcard__hd .mcard__emb')).toEqual([['display:block', 'flex:none', 'width:28px', 'height:28px', 'margin:.85px -2px 0 0']])
    const markRules = rules.filter((r) => /tcard__emb|salon-cover__emb/.test(r.sel))
    expect(markRules).toHaveLength(2)
    for (const r of markRules) for (const d of r.decls) expect(d).not.toMatch(/object-fit|mask/)
  })

  it.each([['home'], ['store']] as const)('p7 %s with a mark (and the store body): nothing inside the picture is a tab stop', (view) => {
    const root = mount(view, MARK, true).querySelector('.reserve-card-preview')!
    expect(root.querySelectorAll('[data-logo]')).toHaveLength(view === 'home' ? 2 : 1)
    if (view === 'store') expect(root.querySelector('[data-store-body]')).not.toBeNull()
    expect(root.querySelectorAll('a[href], input, select, textarea')).toHaveLength(0)
    for (const b of Array.from(root.querySelectorAll('button'))) if (!b.disabled) expect(b.getAttribute('tabindex')).toBe('-1')
    for (const t of Array.from(root.querySelectorAll('[tabindex]'))) expect(t.getAttribute('tabindex')).toBe('-1')
  })

  it.each([['home', '.mcard'], ['store', '.salon-cover__in']] as const)('p8 %s (R245): a mark arriving or leaving remounts the measured surface, so long follows; mark → another mark remounts nothing', (view, sel) => {
    layout()
    const at = (markUrl?: string) => (
      <ReserveCardPreview name={NAME} storeLine="Daikanyama" cardColor="#1a6b55" view={view} {...(markUrl === undefined ? {} : { markUrl })} />
    )
    const r = render(at())
    expect(isLong(r.container, view)).toBe(false)
    r.rerender(at(MARK))
    expect(isLong(r.container, view)).toBe(true)
    const node = r.container.querySelector(sel)
    expect(node).not.toBeNull()
    r.rerender(at('blob:http://localhost/mark-2'))
    expect(r.container.querySelector(sel)).toBe(node)
    expect(isLong(r.container, view)).toBe(true)
    r.rerender(at())
    expect(isLong(r.container, view)).toBe(false)
  })
})
