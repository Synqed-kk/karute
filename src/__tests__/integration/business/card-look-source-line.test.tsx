/**
 * @jest-environment jsdom
 */
// S40 1b-1 F4/F5 — カードの見た目's source line (mock #clSrc) as BEHAVIOUR, not source text: it speaks for
// the SAVED colour only (標準の色 · the empty sentence · the legacy sentence · nothing), never the unsaved
// pick and never a change date (core sends none); the two home notes show on ホーム only.
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ReserveCardLookSection, STAND_IN, fitScale } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { PALETTE } from '@/business/lib/reserve-card/palette'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'

class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO
afterEach(cleanup)

const EMPTY = '色はまだ設定されていません。お客様のアプリのカードは、これまでどおりの色で表示されます。'
const LEGACY = '現在の色は、以前に設定された色で、12色には含まれていません。12色のどれかを選ぶまで、この設定は変わりません。'
const NOTE_1 = '見本では、編集中のお店を大きいカードにしています。実際のアプリでは、次のご予約が近いお店が大きいカードになります。'
const NOTE_2 = 'カードを開く動きは、この見本だけのものです。'

const section = (saved: string | null, draft: string = saved ?? '') => (
  <ReserveCardLookSection
    look={{ storeLine: 'テスト東京店', scopeLabel: '全店共通', value: saved, palette: PALETTE, practice: true }}
    value={draft}
    onPick={() => {}}
    reduced
    render={({ main, preview }) => <>{main}{preview}</>}
  />
)
const mount = (saved: string | null, draft: string = saved ?? '') => render(section(saved, draft))

/** Stub a prototype accessor and return its exact undo: an OWN descriptor the prototype had is put back; an
 *  inherited one (jsdom puts clientWidth/offsetHeight/scrollTop on Element.prototype, not HTMLElement's) is
 *  left inherited — the stub is DELETED, never re-defined as an own property. */
const stubProto = (proto: object, key: string, desc: PropertyDescriptor) => {
  const own = Object.getOwnPropertyDescriptor(proto, key)
  Object.defineProperty(proto, key, { configurable: true, ...desc })
  return () => { if (own) Object.defineProperty(proto, key, own); else delete (proto as Record<string, unknown>)[key] }
}
/** A ResizeObserver that records WHICH elements it observes and fires only when the test resizes one of them
 *  (a real page: the frame's box is fixed, so only the strip's width change can ever refit). */
class SpyRO {
  static all: SpyRO[] = []
  observed = new Set<Element>()
  disconnected = false
  constructor(readonly cb: () => void) { SpyRO.all.push(this) }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear(); this.disconnected = true }
}
const resize = (el: Element) => { for (const ro of SpyRO.all) if (ro.observed.has(el)) ro.cb() }
const lineOf = (c: HTMLElement) => c.querySelector('.cl-state')?.textContent ?? null

describe('カードの見た目 source line (saved colour only)', () => {
  it('the stand-in is palette colour 1', () => {
    expect(STAND_IN).toBe(PALETTE[0].hex)
  })
  it.each([
    ['nothing saved', null, EMPTY],
    ['the standard colour saved', '#1C2247', '標準の色'],
    ['another of the 12 saved (no change date from core)', '#1F3D33', null],
    ['a legacy colour saved', '#123456', LEGACY],
  ])('%s → the exact line or none, and never a date', (_, saved, line) => {
    const { container } = mount(saved)
    expect(lineOf(container)).toBe(line)
    expect(container.textContent).not.toMatch(/\d+月\d+日/)
    expect(container.querySelector('.cl-state .cl-dot') !== null).toBe(saved === '#123456')
  })
  it('an unsaved pick never changes the line', () => {
    expect(lineOf(mount('#1C2247', '#1F3D33').container)).toBe('標準の色')
    cleanup()
    expect(lineOf(mount('#1F3D33', '#1C2247').container)).toBe(null)
    cleanup()
    expect(lineOf(mount(null, '#1C2247').container)).toBe(EMPTY)
  })
})

describe('カードの見た目 home notes', () => {
  it('both notes show on ホーム and neither on お店ページ', () => {
    const { container, getByRole } = mount('#1C2247')
    const caps = () => Array.from(container.querySelectorAll('.st-pv-cap')).map((p) => p.textContent)
    expect(caps()).toEqual(expect.arrayContaining([NOTE_1, NOTE_2]))
    fireEvent.click(getByRole('button', { name: 'お店ページ' }))
    expect(caps()).not.toContain(NOTE_1)
    expect(caps()).not.toContain(NOTE_2)
    fireEvent.click(getByRole('button', { name: 'ホーム' }))
    expect(caps()).toEqual(expect.arrayContaining([NOTE_1, NOTE_2]))
  })
})

