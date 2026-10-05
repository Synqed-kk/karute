/**
 * @jest-environment jsdom
 *
 * S105 round 5 — the bottom bar has no dead space. 105 of 290 field touches in
 * the bar hit no control. Each of the five controls now carries its grown touch
 * area as transparent `data-bar-hit` span(s) INSIDE itself (bottom-nav.tsx), so
 * the bar's only interactive elements are still the five controls and a touch
 * on a span is the control's own touch (tapActivation). jsdom has no layout:
 * the geometry is PINNED BY EXACT CLASS STRINGS below (S106 R5), not by a
 * layout check — any change to an offset, z-index, the safe-area strips, the
 * slop, the row-cap variable or `hidden` fails here; whether those classes
 * still lay out contiguously is proven by the Playwright grid outside CI.
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
      expect(spans.length).toBe(controls.indexOf(c) !== 2 ? 1 : path === '/sessions' ? 0 : 2)
      for (const h of spans) {
        expect(h.tagName).toBe('SPAN')
        expect(h.getAttribute('aria-hidden')).toBe('true')
        expect(h.className).toMatch(/\babsolute\b/)
      }
      // the span's containing block is the control itself
      expect(c.className).toMatch(/\brelative\b/)
    }
    // every hit span in the bar belongs to one of the five controls
    for (const h of nav.querySelectorAll('[data-bar-hit]')) expect(controls).toContain(h.parentElement)
  })

  it('every hit span carries exactly its pinned classes (geometry pinned by class strings)', () => {
    const { container } = render(<BottomNav nextCustomer={null} locale="ja" />)
    const nav = container.querySelector('nav[aria-label="Primary navigation"]')!
    const controls = Array.from(nav.querySelectorAll('a,button'))
    const got = controls.map((c) =>
      Array.from(c.children)
        .filter((h) => h.hasAttribute('data-bar-hit'))
        .map((h) => h.className),
    )
    const tab = (edge: string) =>
      `absolute -top-px bottom-[calc(-1*env(safe-area-inset-bottom))] z-[1] hidden pointer-coarse:block ${edge}`
    const capEdge = 'calc(-8px_-_max(0px,(100vw_-_var(--breakpoint-sm))/2))'
    const record =
      path === '/sessions' && rec === 'recording'
        ? [] // the stop button keeps its own size (S106 R2)
        : [
            'absolute -left-3 -right-3 -top-3 hidden h-[19px] pointer-coarse:block',
            'absolute -left-16 -right-16 top-[7px] bottom-[calc(-44px_-_env(safe-area-inset-bottom))] hidden pointer-coarse:block',
          ]
    expect(got).toEqual([
      [tab(`left-[${capEdge}] right-0`)],
      [tab('left-0 right-0')],
      record,
      [tab('left-0 right-0')],
      [tab(`left-0 right-[${capEdge}]`)],
    ])
    // the row's cap is the same variable the edge spans read (S106 R4)
    expect(nav.querySelector('.max-w-screen-sm')).not.toBeNull()
    expect(nav.innerHTML).not.toContain('640px')
  })

  it('a tap on each hit span activates its own control, once', () => {
    const { container } = render(<BottomNav nextCustomer={null} locale="ja" />)
    const nav = container.querySelector('nav[aria-label="Primary navigation"]')!
    const controls = Array.from(nav.querySelectorAll('a,button'))
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
      } else if (controls.indexOf(c) === 2 && path === '/sessions') {
        expect(stopRecording).toHaveBeenCalledTimes(1)
        expect(push).not.toHaveBeenCalled()
      } else {
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(controls.indexOf(c) === 2 ? '/sessions' : c.getAttribute('href'))
      }
    }
  })
})
