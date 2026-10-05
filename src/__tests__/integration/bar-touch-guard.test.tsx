/**
 * @jest-environment jsdom
 *
 * S103 — the wrong-place tap. A touch whose POSITION is inside the bottom
 * bar's rect belongs to the bar, whatever element the engine says received it
 * (src/lib/bar-touch-guard.ts). jsdom has no layout, so every rect is pinned
 * below: a 400px-wide viewport, the bar at y 700-764, the record circle
 * 8px proud of it (y 692-736), and the 予約 row passing UNDER the bar's top
 * edge (y 600-720) — the field geometry. The rule: WHERE A TOUCH STARTS
 * DECIDES — a touch that starts inside the bar on page content is the bar's
 * from start to finish; a touch that starts anywhere else is never touched.
 */
import { useEffect, useRef, type ReactNode, type MouseEvent } from 'react'
import { render, screen, fireEvent, createEvent, act } from '@testing-library/react'
import type { ReservationView } from '@/lib/adapters/reservation-view'

const push = jest.fn()
/** Route + recorder state the mocks read (reset before each test). */
const mockEnv = { path: '/appointments', rec: 'idle', stop: jest.fn() }
jest.mock('@/i18n/navigation', () => ({
  usePathname: () => mockEnv.path,
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
  useGlobalRecorder: () => ({ state: mockEnv.rec, startedAt: 0, stopRecording: mockEnv.stop, target: null }),
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

/** The bar's geometry can move after install (the reopen-the-app theory):
 *  `shift` moves every bar rect vertically, `zero` collapses them. */
const geom = { shift: 0, zero: false }
function barBox(el: Element): [number, number, number, number] | null {
  // S105 r5 hit spans (bottom-nav.tsx, touch screens): a tab's span is its
  // cell (this bar has no margin or strip); the record control's are the proud
  // part + 12px slop (y 680-700, x 166-234) and its column (±64px; the tabs'
  // areas win over the excess) down to the bar's bottom.
  if (el.hasAttribute('data-bar-hit')) {
    const p = el.parentElement!
    if (!p.hasAttribute('data-bar-record')) return barBox(p)
    return el === p.querySelector('[data-bar-hit]') ? [166, 680, 234, 700] : [136, 700, 264, 764]
  }
  if (el.getAttribute('aria-label') === 'Primary navigation') return [0, 700, 400, 764]
  // the record circle: centre (200,714), radius 22 (+4 ring = 26)
  if (el.hasAttribute('data-bar-record')) return [178, 692, 222, 736]
  const href = el.getAttribute('href')
  if (href === '/appointments') return [0, 700, 80, 764]
  if (href === '/karute') return [80, 700, 160, 764]
  if (href === '/customers') return [240, 700, 320, 764]
  if (el.getAttribute('aria-haspopup') === 'menu') return [320, 700, 400, 764]
  return null
}
function rectOf(el: Element): DOMRect {
  const dr = el.getAttribute('data-rect')
  if (dr) {
    const [l, t, r, b] = dr.split(',').map(Number)
    return box(l, t, r, b)
  }
  const b = barBox(el)
  if (b) return geom.zero ? ZERO : box(b[0], b[1] + geom.shift, b[2], b[3] + geom.shift)
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
  push.mockReset()
  Object.assign(mockEnv, { path: '/appointments', rec: 'idle', stop: jest.fn() })
  Object.assign(geom, { shift: 0, zero: false })
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

/** A plain page: <main> with any children, the real BottomNav; `guard`
 *  false runs the guard's cleanup (what the shell's effect does on unmount). */
function Plain({ children, guard = true }: { children: ReactNode; guard?: boolean }) {
  const main = useRef<HTMLElement | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  useEffect(() => (guard ? installBarTouchGuard(wrap.current!, main.current!) : undefined), [guard])
  return (
    <div>
      <main ref={main}>{children}</main>
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

/** A finger/mouse click carries detail 1 (jsdom's default 0 is the keyboard's). */
const at = (x: number, y: number) => ({ clientX: x, clientY: y, detail: 1 })
function pointerTap(el: Element, x: number, y: number, click = true) {
  fireEvent.pointerDown(el, at(x, y))
  fireEvent.pointerUp(el, at(x, y))
  if (click) fireEvent.click(el, at(x, y))
}
const finger = (x: number, y: number) => [{ identifier: 1, clientX: x, clientY: y }]
const touchStart = (el: Element, x: number, y: number) =>
  fireEvent.touchStart(el, { touches: finger(x, y), changedTouches: finger(x, y) })
const touchEnd = (el: Element, x: number, y: number) =>
  fireEvent.touchEnd(el, { touches: [], changedTouches: finger(x, y) })
/** A touchend the engine will not let anyone cancel (the page was gliding). */
function momentumTouchEnd(el: Element, x: number, y: number) {
  const ev = new Event('touchend', { bubbles: true, cancelable: false })
  Object.assign(ev, { changedTouches: finger(x, y), touches: [] })
  el.dispatchEvent(ev)
}
const log = () => JSON.parse(localStorage.getItem(BAR_GUARD_LOG_KEY) ?? '[]')
/** Fire an event with an explicit (monotonic) event.timeStamp. */
function stamped(el: Element, kind: 'touchStart' | 'touchEnd' | 'pointerDown' | 'pointerUp' | 'click', init: object, t: number) {
  const ev = createEvent[kind](el, init)
  Object.defineProperty(ev, 'timeStamp', { value: t })
  return fireEvent(el, ev)
}

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

  it('(h) the guard listens to no pointerup, removes its listeners on unmount, and a page target is then untouched', () => {
    const addSpy = jest.spyOn(document, 'addEventListener')
    const removeSpy = jest.spyOn(document, 'removeEventListener')
    const { unmount } = setup()
    const captured = addSpy.mock.calls.filter((c) => (c[2] as AddEventListenerOptions)?.capture).map((c) => c[0])
    expect(captured.sort()).toEqual(['click', 'pointerdown', 'touchcancel', 'touchend', 'touchstart'])
    unmount()
    const removed = removeSpy.mock.calls.map((c) => c[0])
    for (const type of ['pointerdown', 'touchstart', 'touchend', 'touchcancel', 'click', 'visibilitychange']) {
      expect(removed).toContain(type)
    }
    addSpy.mockRestore()
    removeSpy.mockRestore()
    // the real case: page content under the bar, intercepted while the guard
    // is installed, reaches its own handler once the guard is cleaned up
    const onClick = jest.fn()
    const page = (guard: boolean) => (
      <Plain guard={guard}>
        <button data-rect="0,600,400,720" onClick={onClick}>
          content
        </button>
      </Plain>
    )
    const { rerender } = render(page(true))
    fireEvent.click(screen.getByText('content'), at(120, 710))
    expect(onClick).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    rerender(page(false))
    fireEvent.click(screen.getByText('content'), at(120, 710))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
    expect(log()).toHaveLength(1)
  })
})

describe('bar touch guard — where a touch starts decides', () => {
  it('a short tap that starts just above the bar and lifts inside it fires no hold-to-cancel (touch)', () => {
    const { row, onLongPress } = setup()
    touchStart(row, 120, 696)
    fireEvent.pointerDown(row, at(120, 696))
    fireEvent.pointerUp(row, at(120, 703))
    touchEnd(row, 120, 703)
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('a short press that starts just above the bar and lifts inside it fires no hold-to-cancel (mouse)', () => {
    const { row, onLongPress } = setup()
    fireEvent.pointerDown(row, at(120, 696))
    fireEvent.pointerUp(row, at(120, 703))
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('a tap that starts 4px above the bar and lifts inside it opens the pressed row as before and never activates a tab', () => {
    const { row, onSelect, onLongPress } = setup()
    touchStart(row, 120, 696)
    fireEvent.pointerDown(row, at(120, 696))
    fireEvent.pointerUp(row, at(120, 703))
    touchEnd(row, 120, 703)
    fireEvent.click(row, at(120, 703))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onLongPress).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })

  it('a swipe that starts on the page and ends inside the bar keeps its touchend on its start target', () => {
    const { row, onSelect } = setup()
    const onTouchEnd = jest.fn()
    row.addEventListener('touchend', onTouchEnd)
    touchStart(row, 120, 650)
    touchEnd(row, 120, 720)
    expect(onTouchEnd).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('a touch that starts inside the bar and lifts just above it activates the tab under its START point; its click opens nothing', () => {
    const { row, onSelect } = setup()
    touchStart(row, 120, 702)
    fireEvent.pointerDown(row, at(120, 702))
    fireEvent.pointerUp(row, at(120, 697))
    touchEnd(row, 120, 697)
    fireEvent.click(row, at(120, 697))
    expect(onSelect).not.toHaveBeenCalled()
    expect(push.mock.calls).toEqual([['/karute']])
  })

  it('one full guarded touch tap (pointerdown, touchstart, touchend, click) writes exactly one line', () => {
    const { row, onSelect } = setup()
    fireEvent.pointerDown(row, at(120, 710))
    touchStart(row, 120, 710)
    touchEnd(row, 120, 710)
    fireEvent.click(row, at(120, 710))
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ type: 'touchend', activated: '/karute' })
  })

  it('no activation while another finger is still down', () => {
    const { row } = setup()
    fireEvent.touchStart(row, { touches: finger(120, 650), changedTouches: finger(120, 650) })
    const two = { identifier: 2, clientX: 120, clientY: 710 }
    fireEvent.touchStart(row, { touches: [...finger(120, 650), two], changedTouches: [two] })
    fireEvent.touchEnd(row, { touches: finger(120, 650), changedTouches: [two] })
    expect(push).not.toHaveBeenCalled()
  })

  it('a keyboard / assistive-technology click (detail 0) at a bar position is never intercepted', () => {
    const { row, onSelect } = setup()
    fireEvent.click(row, { clientX: 120, clientY: 710 })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })

  it('a disabled bar control is not activated; the line says activated: null', () => {
    render(
      <Plain>
        <button data-rect="0,600,400,720">content</button>
      </Plain>,
    )
    const menu = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    menu.disabled = true
    const before = menu.getAttribute('aria-expanded')
    touchStart(screen.getByText('content'), 360, 710)
    touchEnd(screen.getByText('content'), 360, 710)
    expect(menu.getAttribute('aria-expanded')).toBe(before)
    expect(log().map((l: { activated: unknown }) => l.activated)).toEqual([null])
  })
})

describe('bar touch guard — the bar moves after install (live rect)', () => {
  it('a tap at the bar\'s OLD position is not intercepted, one at its NEW position is; a zero rect makes it inert', () => {
    const { row, onSelect } = setup()
    geom.shift = -200 // the bar now sits at y 500-564
    pointerTap(row, 120, 710)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    pointerTap(row, 120, 510)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(push.mock.calls).toEqual([['/karute']])
    geom.zero = true
    pointerTap(row, 120, 510)
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(push).toHaveBeenCalledTimes(1)
  })
})

describe('bar touch guard — the record hit area (circle + ring + 12px slop + column)', () => {
  it('a touch on page content just outside the 12px slop beside the proud circle starts no recording', () => {
    const { row } = setup()
    touchStart(row, 162, 690) // 4px left of the slop, off the circle and ring
    touchEnd(row, 162, 690)
    expect(push).not.toHaveBeenCalled()
  })

  it('a touch on page content just above the 12px slop starts no recording', () => {
    const { row } = setup()
    touchStart(row, 200, 677) // 3px above the slop's top (680)
    touchEnd(row, 200, 677)
    expect(push).not.toHaveBeenCalled()
  })

  it('a touch on page content in the slop, off the circle and ring (old definition: nothing) → record once', () => {
    const { row, onSelect } = setup()
    touchStart(row, 170, 684) // ~42px from the centre: outside circle+ring (26)
    touchEnd(row, 170, 684)
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/sessions')
  })

  it('a touch on page content in the record column under the circle (old definition: nothing) → record once', () => {
    render(
      <Plain>
        <div data-rect="0,600,400,764">content</div>
      </Plain>,
    )
    touchStart(screen.getByText('content'), 170, 760)
    touchEnd(screen.getByText('content'), 170, 760)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/sessions')
  })

  it('a point in both the record column span and カルテ → カルテ (a tab wins over the column excess)', () => {
    render(
      <Plain>
        <div data-rect="0,600,400,764">content</div>
      </Plain>,
    )
    touchStart(screen.getByText('content'), 150, 750)
    touchEnd(screen.getByText('content'), 150, 750)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/karute')
  })

  it('while recording on /sessions, the point outside the slop does not stop the recording', () => {
    Object.assign(mockEnv, { rec: 'recording', path: '/sessions' })
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    touchStart(screen.getByText('content'), 162, 690)
    touchEnd(screen.getByText('content'), 162, 690)
    expect(mockEnv.stop).not.toHaveBeenCalled()
    touchStart(screen.getByText('content'), 170, 684)
    touchEnd(screen.getByText('content'), 170, 684)
    expect(mockEnv.stop).toHaveBeenCalledTimes(1)
  })
})

describe('bar touch guard — ghost clicks and other layers', () => {
  it('a ghost click after a direct tab tap (uncancellable touchend) lands on page content → one push, one line', () => {
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    const tab = document.querySelector('a[href="/karute"]')!
    touchStart(tab, 120, 710)
    momentumTouchEnd(tab, 120, 710)
    act(() => {
      jest.advanceTimersByTime(20)
    })
    fireEvent.click(screen.getByText('content'), at(120, 710))
    expect(push).toHaveBeenCalledTimes(1)
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ type: 'click', activated: null })
  })

  it('while recording on /sessions, a ghost click after a direct stop tap stops the recording once', () => {
    Object.assign(mockEnv, { rec: 'recording', path: '/sessions' })
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    const stopBtn = document.querySelector('[data-bar-record]')!
    touchStart(stopBtn, 200, 714)
    momentumTouchEnd(stopBtn, 200, 714)
    fireEvent.click(screen.getByText('content'), at(200, 714))
    expect(mockEnv.stop).toHaveBeenCalledTimes(1)
  })

  it('an in-page fixed z-50 dialog button over the bar keeps its tap 400ms after a guarded touch', () => {
    const onClick = jest.fn()
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
        <div style={{ position: 'fixed', zIndex: 50 }}>
          <button data-rect="0,700,400,760" onClick={onClick}>
            confirm
          </button>
        </div>
      </Plain>,
    )
    touchStart(screen.getByText('content'), 120, 710)
    touchEnd(screen.getByText('content'), 120, 710)
    act(() => {
      jest.advanceTimersByTime(400)
    })
    const btn = screen.getByText('confirm')
    touchStart(btn, 120, 730)
    fireEvent.pointerDown(btn, at(120, 730))
    fireEvent.pointerUp(btn, at(120, 730))
    touchEnd(btn, 120, 730)
    fireEvent.click(btn, at(120, 730))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('a portaled (body-level) button over the bar keeps its click 400ms after a guarded touch', () => {
    const onClick = jest.fn()
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    const btn = document.createElement('button')
    btn.addEventListener('click', onClick)
    document.body.appendChild(btn)
    touchStart(screen.getByText('content'), 120, 710)
    touchEnd(screen.getByText('content'), 120, 710)
    act(() => {
      jest.advanceTimersByTime(400)
    })
    // A real tap on the button: its own finger-down, then its click.
    fireEvent.pointerDown(btn, at(120, 730))
    fireEvent.click(btn, at(120, 730))
    btn.remove()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('with the guard installed, a body-level button clicked at a bar position reaches its handler once: no push, no line', () => {
    setup()
    const btn = document.createElement('button')
    const onClick = jest.fn()
    btn.addEventListener('click', onClick)
    document.body.appendChild(btn)
    fireEvent.click(btn, at(120, 710))
    btn.remove()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })

  it.each([
    ['a fixed z-50 sheet', { position: 'fixed', zIndex: 50 }, undefined],
    ['an absolute z-50 dropdown option', { position: 'absolute', zIndex: 50 }, { position: 'relative' }],
    ['a fixed z-auto layer inside a fixed z-50 parent', { position: 'fixed' }, { position: 'fixed', zIndex: 50 }],
    ['a sticky z-50 footer action', { position: 'sticky', zIndex: 50 }, undefined],
  ] as const)('a layer above the bar inside the page keeps its tap: %s', (_name, layer, outer) => {
    const onClick = jest.fn()
    render(
      <Plain>
        <div style={outer}>
          <div style={layer}>
            <button data-rect="0,690,400,760" onClick={onClick}>
              layer
            </button>
          </div>
        </div>
      </Plain>,
    )
    pointerTap(screen.getByText('layer'), 120, 710)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })
})

describe('bar touch guard — the recorder', () => {
  it.each(['not json{', '{"a":1}', 'null', '"str"'])('garbage %s under the key: the recorder starts again from []', (garbage) => {
    localStorage.setItem(BAR_GUARD_LOG_KEY, garbage)
    const { row } = setup()
    for (let i = 0; i < 3; i++) {
      act(() => {
        jest.advanceTimersByTime(1000)
      })
      touchStart(row, 120, 710)
      touchEnd(row, 120, 710)
    }
    expect(Array.isArray(log())).toBe(true)
    expect(log()).toHaveLength(3)
  })

  it('a role that is not a bare lowercase ARIA role is stored as null', () => {
    render(
      <Plain>
        <div role="山田様の予約" data-rect="0,600,400,720">
          x
        </div>
      </Plain>,
    )
    fireEvent.click(screen.getByText('x'), at(120, 710))
    expect(log()).toHaveLength(1)
    expect(log()[0].role).toBeNull()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).not.toContain('山田')
  })
})

describe('bar touch guard — fix round 2 (S104)', () => {
  const pageButton = (onClick: jest.Mock) =>
    render(
      <Plain>
        <button data-rect="0,600,400,720" onClick={onClick}>
          content
        </button>
      </Plain>,
    )
  const A = { identifier: 1, clientX: 120, clientY: 710 }
  const B = { identifier: 2, clientX: 300, clientY: 650 }

  it('F1 an owned touch lifts just outside the bar: its click on a page button with its own handler never runs', () => {
    const onClick = jest.fn()
    pageButton(onClick)
    const c = screen.getByText('content')
    touchStart(c, 120, 702)
    fireEvent.pointerDown(c, at(120, 702))
    touchEnd(c, 120, 697)
    fireEvent.click(c, at(120, 697))
    expect(onClick).not.toHaveBeenCalled()
    expect(push.mock.calls).toEqual([['/karute']])
  })

  it('F2 two overlapping touches: the non-owned finger is never stopped; the owned one activates once on its own lift', () => {
    const { row } = setup()
    const seen: string[] = []
    for (const t of ['touchstart', 'touchend']) {
      row.addEventListener(t, (ev) => seen.push(`${t}:${(ev as TouchEvent).changedTouches[0].identifier}`))
    }
    fireEvent.touchStart(row, { touches: [A], changedTouches: [A] })
    fireEvent.touchStart(row, { touches: [A, B], changedTouches: [B] })
    fireEvent.touchEnd(row, { touches: [A], changedTouches: [B] })
    expect(push).not.toHaveBeenCalled()
    fireEvent.touchEnd(row, { touches: [], changedTouches: [A] })
    expect(seen).toEqual(['touchstart:2', 'touchend:2'])
    expect(push.mock.calls).toEqual([['/karute']])
  })

  it('F2 a touchcancel of the owned touch: nothing activates, and nothing is left that changes the next tap', () => {
    const { row, onSelect } = setup()
    const ends = jest.fn()
    row.addEventListener('touchend', ends)
    touchStart(row, 120, 710)
    fireEvent.pointerDown(row, at(120, 710))
    fireEvent.touchCancel(row, { touches: [], changedTouches: finger(120, 710) })
    touchEnd(row, 120, 710) // a stray end with the same id: no longer owned
    expect(ends).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
    pointerTap(row, 120, 650)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('F3 an owned touch that lifts beyond slop activates nothing and opens nothing under the bar', () => {
    const { row, onSelect } = setup()
    touchStart(row, 120, 710)
    fireEvent.pointerDown(row, at(120, 710))
    fireEvent.pointerUp(row, at(120, 740))
    touchEnd(row, 120, 740)
    fireEvent.click(row, at(120, 740))
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(log().map((l: { activated: unknown }) => l.activated)).toEqual([null])
  })

  it('F3 an owned mouse press that lifts beyond slop activates nothing and opens nothing under the bar', () => {
    const { row, onSelect } = setup()
    fireEvent.pointerDown(row, at(120, 710))
    fireEvent.pointerUp(row, at(120, 740))
    fireEvent.click(row, at(120, 740))
    expect(onSelect).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(log().map((l: { activated: unknown }) => l.activated)).toEqual([null])
  })

  it('F4 a 600 ms hold that starts on the bar over a row never starts its hold-to-cancel', () => {
    const { row, onSelect, onLongPress } = setup()
    touchStart(row, 120, 710)
    fireEvent.pointerDown(row, at(120, 710))
    act(() => {
      jest.advanceTimersByTime(600)
    })
    expect(onLongPress).not.toHaveBeenCalled()
    fireEvent.pointerUp(row, at(120, 710))
    touchEnd(row, 120, 710)
    fireEvent.click(row, at(120, 710))
    expect(onLongPress).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('F4 an owned touchend and an intercepted click are default-prevented (a link under the bar does not follow)', () => {
    render(
      <Plain>
        <a href="https://example.test/x" data-rect="0,600,400,720">
          content
        </a>
      </Plain>,
    )
    const c = screen.getByText('content')
    touchStart(c, 120, 710)
    expect(touchEnd(c, 120, 710)).toBe(false)
    expect(fireEvent.click(c, at(120, 710))).toBe(false)
  })

  it('F4 the page never sees an owned touch: neither its touchstart nor its touchend', () => {
    const { row } = setup()
    const starts = jest.fn()
    const ends = jest.fn()
    row.addEventListener('touchstart', starts)
    row.addEventListener('touchend', ends)
    touchStart(row, 120, 710)
    touchEnd(row, 120, 710)
    expect(starts).not.toHaveBeenCalled()
    expect(ends).not.toHaveBeenCalled()
    expect(push.mock.calls).toEqual([['/karute']])
  })

  it('F5 a ghost click after a direct tab tap, on a page button with its own handler: the handler never runs', () => {
    const onClick = jest.fn()
    pageButton(onClick)
    const tab = document.querySelector('a[href="/karute"]')!
    touchStart(tab, 120, 710)
    momentumTouchEnd(tab, 120, 710)
    fireEvent.click(screen.getByText('content'), at(120, 710))
    expect(onClick).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(log()).toHaveLength(1)
  })

  it('F10 a two-finger lift that lists the other finger first still ends the owned touch', () => {
    const { row } = setup()
    fireEvent.touchStart(row, { touches: [A], changedTouches: [A] })
    fireEvent.touchStart(row, { touches: [A, B], changedTouches: [B] })
    fireEvent.touchEnd(row, { touches: [], changedTouches: [B, A] })
    expect(push.mock.calls).toEqual([['/karute']])
  })

  it('F11 a touch from above the bar lifting inside it, then a click with no pointer events: the page handler keeps it', () => {
    const onClick = jest.fn()
    pageButton(onClick)
    const c = screen.getByText('content')
    touchStart(c, 120, 696)
    touchEnd(c, 120, 703)
    fireEvent.click(c, at(120, 703))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(localStorage.getItem(BAR_GUARD_LOG_KEY)).toBeNull()
  })

  it('F13 a guard-owned touch activates a tab whose own touch left swallowClick armed (clickAsTap, not el.click)', () => {
    render(<Plain><button data-rect="0,600,400,720">content</button></Plain>)
    const tab = document.querySelector<HTMLAnchorElement>('a[href="/karute"]')!
    const content = screen.getByText('content')
    // a real tap on the tab: tapActivation pushes once and arms swallowClick; the engine never sends the click
    touchStart(tab, 120, 710)
    touchEnd(tab, 120, 710)
    expect(push.mock.calls).toEqual([['/karute']])
    // a guard-owned touch (page content under the bar) at the same tab must still activate it
    touchStart(content, 120, 710)
    touchEnd(content, 120, 710)
    expect(push.mock.calls).toEqual([['/karute'], ['/karute']])
  })
})

describe('bar touch guard — fix round 3 (S104): no decision depends on elapsed time', () => {
  const pageButton = (onClick: jest.Mock) =>
    render(
      <Plain>
        <button data-rect="0,600,400,720" onClick={onClick}>
          content
        </button>
      </Plain>,
    )
  /** An owned touch at (x,y) on el, lifted at t+50, then its click at t+50+lag
   *  (explicit event.timeStamps AND the fake clock advanced by lag). */
  function ownedTouchLateClick(el: Element, x: number, y: number, lag: number) {
    stamped(el, 'pointerDown', at(x, y), 10_000)
    stamped(el, 'touchStart', { touches: finger(x, y), changedTouches: finger(x, y) }, 10_010)
    stamped(el, 'touchEnd', { touches: [], changedTouches: finger(x, y) }, 10_060)
    act(() => {
      jest.advanceTimersByTime(lag)
    })
    return stamped(el, 'click', at(x, y), 10_060 + lag)
  }

  it('T1a an owned tab touch whose click comes 1,500 ms late (a stall): exactly one push, no row opens (probe P1)', () => {
    const { row, onSelect } = setup()
    expect(ownedTouchLateClick(row, 120, 710, 1500)).toBe(false)
    expect(push.mock.calls).toEqual([['/karute']])
    expect(onSelect).not.toHaveBeenCalled()
    expect(log().map((l: { type: string }) => l.type)).toEqual(['touchend'])
  })

  it('T1a while recording on /sessions, an owned touch on the stop button whose click comes 1,500 ms late stops once', () => {
    Object.assign(mockEnv, { rec: 'recording', path: '/sessions' })
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    ownedTouchLateClick(screen.getByText('content'), 200, 714, 1500)
    expect(mockEnv.stop).toHaveBeenCalledTimes(1)
  })

  it('T1b an owned touch whose click never came: a new normal tap on a row above the bar opens it', () => {
    const { row, onSelect } = setup()
    touchStart(row, 120, 710)
    touchEnd(row, 120, 710)
    expect(push.mock.calls).toEqual([['/karute']])
    pointerTap(row, 120, 650)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('T1b an owned touch whose click never came: a new touch tap on a page button above the bar reaches its handler', () => {
    const onClick = jest.fn()
    pageButton(onClick)
    const c = screen.getByText('content')
    touchStart(c, 120, 710)
    touchEnd(c, 120, 710)
    touchStart(c, 120, 650)
    touchEnd(c, 120, 650)
    fireEvent.click(c, at(120, 650))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(push.mock.calls).toEqual([['/karute']])
  })

  it('T1c a ghost click 1,500 ms after a direct tab tap, on a page button with its own handler: not run, one line; a new tap then works', () => {
    const onClick = jest.fn()
    pageButton(onClick)
    const tab = document.querySelector('a[href="/karute"]')!
    const c = screen.getByText('content')
    stamped(tab, 'touchStart', { touches: finger(120, 710), changedTouches: finger(120, 710) }, 10_000)
    const end = new Event('touchend', { bubbles: true, cancelable: false })
    Object.assign(end, { changedTouches: finger(120, 710), touches: [] })
    Object.defineProperty(end, 'timeStamp', { value: 10_050 })
    tab.dispatchEvent(end)
    act(() => {
      jest.advanceTimersByTime(1500)
    })
    stamped(c, 'click', at(120, 710), 11_550)
    expect(onClick).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(log()).toHaveLength(1)
    expect(log()[0]).toMatchObject({ type: 'click', activated: null })
    pointerTap(c, 120, 650)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('T1f a touchcancel drops the owned press: a later click with no pointer events at another bar control activates that control', () => {
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    const c = screen.getByText('content')
    touchStart(c, 120, 710)
    fireEvent.pointerDown(c, at(120, 710))
    fireEvent.touchCancel(c, { touches: [], changedTouches: finger(120, 710) })
    fireEvent.click(c, at(30, 710))
    expect(push.mock.calls).toEqual([['/appointments']])
  })
})

describe('bar touch guard — fix round 4 (S105): an owned touch\'s click is swallowed wherever it lands', () => {
  /** An owned touch at (x,y) delivered to el: pointerdown, touchstart, touchend. */
  function ownedTouch(el: Element, x: number, y: number) {
    fireEvent.pointerDown(el, at(x, y))
    touchStart(el, x, y)
    touchEnd(el, x, y)
  }

  it('T-G5a an owned touch on a row, its late click delivered to the カルテ tab itself: one push, the click default-prevented', () => {
    const { row, onSelect } = setup()
    ownedTouch(row, 120, 710)
    const tab = document.querySelector('a[href="/karute"]')!
    expect(fireEvent.click(tab, at(120, 710))).toBe(false)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls).toEqual([['/karute']])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('T-G5b while recording on /sessions, an owned touch whose late click is delivered to the stop button itself stops once', () => {
    Object.assign(mockEnv, { rec: 'recording', path: '/sessions' })
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    ownedTouch(screen.getByText('content'), 200, 714)
    fireEvent.click(document.querySelector('[data-bar-record]')!, at(200, 714))
    expect(mockEnv.stop).toHaveBeenCalledTimes(1)
  })

  it('T-G5c an owned touch\'s late click on a body-level (portaled) button is not run; a real tap on it then runs once', () => {
    const onClick = jest.fn()
    render(
      <Plain>
        <div data-rect="0,600,400,720">content</div>
      </Plain>,
    )
    const btn = document.createElement('button')
    btn.addEventListener('click', onClick)
    document.body.appendChild(btn)
    ownedTouch(screen.getByText('content'), 120, 710)
    fireEvent.click(btn, at(120, 730))
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.pointerDown(btn, at(120, 730))
    fireEvent.click(btn, at(120, 730))
    btn.remove()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('T-H2a a row press with no click, an owned bar tap, a finger-down elsewhere: the row\'s late click does not open it (probe P12); a normal tap then opens it', () => {
    const { row, onSelect } = setup()
    fireEvent.pointerDown(row, at(120, 650))
    fireEvent.pointerUp(row, at(120, 650))
    ownedTouch(row, 120, 710)
    fireEvent.pointerDown(document.body, at(300, 300))
    fireEvent.click(row, at(120, 650))
    expect(push.mock.calls).toEqual([['/karute']])
    expect(onSelect).not.toHaveBeenCalled()
    pointerTap(row, 120, 650)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
