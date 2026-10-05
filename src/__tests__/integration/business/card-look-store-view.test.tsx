/**
 * @jest-environment jsdom
 *
 * P6 (S50) — the お店ページ view of カードの見た目 is driven by the お店ページ section's DRAFT (THE SHARED SHAPE:
 * `storeView = { draft, counts }`). The phone draws the draft's PUBLIC projection (a sub ON only while its parent
 * is ON, spec D4), a block only when P1's ready() says so (an unknown count draws nothing, R101), the honest lines
 * of spec E2 under the frame, and ONLY a colour pick moves the view to ホーム (SPECCHECK fix 1).
 */
import { render, fireEvent, cleanup, within } from '@testing-library/react'
import { ReserveCardLookSection, storeViewInputs, type StoreView } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { HONEST } from '@/business/lib/store-page/copy'
import { honestLines, seedRecord, type CapKey, type CapRecord, type Counts } from '@/business/lib/store-page/model'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'

class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO

const LOOK = {
  storeLine: 'テスト東京店',
  scopeLabel: '全店共通',
  value: '#1C2247',
  palette: [{ order: 1, hex: '#1C2247', name: '紺' }, { order: 2, hex: '#1a6b55', name: '緑' }],
}
const LA: Counts = STORES.laestro.counts
/** LA with some counts UNKNOWN (the key absent, R92). */
const without = (...keys: string[]): Counts => Object.fromEntries(Object.entries(LA).filter(([k]) => !keys.includes(k)))

/** A record of TYPE `typeKey` (R171: a type key, never a family) with exactly `on` switched ON (source irrelevant to the phone). */
const rec = (on: readonly CapKey[], typeKey: CapRecord['business_type'] = 'hair_salon'): CapRecord => {
  const s = seedRecord(typeKey)
  return { ...s, switches: Object.fromEntries(Object.keys(s.switches).map((k) => [k, { on: on.includes(k as CapKey), source: 'TYPE_DEFAULT' }])) as CapRecord['switches'] }
}

const el = (storeView?: StoreView, onPick: (hex: string) => void = () => {}) => (
  <ReserveCardLookSection look={LOOK} value="#1C2247" onPick={onPick} reduced render={(s) => <>{s.main}{s.preview}</>} storeView={storeView} />
)
const openStore = (c: HTMLElement) => fireEvent.click(within(c).getByRole('button', { name: 'お店ページ' }))
const phone = (c: HTMLElement) => c.querySelector('.cl-phone') as HTMLElement
const honest = (c: HTMLElement) => Array.from(c.querySelectorAll('.cl-honest p')).map((p) => p.textContent)
const pressed = (c: HTMLElement, name: string) => within(c).getByRole('button', { name }).getAttribute('aria-pressed')

afterEach(cleanup)

