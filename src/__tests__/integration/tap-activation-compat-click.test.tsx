/**
 * @jest-environment jsdom
 *
 * tapActivation — suppressing the compatibility click (Chromium ghost close).
 *
 * Measured on device 2026-08-10 (Chrome 151 / Galaxy S24 and the Capacitor
 * WebView): tapping メニュー opened the sheet for ~14ms and it closed itself.
 * Chromium hit-tests the compatibility click at DISPATCH time — ~20ms after
 * touchend — so it landed on the full-viewport scrim that `activate()` had
 * just mounted under the finger, not on the button that was tapped. The
 * scrim's own tap path then closed the menu. tapActivation's swallow flag is
 * per-element and could not see it; WebKit targets the touchstart-time
 * element, which is why iPhone never showed the bug.
 *
 * The fix suppresses that click at source: preventDefault on the accepted
 * tap's touchend. jsdom cannot model Chromium's hit-testing, so what is pinned
 * here is the contract that produces the fix — the touchend of an accepted tap
 * ends up defaultPrevented, and a rejected one does not. Device verification
 * stays the ground truth.
 */
import { render, screen, fireEvent, createEvent } from '@testing-library/react'
import type { ReactNode, MouseEvent } from 'react'
import { tapActivation } from '@/lib/tap-activation'

const push = jest.fn()

// Same Link mock as bottom-nav-tap.test.tsx: mirrors both real ports
// (thin/ports/nav.vite + next/link) — run the caller's onClick, then navigate
// unless the click was defaultPrevented.
jest.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard',
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
  useGlobalRecorder: () => ({ state: 'idle', startedAt: null, stopRecording: jest.fn() }),
}))

import { BottomNav } from '@/components/layout/bottom-nav'

const AT = { clientX: 100, clientY: 700 }
const ID = 1
function touch(over: Partial<typeof AT> = {}) {
  return [{ identifier: ID, ...AT, ...over }]
}

let now = 1_000_000
beforeEach(() => {
  now = 1_000_000
  push.mockClear()
  jest.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => jest.restoreAllMocks())

/** Runs a tap through React's REAL event system and hands back the native
 *  touchend so its `cancelable`/`defaultPrevented` can be read directly —
 *  the assumption under the fix is that React does not attach touchend
 *  passively, so a preventDefault there actually sticks. */
function tapReturningTouchEnd(el: Element, { dy = 0, via = [] as number[] } = {}) {
  fireEvent.touchStart(el, { touches: touch(), changedTouches: touch() })
  for (const y of via) {
    const at = touch({ clientY: AT.clientY + y })
    fireEvent.touchMove(el, { touches: at, changedTouches: at })
  }
  now += 80
  const end = touch({ clientY: AT.clientY + dy })
  const ev = createEvent.touchEnd(el, { touches: [], changedTouches: end })
  fireEvent(el, ev)
  return ev
}

describe('tapActivation — compatibility-click suppression', () => {
  it('an accepted tap leaves its touchend defaultPrevented (no compat click can follow)', () => {
    const activate = jest.fn()
    render(
      <button type="button" data-testid="probe" {...tapActivation(activate)}>
        tap me
      </button>,
    )
    const ev = tapReturningTouchEnd(screen.getByTestId('probe'))
    // The premise: an engine can only be told to skip the compat click if the
    // event was cancelable in the first place.
    expect(ev.cancelable).toBe(true)
    expect(ev.defaultPrevented).toBe(true)
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('a rejected tap (past the 10px slop) neither activates nor preventDefaults', () => {
    const activate = jest.fn()
    render(
      <button type="button" data-testid="probe" {...tapActivation(activate)}>
        tap me
      </button>,
    )
    const ev = tapReturningTouchEnd(screen.getByTestId('probe'), { dy: 24 })
    expect(activate).not.toHaveBeenCalled()
    // A scroll must keep every default it had — the touch path only ever
    // cancels a gesture it has already classified as a tap.
    expect(ev.defaultPrevented).toBe(false)
  })

  it('メニュー: the tap opens the sheet and cancels its own compat click', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const btn = document.querySelector('button[aria-haspopup="menu"]')!
    const ev = tapReturningTouchEnd(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    // The scrim that Chromium's late click was landing on is mounted by now —
    // this is the element the ghost close came from.
    expect(document.querySelector('.fixed.inset-0')).not.toBeNull()
    // …and the click that would have hit it never gets dispatched, because the
    // tap that mounted it cancelled its own compat click.
    expect(ev.defaultPrevented).toBe(true)
  })

  it('a real click on the scrim still closes the menu (dismiss is not collateral)', () => {
    render(<BottomNav nextCustomer={null} locale="ja" />)
    const btn = document.querySelector('button[aria-haspopup="menu"]')!
    tapReturningTouchEnd(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(document.querySelector('.fixed.inset-0')!)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })
})