// ⚖ 1b-2 B3 — the phone frame and the honest slot (mock .phoneframe / renderHonest :1947-1958): the app sits in
// the frame's own scroller; the honest block carries only the no-colour line, only while no colour is shown,
// and is not rendered at all when it has nothing to say.
describe('カードの見た目 phone frame + honest slot', () => {
  const HONEST = '色が設定されていないため、見本では仮に紺で表示しています。実際のお客様のアプリのカードとは色が異なる場合があります。'
  const honest = (c: HTMLElement) => Array.from(c.querySelectorAll('.cl-honest p')).map((p) => p.textContent)
  it('the app sits in the frame (.cl-frame > .cl-phone), both views', () => {
    const { container, getByRole } = mount('#1F3D33')
    expect(container.querySelector('.cl-strip > .cl-frame > .cl-phone .mcard')).not.toBeNull()
    fireEvent.click(getByRole('button', { name: 'お店ページ' }))
    expect(container.querySelector('.cl-strip > .cl-frame > .cl-phone .salon-cover')).not.toBeNull()
  })
  it('the preview scroller is out of the tab order (aria-hidden + tabIndex -1: the seg is the keyboard path)', () => {
    const phone = mount('#1C2247').container.querySelector('.cl-phone')!
    expect(phone.getAttribute('aria-hidden')).toBe('true')
    expect(phone.getAttribute('tabindex')).toBe('-1')
  })
  it('a view switch opens the app at its top (the scroller\'s scrollTop is written 0)', () => {
    const { container, getByText } = mount('#1C2247')
    const phone = container.querySelector('.cl-phone') as HTMLElement
    // jsdom's scrollTop does not persist, so the instance carries a recording one
    let top = 0
    const writes: number[] = []
    Object.defineProperty(phone, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { writes.push(v); top = v } })
    phone.scrollTop = 240
    writes.length = 0
    fireEvent.click(getByText('お店ページ'))
    expect(writes).toContain(0)
    expect(top).toBe(0)
  })
  it('the reset follows a VIEW CHANGE only — not the first mount (it opens at its top already), not a click on the selected seg, not a same-view re-render', () => {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    const tops = new WeakMap<Element, number>()
    const writes: number[] = [] // every write to the .cl-phone scroller's scrollTop, from its first mount on
    const undo = stubProto(HTMLElement.prototype, 'scrollTop', {
      get(this: HTMLElement) { return tops.get(this) ?? 0 },
      set(this: HTMLElement, v: number) { if (this.classList.contains('cl-phone')) writes.push(v); tops.set(this, v) },
    })
    try {
      const { container, getByRole, rerender } = render(section('#1C2247'))
      expect(writes).toEqual([])
      const phone = container.querySelector('.cl-phone') as HTMLElement
      phone.scrollTop = 240
      writes.length = 0
      fireEvent.click(getByRole('button', { name: 'ホーム' }))
      expect(writes).toEqual([])
      rerender(section('#1C2247', '#1F3D33'))
      expect(writes).toEqual([])
      expect(phone.scrollTop).toBe(240)
      fireEvent.click(getByRole('button', { name: 'お店ページ' }))
      expect(writes).toEqual([0])
    } finally {
      undo()
    }
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')).toEqual(before)
  })
  it('every VIEW-CHANGING path resets the scroller exactly once — a swatch pick on お店ページ (→ ホーム) and a big-card click on ホーム (→ お店ページ), not only the seg', () => {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    const tops = new WeakMap<Element, number>()
    const writes: number[] = []
    const undo = stubProto(HTMLElement.prototype, 'scrollTop', {
      get(this: HTMLElement) { return tops.get(this) ?? 0 },
      set(this: HTMLElement, v: number) { if (this.classList.contains('cl-phone')) writes.push(v); tops.set(this, v) },
    })
    try {
      const { container, getByRole, getAllByRole } = mount('#1C2247')
      const phone = container.querySelector('.cl-phone') as HTMLElement
      const caps = () => Array.from(container.querySelectorAll('.st-pv-cap')).map((p) => p.textContent)
      fireEvent.click(getByRole('button', { name: 'お店ページ' }))
      phone.scrollTop = 240
      writes.length = 0
      fireEvent.click(getAllByRole('radio')[1]) // a pick shows the Home card (mock M21)
      expect(caps()).toContain(NOTE_1)
      expect(writes).toEqual([0])
      phone.scrollTop = 180
      writes.length = 0
      fireEvent.click(phone.querySelector('.mcard')!) // the big card opens the store page (mock M43)
      expect(phone.querySelector('.salon-cover')).not.toBeNull()
      expect(writes).toEqual([0])
    } finally {
      undo()
    }
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')).toEqual(before)
  })
  it('the STRIP is observed: its narrowing refits the FRAME by --cl-scale = fitScale ALONE and writes NO layout value (no height, no --cl-h, no class, no inline style on ANY other element: a height the script wrote fed the side column\'s scrollbar, S46), ≥ 393 returns to 1:1, unmount disconnects', () => {
    const was = (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver
    SpyRO.all = []
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = SpyRO
    const proto = HTMLElement.prototype
    const before = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
    let stripW = 393
    const undo = stubProto(proto, 'clientWidth', { get(this: HTMLElement) { return this.classList.contains('cl-strip') ? stripW : 0 } })
    try {
      const { container, unmount } = mount('#1C2247')
      const strip = container.querySelector('.cl-strip') as HTMLElement
      // every inline property the script left on the strip, and its class list: paint only, or nothing
      const written = () => [Array.from({ length: strip.style.length }, (_, i) => strip.style.item(i)), strip.style.getPropertyValue('--cl-scale'), strip.className]
      expect(fitScale(336)).toBeCloseTo(336 / 393, 6)
      // every OTHER element's style AND class attribute in the document: a fit must leave all of them exactly as they were (S47)
      const others = () => Array.from(document.querySelectorAll('*')).filter((e) => e !== strip).map((e) => [e.getAttribute('style'), e.getAttribute('class')])
      for (const [w, scale] of [[336, fitScale(336)], [393, 1], [289, fitScale(289)], [440, 1]] as const) {
        const before = others()
        stripW = w
        resize(strip)
        expect(others()).toEqual(before)
        expect(written()).toEqual(scale < 1 ? [['--cl-scale'], String(scale), 'cl-strip'] : [[], '', 'cl-strip'])
        expect([strip.style.height, strip.style.getPropertyValue('--cl-h')]).toEqual(['', ''])
      }
      const ro = SpyRO.all.find((r) => r.observed.has(strip))!
      unmount()
      expect(ro.disconnected).toBe(true)
    } finally {
      undo()
      ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = was
    }
    // the stub is gone, not re-defined: HTMLElement.prototype holds exactly what it held before
    expect(Object.getOwnPropertyDescriptor(proto, 'clientWidth')).toEqual(before)
  })
  it('no colour shown → the honest block holds exactly the no-colour line, on both views', () => {
    const { container, getByRole } = mount(null)
    expect(honest(container)).toEqual([HONEST])
    fireEvent.click(getByRole('button', { name: 'お店ページ' }))
    expect(honest(container)).toEqual([HONEST])
  })
  it('a colour shown → no honest block at all (empty → not rendered)', () => {
    const { container } = mount('#1F3D33')
    expect(container.querySelector('.cl-honest')).toBeNull()
    cleanup()
    expect(mount(null, '#1F3D33').container.querySelector('.cl-honest')).toBeNull()
  })
})

