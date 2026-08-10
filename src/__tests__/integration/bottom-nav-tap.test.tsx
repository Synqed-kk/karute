/**
 * @jest-environment jsdom
 *
 * Bottom tab bar — touch activation (root-scroller momentum swallow, #648).
 *
 * On iOS WKWebView a tap that lands while the document still has scroll
 * momentum is consumed as "arrest the scroll": touchstart/touchend arrive but
 * the synthetic click NEVER does, so an onClick-only tab silently ignores the
 * tap (Liam, on device: "very often does not respond"). The bar now activates
 * on touchend and swallows the follow-up click when iOS does deliver one.
 *
 * The momentum swallow itself cannot be simulated in jsdom — these tests pin
 * the two halves of the contract instead: touchend activates, and the late
 * click never re-fires. Device verification stays the ground truth.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode, MouseEvent } from 'react'

let mockPathname = '/dashboard'
const push = jest.fn()
const stopRecording = jest.fn()
let recorderState: 'idle' | 'recording' = 'idle'

// Link mock mirroring BOTH real ports (thin/ports/nav.vite + next/link): run
// the caller's onClick, then navigate UNLESS the click was defaultPrevented.
// Navigation lands on the same `push` spy as router.push, so every assertion
// below counts total navigations however they were triggered.
jest.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push, back: jest.fn() }),
  Link: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string
    children: ReactNode
    onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  } & Record<string, unknown>) => (
    <a
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        e.preventDefault()
        push(href)
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({ state: recorderState, startedAt: null, stopRecording }),
}))

import { BottomNav } from '@/components/layout/bottom-nav'

// Movement/duration thresholds mirror src/lib/tap-activation.ts.
const AT = { clientX: 100, clientY: 700 }
/** The tracked finger. identifier 1 (not 0) so an off-by-index bug can't pass
 *  by accident. */
const ID = 1
function touch(over: Partial<typeof AT> = {}) {
  return [{ identifier: ID, ...AT, ...over }]
}
/** A second finger elsewhere on screen — a thumb on the frame, a palm. It
 *  rides in the SAME global touches list the handlers read. */
const OTHER = { identifier: 2, clientX: 20, clientY: 60 }

