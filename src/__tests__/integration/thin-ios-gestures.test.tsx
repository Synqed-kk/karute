/**
 * @jest-environment jsdom
 *
 * Standard iOS gestures in the thin shell (Liam 7/29): status-bar tap →
 * scroll the shell's <main> to top, and horizontal swipe on the top-level
 * tab screens → previous/next tab. Pins the PURE decision logic (edge dead
 * zone for the WKWebView back gesture, gesture-owner bail, distance/axis/
 * duration thresholds, no wrap at the ends) plus the DOM wirings: the
 * karute:status-tap listener, the touch pipeline, direct-target touchend
 * (survives mid-gesture unmounts — the commit's core design), the session
 * gate (login screen inert), overlay inertness, and effect cleanup.
 */
import type { Session } from '@supabase/supabase-js'
import { act, render } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { ThinShell } from '../../../thin/shell'
import { usePathname } from '../../../thin/ports/nav.vite'
import { swipeTarget, TAB_ORDER } from '../../../thin/gestures'

describe('swipeTarget (pure)', () => {
  const base = {
    from: '/appointments',
    dx: -120,
    dy: 8,
    durationMs: 250,
    startX: 200,
    viewportWidth: 393,
  }

  it('swipe left goes to the next tab, right to the previous', () => {
    expect(swipeTarget({ ...base, from: '/appointments', dx: -120 })).toBe('/karute')
    expect(swipeTarget({ ...base, from: '/karute', dx: 120 })).toBe('/appointments')
  })

  it('covers the whole order dashboard → appointments → karute → customers', () => {
    expect(TAB_ORDER).toEqual(['/dashboard', '/appointments', '/karute', '/customers'])
    expect(swipeTarget({ ...base, from: '/dashboard', dx: -120 })).toBe('/appointments')
    expect(swipeTarget({ ...base, from: '/customers', dx: 120 })).toBe('/karute')
  })

  it('never wraps past the ends', () => {
    expect(swipeTarget({ ...base, from: '/dashboard', dx: 120 })).toBeNull()
    expect(swipeTarget({ ...base, from: '/customers', dx: -120 })).toBeNull()
  })

  it('is inert on non-tab screens (detail pages, unknown paths)', () => {
    expect(swipeTarget({ ...base, from: '/customers/abc' })).toBeNull()
    expect(swipeTarget({ ...base, from: '/karute/xyz' })).toBeNull()
    expect(swipeTarget({ ...base, from: '/' })).toBeNull()
  })

  it('leaves the WKWebView edge-gesture zones alone (28px both edges, exact)', () => {
    expect(swipeTarget({ ...base, startX: 10 })).toBeNull()
    expect(swipeTarget({ ...base, startX: 27 })).toBeNull()
    expect(swipeTarget({ ...base, startX: 28 })).toBe('/karute') // boundary in
    expect(swipeTarget({ ...base, startX: 365 })).toBe('/karute') // 393-28 in
    expect(swipeTarget({ ...base, startX: 366 })).toBeNull() // boundary out
  })

  it('rejects short, slow, or mostly-vertical drags', () => {
    expect(swipeTarget({ ...base, dx: -40 })).toBeNull() // too short
    expect(swipeTarget({ ...base, durationMs: 1200 })).toBeNull() // press-and-think hold
    expect(swipeTarget({ ...base, durationMs: 800 })).toBe('/karute') // slow deliberate drag OK
    expect(swipeTarget({ ...base, dx: -80, dy: 70 })).toBeNull() // diagonal
  })
})

