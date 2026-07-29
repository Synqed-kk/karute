// Standard iOS gestures for the shell (Liam 7/29). Two behaviors:
//
//   1. Status-bar tap → scroll to top. The native side (CookieVC's
//      statusTapCatcher) forwards the tap as a `karute:status-tap` window
//      event because the WKWebView's own scrollView never scrolls (the app
//      scrolls ThinShell's inner <main>) — the web layer owns the container,
//      so it owns the scroll.
//
//   2. Horizontal swipe on a TOP-LEVEL tab screen → previous/next tab, in
//      the bottom-bar order with ホーム first. Detail pages, sheets, and the
//      login screen are inert; the WKWebView edge-swipe (back/forward, native
//      allowsBackForwardNavigationGestures) keeps both 28px screen edges; a
//      touch starting inside anything horizontally scrollable (hero carousel,
//      予約 time grid, tab chip rows) belongs to that element, never to us.
//
// Attached to <main> only — the bottom nav and its sheet are flex siblings
// outside it, so tapping/swiping the bar can never switch tabs by accident.

import { useEffect, type RefObject } from 'react'
import { useRouter } from './ports/nav.vite'

export const TAB_ORDER = ['/dashboard', '/appointments', '/karute', '/customers'] as const

// Reserved for the system back/forward edge gesture — ours must not race it.
const EDGE_PX = 28
const MIN_DX = 64
// Generous by design: with touch-action pan-y a horizontal drag over plain
// content has no other meaning, so even a slow deliberate drag is a tab
// switch. The cap only rejects a press-and-think hold.
const MAX_MS = 1000

export interface SwipeInput {
  from: string
  dx: number
  dy: number
  durationMs: number
  startX: number
  viewportWidth: number
}

/** Pure decision: where does this swipe go? null = not a tab swipe. */
export function swipeTarget(s: SwipeInput): string | null {
  const at = TAB_ORDER.indexOf(s.from as (typeof TAB_ORDER)[number])
  if (at < 0) return null
  if (s.startX < EDGE_PX || s.startX > s.viewportWidth - EDGE_PX) return null
  if (s.durationMs > MAX_MS) return null
  if (Math.abs(s.dx) < MIN_DX) return null
  if (Math.abs(s.dx) < Math.abs(s.dy) * 2) return null
  const to = s.dx < 0 ? at + 1 : at - 1
  return TAB_ORDER[to] ?? null
}

/** True when the touch began inside an element that scrolls horizontally
 *  itself (carousel, time grid, chip row) — that element owns the swipe.
 *  Threshold is deliberately COARSE (48px): per CSS, every overflow-y:auto
 *  container computes overflow-x:auto too, and list containers routinely
 *  overflow sideways by a few bleed pixels (-mx-4 rows) — that must NOT
 *  suppress the tab swipe. A real carousel/grid overflows by hundreds. */
export const H_SCROLL_SLOP = 48
function insideHorizontalScroller(start: EventTarget | null, stop: HTMLElement): boolean {
  let el = start instanceof Element ? start : null
  while (el && el !== stop) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + H_SCROLL_SLOP) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

/** Wires both behaviors onto the shell's scroll container. */
export function useStandardIOSGestures(mainRef: RefObject<HTMLElement | null>) {
  const router = useRouter()
  useEffect(() => {
    const main = mainRef.current
    if (!main) return

    // pan-y: without this WebKit may claim a horizontal drag for (rubber-band)
    // scrolling of this vertical container and fire touchcancel — the swipe
    // then never reaches touchend. Descendant horizontal scrollers (hero
    // carousel, 予約 grid) keep their own default touch-action, so they still
    // pan horizontally; only MAIN's own horizontal panning is ruled out.
    const prevTouchAction = main.style.touchAction
    main.style.touchAction = 'pan-y'

    const onStatusTap = () => main.scrollTo({ top: 0, behavior: 'smooth' })
    window.addEventListener('karute:status-tap', onStatusTap)

    // touchend/touchcancel attach DIRECTLY to the touchstart target, per
    // gesture — not to main. iOS keeps delivering a touch to its original
    // element even after React unmounts it mid-gesture (予約's refetch swaps
    // rows under the finger), and a detached node's events never bubble — a
    // main-level touchend listener silently loses exactly those swipes.
    let detachGesture: (() => void) | null = null
    const onTouchStart = (e: TouchEvent) => {
      detachGesture?.()
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const s = {
        x: t.clientX,
        y: t.clientY,
        t: Date.now(),
        scroller: insideHorizontalScroller(e.target, main),
      }
      const node = e.target
      if (!node) return
      const onEnd = (ev: Event) => {
        detachGesture?.()
        if (s.scroller) return
        const end = (ev as TouchEvent).changedTouches[0]
        if (!end) return
        const input = {
          from: location.pathname,
          dx: end.clientX - s.x,
          dy: end.clientY - s.y,
          durationMs: Date.now() - s.t,
          startX: s.x,
          viewportWidth: window.innerWidth,
        }
        const target = swipeTarget(input)
        if (target) router.push(target)
      }
      const onCancel = () => detachGesture?.()
      node.addEventListener('touchend', onEnd, { passive: true })
      node.addEventListener('touchcancel', onCancel, { passive: true })
      detachGesture = () => {
        detachGesture = null
        node.removeEventListener('touchend', onEnd)
        node.removeEventListener('touchcancel', onCancel)
      }
    }

    main.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      main.style.touchAction = prevTouchAction
      window.removeEventListener('karute:status-tap', onStatusTap)
      main.removeEventListener('touchstart', onTouchStart)
      detachGesture?.()
    }
  }, [mainRef, router])
}
