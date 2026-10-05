/**
 * @jest-environment jsdom
 *
 * S103 — the wrong-place tap. A touch whose POSITION is inside the bottom
 * bar's rect belongs to the bar, whatever element the engine says received it
 * (src/lib/bar-touch-guard.ts). jsdom has no layout, so every rect is pinned
 * below: a 400px-wide viewport, the bar at y 700-764, the record circle
 * 8px proud of it (y 692-736), and the 予約 row passing UNDER the bar's top
 * edge (y 600-720) — the field geometry.
 */
import { useEffect, useRef, type ReactNode, type MouseEvent } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ReservationView } from '@/lib/adapters/reservation-view'

const push = jest.fn()
jest.mock('@/i18n/navigation', () => ({
  usePathname: () => '/appointments',
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
import { ReservationMobileAgenda } from '@/components/karute/spike-lifted/reservation/ReservationMobileAgenda'
import { installBarTouchGuard, BAR_GUARD_LOG_KEY } from '@/lib/bar-touch-guard'

const booking: ReservationView = {
  id: 'appt-1',
  staffId: 'staff-1',
  staffName: '原田 かなみ',
  startTimeHm: '18:00',
  durationMin: 60,
  noShowCount: 0,
  customerName: '魚谷真佐美',
  customerInitials: '魚',
  karuteNumber: '#00529',
  service: '',
  displayStatus: 'booked',
  isCancelled: false,
  isNoShow: false,
  statusReason: null,
  statusSetByName: null,
  statusSetAt: null,
  staffColorKey: 'neutral',
  clientId: 'cust-1',
  karuteRecordId: null,
  isFirstTimeVisit: false,
  pack: null,
  needsRenewal: false,
}

const box = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect
const ZERO = box(0, 0, 0, 0)

function rectOf(el: Element): DOMRect {
  if (el.getAttribute('aria-label') === 'Primary navigation') return box(0, 700, 400, 764)
  if (el.hasAttribute('data-bar-record')) return box(178, 692, 222, 736)
  const href = el.getAttribute('href')
  if (href === '/appointments') return box(0, 700, 80, 764)
  if (href === '/karute') return box(80, 700, 160, 764)
  if (href === '/customers') return box(240, 700, 320, 764)
  if (el.getAttribute('aria-haspopup') === 'menu') return box(320, 700, 400, 764)
  if (el.tagName === 'BUTTON' && el.textContent?.includes('魚谷真佐美')) return box(0, 600, 400, 720)
  return ZERO
}

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    // @ts-expect-error — test-only polyfill (MouseEvent carries coordinates)
    window.PointerEvent = class PointerEvent extends MouseEvent {}
  }
})

let rectSpy: jest.SpyInstance
let debugSpy: jest.SpyInstance
beforeEach(() => {
  jest.useFakeTimers()
  push.mockClear()
  localStorage.clear()
  rectSpy = jest
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      return rectOf(this)
    })
  debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
  rectSpy.mockRestore()
  debugSpy.mockRestore()
})

/** The thin shell's arrangement: the page in <main>, the bar in its own
 *  fixed wrapper, the guard installed once over both. */
function Harness(props: { onSelect: jest.Mock; onLongPress: jest.Mock }) {
  const main = useRef<HTMLElement | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  useEffect(() => installBarTouchGuard(wrap.current!, main.current!), [])
  return (
    <div>
      <main ref={main}>
        <ReservationMobileAgenda reservations={[booking]} {...props} />
      </main>
      <div ref={wrap}>
        <BottomNav nextCustomer={null} locale="ja" />
      </div>
    </div>
  )
}

function setup() {
  const onSelect = jest.fn()
  const onLongPress = jest.fn()
  const utils = render(<Harness onSelect={onSelect} onLongPress={onLongPress} />)
  const row = screen.getByRole('button', { name: /魚谷真佐美/ })
  return { ...utils, row, onSelect, onLongPress }
}

const at = (x: number, y: number) => ({ clientX: x, clientY: y })
function pointerTap(el: Element, x: number, y: number, click = true) {
  fireEvent.pointerDown(el, at(x, y))
  fireEvent.pointerUp(el, at(x, y))
  if (click) fireEvent.click(el, at(x, y))
}
const finger = (x: number, y: number) => [{ identifier: 1, clientX: x, clientY: y }]

