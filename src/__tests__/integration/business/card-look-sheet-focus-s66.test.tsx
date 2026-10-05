/**
 * @jest-environment jsdom
 */
// ⚖ S66 R260 / P10 fix 2 (proof check 20) — WebKit does not focus a clicked button, so a pointer/tap open starts with
// focus on BODY. On close, focus returns to the sheet's TRIGGER itself however the sheet was opened.
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ReserveCardLookSection } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { PALETTE } from '@/business/lib/reserve-card/palette'

class RO { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO
afterEach(cleanup)

const section = () => (
  <ReserveCardLookSection
    look={{ storeLine: 'Test store', scopeLabel: 'all', value: PALETTE[0].hex, palette: PALETTE, practice: true }}
    value={PALETTE[0].hex}
    onPick={() => {}}
    reduced
    narrow
    render={(slots) => <div className="page pg-settings"><div className="st-read">{slots.main}{slots.viewButton}</div></div>}
  />
)
const dialog = () => document.querySelector('[role="dialog"]')
const btn = () => document.querySelector('.cl-viewbtn') as HTMLButtonElement
const closeBtn = () => document.querySelector('[role="dialog"] .cl-preview .st-sec-h .st-link') as HTMLButtonElement
const openFromBody = () => {
  ;(document.activeElement as HTMLElement | null)?.blur()
  expect(document.activeElement).toBe(document.body)
  fireEvent.click(btn()) // a pointer/tap open in WebKit: the button is NOT focused
  expect(dialog()).not.toBeNull()
}

describe('S66 P10 — the sheet gives focus back to its trigger', () => {
  it('f1 opened with focus on BODY, closed by 閉じる → focus is on the trigger', () => {
    render(section())
    openFromBody()
    fireEvent.click(closeBtn())
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(btn())
  })
  it('f2 opened with focus on BODY, closed by Esc → focus is on the trigger', () => {
    render(section())
    openFromBody()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(btn())
  })
  it('f3 a keyboard open (trigger focused) still returns to the trigger', () => {
    render(section())
    btn().focus()
    fireEvent.click(btn())
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(btn())
  })
})
