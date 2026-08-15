/** @jest-environment jsdom */
// 予約 booking picker — MenuCombobox inside the real NewBookingDialog
// (menu-catalog plan §4, PR-4b). The R8 duration model is a six-rule state
// machine whose whole point is that nothing silently overwrites a staff
// decision, so every rule gets a test against the REAL dialog, rendered
// against the REAL ja.json (a call-site key typo throws here).
//
// The seam assertion (menuId reaching the action) rides a StrictMode render —
// lane law after the PR-3a double-invoke incident.
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.'))
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars?.[v] ?? `{${v}}`))
    },
  }
})
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))

// QuickCreateCustomer pulls next/cache in through the customers actions —
// unloadable under jsdom and irrelevant to the picker.
jest.mock('@/actions/customers', () => ({ createQuickCustomer: jest.fn() }))

const createAppointment = jest.fn(
  async () => ({ id: 'appt-1' }) as { id: string } | { error: string },
)
jest.mock('@/actions/appointments', () => ({
  createAppointment: (...args: unknown[]) => createAppointment(...(args as [])),
}))

import { NewBookingDialog } from '@/components/appointments/NewBookingDialog'
import type { CachedMenuOption } from '@/lib/menus/cached'

const EKIMAE = 'c4a9f0d7-2b83-4e51-9f6a-1d7c53e08b42'

function menu(over: Partial<CachedMenuOption> & Pick<CachedMenuOption, 'id' | 'name'>): CachedMenuOption {
  return {
    category: null,
    category_display_order: 0,
    display_order: 0,
    duration_minutes: 60,
    price_list_amount: 5500,
    price_min_amount: null,
    store_id: null,
    storeName: null,
    ...over,
  }
}

// Salon catalog in the pre-sorted order cached.ts hands down (category band →
// display order), 未分類 last.
const CUT = menu({
  id: '0a7d3c18-5e94-4b62-8f31-2c6d90ab74e5',
  name: 'カット',
  category: 'カット',
})
const BANGS = menu({
  id: '1b8e4d29-6fa5-4c73-9e42-3d7e01bc85f6',
  name: '前髪カット',
  category: 'カット',
  category_display_order: 1,
  display_order: 1,
  duration_minutes: 30,
  price_list_amount: 1100,
})
const RETOUCH = menu({
  id: '2c9f5e3a-70b6-4d84-a153-4e8f12cd96a7',
  name: 'リタッチカラー',
  category: 'カラー',
  category_display_order: 2,
  duration_minutes: 90,
  price_list_amount: 8800,
  price_min_amount: 6600,
})
const FULLCOLOR = menu({
  id: '3da06f4b-81c7-4e95-b264-5f9023de07b8',
  name: 'フルカラー',
  category: 'カラー',
  category_display_order: 2,
  display_order: 1,
  duration_minutes: 120,
  price_list_amount: 13200,
  price_min_amount: 9900,
})
const SPA = menu({
  id: '4eb17a5c-92d8-4fa6-8375-609134ef18c9',
  name: 'ヘッドスパ',
  category: 'トリートメント',
  category_display_order: 3,
  duration_minutes: 45,
  price_list_amount: 4400,
  store_id: EKIMAE,
  storeName: '駅前店',
})
const KITSUKE = menu({
  id: '5fc28b6d-a3e9-4b07-9486-71a245fc29d0',
  name: '着付け',
  category_display_order: 99,
  price_list_amount: 6600,
})
const CATALOG = [CUT, BANGS, RETOUCH, FULLCOLOR, SPA, KITSUKE]

const CUSTOMER = { id: 'cust-1', name: '佐藤 花子' }
const STAFF = [{ id: 'staff-1', name: '田中 美咲' }]

/** Re-mounts, so a test needing a different catalog just calls it again. */
function mount(menus: CachedMenuOption[] = CATALOG, strict = false) {
  cleanup()
  const ui = (open: boolean, m: CachedMenuOption[]) => {
    const dialog = (
      <NewBookingDialog
        open={open}
        onOpenChange={() => {}}
        customers={[CUSTOMER]}
        staff={STAFF}
        menus={m}
        initialClientId={CUSTOMER.id}
      />
    )
    return strict ? <StrictMode>{dialog}</StrictMode> : dialog
  }
  const view = render(ui(true, menus))
  return {
    reopen: () => {
      view.rerender(ui(false, menus))
      view.rerender(ui(true, menus))
    },
    setMenus: (m: CachedMenuOption[]) => view.rerender(ui(true, m)),
  }
}

