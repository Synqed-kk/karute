/**
 * @jest-environment jsdom
 *
 * Standard iOS gestures in the thin shell (Liam 7/29): status-bar tap →
 * scroll the shell's <main> to top, and horizontal swipe on the top-level
 * tab screens → previous/next tab. Pins the PURE decision logic (edge dead
 * zone for the WKWebView back gesture, horizontal-scroll-ancestor bail,
 * distance/axis/duration thresholds, no wrap at the ends) plus the two DOM
 * wirings (the karute:status-tap listener and the touch pipeline).
 */
import { act, render } from '@testing-library/react'
import { ThinShell } from '../../../thin/shell'
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

  it('is inert on non-tab screens (detail pages, login, unknown)', () => {
    expect(swipeTarget({ ...base, from: '/customers/abc' })).toBeNull()
    expect(swipeTarget({ ...base, from: '/karute/xyz' })).toBeNull()
    expect(swipeTarget({ ...base, from: '/' })).toBeNull()
  })

  it('leaves the WKWebView edge-gesture zones alone (28px both edges)', () => {
    expect(swipeTarget({ ...base, startX: 10 })).toBeNull()
    expect(swipeTarget({ ...base, startX: 380 })).toBeNull()
    expect(swipeTarget({ ...base, startX: 29 })).toBe('/karute')
  })

  it('rejects short, slow, or mostly-vertical drags', () => {
    expect(swipeTarget({ ...base, dx: -40 })).toBeNull() // too short
    expect(swipeTarget({ ...base, durationMs: 1200 })).toBeNull() // press-and-think hold
    expect(swipeTarget({ ...base, durationMs: 800 })).toBe('/karute') // slow deliberate drag OK
    expect(swipeTarget({ ...base, dx: -80, dy: 70 })).toBeNull() // diagonal
  })
})

describe('ThinShell wiring', () => {
  function renderShell(pathname = '/appointments') {
    window.history.replaceState({}, '', pathname)
    return render(
      <ThinShell nav={<div data-testid="nav" />}>
        <div style={{ height: 2000 }}>content</div>
      </ThinShell>,
    )
  }

  function touch(el: Element, type: string, x: number, y: number) {
    const e = new Event(type, { bubbles: true, cancelable: true })
    const point = [{ clientX: x, clientY: y }]
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : point })
    Object.defineProperty(e, 'changedTouches', { value: point })
    el.dispatchEvent(e)
  }

  it('karute:status-tap scrolls the main container to top', () => {
    const { container } = renderShell()
    const main = container.querySelector('main')!
    const scrollTo = jest.fn()
    main.scrollTo = scrollTo as never
    act(() => {
      window.dispatchEvent(new Event('karute:status-tap'))
    })
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('a fast left swipe on a tab screen navigates to the next tab', () => {
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    act(() => {
      touch(main, 'touchstart', 300, 400)
      touch(main, 'touchend', 150, 405)
    })
    expect(window.location.pathname).toBe('/karute')
  })

  it('a swipe starting inside a horizontally scrollable element is ignored', () => {
    const { container } = renderShell('/appointments')
    const main = container.querySelector('main')!
    const carousel = document.createElement('div')
    carousel.style.overflowX = 'auto'
    Object.defineProperty(carousel, 'scrollWidth', { value: 900 })
    Object.defineProperty(carousel, 'clientWidth', { value: 300 })
    main.appendChild(carousel)
    act(() => {
      touch(carousel, 'touchstart', 300, 400)
      touch(carousel, 'touchend', 150, 405)
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
})
