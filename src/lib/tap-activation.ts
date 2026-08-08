'use client'

// ─────────────────────────────────────────────────────────────
// tapActivation — activate on touchend, not on a click that may never come
// ─────────────────────────────────────────────────────────────
// Constraint (PR #648, 2026-07-29): the thin shell is a ROOT scroller — the
// DOCUMENT scrolls and the tab bar rides a `fixed inset-x-0 bottom-0` wrapper
// INSIDE that scrolling document (thin/shell.tsx). On iOS WKWebView a touch
// landing while the page still carries scroll momentum is consumed as "arrest
// the scroll": touchstart/touchend are still delivered, but the synthetic
// click is NOT — so an onClick-only control silently does nothing. Rubber-band
// overscroll skews hit-testing on top of that ("it did something else").
// Before #648 the bar lived outside the inner scroll container and never saw
// either failure.
//
// The standard iOS-web answer: run the activation on touchend inside tap
// thresholds, and swallow the follow-up click on the occasions iOS DOES
// deliver one, so nothing fires twice (the bar's stop-recording tap must
// never stop twice).
//
// Scope is deliberately narrow: applied PER ELEMENT by the bottom bar, no
// document-level listeners, and never preventDefault on touchend — so this
// can't reach a horizontal scroller or a `data-gesture-inert` subtree, and
// thin/gestures.ts's <main>-only swipe machinery is untouched.

import type { MouseEvent, TouchEvent } from 'react'

/** Finger travel past this is a scroll/drag, not a tap (px, straight-line).
 *  Same 10px slop iOS itself uses, and the same as useLongPress. */
const MOVE_TOLERANCE_PX = 10
/** Held longer than this is a press-and-think, not a tap. */
const MAX_TAP_MS = 500

type TapState = { x: number; y: number; t: number; swallowClick: boolean }

// Keyed by ELEMENT, not by render closure: CenterRecordButton re-renders every
// second while recording, so per-render state would drop any gesture spanning
// a tick. WeakMap → nothing to clean up when the node goes.
const taps = new WeakMap<Element, TapState>()

/**
 * Handler props to spread onto one interactive element.
 *
 * @param activate what a tap DOES — the touch path runs this directly.
 * @param onClick  the element's existing click handler. Omit and the click
 *                 path calls `activate` too (buttons, where onClick already
 *                 was the activation); pass it for an <a>, whose navigation
 *                 lives in the Link component itself — the mouse/desktop path
 *                 then stays exactly as it was.
 */
export function tapActivation(
  activate: () => void,
  onClick?: (e: MouseEvent<Element>) => void,
) {
  return {
    onTouchStart: (e: TouchEvent<Element>) => {
      if (e.touches.length !== 1) {
        // Multi-touch (pinch, second finger) is never a tab tap.
        taps.delete(e.currentTarget)
        return
      }
      const t = e.touches[0]
      taps.set(e.currentTarget, {
        x: t.clientX,
        y: t.clientY,
        t: Date.now(),
        swallowClick: false,
      })
    },
    onTouchEnd: (e: TouchEvent<Element>) => {
      const s = taps.get(e.currentTarget)
      // No matching touchstart on this element → a phantom end (the finger
      // started elsewhere, or a second finger lifted). Not ours.
      if (!s) return
      const end = e.changedTouches[0]
      if (!end || e.touches.length !== 0) {
        taps.delete(e.currentTarget)
        return
      }
      const dx = end.clientX - s.x
      const dy = end.clientY - s.y
      if (
        dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX ||
        Date.now() - s.t > MAX_TAP_MS
      ) {
        taps.delete(e.currentTarget)
        return
      }
      s.swallowClick = true
      activate()
    },
    onClick: (e: MouseEvent<Element>) => {
      const s = taps.get(e.currentTarget)
      if (s?.swallowClick) {
        // touchend already activated — this is iOS's late synthetic click.
        // preventDefault also stops the <a>'s own navigation: both Link ports
        // (next/link and thin/ports/nav.vite) bail on defaultPrevented, so a
        // tab never navigates twice and a stop never stops twice.
        s.swallowClick = false
        e.preventDefault()
        return
      }
      // ponytail: a tap whose click iOS never delivers leaves swallowClick
      // set until the element's next touchstart clears it. On a touch device
      // the next click is always preceded by that touchstart, so it can only
      // bite a mouse click on a hybrid device — not a shipping surface here.
      if (onClick) onClick(e)
      else activate()
    },
  }
}