const serviceInput = () => screen.getByPlaceholderText('施術内容') as HTMLInputElement
const durationSelect = () =>
  screen.getByRole('combobox', { name: /所要時間/ }) as HTMLSelectElement
const chip = (price: string) => screen.queryByText(`メニュー連携 ${price}`)
const hint = () => screen.queryByRole('button', { name: /メニュー標準/ })
const reminder = () => screen.queryByText('時間を確認')
// Scoped to the listbox — every <select> option in the dialog also carries
// role="option".
const listOptions = () => within(screen.getByRole('listbox')).queryAllByRole('option')
/** Matched on the name span so a group header of the same text can't win. */
const optionRow = (name: string) =>
  listOptions().find((el) => el.querySelector('.font-medium')?.textContent === name)!
const groupHeaders = () =>
  screen.getByRole('listbox').querySelectorAll('[role="presentation"]')

function openList() {
  fireEvent.focus(serviceInput())
}
function pick(name: string) {
  openList()
  fireEvent.mouseDown(optionRow(name))
}
function setDuration(value: string) {
  fireEvent.change(durationSelect(), { target: { value } })
}
function durationValues() {
  return Array.from(durationSelect().options).map((o) => o.value)
}

beforeEach(() => {
  jest.clearAllMocks()
  mount()
})

describe('MenuCombobox — list rendering', () => {
  it('opens on focus with the full grouped catalog; 未分類 heads the null-category run', () => {
    openList()
    expect(listOptions()).toHaveLength(CATALOG.length)
    // One header per category RUN (カット/カラー/トリートメント/未分類), not per row.
    expect(groupHeaders()).toHaveLength(4)
    expect(groupHeaders()[3]).toHaveTextContent('未分類')
  })

  it('renders duration + price on each row; a band menu shows the range', () => {
    openList()
    expect(optionRow('カット')).toHaveTextContent('カット · 60分 · ¥5,500')
    expect(optionRow('リタッチカラー')).toHaveTextContent(
      'リタッチカラー · 90分 · ¥6,600–¥8,800',
    )
  })

  it('shows the store chip on store-scoped rows only', () => {
    openList()
    expect(optionRow('ヘッドスパ')).toHaveTextContent('駅前店')
    expect(optionRow('カット')).not.toHaveTextContent('駅前店')
  })

  it('typing filters by name; no match shows the free-text line', () => {
    fireEvent.change(serviceInput(), { target: { value: 'カット' } })
    expect(listOptions()).toHaveLength(2)

    fireEvent.change(serviceInput(), { target: { value: 'まつげパーマ' } })
    expect(listOptions()).toHaveLength(0)
    expect(
      screen.getByText('該当するメニューはありません（自由入力できます）'),
    ).toBeInTheDocument()
  })

  it('keeps free text on outside-close and on focusout — nothing snaps back', () => {
    fireEvent.change(serviceInput(), { target: { value: '着付けと撮影' } })
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(serviceInput().value).toBe('着付けと撮影')

    openList()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.focusOut(serviceInput(), { relatedTarget: document.body })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(serviceInput().value).toBe('着付けと撮影')
  })

  it('opens UPWARD and leaves 保存 clickable while the list is open', async () => {
    openList()
    // Geometry is unobservable in jsdom; the positioning contract is the class
    // (メニュー is the last field — a downward list would sit over 保存), and
    // the behavioral half is that a save click still saves.
    expect(screen.getByRole('listbox').parentElement).toHaveClass('bottom-full')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    expect(createAppointment).toHaveBeenCalledTimes(1)
    // A click that had landed on an option would have filled the field.
    expect(serviceInput().value).toBe('')
  })

  it('resets the list scroll on every open', () => {
    const proto = Element.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollTop')!
    const set = jest.fn()
    // jsdom has no layout, so scrollTop never retains a value — spy the write.
    Object.defineProperty(proto, 'scrollTop', { ...original, set })
    try {
      openList()
      expect(set).toHaveBeenCalledWith(0)
    } finally {
      Object.defineProperty(proto, 'scrollTop', original)
    }
  })
})

