/** @jest-environment jsdom */
// MenusSection catalog + list wiring (menu-catalog plan §3, PR-2/PR-3b).
// RENDERED-STRING assertions against the REAL messages/ja.json — the
// file-level i18n parity test can't see a call-site key typo or a blank-text
// path, and this list is where price honesty (band vs fixed) and load-failure
// honesty (an error must never read as 「メニューがまだありません」) actually
// reach the owner's eyes. PR-3b adds the entry points (create CTA, pressable
// active rows), the 再開 leg and the store filter.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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

const toastError = jest.fn()
const toastSuccess = jest.fn()
jest.mock('sonner', () => ({
  toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) },
}))

// The section now imports the write actions (and pulls the editor's in with
// it) — server-only modules that must never load in jsdom.
const reactivateMenu = jest.fn(async () => ({ ok: true }) as { ok: true } | { error: string })
jest.mock('@/actions/menus', () => ({
  createMenu: jest.fn(),
  updateMenu: jest.fn(),
  retireMenu: jest.fn(),
  reactivateMenu: (...args: unknown[]) => reactivateMenu(...(args as [])),
}))

import { MenusSection } from '@/components/settings/redesign/sections/MenusSection'
import type { Menu } from '@synqed-kk/client'
import type { StoreRow } from '@/actions/stores'

const BUSINESS = '6f1d0b26-3f5e-4a1e-9c62-8b0a4f21d7c3'
const EKIMAE = 'c4a9f0d7-2b83-4e51-9f6a-1d7c53e08b42'
const HONTEN = 'b2f70c19-4d6a-4f38-8e51-0c9b62a4f5d1'

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
// The second store — the store filter only exists for a business that has one.
const honten: StoreRow = { ...store, id: HONTEN, name: '本店（メイン）', isPrimary: true }
const TWO_STORES = [honten, store]

/** Realistic salon catalog in CORE's returned order (categories first appear
 *  カット → カラー → 【blank】 → トリートメント). The blank-category rows sit
 *  DELIBERATELY mid-list, not last: if they came last, "core order untouched"
 *  and "blank bucket moved last" would render identically and the 未分類-last
 *  assertions would pass without the reorder ever running.
 *  No impossible states: every floor ≤ its ceiling. */
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
  // ¥0 floor: free alongside another service, ¥1,100 on its own. A REAL band,
  // and the one price a falsy check would silently collapse to the ceiling.
  menu({
    id: '71e40a8f-c50b-4d29-8f7a-93c467b2adfc',
    name: '眉カット',
    category: 'カット',
    duration_minutes: 15,
    price_list_amount: 1100,
    price_min_amount: 0,
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
    id: '5fc28b6d-a3e9-40b7-9486-71a245f029da',
    name: '着付け',
    category: null,
    price_list_amount: 6600,
    online_visible: false,
  }),
  // Whitespace-only category — what a free-text category input produces when
  // staff type spaces and save (PR-3). Belongs in the blank bucket, not in a
  // group of its own headed by invisible characters.
  menu({
    id: '82f51b90-d61c-4e3a-9a8b-a4d578c3bedf',
    name: 'ヘアセット',
    category: '  ',
    duration_minutes: 40,
    price_list_amount: 3850,
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
    id: '4eb17a5c-92d8-4fa6-8375-609134ef18c9',
    name: 'ヘッドスパ',
    category: 'トリートメント',
    duration_minutes: 45,
    price_list_amount: 4400,
    store_id: EKIMAE,
  }),
  menu({
    id: '60d39c7e-b4fa-41c8-a597-82b356a13aeb',
    name: '縮毛矯正',
    category: 'ストレート',
    duration_minutes: 150,
    price_list_amount: 16500,
    active: false,
  }),
]

const ACTIVE_ONLY = CATALOG.filter((m) => m.active)
const RETIRED = CATALOG.find((m) => !m.active)!

/** Store-filter fixtures: every scope × both states, so the union rule
 *  (this store OR 全店舗) is provable on the ACTIVE list and the RETIRED one
 *  independently. */
