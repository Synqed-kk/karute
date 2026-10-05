/**
 * @jest-environment jsdom
 *
 * S105 round 5 — the bottom bar has no dead space. 105 of 290 field touches in
 * the bar hit no control. Each of the five controls now carries its grown touch
 * area as transparent `data-bar-hit` span(s) INSIDE itself (bottom-nav.tsx), so
 * the bar's only interactive elements are still the five controls and a touch
 * on a span is the control's own touch (tapActivation). jsdom has no layout:
 * geometry is proven by the Playwright grid (build-s105/tabfix/r5-proof).
 */
import { render, fireEvent } from '@testing-library/react'
import type { ReactNode, MouseEvent } from 'react'

const push = jest.fn()
const stopRecording = jest.fn()
const env = { path: '/appointments', rec: 'idle' as 'idle' | 'recording' }
jest.mock('@/i18n/navigation', () => ({
  usePathname: () => env.path,
  useRouter: () => ({ push, back: jest.fn() }),
  Link: ({
    href,
    children,
    onClick,
    ...rest
  }: { href: string; children: ReactNode; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void } & Record<
    string,
    unknown
  >) => (
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
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({ state: env.rec, startedAt: 0, stopRecording, target: null }),
}))

import { BottomNav } from '@/components/layout/bottom-nav'

const finger = [{ identifier: 1, clientX: 10, clientY: 10 }]
function tap(el: Element) {
  fireEvent.touchStart(el, { touches: finger, changedTouches: finger })
  fireEvent.touchEnd(el, { touches: [], changedTouches: finger })
  fireEvent.click(el, { detail: 1 })
}

const STATES = [
  { name: 'idle', path: '/appointments', rec: 'idle' },
  { name: 'recording, not on /sessions', path: '/appointments', rec: 'recording' },
  { name: 'recording on /sessions (stop)', path: '/sessions', rec: 'recording' },
] as const

beforeEach(() => {
  push.mockReset()
  stopRecording.mockReset()
})

describe.each(STATES)('bottom bar hit columns — $name', ({ path, rec }) => {
  beforeEach(() => Object.assign(env, { path, rec }))

  it('the five controls are the bar\'s only interactive elements, each with its own hit span(s)', () => {
    const { container } = render(<BottomNav nextCustomer={null} locale="ja" />)
    const nav = container.querySelector('nav[aria-label="Primary navigation"]')!
    const controls = Array.from(nav.querySelectorAll('a,button,[tabindex],[role="button"]'))
    expect(controls.map((c) => c.getAttribute('href') ?? c.getAttribute('aria-label') ?? c.getAttribute('aria-haspopup'))).toHaveLength(5)
    for (const c of controls) {
      const spans = Array.from(c.children).filter((h) => h.hasAttribute('data-bar-hit'))
      expect(spans.length).toBe(c.hasAttribute('data-bar-record') ? 2 : 1)
      for (const h of spans) {
        expect(h.tagName).toBe('SPAN')
        expect(h.getAttribute('aria-hidden')).toBe('true')
        expect(h.className).toMatch(/\babsolute\b/)
        expect(h.className).toMatch(/\bhidden pointer-coarse:block\b|\bpointer-coarse:block\b/)
      }
      // the span's containing block is the control itself
      expect(c.className).toMatch(/\brelative\b/)
    }
    // every hit span in the bar belongs to one of the five controls
    for (const h of nav.querySelectorAll('[data-bar-hit]')) expect(controls).toContain(h.parentElement)
  })

  it('a tap on each hit span activates its own control, once', () => {
    const { container } = render(<BottomNav nextCustomer={null} locale="ja" />)
    const nav = container.querySelector('nav[aria-label="Primary navigation"]')!
    for (const h of Array.from(nav.querySelectorAll('[data-bar-hit]'))) {
      push.mockReset()
      stopRecording.mockReset()
      const c = h.parentElement!
      tap(h)
      if (c.getAttribute('aria-haspopup') === 'menu') {
        expect(c.getAttribute('aria-expanded')).toBe('true')
        tap(h) // close again for the next span
        expect(c.getAttribute('aria-expanded')).toBe('false')
        expect(push).not.toHaveBeenCalled()
      } else if (c.hasAttribute('data-bar-record') && path === '/sessions') {
        expect(stopRecording).toHaveBeenCalledTimes(1)
        expect(push).not.toHaveBeenCalled()
      } else {
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(c.hasAttribute('data-bar-record') ? '/sessions' : c.getAttribute('href'))
      }
    }
  })
})