describe('bar touch guard', () => {
  it('(a) a tap inside the bar rect delivered to a row opens no booking and activates カルテ once', () => {
    const { row, onSelect } = setup()
    pointerTap(row, 120, 710)
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/karute')
  })

  it('(a, touch) touchstart/touchend + trailing click on a row inside the bar → カルテ once, no booking', () => {
    const { row, onSelect } = setup()
    fireEvent.touchStart(row, { touches: finger(120, 710), changedTouches: finger(120, 710) })
    fireEvent.pointerDown(row, at(120, 710))
    fireEvent.pointerUp(row, at(120, 710))
    fireEvent.touchEnd(row, { touches: [], changedTouches: finger(120, 710) })
    fireEvent.click(row, at(120, 710))
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/karute')
  })

  it('(b) a tap on the record button ring (above the bar, outside the circle) → record once, no booking', () => {
    const { row, onSelect } = setup()
    pointerTap(row, 200, 689)
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/sessions')
  })

  it('(c) a normal tap on a row above the bar still opens it, once', () => {
    const { row, onSelect } = setup()
    pointerTap(row, 120, 650)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })

  it('(d) a normal tap whose target IS the bar → guard inert, bar activates once', () => {
    const { onSelect } = setup()
    const tab = document.querySelector('a[href="/karute"]')!
    fireEvent.touchStart(tab, { touches: finger(120, 710), changedTouches: finger(120, 710) })
    fireEvent.touchEnd(tab, { touches: [], changedTouches: finger(120, 710) })
    fireEvent.click(tab, at(120, 710))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/karute')
    expect(onSelect).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })

  it('(e) hold-to-cancel still fires and its trailing click opens nothing', () => {
    const { row, onSelect, onLongPress } = setup()
    fireEvent.pointerDown(row, at(120, 650))
    act(() => {
      jest.advanceTimersByTime(450)
    })
    fireEvent.pointerUp(row, at(120, 650))
    fireEvent.click(row, at(120, 650))
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('(f) pointerup with no click (a tap that stops a glide) opens nothing', () => {
    const { row, onSelect, onLongPress } = setup()
    pointerTap(row, 120, 650, false)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('(g) the recorder writes one line per interception, no text/label fields, at most 50', () => {
    const { row } = setup()
    fireEvent.click(row, at(120, 710))
    const log = JSON.parse(localStorage.getItem(BAR_GUARD_LOG_KEY)!)
    expect(log).toHaveLength(1)
    expect(Object.keys(log[0]).sort()).toEqual(
      ['activated', 'at', 'barTop', 'msSinceScroll', 'msSinceVisible', 'role', 'scrollY', 'tag', 'type', 'vvTop', 'x', 'y'].sort(),
    )
    expect(log[0]).toMatchObject({ type: 'click', x: 120, y: 710, tag: 'button', barTop: 700, activated: '/karute' })
    const raw = localStorage.getItem(BAR_GUARD_LOG_KEY)!
    for (const leak of ['魚谷', '原田', 'appt-1', 'cust-1', 'karute.', 'aria']) expect(raw).not.toContain(leak)
    for (let i = 0; i < 60; i++) {
      act(() => {
        jest.advanceTimersByTime(1000)
      })
      fireEvent.click(row, at(120, 710))
    }
    expect(JSON.parse(localStorage.getItem(BAR_GUARD_LOG_KEY)!)).toHaveLength(50)
  })

  it('(h) the guard removes its listeners on unmount', () => {
    const removeSpy = jest.spyOn(document, 'removeEventListener')
    const { unmount } = setup()
    unmount()
    const removed = removeSpy.mock.calls.map((c) => c[0])
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'visibilitychange']) {
      expect(removed).toContain(type)
    }
    removeSpy.mockRestore()
    // and a later bar-position click on a page element is no longer touched
    const stray = document.createElement('button')
    document.body.appendChild(stray)
    const onClick = jest.fn()
    stray.addEventListener('click', onClick)
    fireEvent.click(stray, at(120, 710))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })
})
