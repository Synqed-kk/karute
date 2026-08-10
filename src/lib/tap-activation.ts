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
// document-level listeners, and the ONLY preventDefault on the touch path is
// in touchend's accepted-tap branch — by then the finger is off the glass and
// the gesture is already classified a clean tap, so a horizontal scroller, a
// `data-gesture-inert` subtree, and thin/gestures.ts's <main>-only swipe
// machinery are all unreachable from it. Its one job is suppressing the
// compatibility click: Chromium hit-tests that click at DISPATCH time, ~20ms
// after touchend, so it lands on whatever `activate()` mounted under the
// finger in the meantime — not on the element that was tapped. WebKit targets
// the touchstart-time element instead, which is why only Chromium sees it.

import type { MouseEvent, TouchEvent } from 'react'

/** Finger travel past this is a scroll/drag, not a tap (px, straight-line).
 *  Same 10px slop iOS itself uses, and the same as useLongPress. */
const MOVE_TOLERANCE_PX = 10
/** Held longer than this is a press-and-think, not a tap. */
const MAX_TAP_MS = 500

type TapState = {
  /** Touch.identifier of the finger this gesture is tracking. */
  id: number
  x: number
  y: number
  t: number
  /** Sticky: set the moment the finger EVER leaves the slop, never unset. */
  moved: boolean
  swallowClick: boolean
}

/** Just the fields the classification reads. Structural on purpose: React's
 *  TouchList type and lib.dom's are not assignable to each other, and the
 *  loop below needs neither's extras. (React's TouchList does carry an
 *  `identifiedTouch` method — do NOT use it: it was dropped from the spec and
 *  Safari, the one engine that matters here, has never shipped it.) */
type TouchLike = { identifier: number; clientX: number; clientY: number }

/** The tracked finger inside a TouchList, or null if it isn't in there.
 *  Every list on a touch event is GLOBAL — a thumb resting on the frame or a
 *  palm elsewhere on screen is in `touches` too, and `[0]` is then somebody
 *  else's finger. Reading index 0 made a stationary tap look like a huge drag
 *  and spuriously cancelled it, which is the "footer doesn't respond" report
 *  all over again for two-handed use. Match by identifier, never by position.
 *  Manual loop rather than Array.from().find(): no allocation on a handler
 *  that fires at touch-sample rate, and fewer bytes in the shell bundle. */
function trackedTouch(list: ArrayLike<TouchLike>, id: number): TouchLike | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === id) return list[i]
  }
  return null
}

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
      // ponytail: a fresh touchstart also clears a swallowClick left set by a
      // tap whose click iOS never delivered. Ceiling: on a rapid same-element
      // double-tap, tap #1's late click can land AFTER this reset and slip
      // through unswallowed — harmless for tab/menu-item pushes
      // (same-destination) and the dismiss controls (idempotent close), with
      // ONE exception: the メニュー toggle, where the slipped click reads as a
      // phantom extra toggle. Needs a same-element re-tap racing a delayed
      // click, so it's rarer than the momentum-swallow this file fixes.
      // Upgrade path if it's ever observed: age the flag by timestamp
      // instead of clearing it.
      taps.set(e.currentTarget, {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        t: Date.now(),
        moved: false,
        swallowClick: false,
      })
    },
    // Sticky cancel. Classifying on the ENDPOINT alone called a drag that
    // wandered past the slop and came back a tap — an unintended navigate /
    // toggle / recording-stop on what the user meant as a scroll. Once the
    // finger leaves the slop the gesture is a drag forever, however it lands.
    // Passive: never preventDefault here, so a horizontal scroller or a
    // `data-gesture-inert` subtree could not be affected even if this util
    // ever escaped the bar.
    onTouchMove: (e: TouchEvent<Element>) => {
      const s = taps.get(e.currentTarget)
      if (!s || s.moved) return
      // Absent → this move is some OTHER finger's; ours hasn't budged.
      const t = trackedTouch(e.touches, s.id)
      if (!t) return
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
        s.moved = true
      }
    },
    onTouchEnd: (e: TouchEvent<Element>) => {
      const s = taps.get(e.currentTarget)
      // No matching touchstart on this element → a phantom end (the finger
      // started elsewhere, or a second finger lifted). Not ours.
      if (!s) return
      // changedTouches is global too: a simultaneous two-finger lift puts both
      // in the list and `[0]` can be the finger we never tracked. Ours absent
      // → this end isn't about our finger; leave the state alone so its own
      // touchend can still classify it.
      const end = trackedTouch(e.changedTouches, s.id)
      if (!end) return
      // ponytail: a finger still resting elsewhere at release bails here.
      // Adjudicated: a clean tap means every finger is up. Upgrade path if a
      // resting thumb ever costs real taps: drop the guard and rely on the
      // per-identifier tracking above, which already isolates our finger.
      if (e.touches.length !== 0) {
        taps.delete(e.currentTarget)
        return
      }
      const dx = end.clientX - s.x
      const dy = end.clientY - s.y
      // Endpoint distance is kept ALONGSIDE the sticky flag, not replaced by
      // it: touchmove can be coalesced or dropped under load, so a displaced
      // release with no surviving move event must still fail.
      //
      // A rejected gesture drops its state entirely — no activation AND no
      // swallow flag. If iOS then synthesizes a click for it, the plain
      // onClick path handles it exactly as the pre-fix code did: this can
      // degrade to today's behavior, never below it.
      if (
        s.moved ||
        dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX ||
        Date.now() - s.t > MAX_TAP_MS
      ) {
        taps.delete(e.currentTarget)
        return
      }
      // Suppress the compatibility click at source. Under Chromium the
      // full-viewport scrim `activate()` is about to mount receives that click
      // and closes the sheet the same tap just opened (メニュー, measured on
      // device 2026-08-10: open at +8ms, closed at +22ms) — the per-element
      // swallow flag below cannot reach it, because the click never touches
      // this element.
      //
      // Ceiling: touchend is cancelable here — React attaches it actively,
      // passivizing only touchstart/touchmove/wheel — UNLESS the engine has
      // already consumed the sequence for scrolling, which is exactly the
      // momentum tap #648 exists for. There the guard no-ops and the ghost
      // click can return; the swallowClick backstop below covers what it can
      // of that case (whatever lands on this same element).
      if (e.cancelable) e.preventDefault()
      // Backstop, kept for engines that deliver the click regardless.
      s.swallowClick = true
      activate()
    },
    onClick: (e: MouseEvent<Element>) => {
      const s = taps.get(e.currentTarget)
      if (s?.swallowClick) {
        // touchend already activated, and its preventDefault should have
        // suppressed this click — so getting here means the engine delivered
        // one anyway (iOS synthesizes some outside the compatibility path).
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