let now = 1_000_000
beforeEach(() => {
  mockPathname = '/dashboard'
  recorderState = 'idle'
  now = 1_000_000
  push.mockClear()
  stopRecording.mockClear()
  jest.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => jest.restoreAllMocks())

/** A finger down, then up `ms` later `dy` pixels away, optionally travelling
 *  through `via` offsets on the way. No click — the momentum case, where iOS
 *  never synthesises one. */
function tapNoClick(el: Element, { ms = 80, dy = 0, via = [] as number[] } = {}) {
  fireEvent.touchStart(el, { touches: touch(), changedTouches: touch() })
  for (const y of via) {
    const at = touch({ clientY: AT.clientY + y })
    fireEvent.touchMove(el, { touches: at, changedTouches: at })
  }
  now += ms
  const end = touch({ clientY: AT.clientY + dy })
  fireEvent.touchEnd(el, { touches: [], changedTouches: end })
}

const customersTab = () => screen.getByText('customers').closest('a')!
// The bar's メニュー toggle — `aria-haspopup` separates it from the sheet's
// own "Close menu" button, which shares the accessible name.
const menuButton = () => document.querySelector('button[aria-haspopup="menu"]')!

describe('bottom bar tap activation (#648 root-scroller momentum)', () => {
  it('a tap whose click iOS swallows still navigates (touchend activates)', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    tapNoClick(customersTab())
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/customers')
  })

  it('never double-fires when iOS DOES deliver the late click', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const tab = customersTab()
    tapNoClick(tab)
    fireEvent.click(tab)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('a drag past the 10px slop is a scroll, not a tap — and the click path still works', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const tab = customersTab()
    tapNoClick(tab, { dy: 24 })
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(tab)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/customers')
  })

  // Greptile r1 P1: classifying on the ENDPOINT alone let a drag that wandered
  // out and came back read as a tap. The cancel is sticky.
  it('a drag that wanders past the slop and RETURNS is still not a tap', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const tab = customersTab()
    // Out 40px, back to 2px from the origin, released 1px away, all inside
    // the 500ms window — endpoint-only classification called this a tap.
    tapNoClick(tab, { ms: 200, dy: 1, via: [40, 2] })
    expect(push).not.toHaveBeenCalled()
    // A cancelled gesture takes no swallow flag: if iOS synthesizes a click
    // anyway it falls through to the plain onClick path — exactly the pre-fix
    // behavior. (`defaultPrevented` proves nothing on an <a>: both Link ports
    // preventDefault on their NORMAL path too. The navigation landing is the
    // observable, and it is zero when the flag wrongly swallows.)
    fireEvent.click(tab)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/customers')
  })

  it('small jitter inside the slop throughout is still a tap', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    tapNoClick(customersTab(), { via: [4, -3, 2] })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/customers')
  })

  // Delta-verify P2: every TouchList on the event is GLOBAL. A second finger
  // anywhere on screen rides in it, so reading index 0 read the WRONG finger.
  // Each of these puts OTHER at index 0 deliberately.
  it('a second finger elsewhere does not cancel a stationary tap', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const tab = customersTab()
    fireEvent.touchStart(tab, { touches: touch(), changedTouches: touch() })
    // Thumb lands on the frame; our finger has not moved a pixel.
    fireEvent.touchMove(tab, {
      touches: [OTHER, ...touch()],
      changedTouches: [OTHER],
    })
    now += 80
    fireEvent.touchEnd(tab, { touches: [], changedTouches: touch() })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/customers')
  })

  it('the TRACKED finger moving past the slop still cancels, second finger present', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const tab = customersTab()
    fireEvent.touchStart(tab, { touches: touch(), changedTouches: touch() })
    const moved = touch({ clientY: AT.clientY + 40 })
    fireEvent.touchMove(tab, { touches: [OTHER, ...moved], changedTouches: moved })
    now += 80
    fireEvent.touchEnd(tab, { touches: [], changedTouches: touch({ clientY: AT.clientY + 1 }) })
    expect(push).not.toHaveBeenCalled()
  })

  it('a simultaneous two-finger lift classifies on the tracked finger, not changedTouches[0]', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const tab = customersTab()
    fireEvent.touchStart(tab, { touches: touch(), changedTouches: touch() })
    now += 80
    // Both fingers leave in one event, ours second in the list.
    fireEvent.touchEnd(tab, { touches: [], changedTouches: [OTHER, ...touch()] })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/customers')
  })

  it('a long hold past 500ms is not a tap — and the click path still works', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const tab = customersTab()
    tapNoClick(tab, { ms: 900 })
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(tab)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('mouse-only click still navigates (web/desktop path untouched)', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    fireEvent.click(customersTab())
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/customers')
  })

  // A late click on the TOGGLE ITSELF is swallowed by the per-element flag.
  // That is not the Chromium ghost-close measured on 8/10 — there the compat
  // click is hit-tested at dispatch time and lands on the SCRIM, an element
  // this flag can never see. That case is pinned in
  // tap-activation-compat-click.test.tsx, at the touchend that prevents it.
  it('menu toggle: a late click on the same button does not toggle it back shut', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const btn = menuButton()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    tapNoClick(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(btn) // the late synthetic click must not toggle it shut
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('menu-sheet items activate on touchend and never navigate twice', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const item = screen.getByText('settings').closest('a')!
    tapNoClick(item)
    fireEvent.click(item)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/settings')
  })

  // Dismiss controls: same fixed/root-scroller context, same swallowed click.
  // "Menu won't close" is the same bug wearing a different hat.
  //
  // Both dismisses are idempotent, so "did the late click re-fire?" cannot be
  // observed through state — a second setMenuOpen(false) looks identical.
  // The close button is checked directly instead: fireEvent returns false when
  // the event was defaultPrevented, which IS the swallow. The scrim unmounts
  // with the menu, so no late click can reach it at all — touchend is the only
  // half there is to pin.
  it('scrim: one tap dismisses the menu (touchend, no click needed)', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const toggle = menuButton()
    tapNoClick(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    tapNoClick(document.querySelector('.fixed.inset-0')!)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('sheet close button: one tap dismisses, and the late click is swallowed', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const toggle = menuButton()
    tapNoClick(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const close = screen.getByRole('button', { name: 'Close menu' })
    tapNoClick(close)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // false = defaultPrevented = the swallow fired.
    expect(fireEvent.click(close)).toBe(false)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('stop-recording: one tap stops exactly once', () => {
    recorderState = 'recording'
    mockPathname = '/sessions'
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const stop = screen.getByRole('button', { name: '録音を停止' })
    tapNoClick(stop)
    expect(stopRecording).toHaveBeenCalledTimes(1)
    fireEvent.click(stop)
    expect(stopRecording).toHaveBeenCalledTimes(1)
  })
})
