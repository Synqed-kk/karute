/**
 * @jest-environment jsdom
 *
 * Business 顧客 screen — interaction-parity tests for five of the six WO-1b
 * gap closures (PACKET-PARITY-WAVE-2026-08-19 ADDENDUM 2: "RTL user-event
 * tests are the machine check for interaction parity (focus handoff,
 * Escape/outside-click close, backdrop close, state flips) ... the six
 * WO-1b gap closures get theirs via the branch-1 micro-fix"). The sixth gap
 * (表示する列 refuses to hide the last column) is already covered by
 * foundation.test.ts's `toggleColumn` unit test (added in the same commit
 * that closed the gap) — not duplicated here.
 *
 * Territory's import fence (business-isolation.test.ts) allows only
 * react/next/node specifiers inside `src/__tests__/integration/business/` —
 * no @testing-library/* package resolves to any of those, so this suite
 * cannot render CustomersScreen with a DOM renderer (react-dom is off the
 * allowlist by the same rule). Instead, the five DOM-touching handlers
 * (search matching, clear+refocus, popover open/Escape/outside-click,
 * create-dialog open, backdrop close) are exported from CustomersScreen.tsx
 * as small functions parameterized on real DOM nodes — the same pattern
 * already used for `toggleColumn` — and exercised here with plain jsdom
 * (globals only, zero extra imports: `document`/`HTMLElement`/events all
 * come from the `@jest-environment jsdom` runtime, not a package).
 *
 * jsdom 20 (this repo's pin) ships no HTMLDialogElement.showModal/close —
 * added in a later jsdom major — so the two dialog tests polyfill just
 * enough of the native contract (the `open` boolean flipping); `open`
 * itself is already a normal reflected attribute in jsdom 20.
 */
import { wireColumnsPopover } from '@/business/lib/column-config'
import {
  matchesCustomerSearch,
  clearSearch,
  openCreateDialog,
  closeOnBackdropClick,
  type CustomerRow,
} from '@/app/[locale]/(business)/business/customers/CustomersScreen'

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.open = true
  }
}
if (typeof HTMLDialogElement.prototype.close !== 'function') {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    this.open = false
  }
}

function row(overrides: Partial<CustomerRow> & Pick<CustomerRow, 'id' | 'no' | 'name'>): CustomerRow {
  return {
    furigana: null,
    mark: overrides.name.slice(0, 2),
    phone: null,
    email: null,
    source: '店頭登録',
    identityCheck: null,
    storeLabel: null,
    groupKey: '',
    hasNext: false,
    nextLabel: 'なし',
    nextMenu: '予約なし',
    nextDetail: '次回予約なし',
    nextPrice: '予約確定後に記録',
    ticket: null,
    wallet: null,
    lastVisitShort: null,
    lastVisitFull: null,
    totalSpent: null,
    consent: null,
    lineLinked: false,
    merge: 'none',
    party: [],
    thin: false,
    externalOwner: false,
    note: null,
    history: [],
    bookings: [],
    ...overrides,
  }
}

describe('顧客 screen — interaction parity (WO-1b gap closures)', () => {
  it('search finds a customer by email (gap #1)', () => {
    const findableByEmail = row({
      id: 'c2',
      no: 'C-0002',
      name: '見本 次郎',
      email: 'jiro-unique@example.com',
    })
    const other = row({ id: 'c1', no: 'C-0001', name: '見本 花子' })

    expect(matchesCustomerSearch(findableByEmail, 'jiro-unique')).toBe(true)
    expect(matchesCustomerSearch(other, 'jiro-unique')).toBe(false)
    // Case-insensitive, same as canon's own .toLowerCase() compare.
    expect(matchesCustomerSearch(findableByEmail, 'JIRO-UNIQUE')).toBe(true)
  })

  it('検索をクリア clears the state and puts the caret back in the box (gap #2)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const setSearch = jest.fn()

    clearSearch(input, setSearch)

    expect(setSearch).toHaveBeenCalledWith('')
    expect(document.activeElement).toBe(input)
  })

  it('表示する列 popover focuses the first checkbox on open (gap #4)', () => {
    const pop = document.createElement('div')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    pop.appendChild(checkbox)
    const trigger = document.createElement('button')
    document.body.append(pop, trigger)

    wireColumnsPopover(pop, trigger, jest.fn())

    expect(document.activeElement).toBe(checkbox)
  })

  it('表示する列 popover closes on Escape and hands focus back to the button (gap #4)', () => {
    const pop = document.createElement('div')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    pop.appendChild(checkbox)
    const trigger = document.createElement('button')
    document.body.append(pop, trigger)
    const onClose = jest.fn()

    wireColumnsPopover(pop, trigger, onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  it('表示する列 popover closes on an outside click but not on a click inside it or the button (gap #4)', () => {
    const pop = document.createElement('div')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    pop.appendChild(checkbox)
    const trigger = document.createElement('button')
    const outside = document.createElement('div')
    document.body.append(pop, trigger, outside)
    const onClose = jest.fn()

    const cleanup = wireColumnsPopover(pop, trigger, onClose)

    // Inside the popover: no close.
    checkbox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    // On the trigger itself: no close (its own click stays a toggle).
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    // Anywhere else: closes and hands focus back.
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })

  it('顧客を追加 opens the create dialog cleared, with 氏名 focused (gap #5)', () => {
    const dialog = document.createElement('dialog')
    dialog.innerHTML = `
      <form>
        <input name="name" />
        <input name="phone" />
      </form>
    `
    const nameInput = dialog.querySelector('input[name="name"]') as HTMLInputElement
    nameInput.value = '打鍵確認' // simulates a previous, uncleared typed value
    document.body.appendChild(dialog)

    openCreateDialog(dialog)

    expect(dialog.open).toBe(true)
    expect(nameInput.value).toBe('') // form.reset() cleared it
    expect(document.activeElement).toBe(nameInput)
  })

  it('a backdrop click closes the create dialog, a click on its content does not (gap #6)', () => {
    const dialog = document.createElement('dialog')
    const content = document.createElement('div')
    dialog.appendChild(content)
    document.body.appendChild(dialog)
    dialog.showModal()

    closeOnBackdropClick(content, dialog) // click landed on dialog content
    expect(dialog.open).toBe(true)

    closeOnBackdropClick(dialog, dialog) // click landed on the dialog element itself
    expect(dialog.open).toBe(false)
  })
})
