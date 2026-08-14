/** @jest-environment jsdom */
// MenusSection read-only catalog (menu-catalog plan §3, PR-2). RENDERED-STRING
// assertions against the REAL messages/ja.json — the file-level i18n parity
// test can't see a call-site key typo or a blank-text path, and this list is
// where price honesty (band vs fixed) and load-failure honesty (an error must
// never read as 「メニューがまだありません」) actually reach the owner's eyes.
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const messages = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => {
      const value = `${ns}.${key}`
        .split('.')
        .reduce<unknown>(
          (acc, part) =>
            acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
          messages,
        )
      if (typeof value !== 'string') throw new Error(`missing ja message for key: ${ns}.${key}`)
      return value.replace(/\{(\w+)\}/g, (_m, p: string) => String(params?.[p] ?? `{${p}}`))
    },
  }
})

import { MenusSection } from '@/components/settings/redesign/sections/MenusSection'
import type { Menu } from '@synqed-kk/client'
import type { StoreRow } from '@/actions/stores'

const BUSINESS = '6f1d0b26-3f5e-4a1e-9c62-8b0a4f21d7c3'
const EKIMAE = 'c4a9f0d7-2b83-4e51-9f6a-1d7c53e08b42'

const store: StoreRow = {
  id: EKIMAE,
  name: '駅前店',
  address: null,
  phone: null,
  isPrimary: false,
  active: true,
  staffCount: 3,
  customerCount: 120,
  businessType: null,
}

/** Realistic salon catalog in CORE's returned order (categories first appear
 *  カット → カラー → トリートメント; the blank-category 着付け must render
 *  under 未分類 LAST). No impossible states: every floor ≤ its ceiling. */