describe('MenuCombobox — keyboard operability', () => {
  it('ArrowDown/ArrowUp track aria-activedescendant and Enter picks', () => {
    const input = serviceInput()
    openList()
    expect(input).not.toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const first = input.getAttribute('aria-activedescendant')
    expect(optionRow('カット')).toHaveAttribute('id', first)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    // Wraps to the last row (着付け, the 未分類 tail).
    expect(optionRow('着付け')).toHaveAttribute(
      'id',
      input.getAttribute('aria-activedescendant'),
    )

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(serviceInput().value).toBe('着付け')
    expect(chip('¥6,600')).toBeInTheDocument()
  })

  it('Escape closes without clearing the text, and the field reopens on click', () => {
    fireEvent.change(serviceInput(), { target: { value: 'カラー' } })
    fireEvent.keyDown(serviceInput(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(serviceInput().value).toBe('カラー')

    fireEvent.click(serviceInput())
    // Reopening drops the filter — the whole catalog is browsable again.
    expect(listOptions()).toHaveLength(CATALOG.length)
  })
})

describe('R8 duration model', () => {
  it('a pick fills the standard, shows the chip + hint, and announces', () => {
    pick('リタッチカラー')
    expect(serviceInput().value).toBe('リタッチカラー')
    expect(durationSelect().value).toBe('90')
    expect(chip('¥8,800')).toBeInTheDocument()
    expect(hint()).toHaveTextContent('メニュー標準: 90分')
    expect(
      screen.getByText('所要時間をメニュー標準の90分に設定しました'),
    ).toBeInTheDocument()
  })

  it('the chip carries the LIST price for a band menu (the row shows the range)', () => {
    pick('フルカラー')
    expect(chip('¥13,200')).toBeInTheDocument()
    expect(chip('¥9,900')).toBeNull()
  })

  it('the prefill never marks the duration touched — a re-pick refills', () => {
    pick('リタッチカラー')
    expect(durationSelect().value).toBe('90')
    pick('ヘッドスパ')
    expect(durationSelect().value).toBe('45')
    expect(chip('¥4,400')).toBeInTheDocument()
  })

  it('a touched duration survives the pick, the re-pick and the unlink', () => {
    setDuration('75')
    pick('リタッチカラー')
    expect(durationSelect().value).toBe('75')
    // No announce fires when touched blocked the fill.
    expect(screen.queryByText(/所要時間をメニュー標準の/)).toBeNull()
    // The hint still offers the standard even though nothing was filled.
    expect(hint()).toHaveTextContent('メニュー標準: 90分')

    pick('ヘッドスパ')
    expect(durationSelect().value).toBe('75')

    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    expect(durationSelect().value).toBe('75')
    expect(reminder()).toBeNull()
  })

  it('a manual edit after a touched duration keeps it and shows no nudge', () => {
    setDuration('45')
    setDuration('60') // back to the default value, but touched all the same
    pick('リタッチカラー')
    expect(durationSelect().value).toBe('60')

    fireEvent.change(serviceInput(), { target: { value: 'リタッチカラー+' } })
    expect(chip('¥8,800')).toBeNull()
    expect(durationSelect().value).toBe('60')
    // Nothing was reverted, so there is nothing to check.
    expect(reminder()).toBeNull()
  })

  it('revert-on-clear: an untouched duration goes back to its PRE-LINK value', () => {
    // 75 is neither the 60 default nor the 90 standard, so the revert target
    // is unambiguous. The hint tap re-arms touched, which is what makes a
    // non-default pre-link value reachable at all.
    setDuration('75')
    pick('リタッチカラー')
    fireEvent.click(hint()!)
    expect(durationSelect().value).toBe('90')

    fireEvent.change(serviceInput(), { target: { value: 'リタッチカラーだけ' } })
    expect(durationSelect().value).toBe('75')
    expect(chip('¥8,800')).toBeNull()
    expect(serviceInput().value).toBe('リタッチカラーだけ')
    expect(reminder()).toBeInTheDocument()
  })

  it('the chip × reverts the same way, keeps the text and refocuses the field', () => {
    pick('リタッチカラー')
    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    expect(durationSelect().value).toBe('60')
    expect(serviceInput().value).toBe('リタッチカラー')
    expect(reminder()).toBeInTheDocument()
    expect(document.activeElement).toBe(serviceInput())
  })

  it('the hint applies the standard and re-arms touched', () => {
    setDuration('75')
    pick('リタッチカラー')
    expect(durationSelect().value).toBe('75')

    fireEvent.click(hint()!)
    expect(durationSelect().value).toBe('90')
    expect(
      screen.getByText('所要時間をメニュー標準の90分に設定しました'),
    ).toBeInTheDocument()

    // Re-armed: the next pick fills again.
    pick('ヘッドスパ')
    expect(durationSelect().value).toBe('45')
  })

  // The hint-tap leg of the R2 lifecycle rule is unreachable by construction —
  // the nudge only ever shows while UNLINKED, and the hint only renders while
  // linked — so the code carries it and no test can drive it.
  it('the 時間を確認 nudge clears on a pick and on a manual duration change', () => {
    const clear = (next: () => void) => {
      pick('リタッチカラー')
      fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
      expect(reminder()).toBeInTheDocument()
      next()
      expect(reminder()).toBeNull()
    }
    clear(() => pick('カット'))
    clear(() => setDuration('45'))
  })

  it('it also times itself out', () => {
    jest.useFakeTimers()
    try {
      pick('リタッチカラー')
      fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
      expect(reminder()).toBeInTheDocument()
      act(() => {
        jest.advanceTimersByTime(4000)
      })
      expect(reminder()).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('duration option union', () => {
  it('adds the linked standard, drops it on unlink, and never blanks the select', () => {
    expect(durationValues()).toEqual(['30', '45', '60', '75', '90'])

    pick('フルカラー')
    expect(durationValues()).toEqual(['30', '45', '60', '75', '90', '120'])
    expect(durationSelect().value).toBe('120')

    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    expect(durationValues()).toEqual(['30', '45', '60', '75', '90'])
    expect(durationSelect().value).toBe('60')
  })

  it('keeps an off-list CURRENT value after the linked standard drops out', () => {
    pick('フルカラー')
    setDuration('45') // touched
    setDuration('120') // still offered while linked; the staff chose it
    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))

    expect(durationSelect().value).toBe('120')
    expect(durationValues()).toContain('120')
  })
})

describe('dialog lifecycle', () => {
  it('reopening clears the link, the chip, touched AND the duration', () => {
    const { reopen } = mount()
    setDuration('75')
    pick('フルカラー')
    expect(durationSelect().value).toBe('75')

    reopen()
    expect(serviceInput().value).toBe('')
    expect(chip('¥13,200')).toBeNull()
    expect(hint()).toBeNull()
    // Booking 2 never inherits booking 1's length…
    expect(durationSelect().value).toBe('60')
    // …and touched is re-armed, so the next pick fills.
    pick('リタッチカラー')
    expect(durationSelect().value).toBe('90')
  })

  it('a menus refresh while the dialog is OPEN cannot wipe an armed link', () => {
    const { setMenus } = mount()
    pick('リタッチカラー')
    setMenus([CUT])
    expect(chip('¥8,800')).toBeInTheDocument()
    expect(hint()).toHaveTextContent('メニュー標準: 90分')
  })

  it('zero menus → the plain free-text field, no picker chrome', () => {
    mount([])
    const input = serviceInput()
    expect(input).not.toHaveAttribute('role', 'combobox')
    fireEvent.focus(input)
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.change(input, { target: { value: '着付け' } })
    expect(input.value).toBe('着付け')
    expect(screen.queryByRole('button', { name: 'メニュー連携を解除' })).toBeNull()
  })
})

describe('save', () => {
  it('sends menuId for a linked booking (StrictMode)', async () => {
    mount(CATALOG, true)
    pick('リタッチカラー')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    expect(createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CUSTOMER.id,
        title: 'リタッチカラー',
        durationMinutes: 90,
        menuId: RETOUCH.id,
      }),
    )
  })

  it('sends no menuId for a free-text booking', async () => {
    fireEvent.change(serviceInput(), { target: { value: '着付けと撮影' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    expect(createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ title: '着付けと撮影', menuId: undefined }),
    )
  })

  it('drops menuId when the staff unlinks before saving', async () => {
    pick('リタッチカラー')
    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })
    expect(createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'リタッチカラー', menuId: undefined }),
    )
  })
})