const FILTER_CATALOG: Menu[] = [
  menu({ id: 'e9b60089-2676-440d-b26d-ac3d6b99e442', name: '全店カット', category: 'カット' }),
  menu({
    id: '5887c106-e88a-46d2-bfe2-84d94301d60f',
    name: '駅前トリートメント',
    category: 'トリートメント',
    store_id: EKIMAE,
  }),
  menu({
    id: '17ec70f3-b20b-483e-b163-52224f89e688',
    name: '本店ヘッドスパ',
    category: 'トリートメント',
    store_id: HONTEN,
  }),
  menu({
    id: '688cdb66-52a4-4cd4-becc-d18d01b34054',
    name: '駅前デジタルパーマ',
    duration_minutes: 120,
    price_list_amount: 13200,
    store_id: EKIMAE,
    active: false,
  }),
  menu({
    id: '940ac155-6eda-4825-8db6-efd26728fa20',
    name: '本店縮毛矯正',
    duration_minutes: 150,
    price_list_amount: 16500,
    store_id: HONTEN,
    active: false,
  }),
]

const filterSelect = () => screen.getByRole('combobox', { name: '店舗' })
const createButtons = () => screen.queryAllByRole('button', { name: '＋ メニューを追加' })

beforeEach(() => jest.clearAllMocks())

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

  it('a whitespace-only category joins 未分類 instead of heading its own group', () => {
    render(<MenusSection menus={CATALOG} stores={[store]} />)
    expect(screen.getByText('未分類').parentElement!.textContent).toContain('ヘアセット')
  })

  // Seat audit A2: 未分類 is plausible staff free text, so a REAL category can
  // carry the same label as the blank bucket. Keying the bucket by the
  // TRANSLATED label collided with it — duplicate React key, two groups
  // indistinguishable in intent. The bucket keys off a sentinel instead.
  it('a REAL category named 未分類 keeps its core position, the blank bucket still renders last, keys stay unique', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // 着付け sits mid-list, ahead of カット, so the blank bucket only ends up
      // last if the reorder actually runs.
      const colliding: Menu[] = [
        menu({
          id: '7f4a1e8b-c05d-4926-8a31-b6e7420cd913',
          name: 'シャンプー',
          category: '未分類',
        }),
        menu({ id: '9b6c3a0d-e27f-4148-ac53-d8091642ef35', name: '着付け', category: null }),
        menu({ id: '8a5b2f9c-d16e-4037-9b42-c7f8531de024', name: 'カット', category: 'カット' }),
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

      // Belt only, NOT the guard: React dedups duplicate-key warnings per key
      // signature, so in a full-file run an earlier render can have already
      // spent the warning and this spy stays silent on a real regression. The
      // WHICH-rows-under-WHICH-header assertions above are what actually
      // catches the A2 collision (a shared bucket renders both rows together).
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
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

  it('a ¥0 floor renders as a band, not collapsed to the single ceiling price', () => {
    render(<MenusSection menus={ACTIVE_ONLY} stores={[store]} />)
    expect(screen.getByText('¥0–¥1,100')).toBeTruthy()
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
  it('collapsed by default with the retired COUNT; expanding reveals the row + 停止中 chip', () => {
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

  // The end state of a catalog being closed down: everything retired, nothing
  // active. The list card must not render as an empty shell, and this is a
  // catalog WITH menus — never the 「まだありません」 empty state.
  it('every menu retired → disclosure only, no empty active card, no empty state', () => {
    const retiredOnly = CATALOG.filter((m) => !m.active)
    const { container } = render(<MenusSection menus={retiredOnly} stores={[store]} />)
    expect(screen.getByText('停止中のメニュー（1）')).toBeTruthy()
    expect(screen.queryByText('メニューがまだありません')).toBeNull()
    // Collapsed disclosure renders no panel, so the ONLY card that could exist
    // here is the active list's — and with zero active rows it must not.
    expect(container.querySelector('.rounded-xl.bg-card')).toBeNull()
  })
})

describe('MenusSection — empty vs load failure (data honesty)', () => {
  // PR-3b: the empty state keeps its text-only copy and GAINS the create CTA
  // (mock :618). While the catalog is empty that CTA owns create outright —
  // the header button is suppressed, so there is exactly ONE way to start.
  it('[] renders the text-only copy plus a single create CTA, with no header button beside it', () => {
    render(<MenusSection menus={[]} stores={[store]} />)
    expect(screen.getByText('メニューがまだありません')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '＋ メニューを追加' }).length).toBe(1)
    // No list chrome to press either — no rows, no disclosure, no filter.
    expect(screen.getAllByRole('button').length).toBe(1)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('null (fetch failed) renders the load error and NEVER the empty state', () => {
    render(<MenusSection menus={null} stores={[store]} />)
    expect(screen.getByText('メニューを読み込めませんでした')).toBeTruthy()
    expect(screen.queryByText('メニューがまだありません')).toBeNull()
  })
})

describe('MenusSection — create entry point (PR-3b)', () => {
  it('a non-empty catalog carries the header button and opens the editor in CREATE mode', () => {
    render(<MenusSection menus={CATALOG} stores={[store]} />)
    expect(createButtons().length).toBe(1)

    fireEvent.click(createButtons()[0])

    expect(screen.getByText('メニューを追加')).toBeTruthy()
    expect((screen.getByLabelText(/メニュー名/) as HTMLInputElement).value).toBe('')
  })

  it('a retired-only catalog is NOT empty — the header button stays', () => {
    render(<MenusSection menus={[RETIRED]} stores={[store]} />)
    expect(createButtons().length).toBe(1)
    expect(screen.queryByText('メニューがまだありません')).toBeNull()
  })

  it('a failed read offers no way to write — an error state must not invite a create', () => {
    render(<MenusSection menus={null} stores={[store]} />)
    expect(createButtons().length).toBe(0)
    expect(screen.queryByRole('combobox', { name: '店舗' })).toBeNull()
  })
})

describe('MenusSection — pressable ACTIVE rows, inert RETIRED rows', () => {
  it('clicking an active row opens the editor PREFILLED with that row', () => {
    render(<MenusSection menus={CATALOG} stores={[store]} />)
    fireEvent.click(screen.getByText('リタッチカラー'))

    expect(screen.getByText('メニューを編集')).toBeTruthy()
    expect((screen.getByLabelText(/メニュー名/) as HTMLInputElement).value).toBe('リタッチカラー')
    expect((screen.getByLabelText(/通常価格/) as HTMLInputElement).value).toBe('8800')
  })

  // Deliberate: a retired row's ONE action is 再開. Making the row pressable
  // would nest that button inside another and open an editor whose footer
  // offers メニューを停止… on an already-stopped menu.
  it('a retired row is not pressable and never opens the editor — 再開 is its only control', () => {
    render(<MenusSection menus={CATALOG} stores={[store]} />)
    fireEvent.click(screen.getByText('停止中のメニュー（1）'))

    expect(screen.getByText('縮毛矯正').closest('button')).toBeNull()
    expect(screen.getByRole('button', { name: '再開' })).toBeTruthy()

    fireEvent.click(screen.getByText('縮毛矯正'))
    expect(screen.queryByText('メニューを編集')).toBeNull()
  })
})

describe('MenusSection — 再開 (reactivate)', () => {
  /** A write the test resolves by hand — the only way to observe in-flight state. */
  function hangingReactivate() {
    let finish: (r: { ok: true }) => void = () => {}
    reactivateMenu.mockReturnValueOnce(
      new Promise<{ ok: true }>((res) => {
        finish = res
      }),
    )
    return async () => act(async () => { finish({ ok: true }) })
  }

  const openConfirm = () => {
    render(<MenusSection menus={CATALOG} stores={[store]} />)
    fireEvent.click(screen.getByText('停止中のメニュー（1）'))
    fireEvent.click(screen.getByRole('button', { name: '再開' }))
  }
  const confirmButton = () => screen.getByRole('button', { name: '再開する' }) as HTMLButtonElement

  it('renders the mock ② copy and holds the write back', () => {
    openConfirm()
    expect(screen.getByText('「縮毛矯正」を再開しますか？')).toBeTruthy()
    expect(
      screen.getByText('新しい予約の選択肢に戻ります。予約履歴・カルテは変わりません。'),
    ).toBeTruthy()
    expect(reactivateMenu).not.toHaveBeenCalled()
  })

  it('accepting calls reactivateMenu with THAT row id, toasts, and closes the confirm', async () => {
    openConfirm()
    fireEvent.click(confirmButton())

    await waitFor(() => expect(reactivateMenu).toHaveBeenCalledTimes(1))
    expect(reactivateMenu).toHaveBeenCalledWith(RETIRED.id)
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('再開しました'))
    await waitFor(() => expect(screen.queryByText('「縮毛矯正」を再開しますか？')).toBeNull())
  })

  it('cancelling closes the confirm and writes nothing', async () => {
    openConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByText('「縮毛矯正」を再開しますか？')).toBeNull())
    expect(reactivateMenu).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('both confirm buttons go inert while the write is in flight — no double-write', async () => {
    const settle = hangingReactivate()
    openConfirm()
    fireEvent.click(confirmButton())

    await waitFor(() => expect(confirmButton().disabled).toBe(true))
    expect((screen.getByRole('button', { name: 'キャンセル' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(confirmButton())
    expect(reactivateMenu).toHaveBeenCalledTimes(1)

    await settle()
  })

  it('a failed 再開 toasts the error and never claims success', async () => {
    reactivateMenu.mockResolvedValueOnce({ error: 'Could not reactivate menu: offline' })
    openConfirm()
    fireEvent.click(confirmButton())

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not reactivate menu: offline'),
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('MenusSection — store filter', () => {
  it('one store → no filter at all (a control with one real answer is dead chrome)', () => {
    render(<MenusSection menus={FILTER_CATALOG} stores={[store]} />)
    expect(screen.queryByRole('combobox', { name: '店舗' })).toBeNull()
  })

  it('an empty catalog gets no filter either — nothing to narrow', () => {
    render(<MenusSection menus={[]} stores={TWO_STORES} />)
    expect(screen.queryByRole('combobox', { name: '店舗' })).toBeNull()
  })

  it('two stores → 全店舗 plus one option per store, defaulting to 全店舗', () => {
    render(<MenusSection menus={FILTER_CATALOG} stores={TWO_STORES} />)
    expect((filterSelect() as HTMLSelectElement).value).toBe('')
    expect(
      [...(filterSelect() as HTMLSelectElement).options].map((o) => o.textContent),
    ).toEqual(['全店舗', '本店（メイン）', '駅前店'])
  })

  // The UNION rule, on both lists at once: 駅前店 keeps its own menus AND the
  // all-store ones (an all-store menu is bookable there), and drops 本店's.
  it('a store selection filters ACTIVE and RETIRED alike, and the retired COUNT follows', () => {
    render(<MenusSection menus={FILTER_CATALOG} stores={TWO_STORES} />)
    expect(screen.getByText('停止中のメニュー（2）')).toBeTruthy()

    fireEvent.change(filterSelect(), { target: { value: EKIMAE } })

    expect(screen.getByText('全店カット')).toBeTruthy()
    expect(screen.getByText('駅前トリートメント')).toBeTruthy()
    expect(screen.queryByText('本店ヘッドスパ')).toBeNull()

    expect(screen.getByText('停止中のメニュー（1）')).toBeTruthy()
    fireEvent.click(screen.getByText('停止中のメニュー（1）'))
    expect(screen.getByText('駅前デジタルパーマ')).toBeTruthy()
    expect(screen.queryByText('本店縮毛矯正')).toBeNull()
  })

  it('a filter that empties BOTH lists says so — never the 「まだありません」 empty state, and the header button stays', () => {
    const hontenOnly = FILTER_CATALOG.filter((m) => m.store_id === HONTEN)
    render(<MenusSection menus={hontenOnly} stores={TWO_STORES} />)

    fireEvent.change(filterSelect(), { target: { value: EKIMAE } })

    expect(screen.getByText('この店舗で利用できるメニューはありません')).toBeTruthy()
    expect(screen.queryByText('メニューがまだありません')).toBeNull()
    expect(createButtons().length).toBe(1)
    expect(screen.queryByText(/停止中のメニュー/)).toBeNull()
  })
})