function menu(over: Partial<Menu> & Pick<Menu, 'id' | 'name'>): Menu {
  return {
    business_id: BUSINESS,
    store_id: null,
    description: null,
    category: null,
    category_display_order: 0,
    display_order: 0,
    duration_minutes: 60,
    price_list_amount: 5500,
    price_min_amount: null,
    currency: 'JPY',
    tax_included: true,
    nomination_allowed: true,
    online_visible: true,
    active: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

const CATALOG: Menu[] = [
  menu({ id: '0a7d3c18-5e94-4b62-8f31-2c6d90ab74e5', name: 'カット', category: 'カット' }),
  menu({
    id: '1b8e4d29-6fa5-4c73-9042-3d7e01bc85f6',
    name: '前髪カット',
    category: 'カット',
    duration_minutes: 30,
    price_list_amount: 1100,
    nomination_allowed: false,
  }),
  menu({
    id: '2c9f5e3a-70b6-4d84-a153-4e8f12cd96a7',
    name: 'リタッチカラー',
    category: 'カラー',
    duration_minutes: 90,
    price_list_amount: 8800,
    price_min_amount: 6600,
  }),
  menu({
    id: '3da06f4b-81c7-4e95-b264-5f9023de07b8',
    name: 'トリートメント',
    category: 'トリートメント',
    duration_minutes: 45,
    price_list_amount: 5500,
    price_min_amount: 3300,
  }),
  menu({
    id: '4eb17a5c-92d8-4fa6-c375-609134ef18c9',
    name: 'ヘッドスパ',
    category: 'トリートメント',
    duration_minutes: 45,
    price_list_amount: 4400,
    store_id: EKIMAE,
  }),
  menu({
    id: '5fc28b6d-a3e9-40b7-d486-71a245f029da',
    name: '着付け',
    category: null,
    price_list_amount: 6600,
    online_visible: false,
  }),
  menu({
    id: '60d39c7e-b4fa-41c8-e597-82b356a13aeb',
    name: '縮毛矯正',
    category: 'カラー',
    duration_minutes: 150,
    price_list_amount: 16500,
    active: false,
  }),
]

const ACTIVE_ONLY = CATALOG.filter((m) => m.active)

describe('MenusSection — grouping (core order, 未分類 last)', () => {
  it('renders category headers in first-appearance order with 未分類 LAST', () => {
    const { container } = render(<MenusSection menus={CATALOG} stores={[store]} />)
    // Each group header precedes its own rows, so the first occurrence of a
    // category string in the rendered text IS its header position.
    const text = container.textContent ?? ''
    const at = (s: string) => text.indexOf(s)
    expect(at('カット')).toBeGreaterThan(-1)
    expect(at('カット')).toBeLessThan(at('カラー'))
    expect(at('カラー')).toBeLessThan(at('トリートメント'))
    expect(at('トリートメント')).toBeLessThan(at('未分類'))
  })

  it('places the blank-category menu under 未分類, not under a real category', () => {
    render(<MenusSection menus={CATALOG} stores={[store]} />)
    const group = screen.getByText('未分類').parentElement!
    expect(group.textContent).toContain('着付け')
    expect(group.textContent).not.toContain('カット')
  })

  // Seat audit A2: 未分類 is plausible staff free text, so a REAL category can
  // carry the same label as the blank bucket. Keying the bucket by the
  // TRANSLATED label collided with it — duplicate React key, two groups
  // indistinguishable in intent. The bucket keys off a sentinel instead.
  it('a REAL category named 未分類 keeps its core position, the blank bucket still renders last, keys stay unique', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const colliding: Menu[] = [
      menu({ id: '7f4a1e8b-c05d-4926-8a31-b6e7420cd913', name: 'シャンプー', category: '未分類' }),
      menu({ id: '8a5b2f9c-d16e-4037-9b42-c7f8531de024', name: 'カット', category: 'カット' }),
      menu({ id: '9b6c3a0d-e27f-4148-ac53-d8091642ef35', name: '着付け', category: null }),
    ]

    const { container } = render(<MenusSection menus={colliding} stores={[store]} />)

    // Two same-labeled headers is core-data truth, not a bug — what must hold
    // is WHICH rows sit under each and that the blank one stays last.
    const headers = screen.getAllByText('未分類')
    expect(headers.length).toBe(2)
    expect(headers[0].parentElement!.textContent).toContain('シャンプー')
    expect(headers[0].parentElement!.textContent).not.toContain('着付け')
    expect(headers[1].parentElement!.textContent).toContain('着付け')
    expect(headers[1].parentElement!.textContent).not.toContain('シャンプー')

    // Core order preserved: the real 未分類 appears first, カット next, the
    // blank bucket last.
    const text = container.textContent ?? ''
    expect(text.indexOf('シャンプー')).toBeLessThan(text.indexOf('カット'))
    expect(text.indexOf('カット')).toBeLessThan(text.indexOf('着付け'))

    // A duplicate React key surfaces here and nowhere else.
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('MenusSection — price honesty (band vs fixed)', () => {
  it('a menu with a floor renders the band; a menu without one renders the single price', () => {
    render(<MenusSection menus={ACTIVE_ONLY} stores={[store]} />)
    expect(screen.getByText('¥3,300–¥5,500')).toBeTruthy()
    expect(screen.getByText('¥6,600–¥8,800')).toBeTruthy()
    // カット is fixed at ¥5,500 — never rendered as a band.
    expect(screen.getByText('¥5,500')).toBeTruthy()
    expect(screen.queryByText('¥5,500–¥5,500')).toBeNull()
  })

  it('renders each row duration from the menu, not a default', () => {
    render(<MenusSection menus={ACTIVE_ONLY} stores={[store]} />)
    expect(screen.getAllByText('60分').length).toBe(2) // カット + 着付け
    expect(screen.getByText('30分')).toBeTruthy()
    expect(screen.getByText('90分')).toBeTruthy()
  })
})

describe('MenusSection — chips carry information only', () => {
  it('store-scoped rows chip the STORE NAME; all-store rows chip nothing', () => {
    render(<MenusSection menus={ACTIVE_ONLY} stores={[store]} />)
    expect(screen.getByText('駅前店')).toBeTruthy()
    expect(screen.queryByText('店舗限定')).toBeNull()
  })

  it('an unresolvable store (viewer without stores.viewAll) falls back to the generic label', () => {
    render(<MenusSection menus={ACTIVE_ONLY} stores={[]} />)
    expect(screen.getByText('店舗限定')).toBeTruthy()
    expect(screen.queryByText('駅前店')).toBeNull()
  })

  it('non-default flags chip; defaults stay silent', () => {
    render(<MenusSection menus={ACTIVE_ONLY} stores={[store]} />)
    expect(screen.getAllByText('オンライン非表示').length).toBe(1)
    expect(screen.getAllByText('指名不可').length).toBe(1)
  })
})

describe('MenusSection — 停止中 disclosure', () => {
  it('collapsed by default with the retired COUNT; expanding reveals the grayed row + 停止中 chip', () => {
    render(<MenusSection menus={CATALOG} stores={[store]} />)
    expect(screen.queryByText('縮毛矯正')).toBeNull()

    fireEvent.click(screen.getByText('停止中のメニュー（1）'))

    expect(screen.getByText('縮毛矯正')).toBeTruthy()
    expect(screen.getByText('停止中')).toBeTruthy()
    expect(screen.getByText('¥16,500')).toBeTruthy()
  })

  it('zero retired menus → no disclosure row at all', () => {
    render(<MenusSection menus={ACTIVE_ONLY} stores={[store]} />)
    expect(screen.queryByText('停止中のメニュー（0）')).toBeNull()
    expect(screen.queryByText(/停止中のメニュー/)).toBeNull()
  })
})

describe('MenusSection — empty vs load failure (data honesty)', () => {
  it('[] renders the text-only empty state (no create CTA in PR-2)', () => {
    render(<MenusSection menus={[]} stores={[store]} />)
    expect(screen.getByText('メニューがまだありません')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('null (fetch failed) renders the load error and NEVER the empty state', () => {
    render(<MenusSection menus={null} stores={[store]} />)
    expect(screen.getByText('メニューを読み込めませんでした')).toBeTruthy()
    expect(screen.queryByText('メニューがまだありません')).toBeNull()
  })
})
