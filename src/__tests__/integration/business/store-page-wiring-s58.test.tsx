/**
 * @jest-environment jsdom
 *
 * S58 P6-R3 — the phone's お店ページ follows the PAYLOAD's sample (R189: `storePage.sampleKey`, the sample the
 * counts were computed for; an unsaved 業種 pick does not change it), one typed sample (R185: counts are P1's
 * Counts, junk never draws; STORES frozen at every depth), React keys that survive a repeated title (R196),
 * and the honest lines' order pinned (P6 attack NIT3). Sources: ATTACK-S57-P6-OPUS.md SF2/NIT3,
 * ATTACK-S57-P4A-OPUS.md F1/F3.
 */
import { render, fireEvent, cleanup, within } from '@testing-library/react'
import { ReserveCardLookSection, storeViewInputs, type StoreView } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'
import { STORES, type StorePageSample } from '@/business/lib/reserve-card/store-page-sample'
import { CAP_KEYS, seedRecord, type CapKey, type CapRecord, type Counts } from '@/business/lib/store-page/model'

class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO
afterEach(cleanup)

const LA = STORES.laestro
const FORCE = STORES.force
const LOOK = { storeLine: 'テスト東京店', scopeLabel: '全店共通', value: '#1C2247', palette: [{ order: 1, hex: '#1C2247', name: '紺' }, { order: 2, hex: '#1a6b55', name: '緑' }], practice: true }
const rec = (on: readonly CapKey[], typeKey: CapRecord['business_type'] = 'hair_salon'): CapRecord => {
  const s = seedRecord(typeKey)
  return { ...s, switches: Object.fromEntries(Object.keys(s.switches).map((k) => [k, { on: on.includes(k as CapKey), source: 'TYPE_DEFAULT' }])) as CapRecord['switches'] }
}
const el = (sv: StoreView, value = '#1C2247') => (
  <ReserveCardLookSection look={LOOK} value={value} onPick={() => {}} reduced render={(s) => <>{s.main}{s.preview}</>} storeView={sv} />
)
const openStore = (c: HTMLElement) => fireEvent.click(within(c).getByRole('button', { name: 'お店ページ' }))
const phone = (c: HTMLElement) => c.querySelector('.cl-phone') as HTMLElement
const honest = (c: HTMLElement) => Array.from(c.querySelectorAll('.cl-honest p')).map((p) => p.textContent)
const preview = (sample: StorePageSample) => (
  <ReserveCardPreview name="X" storeLine="" cardColor={null} view="store" on={new Set<string>(CAP_KEYS)} sample={sample} />
)

describe('(a) R189 — the section draws the sample the payload names', () => {
  const LA_MARK = LA.rv.products[0].t
  const FORCE_MARK = FORCE.rv.classes[0].nm
  it.each([
    ['laestro', 'hair_salon', 'personal_gym'],
    ['force', 'personal_gym', 'hair_salon'],
  ] as const)('sampleKey %s: saved type %s, then an unsaved pick of %s leaves the sample as named', (key, saved, picked) => {
    const counts: Counts = STORES[key].counts
    const on: CapKey[] = ['shop', 'classes']
    expect(storeViewInputs({ draft: rec(on, saved), counts, sampleKey: key }).sample.name).toBe(STORES[key].name)
    expect(storeViewInputs({ draft: rec(on, picked), counts, sampleKey: key }).sample.name).toBe(STORES[key].name)
    const { container, rerender } = render(el({ draft: rec(on, saved), counts, sampleKey: key }))
    openStore(container)
    const want = key === 'laestro' ? LA_MARK : FORCE_MARK
    const other = key === 'laestro' ? FORCE_MARK : LA_MARK
    expect(phone(container).textContent).toContain(want)
    rerender(el({ draft: rec(on, picked), counts, sampleKey: key }))
    expect(phone(container).textContent).toContain(want)
    expect(phone(container).textContent).not.toContain(other)
  })
})