describe('ThinShell wiring', () => {
  beforeEach(() => {
    // The chrome's mounted-app gate: swipes only exist for a signed-in staff.
    setSessionState({ status: 'signed-in', session: { access_token: 't' } as Session })
  })

  function renderShell(pathname = '/appointments') {
    window.history.replaceState({}, '', pathname)
    return render(
      <ThinShell nav={<div data-testid="nav" />}>
        <div style={{ height: 2000 }}>content</div>
      </ThinShell>,
    )
  }

  function touch(
    el: Element,
    type: string,
    x: number,
    y: number,
    opts: { defineChanged?: boolean } = { defineChanged: true },
  ) {
    const e = new Event(type, { bubbles: true, cancelable: true })
    const point = [{ clientX: x, clientY: y }]
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : point })
    if (opts.defineChanged) {
      Object.defineProperty(e, 'changedTouches', { value: point })
    }
    el.dispatchEvent(e)
  }

  // (The karute:status-tap listener tests died with the listener: under the
  //  root-scroller shell the status-bar tap is handled natively end-to-end —
  //  there is no web-side event to pin. The tab-swipe pins below are the
  //  surviving contract.)

  it('a fast left swipe on a tab screen navigates to the next tab', () => {
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    act(() => {
      touch(main, 'touchstart', 300, 400)
      touch(main, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/karute')
  })

  it('the swipe survives its start node being unmounted mid-gesture', () => {
    // The commit's core design: iOS keeps delivering the touch to the
    // original element after React swaps it out (予約 refetch), and detached
    // nodes never bubble — the touchend listener must sit on the node itself.
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    const row = document.createElement('div')
    main.appendChild(row)
    act(() => {
      touch(row, 'touchstart', 300, 400)
      row.remove()
      touch(row, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/karute')
  })

  it('the swipe survives a ThinShell re-render mid-gesture', () => {
    window.history.replaceState({}, '', '/appointments')
    const shell = (
      <ThinShell nav={<div />}>
        <div>content</div>
      </ThinShell>
    )
    const { container, rerender } = render(shell)
    const main = container.querySelector('main')!
    act(() => {
      touch(main, 'touchstart', 300, 400)
    })
    rerender(
      <ThinShell nav={<div />}>
        <div>content 2</div>
      </ThinShell>,
    )
    act(() => {
      touch(main, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/karute')
  })

  it('touchcancel aborts the gesture — even with no changedTouches defined', () => {
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    act(() => {
      touch(main, 'touchstart', 300, 400)
      touch(main, 'touchcancel', 0, 0, { defineChanged: false }) // iOS cancels can be empty
      touch(main, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/appointments')
  })

  it('a second finger disarms the gesture', () => {
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    act(() => {
      touch(main, 'touchstart', 300, 400)
      const two = new Event('touchstart', { bubbles: true })
      Object.defineProperty(two, 'touches', {
        value: [{ clientX: 300, clientY: 400 }, { clientX: 100, clientY: 100 }],
      })
      main.dispatchEvent(two)
      touch(main, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/appointments')
  })

  it('a swipe starting inside a horizontally scrollable element is ignored — from a CHILD of the scroller', () => {
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    const carousel = document.createElement('div')
    carousel.style.overflowX = 'auto'
    Object.defineProperty(carousel, 'scrollWidth', { value: 900 })
    Object.defineProperty(carousel, 'clientWidth', { value: 300 })
    const slide = document.createElement('div')
    carousel.appendChild(slide)
    main.appendChild(carousel)
    act(() => {
      touch(slide, 'touchstart', 300, 400) // ancestor walk, not target-only
      touch(slide, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/appointments')
  })

  it('a few bleed pixels of sideways overflow do NOT suppress the swipe', () => {
    // Every overflow-y:auto container computes overflow-x:auto, and -mx-4 row
    // bleed adds a few px of scrollWidth — the real-device bug that made the
    // swipe dead on list rows. Only genuine carousels (≥48px overflow) defer.
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    const list = document.createElement('div')
    list.style.overflowX = 'auto'
    Object.defineProperty(list, 'scrollWidth', { value: 310 })
    Object.defineProperty(list, 'clientWidth', { value: 300 })
    main.appendChild(list)
    act(() => {
      touch(list, 'touchstart', 300, 400)
      touch(list, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/karute')
  })

  it('a swipe on an inline overlay (fixed sheet / data-gesture-inert) never switches tabs', () => {
    // CancelBookingSheet renders fixed inset-0 INSIDE <main> — a swipe on the
    // open sheet must not destroy it by navigating (hold-to-confirm could
    // even fire the destructive action AND switch tabs in one release).
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    const sheet = document.createElement('div')
    sheet.style.position = 'fixed'
    main.appendChild(sheet)
    const tagged = document.createElement('div')
    tagged.setAttribute('data-gesture-inert', '')
    main.appendChild(tagged)
    act(() => {
      touch(sheet, 'touchstart', 300, 400)
      touch(sheet, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/appointments')
    act(() => {
      touch(tagged, 'touchstart', 300, 400)
      touch(tagged, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/appointments')
  })

  it('signed-out (login screen showing) swipes never mutate history', () => {
    setSessionState({ status: 'signed-out' })
    const { container } = renderShell('/customers') // boot rewrites '/' here even signed-out
    const main = container.querySelector('main')!
    act(() => {
      touch(main, 'touchstart', 300, 400)
      touch(main, 'touchend', 450, 405)
    })
    expect(window.location.pathname).toBe('/customers')
  })

  it('push notifies nav listeners — the screen actually switches, not just the URL', () => {
    function PathProbe() {
      return <div data-testid="path">{usePathname()}</div>
    }
    const { container, getByTestId } = render(
      <ThinShell nav={<PathProbe />}>
        <div>content</div>
      </ThinShell>,
    )
    window.history.replaceState({}, '', '/appointments')
    const main = container.querySelector('main')!
    act(() => {
      touch(main, 'touchstart', 300, 400)
      touch(main, 'touchend', 150, 405)
    })
    expect(getByTestId('path').textContent).toBe('/karute')
  })

  it('unmount restores touch-action and detaches every listener', () => {
    const { container, unmount } = renderShell('/appointments')
    const main = container.querySelector('main')!
    expect(main.style.touchAction).toBe('pan-y')
    unmount()
    // jsdom reads a property restored to '' back as undefined — both mean
    // "pan-y is gone", which is the contract.
    expect(main.style.touchAction || '').toBe('')
    act(() => {
      touch(main, 'touchstart', 300, 400)
      touch(main, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/appointments')
  })
})