describe('お店ページ view follows the draft', () => {
  it('flipping posts in the draft adds / removes its block, and the view stays on お店ページ', () => {
    const { container, rerender } = render(el({ draft: rec(['checkin_qr']), counts: LA, sampleKey: 'laestro' }))
    openStore(container)
    expect(phone(container).textContent).not.toContain('お店からのお知らせ')
    rerender(el({ draft: rec(['checkin_qr', 'posts']), counts: LA, sampleKey: 'laestro' }))
    expect(phone(container).textContent).toContain('お店からのお知らせ')
    expect(pressed(container, 'お店ページ')).toBe('true') // a switch flip never moves the view
    rerender(el({ draft: rec(['checkin_qr']), counts: LA, sampleKey: 'laestro' }))
    expect(phone(container).textContent).not.toContain('お店からのお知らせ')
    expect(pressed(container, 'お店ページ')).toBe('true')
  })

  it('a sub ON under an OFF parent draws nothing; under an ON parent it draws', () => {
    const { container, rerender } = render(el({ draft: rec(['read_points']), counts: LA, sampleKey: 'laestro' }))
    openStore(container)
    expect(phone(container).textContent).not.toContain('読むとポイントがたまります')
    rerender(el({ draft: rec(['read_points', 'posts']), counts: LA, sampleKey: 'laestro' }))
    expect(phone(container).textContent).toContain('読むとポイントがたまります')
  })

  it('the phone is handed the public projection: subs under an OFF parent are not in it', () => {
    const on = storeViewInputs({ draft: rec(['read_points', 'photo_proof', 'homecare']), counts: LA, sampleKey: 'laestro' }).on
    expect([...on].sort()).toEqual(['homecare', 'photo_proof'])
  })

  it('an unknown count draws no block and no number (R101)', () => {
    const { container, rerender } = render(el({ draft: rec(['posts', 'packs']), counts: LA, sampleKey: 'laestro' }))
    openStore(container)
    expect(container.querySelector('[data-cap="packs_chip"]')).not.toBeNull()
    expect(phone(container).textContent).toContain('お店からのお知らせ')
    rerender(el({ draft: rec(['posts', 'packs']), counts: without('packs', 'posts'), sampleKey: 'laestro' }))
    expect(container.querySelector('[data-cap="packs_chip"]')).toBeNull()
    expect(phone(container).textContent).not.toContain('お店からのお知らせ')
    expect(honest(container).join('')).not.toContain('0件')
  })

  it('the sample follows the payload\'s sampleKey: force draws the STUDIO FORCE sample, laestro La Estro', () => {
    const { container, rerender } = render(el({ draft: rec(['shop'], 'hair_salon'), counts: LA, sampleKey: 'laestro' }))
    openStore(container)
    expect(phone(container).textContent).toContain('リペアシャンプー 300ml')
    rerender(el({ draft: rec(['classes'], 'personal_gym'), counts: STORES.force.counts, sampleKey: 'force' }))
    expect(phone(container).textContent).not.toContain('リペアシャンプー 300ml')
    expect(phone(container).textContent).toContain(STORES.force.rv.classes[0].nm)
  })

  it('without storeView the store view is the cover only (today)', () => {
    const { container } = render(el())
    openStore(container)
    expect(container.querySelector('[data-store-body]')).toBeNull()
    expect(honest(container)).toEqual([])
  })
})

describe('honest lines under the frame (spec E2)', () => {
  it('a parent ON with a 0 count says so', () => {
    const { container } = render(el({ draft: rec(['packs']), counts: { ...LA, packs: 0 }, sampleKey: 'laestro' }))
    expect(honest(container)).toEqual([HONEST.pending('回数券', '回数券')])
  })
  it('待機リスト ON with no ready classes gets the waitlist line', () => {
    const { container } = render(el({ draft: rec(['waitlist']), counts: LA, sampleKey: 'laestro' }))
    expect(honest(container)).toEqual([HONEST.waitlist])
  })
  it('everything ready → no honest block', () => {
    const { container } = render(el({ draft: rec(['packs', 'posts']), counts: LA, sampleKey: 'laestro' }))
    expect(container.querySelector('.cl-honest')).toBeNull()
  })
  it('an unknown count claims no 0件 line', () => {
    const { container } = render(el({ draft: rec(['packs']), counts: without('packs'), sampleKey: 'laestro' }))
    expect(honest(container)).toEqual([])
  })
  it('the model itself yields no line for an unknown count, and the phone shows exactly its lines (no filter of its own)', () => {
    const unknownDraft = { draft: rec(['packs']), counts: without('packs'), sampleKey: 'laestro' as const }
    expect(honestLines(unknownDraft.draft, unknownDraft.counts)).toEqual([])
    expect(storeViewInputs(unknownDraft).honest).toEqual(honestLines(unknownDraft.draft, unknownDraft.counts))
    const zero = { draft: rec(['packs']), counts: { ...LA, packs: 0 }, sampleKey: 'laestro' as const }
    expect(storeViewInputs(zero).honest).toEqual(honestLines(zero.draft, zero.counts))
    expect(storeViewInputs(zero).honest.length).toBe(1)
  })
})

describe('only a colour pick jumps to ホーム', () => {
  it('a swatch pick moves the view to ホーム', () => {
    const picked: string[] = []
    const { container } = render(el({ draft: rec(['posts']), counts: LA, sampleKey: 'laestro' }, (h: string) => { picked.push(h) }))
    openStore(container)
    expect(pressed(container, 'お店ページ')).toBe('true')
    fireEvent.click(within(container).getByRole('radio', { name: '緑' }))
    expect(picked).toEqual(['#1a6b55'])
    expect(pressed(container, 'ホーム')).toBe('true')
  })
})
