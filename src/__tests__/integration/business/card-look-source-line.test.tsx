/**
 * @jest-environment jsdom
 */
// S40 1b-1 F4/F5 — カードの見た目's source line (mock #clSrc) as BEHAVIOUR, not source text: it speaks for
// the SAVED colour only (標準の色 · the empty sentence · the legacy sentence · nothing), never the unsaved
// pick and never a change date (core sends none); the two home notes show on ホーム only.
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ReserveCardLookSection, STAND_IN } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { PALETTE } from '@/business/lib/reserve-card/palette'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'

class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO
afterEach(cleanup)

const EMPTY = '色はまだ設定されていません。お客様のアプリのカードは、これまでどおりの色で表示されます。'
const LEGACY = '現在の色は、以前に設定された色で、12色には含まれていません。12色のどれかを選ぶまで、この設定は変わりません。'
const NOTE_1 = '見本では、編集中のお店を大きいカードにしています。実際のアプリでは、次のご予約が近いお店が大きいカードになります。'
const NOTE_2 = 'カードを開く動きは、この見本だけのものです。'

const mount = (saved: string | null, draft: string = saved ?? '') =>
  render(
    <ReserveCardLookSection
      look={{ businessName: 'Dev Salon', storeLine: 'テスト東京店', scopeLabel: '全店共通', value: saved, palette: PALETTE }}
      value={draft}
      onPick={() => {}}
      reduced
      render={({ main, preview }) => <>{main}{preview}</>}
    />,
  )
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
