/**
 * @jest-environment jsdom
 */
// S49 P4b — the お店ページ preview body, part 2 (spec §E1 items 6, 7, 9-12 + D5 + D23) as BEHAVIOUR: each block by its
// key and the mock's count rule, the waitlist line only under a 満席 row while waitlist is ON, the わたしの記録 tabs
// (fallback to 来店履歴 when the open tab's key goes away), the photo line, empty states, and the mock's order.
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'

afterEach(cleanup)

const LA = STORES.laestro
const FORCE = STORES.force
type Sample = typeof LA | typeof FORCE

const el = (on: readonly string[], sample: Sample) => (
  <ReserveCardPreview name="X" storeLine="" cardColor={null} view="store" on={new Set(on)} sample={sample} />
)
const mount = (on: readonly string[], sample: Sample = LA) => render(el(on, sample))
const cap = (c: ParentNode, k: string) => c.querySelector(`[data-cap="${k}"]`)
const tabs = (c: ParentNode) => [...c.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
const selected = (c: ParentNode) => c.querySelector('[role="tab"][aria-selected="true"]')!.textContent
const panel = (c: ParentNode) => c.querySelector('[role="tabpanel"]')!.textContent
const tab = (c: ParentNode, name: string) => [...c.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!

describe('ご予約 upcoming rows (floor)', () => {
  it('La Estro lists both sample bookings with every switch OFF', () => {
    const { container: c } = mount([])
    expect(c.textContent).toContain('ご予約')
    expect(c.textContent).toContain('今日 14:30')
    expect(c.textContent).toContain('9月22日 14:00')
  })
  it('STUDIO FORCE (no bookings) draws no ご予約 block', () => {
    const { container: c } = mount([], FORCE)
    expect([...c.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('ご予約')
  })
})

describe('classes + waitlist', () => {
  it('classes ON with lessons: day pills, rows, 残り{n}枠 / 満席', () => {
    const { container: c } = mount(['classes'], FORCE)
    const block = cap(c, 'classes')!
    expect(block.textContent).toContain('今日 9/14明日 9/15火 9/16')
    expect(block.textContent).toContain('残り3枠')
    expect(block.textContent).toContain('満席')
    expect(block.textContent).toContain('残り1枠')
  })
  it('classes OFF, or 0 lessons, draws nothing', () => {
    expect(cap(mount([], FORCE).container, 'classes')).toBeNull()
    cleanup()
    expect(cap(mount(['classes', 'waitlist'], LA).container, 'classes')).toBeNull()
  })
  it('キャンセル待ちに登録 sits only under the 満席 row, only while waitlist is ON', () => {
    const { container: c } = mount(['classes', 'waitlist'], FORCE)
    const wl = c.querySelectorAll('[data-cap="waitlist"]')
    expect(wl).toHaveLength(1)
    expect(wl[0].textContent).toBe('キャンセル待ちに登録')
    expect(wl[0].closest('.salon-classes__row')!.textContent).toContain('バーベルベーシック')
    cleanup()
    expect(cap(mount(['classes'], FORCE).container, 'waitlist')).toBeNull()
  })
})

describe('shop + rental', () => {
  it('shop when ready: hint, three products, 注文する each', () => {
    const { container: c } = mount(['shop'])
    const block = cap(c, 'shop')!
    expect(block.querySelector('h2')!.textContent).toBe('ショップお店で受け取り')
    expect(block.textContent).toContain('リペアシャンプー 300ml')
    expect(block.textContent).toContain('￥4,180 税込')
    expect(block.textContent!.split('注文する')).toHaveLength(4)
  })
  it('shop with 0 products (FORCE) or OFF draws nothing', () => {
    expect(cap(mount(['shop'], FORCE).container, 'shop')).toBeNull()
    cleanup()
    expect(cap(mount([]).container, 'shop')).toBeNull()
  })
  it('rental needs the key, a resource count and lockers in the sample', () => {
    const { container: c } = mount(['rental'], FORCE)
    expect(cap(c, 'rental')!.textContent).toBe('ロッカー・レンタルロッカー（月額）空き 6/24 ・ ￥3,300 税込 / 月お申し込み')
    cleanup()
    expect(cap(mount(['rental'], LA).container, 'rental')).toBeNull()
    cleanup()
    expect(cap(mount([], FORCE).container, 'rental')).toBeNull()
  })
})

describe('わたしの記録 tabs (D23)', () => {
  it('来店履歴 always; 回数券 when packs ready; ホームケア when homecare ready', () => {
    expect(tabs(mount([]).container)).toEqual(['来店履歴'])
    cleanup()
    expect(tabs(mount(['packs', 'homecare']).container)).toEqual(['来店履歴', '回数券', 'ホームケア'])
    cleanup()
    expect(tabs(mount(['packs', 'homecare'], FORCE).container)).toEqual(['来店履歴', 'ホームケア'])
  })
  it('来店履歴 lists the visits + すべての来店履歴; badge and 税込 price', () => {
    const { container: c } = mount([])
    expect(selected(c)).toBe('来店履歴')
    expect(c.querySelectorAll('.visit-rows > div')).toHaveLength(5)
    expect(panel(c)).toContain('代官山院回数券VIP施術')
    expect(panel(c)).toContain('￥27,000 税込')
    expect(panel(c)).toContain('2026年9月7日（月） ・ 篠原 夢果 ・ 代官山院')
    expect(panel(c)).toContain('すべての来店履歴')
  })
  it('empty 来店履歴 prints the mock empty state with the sample line', () => {
    const { container: c } = mount([], FORCE)
    expect(panel(c)).toBe('まだ来店の記録はありませんレッスンにご参加いただくと、こちらに残ります')
  })
  it('clicking a tab switches the list', () => {
    const { container: c } = mount(['packs', 'homecare'])
    fireEvent.click(tab(c, '回数券'))
    expect(selected(c)).toBe('回数券')
    expect(panel(c)).toBe('VIP施術 10回券残り4回 ・ 有効期限 2027年2月28日')
    fireEvent.click(tab(c, 'ホームケア'))
    expect(panel(c)).toContain('頭皮マッサージ週3回 ・ 最後の記録 9月12日（土）')
  })
  it('the photo line follows photo_proof on every care row', () => {
    const r = mount(['homecare'])
    fireEvent.click(tab(r.container, 'ホームケア'))
    expect(panel(r.container)).not.toContain('写真で報告できます')
    r.rerender(el(['homecare', 'photo_proof'], LA))
    expect(panel(r.container).split(' ・ 写真で報告できます')).toHaveLength(3)
  })
  it('the open tab falls back to 来店履歴 when its key goes away, and stays there', () => {
    const r = mount(['packs', 'homecare'])
    fireEvent.click(tab(r.container, 'ホームケア'))
    r.rerender(el(['packs'], LA))
    expect(selected(r.container)).toBe('来店履歴')
    expect(panel(r.container)).toContain('すべての来店履歴')
    r.rerender(el(['packs', 'homecare'], LA))
    expect(selected(r.container)).toBe('来店履歴')
  })
})

describe('order + tab bar', () => {
  it('blocks keep the mock order (E1 6 → 12)', () => {
    const on = ['checkin_qr', 'packs', 'intake', 'classes', 'waitlist', 'posts', 'shop', 'rental', 'homecare']
    const kinds = (c: HTMLElement) =>
      [...c.querySelectorAll('[data-store-body] > div > h2, [data-store-body] h2, .salon-tabbar')]
        .map((h) => (h.classList.contains('salon-tabbar') ? 'TABBAR' : h.textContent))
    const la = kinds(mount(on).container)
    expect(la.filter((x, i) => la.indexOf(x) === i)).toEqual(['ご予約', 'お店からのお知らせ', 'ショップお店で受け取り', 'わたしの記録', 'TABBAR'])
    cleanup()
    const force = kinds(mount(on, FORCE).container)
    expect(force.filter((x, i) => force.indexOf(x) === i)).toEqual(['レッスンを予約', 'お店からのお知らせ', 'ロッカー・レンタル', 'わたしの記録', 'TABBAR'])
  })
  it('intake comes before ご予約, and the tab bar is the last thing after the body', () => {
    const { container: c } = mount(['intake'])
    const intake = cap(c, 'intake')!
    const booking = [...c.querySelectorAll('h2')].find((h) => h.textContent === 'ご予約')!
    expect(intake.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const bar = c.querySelector('.salon-tabbar')!
    expect(bar.previousElementSibling!.hasAttribute('data-store-body')).toBe(true)
    expect(bar.textContent).toBe('ホーム予約ためるマイページ')
  })
})
