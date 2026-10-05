/**
 * @jest-environment jsdom
 */
// S49 P4a — the お店ページ preview body, part 1 (spec §E1 items 2-5 and 8) as BEHAVIOUR: each block appears only
// for its key (and the mock's count rule), the blocks keep the mock's order, and the cover is untouched — with
// no `on`/`sample` the store view is exactly today's cover-only output.
import { render, cleanup } from '@testing-library/react'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'

afterEach(cleanup)

const LA = STORES.laestro
const FORCE = STORES.force
const ALL = ['checkin_qr', 'packs', 'intake', 'posts', 'read_points', 'reactions'] as const

const mount = (on?: readonly string[], sample: typeof LA | typeof FORCE = LA) =>
  render(
    <ReserveCardPreview
      name="La Estro"
      storeLine="代官山院"
      cardColor="#1a6b55"
      address="東京都渋谷区代官山町12-18 INO II ビル 2F"
      view="store"
      {...(on ? { on: new Set(on), sample } : {})}
    />,
  ).container

const body = (c: ParentNode) => c.querySelector('[data-store-body]')
const has = (c: ParentNode, sel: string) => c.querySelector(sel) !== null

describe('store page body — absent props', () => {
  it('without on/sample the store view is the cover alone (no body)', () => {
    const c = mount()
    expect(has(c, '.salon-cover')).toBe(true)
    expect(body(c)).toBeNull()
  })
  it('only on, or only sample, still draws no body', () => {
    const onOnly = render(<ReserveCardPreview name="X" storeLine="" cardColor={null} view="store" on={new Set(ALL)} />).container
    expect(body(onOnly)).toBeNull()
    cleanup()
    const sampleOnly = render(<ReserveCardPreview name="X" storeLine="" cardColor={null} view="store" sample={LA} />).container
    expect(body(sampleOnly)).toBeNull()
  })
  it('the cover markup is byte-identical with and without the body', () => {
    const plain = mount().querySelector('.salon-cover')!.outerHTML
    cleanup()
    const full = mount([...ALL]).querySelector('.salon-cover')!.outerHTML
    expect(full).toBe(plain)
  })
  it('the home view ignores on/sample', () => {
    const c = render(<ReserveCardPreview name="X" storeLine="" cardColor={null} view="home" on={new Set(ALL)} sample={LA} />).container
    expect(body(c)).toBeNull()
  })
})

describe('store page body — floor blocks follow the sample', () => {
  it('La Estro: rank chip, next booking, 予約する with every switch OFF', () => {
    const c = mount([])
    expect(c.querySelector('.salon-rankfloat .rank-chip')!.textContent).toBe('GOLD MEMBER')
    expect(c.querySelector('.rank-chip')!.getAttribute('data-tier')).toBe('GOLD')
    expect(c.querySelector('.salon-next__label')!.textContent).toBe('次回のご予約')
    expect(c.querySelector('.salon-next__date')!.textContent).toBe('9/14（月）14:30')
    expect(c.querySelector('.salon-acts__primary')!.textContent).toBe('予約する')
    for (const k of ALL) expect(has(c, `[data-cap="${k}"]`)).toBe(false)
    expect(has(c, '[data-cap="packs_chip"]')).toBe(false)
  })
  it('STUDIO FORCE: no rank, no next booking block, 予約する stays', () => {
    const c = mount([], FORCE)
    expect(has(c, '.salon-rankfloat')).toBe(false)
    expect(has(c, '.salon-next')).toBe(false)
    expect(c.querySelector('.salon-acts__primary')!.textContent).toBe('予約する')
  })
  it('the body holds nothing focusable (a picture)', () => {
    const c = mount([...ALL])
    for (const b of c.querySelectorAll('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
    for (const a of c.querySelectorAll('[data-store-body] a')) expect(a.hasAttribute('href')).toBe(false)
  })
})

describe('store page body — each switched block by its key', () => {
  it('packs: 「回数券 残り4回」 beside the date only while packs is ON and the sample has packs', () => {
    expect(mount(['packs']).querySelector('[data-cap="packs_chip"]')!.textContent).toBe('回数券 残り4回')
    cleanup()
    expect(has(mount([]), '[data-cap="packs_chip"]')).toBe(false)
  })
  it('checkin_qr: 受付 joins the actions row', () => {
    expect(mount(['checkin_qr']).querySelector('.salon-acts [data-cap="checkin_qr"]')!.textContent).toBe('受付')
    cleanup()
    expect(mount([]).querySelectorAll('.salon-acts > *')).toHaveLength(1)
  })
  it('intake: the banner with the mock words; absent when the sample has no questions', () => {
    const c = mount(['intake'])
    const t = c.querySelector('[data-cap="intake"]')!
    expect(t.querySelector('.member-row__t')!.textContent).toBe('問診票のご記入をお願いします')
    expect(t.querySelector('.member-row__s')!.textContent).toBe('ご来店までに、3つの質問にお答えください。')
    cleanup()
    expect(has(mount(['intake'], FORCE), '[data-cap="intake"]')).toBe(false)
  })
  it('posts: heading + every sample post title and date, no hint/points/reactions by default', () => {
    const c = mount(['posts'])
    const p = c.querySelector('[data-cap="posts"]')!
    expect(p.querySelector('h2')!.textContent).toBe('お店からのお知らせ')
    expect([...p.querySelectorAll('.member-row__t')].map((n) => n.textContent)).toEqual(LA.rv.posts.map((x) => x.t))
    expect([...p.querySelectorAll('.member-row__s')].map((n) => n.textContent)).toEqual(LA.rv.posts.map((x) => x.d))
    expect(has(p, 'small')).toBe(false)
    expect(has(p, '[data-cap="read_points"]')).toBe(false)
    expect(has(p, '[data-cap="reactions"]')).toBe(false)
  })
  it('read_points: the hint and +5pt on every post', () => {
    const p = mount(['posts', 'read_points']).querySelector('[data-cap="posts"]')!
    expect(p.querySelector('h2 small')!.textContent).toBe('読むとポイントがたまります')
    const pts = [...p.querySelectorAll('[data-cap="read_points"]')].map((n) => n.textContent)
    expect(pts).toEqual(LA.rv.posts.map(() => '+5pt'))
  })
  it('reactions: the mock line under every post', () => {
    const p = mount(['posts', 'reactions']).querySelector('[data-cap="posts"]')!
    const r = [...p.querySelectorAll('[data-cap="reactions"]')].map((n) => n.textContent)
    expect(r).toEqual(LA.rv.posts.map(() => '♡ いいね ・ 💬 コメント'))
  })
  it('subs never draw without their parent block', () => {
    const c = mount(['read_points', 'reactions'])
    expect(has(c, '[data-cap="posts"]')).toBe(false)
    expect(has(c, '[data-cap="read_points"]')).toBe(false)
    expect(has(c, '[data-cap="reactions"]')).toBe(false)
  })
})

describe('store page body — order', () => {
  it('cover · rank · next · actions · intake · posts (mock phoneMarkup order)', () => {
    const c = mount([...ALL])
    const sel = ['.salon-cover', '.salon-rankfloat', '.salon-next', '.salon-acts', '[data-cap="intake"]', '[data-cap="posts"]']
    const nodes = sel.map((s) => c.querySelector(s)!)
    for (const n of nodes) expect(n).not.toBeNull()
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const acts = [...c.querySelectorAll('.salon-acts > *')].map((n) => n.textContent)
    expect(acts).toEqual(['予約する', '受付'])
  })
})
