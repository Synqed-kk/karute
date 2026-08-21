/**
 * @jest-environment jsdom
 *
 * Business sidebar 店舗切替 — the popover behavior the ⚖ 8/20 switcher replaced
 * the three pills with (store-switch-mock.html): the current row takes focus on
 * open, Escape and an outside click both close it and hand focus back to the
 * store card, and a click inside the panel or on the card itself does not.
 *
 * Same house pattern as customers-screen-interactions.test.ts: territory's
 * import fence allows only react/next/node specifiers here, so no renderer
 * (@testing-library/*, react-dom) resolves. The handler is exported from
 * BusinessSidebar.tsx parameterized on real DOM nodes and exercised with plain
 * jsdom globals — zero extra imports.
 */
import { wireStorePicker } from '@/app/[locale]/(business)/BusinessSidebar'

/** The panel the sidebar renders: two rows, the current one carrying
 *  aria-current="true" exactly as the switcher marks it. */
function panel(currentIndex: number) {
  const pop = document.createElement('div')
  const rows = ['テスト銀座店', 'テスト代官山店'].map((name, i) => {
    const a = document.createElement('a')
    a.className = 'store-opt'
    a.href = `/ja/business/customers?store=s${i + 1}`
    a.textContent = name
    if (i === currentIndex) a.setAttribute('aria-current', 'true')
    pop.appendChild(a)
    return a
  })
  const card = document.createElement('button')
  const outside = document.createElement('div')
  document.body.append(pop, card, outside)
  return { pop, rows, card, outside }
}

describe('サイドバー 店舗切替 — popover behavior', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the CURRENT store row on open, not merely the first', () => {
    const { rows, pop, card } = panel(1)

    wireStorePicker(pop, card, jest.fn())

    expect(document.activeElement).toBe(rows[1])
  })

  it('falls back to the first row when nothing is marked current', () => {
    const { rows, pop, card } = panel(-1)

    wireStorePicker(pop, card, jest.fn())

    expect(document.activeElement).toBe(rows[0])
  })

  it('closes on Escape and hands focus back to the store card', () => {
    const { pop, card } = panel(0)
    const onClose = jest.fn()

    wireStorePicker(pop, card, onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(card)
  })

  it('ignores keys that are not Escape', () => {
    const { pop, card } = panel(0)
    const onClose = jest.fn()

    wireStorePicker(pop, card, onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on an outside click but not on a click inside the panel or on the card', () => {
    const { pop, rows, card, outside } = panel(0)
    const onClose = jest.fn()

    const cleanup = wireStorePicker(pop, card, onClose)

    rows[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    // The card's own click stays a toggle — closing here would reopen it.
    card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(card)

    cleanup()
  })

  it('the cleanup unhooks both listeners — a closed panel cannot be closed twice', () => {
    const { pop, card, outside } = panel(0)
    const onClose = jest.fn()

    wireStorePicker(pop, card, onClose)()

    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onClose).not.toHaveBeenCalled()
  })
})