// Reserve's branch rule (studio-home.tsx:478, :514), carried by the port: the card prints the store line under the
// name only when it differs from the name — a store named like the card has no branch to add.
describe('reserve card port — the branch line follows Reserve\'s branch rule', () => {
  const home = (name: string, storeLine: string) =>
    render(<ReserveCardPreview name={name} storeLine={storeLine} cardColor={null} view="home" />).container
  it('name === storeLine → no .mcard__store on ホーム', () => {
    expect(home('テスト東京店', 'テスト東京店').querySelector('.mcard__store')).toBeNull()
  })
  it('name ≠ storeLine → .mcard__store carries the store line', () => {
    expect(home('La Estro', '代官山院').querySelector('.mcard__store')?.textContent).toBe('代官山院')
  })
})

// Reserve's cover (studio-salon.tsx) always renders both paragraphs under the name: .salon-cover__st = line 2 (the
// store line) and .salon-cover__ad = line 3 (the address). A store with a name but no address keeps the empty third
// paragraph — the port's drawing is Reserve's, verbatim, so this pins it rather than hiding it.
describe('reserve card port — the cover without an address: lines 1–2 print, line 3 is empty', () => {
  const store = (address?: string) =>
    render(<ReserveCardPreview name="La Estro" storeLine="代官山院" cardColor={null} address={address} view="store" />).container
  it('no address → the name and the store line print, .salon-cover__ad exists and is empty', () => {
    const c = store(undefined)
    expect(c.querySelector('.salon-cover__wm')?.textContent).toBe('La Estro')
    expect(c.querySelector('.salon-cover__st')?.textContent).toBe('代官山院')
    const ad = c.querySelector('.salon-cover__ad')
    expect(ad).not.toBeNull()
    expect(ad?.textContent).toBe('')
  })
  it('with an address → .salon-cover__ad carries the address', () => {
    expect(store('東京都渋谷区猿楽町1-2-3').querySelector('.salon-cover__ad')?.textContent).toBe('東京都渋谷区猿楽町1-2-3')
  })
})