// R213 — the old cast was type-only; what this pins is model.ts countOf's runtime refusal (a mutant that lets junk
// through countOf turns every case red: Infinity, "3", true, [5] draw).
describe('(b) R213 — a junk count in the payload is refused before the preview draws it (and nothing throws)', () => {
  const BLOCKS = [['[data-cap="packs_chip"]', 'packs'], ['[data-cap="posts"]', 'posts'], ['[data-cap="intake"]', 'questions']] as const
  const JUNK: [string, unknown, boolean][] = [['Infinity', Infinity, false], ['"3"', '3', false], ['true', true, false], ['[5]', [5], false], ['missing', undefined, true]]
  const withCount = (need: string, v: unknown, missing: boolean): StorePageSample => {
    const counts: Record<string, unknown> = { ...LA.counts }
    if (missing) delete counts[need]
    else counts[need] = v
    return { ...LA, counts: counts as unknown as Counts }
  }
  it.each(BLOCKS)('%s (count %s)', (sel, need) => {
    const base = render(preview(LA))
    expect(base.container.querySelector(sel)).not.toBeNull() // a clean count draws it
    cleanup()
    const drew: string[] = []
    for (const [name, v, missing] of JUNK) {
      let c: HTMLElement | null = null
      expect(() => { c = render(preview(withCount(need, v, missing))).container }).not.toThrow()
      if (c && (c as HTMLElement).querySelector(sel) !== null) drew.push(name)
      cleanup()
    }
    expect(drew).toEqual([])
  })
})

describe('(c) R185 — STORES cannot be mutated', () => {
  it('every level is frozen and a nested write changes nothing', () => {
    for (const s of [LA, FORCE]) {
      expect([Object.isFrozen(STORES), Object.isFrozen(s), Object.isFrozen(s.counts), Object.isFrozen(s.rv), Object.isFrozen(s.rv.next), Object.isFrozen(s.rv.posts), Object.isFrozen(s.rv.posts[0])]).toEqual([true, true, true, true, true, true, true])
    }
    const counts = LA.counts as unknown as Record<string, number>
    const post = LA.rv.posts[0] as unknown as Record<string, string>
    const before = [counts.packs, post.t, LA.rv.posts.length]
    try { counts.packs = 99 } catch { /* strict mode throws */ }
    try { post.t = FORCE.rv.posts[0].t } catch { /* strict mode throws */ }
    try { (LA.rv.posts as unknown as unknown[]).push(FORCE.rv.posts[0]) } catch { /* frozen array throws */ }
    expect([counts.packs, post.t, LA.rv.posts.length]).toEqual(before)
  })
})

describe('(d) R196 — two packs / care rows with one title draw with no console.error', () => {
  it('both tabs show both rows and React warns nothing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const sample: StorePageSample = { ...LA, rv: { ...LA.rv, packs: [LA.rv.packs[0], LA.rv.packs[0]], care: [LA.rv.care[0], LA.rv.care[0]] } }
      const { container } = render(preview(sample))
      const rowsOf = (t: string) => Array.from(container.querySelectorAll('.visit-row__t')).filter((p) => p.textContent === t).length
      let packs = 0
      let care = 0
      for (const tab of within(container).queryAllByRole('tab', { hidden: true })) {
        fireEvent.click(tab)
        packs = Math.max(packs, rowsOf(LA.rv.packs[0].t))
        care = Math.max(care, rowsOf(LA.rv.care[0].t))
      }
      expect([packs, care]).toEqual([2, 2])
      expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})

describe('(e) P6 NIT3 — the honest lines appear in the pinned order', () => {
  it('the colour line first, then the store lines in honestLines order', () => {
    const sv: StoreView = { draft: rec(['packs', 'posts']), counts: { ...LA.counts, packs: 0, posts: 0 }, sampleKey: 'laestro' }
    // S60 R204 · P7A-R3 F-9 — the expected lines written out as literals (packs, then posts), nothing computed
    const store = ['回数券はオンですが、回数券が0件のため、まだお客様には出ません', 'お知らせはオンですが、投稿が0件のため、まだお客様には出ません']
    const { container } = render(el(sv, ''))
    openStore(container)
    const lines = honest(container)
    expect(lines.length).toBe(3)
    expect(store).not.toContain(lines[0])
    expect(lines.slice(1)).toEqual(store)
  })
})
