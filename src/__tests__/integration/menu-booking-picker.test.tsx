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
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'

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

const ZERO_RECT = { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0 }

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

/** A tap on the field — the way the staff opens the catalog (Liam 8/15). */
function openList() {
  fireEvent.click(serviceInput())
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
  it('opens on a tap with the full grouped catalog; 未分類 heads the null-category run', () => {
    openList()
    expect(listOptions()).toHaveLength(CATALOG.length)
    // One header per category RUN (カット/カラー/トリートメント/未分類), not per row.
    expect(groupHeaders()).toHaveLength(4)
    expect(groupHeaders()[3]).toHaveTextContent('未分類')
    // The listbox's accessible name is the only new key with no visible
    // string, so a wrong-but-present translation would otherwise ship.
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'メニュー候補')
  })

  it('focus alone never opens the list — a tap does', () => {
    // Dialog autofocus, a Tab into the field and the chip ×'s refocus all
    // arrive as bare focus. The list opens UPWARD over the 所要時間 row, so
    // opening on arrival hides a row nobody asked to hide (Liam 8/15).
    fireEvent.focus(serviceInput())
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(serviceInput())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
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

  it('hovering a row is the pointer’s only feedback, so it must set the active row', () => {
    openList()
    // React synthesises onMouseEnter from mouseover.
    fireEvent.mouseOver(optionRow('ヘッドスパ'))
    expect(optionRow('ヘッドスパ')).toHaveClass('bg-primary/8', 'text-primary')
    expect(serviceInput()).toHaveAttribute(
      'aria-activedescendant',
      optionRow('ヘッドスパ').id,
    )
  })

  it('marks the linked row for sighted AND assistive users when the list reopens', () => {
    pick('リタッチカラー')
    openList()
    expect(optionRow('リタッチカラー')).toHaveAttribute('aria-selected', 'true')
    expect(optionRow('カット')).toHaveAttribute('aria-selected', 'false')
    // Linked but not keyboard-active → the neutral marker, never the accent.
    expect(optionRow('リタッチカラー')).toHaveClass('bg-muted')
    expect(optionRow('リタッチカラー')).not.toHaveClass('bg-primary/8')

    // The R13 selected-state wash is what tells the staff where Enter lands.
    fireEvent.keyDown(serviceInput(), { key: 'ArrowDown' })
    expect(optionRow('カット')).toHaveClass('bg-primary/8', 'text-primary')
  })

  it('a tap on a category header or the no-results line never closes the list', () => {
    openList()
    // jsdom does not implement mousedown's focus side-effect, so the only
    // observable half is the preventDefault that stops the blur → focusout →
    // close → filter/scroll reset chain in a real browser.
    const header = groupHeaders()[0]
    const headerDown = createEvent.mouseDown(header)
    fireEvent(header, headerDown)
    expect(headerDown.defaultPrevented).toBe(true)

    fireEvent.change(serviceInput(), { target: { value: 'まつげパーマ' } })
    const empty = screen.getByText('該当するメニューはありません（自由入力できます）')
    const emptyDown = createEvent.mouseDown(empty)
    fireEvent(empty, emptyDown)
    expect(emptyDown.defaultPrevented).toBe(true)
  })

  it('caps the upward list so its top edge lands under the dialog title', () => {
    const title = document.querySelector('h2')!
    const field = serviceInput().parentElement!
    // jsdom has no layout — every rect reads 0, so the two the measurement
    // depends on are fed in and the rest keep the real (zero) implementation.
    const stubs = new Map<Element, Partial<DOMRect>>([
      [title, { bottom: 100 }],
      [field, { top: 416 }],
    ])
    const spy = jest
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const stub = stubs.get(this)
        return { ...ZERO_RECT, ...stub } as DOMRect
      })
    try {
      openList()
      // 416 (field top) − 100 (title bottom) − 16 (mb-1 + breathing room).
      expect(screen.getByRole('listbox').style.maxHeight).toBe('300px')

      // Re-measured as the list resizes under a filter — and with the title
      // scrolled out of the dialog the cap falls back to the viewport top.
      stubs.set(title, { bottom: -40 })
      fireEvent.change(serviceInput(), { target: { value: 'カット' } })
      expect(screen.getByRole('listbox').style.maxHeight).toBe('404px')
    } finally {
      spy.mockRestore()
    }
  })

  it('scrolls back to the top when the filter narrows the list', () => {
    const proto = Element.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollTop')!
    const set = jest.fn()
    // jsdom has no layout, so scrollTop never retains a value — spy the write.
    Object.defineProperty(proto, 'scrollTop', { ...original, set })
    try {
      openList()
      // A fresh open is free — the <ul> unmounts on close and rebuilds at 0.
      // Narrowing an ALREADY-scrolled open list is what the reset is for.
      set.mockClear()
      fireEvent.change(serviceInput(), { target: { value: 'カ' } })
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

  it('closing drops both ARIA IDREFs; a reopen restores aria-controls but not the highlight', () => {
    // Both point into the <ul>, which unmounts on close: a stale
    // activedescendant sends assistive tech to a removed id (Greptile #702),
    // and a stale aria-controls advertises a listbox that is no longer there.
    const input = serviceInput()
    openList()
    expect(input).toHaveAttribute(
      'aria-controls',
      screen.getByRole('listbox').id,
    )
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(input).not.toHaveAttribute('aria-controls')

    fireEvent.click(input)
    expect(input).toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
  })

  it('Enter after an Escape never picks the row the staff just backed out of', () => {
    const input = serviceInput()
    openList()
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // active = カット
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    // Escape deliberately leaves activeIndex alone, so the closed-list guard
    // is the only thing between "dismiss, then type my own wording, then
    // Enter to commit" and a silent re-link to the dismissed menu.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(serviceInput().value).toBe('')
    expect(chip('¥5,500')).toBeNull()
    expect(durationSelect().value).toBe('60')
  })

  it('typing after arrowing clears the highlight instead of stranding it', () => {
    const input = serviceInput()
    openList()
    fireEvent.keyDown(input, { key: 'ArrowUp' }) // last row, index 5
    expect(input).toHaveAttribute('aria-activedescendant')

    // The list collapses to 2 rows; a surviving index 5 would point
    // aria-activedescendant at an id that no longer exists and make Enter
    // resolve undefined — the key that just worked goes dead, silently.
    fireEvent.change(input, { target: { value: 'カット' } })
    expect(listOptions()).toHaveLength(2)
    expect(input).not.toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(serviceInput().value).toBe('カット')
    expect(chip('¥5,500')).toBeNull()
  })

  // Japanese input: Escape cancels a 変換 and Enter commits it, both delivered
  // to the field as ordinary keydowns. Consuming them here would close the list
  // on the conversion-cancel (so the staff's follow-up Escape reaches the
  // dialog and discards the booking) and pick a menu on the commit.
  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
  ])('keys delivered during an IME conversion are ignored (%s)', (_label, ime) => {
    const input = serviceInput()
    openList()

    fireEvent.keyDown(input, { key: 'ArrowDown', ...ime })
    expect(input).not.toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(input, { key: 'Escape', ...ime })
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter', ...ime })
    expect(serviceInput().value).toBe('')
    expect(chip('¥5,500')).toBeNull()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  // The dialog is a @base-ui/react Dialog and closes on Escape itself, so the
  // list-closing Escape must not reach it: dismissing a dropdown may never
  // throw away a half-entered booking. Needs its own mount — the shared
  // harness pins `open` with a no-op onOpenChange, which can see nothing.
  it('Escape closing the list never asks the dialog to close', () => {
    cleanup()
    const onOpenChange = jest.fn()
    render(
      <NewBookingDialog
        open
        onOpenChange={onOpenChange}
        customers={[CUSTOMER]}
        staff={STAFF}
        menus={CATALOG}
        initialClientId={CUSTOMER.id}
      />,
    )
    openList()
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(serviceInput(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()

    // Only the FIRST one is consumed — Escape on a closed list still closes
    // the dialog, which is what the staff means by then.
    fireEvent.keyDown(serviceInput(), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
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

  it('a same-value re-select of 所要時間 never arms touched', () => {
    // Real browsers do not fire change when the same <option> is re-picked,
    // but assistive tooling and any future controlled-select refactor can.
    // Once touched is armed by mistake the next pick stops prefilling and a
    // 120分 colour books into a 60分 slot with nothing on screen to explain it.
    setDuration('60')
    pick('フルカラー')
    expect(durationSelect().value).toBe('120')
  })

  it('revert-on-clear: an untouched duration goes back to its PRE-LINK value', () => {
    // 75 is neither the 60 default nor the 90 standard, so the revert target
    // is unambiguous. The hint tap re-arms touched, which is what makes a
    // non-default pre-link value reachable at all.
    setDuration('75')
    pick('リタッチカラー')
    fireEvent.click(hint()!)
    expect(durationSelect().value).toBe('90')

    // Only the FIRST link records the pre-link value: re-picking must not
    // re-baseline it to a duration the picker itself put there, or abandoning
    // the catalog restores 90 to a booking nobody chose 90 minutes for.
    pick('ヘッドスパ')
    expect(durationSelect().value).toBe('45')

    fireEvent.change(serviceInput(), { target: { value: 'リタッチカラーだけ' } })
    expect(durationSelect().value).toBe('75')
    expect(chip('¥4,400')).toBeNull()
    expect(serviceInput().value).toBe('リタッチカラーだけ')
    expect(reminder()).toBeInTheDocument()
    expect(screen.getByText('所要時間を75分に戻しました')).toBeInTheDocument()
  })

  it('the chip × reverts the same way, keeps the text and refocuses the field', () => {
    pick('リタッチカラー')
    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    expect(durationSelect().value).toBe('60')
    expect(serviceInput().value).toBe('リタッチカラー')
    expect(reminder()).toBeInTheDocument()
    // The revert is the one duration change nobody asked for, so it announces
    // too — the pill alone reaches only sighted staff.
    expect(screen.getByText('所要時間を60分に戻しました')).toBeInTheDocument()
    expect(document.activeElement).toBe(serviceInput())
  })

  it('the chip × hands focus back WITHOUT reopening the catalog over the pill', () => {
    pick('リタッチカラー')
    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    // The list opens UPWARD, so a reopen here would cover the 所要時間 select
    // and the 時間を確認 pill for the pill's whole 4-second life — the revert
    // safeguard would be invisible on its own primary trigger.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(serviceInput())
    expect(reminder()).toBeInTheDocument()

    // The refocused field is still a live picker — a deliberate open works.
    fireEvent.keyDown(serviceInput(), { key: 'ArrowDown' })
    expect(listOptions()).toHaveLength(CATALOG.length)
  })

  it('tapping the × with the catalog OPEN closes it, drops the link and refocuses the field', () => {
    // The test above enters with the list already CLOSED. Entering OPEN is the
    // harder case: the list is upward, so leaving it up parks it over the
    // 所要時間 row and the 時間を確認 pill for the pill's whole life. The closer
    // is MenuCombobox's document-level pointerdown listener — the × lives
    // outside its container — so the tap is simulated as a real one, pointerdown
    // before click, and not as the bare click jsdom would let pass.
    act(() => serviceInput().focus())
    openList()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(optionRow('リタッチカラー'))
    expect(screen.queryByRole('listbox')).toBeNull()
    // Reopen without re-focusing — the field never lost focus to begin with.
    fireEvent.click(serviceInput())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(document.activeElement).toBe(serviceInput())

    const unlink = screen.getByRole('button', { name: 'メニュー連携を解除' })
    fireEvent.pointerDown(unlink)
    fireEvent.click(unlink)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(chip('¥8,800')).toBeNull()
    expect(document.activeElement).toBe(serviceInput())
  })

  it('a revert that moves nothing neither nudges nor announces', () => {
    // カット's standard IS the 60分 default, so unlinking restores exactly what
    // is already on screen. Crying wolf here makes the real alarm above
    // cheaper to ignore.
    pick('カット')
    expect(durationSelect().value).toBe('60')
    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    expect(durationSelect().value).toBe('60')
    expect(reminder()).toBeNull()
    expect(screen.queryByText(/戻しました/)).toBeNull()
  })

  it('an identical repeat announcement still announces (the live region remounts)', () => {
    const liveText = () =>
      document.querySelector('[aria-live="polite"] span') as HTMLElement
    pick('リタッチカラー')
    const first = liveText()
    expect(first).toHaveTextContent('所要時間をメニュー標準の90分に設定しました')

    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    pick('リタッチカラー')
    const second = liveText()
    expect(second).toHaveTextContent('所要時間をメニュー標準の90分に設定しました')
    // Same text: only a fresh text node makes aria-live speak a second time.
    expect(second).not.toBe(first)
  })

  it('the pill sits in a fixed-height row and carries its dark-mode pair', () => {
    pick('リタッチカラー')
    fireEvent.click(screen.getByRole('button', { name: 'メニュー連携を解除' }))
    // Without the reserved height the select jogs down ~18px at the exact
    // moment the staff is reaching for it.
    expect(reminder()!.parentElement).toHaveClass('h-[18px]')
    // Every other amber warning wash in the app pairs light with dark.
    expect(reminder()).toHaveClass('dark:bg-amber-500/10', 'dark:text-amber-300')
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

  it('a DEGRADED refresh (empty catalog) keeps the picker on the last-good list', () => {
    // What the menuList mirror actually buys: the 60s cached read can fail
    // mid-entry and hand down []. Consuming the prop directly would swap the
    // field to the plain <Input> and yank the combobox out from under a
    // cursor that is mid-word.
    const { setMenus } = mount()
    fireEvent.change(serviceInput(), { target: { value: 'リタ' } })
    setMenus([])

    expect(serviceInput()).toHaveAttribute('role', 'combobox')
    expect(serviceInput().value).toBe('リタ')
    // Typing left the list open on its filter; dismiss it and tap again —
    // the catalog behind it is still the last-good one, not the empty prop.
    fireEvent.keyDown(serviceInput(), { key: 'Escape' })
    openList()
    expect(listOptions()).toHaveLength(CATALOG.length)
  })

  it('zero menus → the plain free-text field, no picker chrome', () => {
    mount([])
    const input = serviceInput()
    expect(input).not.toHaveAttribute('role', 'combobox')
    fireEvent.click(input)
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
