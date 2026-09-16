'use client'

// ONE horizontal slide gesture, for every three-pane track this app slides.
//
// This is the 日付ジャンプ panel's own gesture, LIFTED rather than re-described:
// the pointer tracking, the 6 px axis lock, the "distance OR speed" commit
// rule, the flick's velocity handed into the spring, the interruption rule (a
// new intention LANDS what is moving before it starts its own) and the re-seat
// under a finger that takes over mid-flight are the lines that shipped in
// DateJumpPanel.tsx, moved here unchanged. The panel adopts it; the 予約 page's
// 日/週/月 body adopts it too, so the two surfaces cannot drift into two
// different feelings of the same gesture.
//
// WHAT IT DOES NOT OWN, on purpose: the panes, their keys, what a commit MEANS
// (a month in the panel, a date in the page), and any pixel other than the
// track's own transform. The host hands over `apply`-adjacent callbacks and
// keeps its own reducer — which is what lets one gesture drive a month track
// that also interpolates a grid's height and a page track that does not.
//
// NO LIBRARY. The integrator is the house spring (src/lib/motion/spring.ts),
// the same one the panel, 録音, Today and Settings already run on.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { makeSpring, type Spring, type SpringOptions } from './spring'

/**
 * `prefers-reduced-motion`, as a boolean this family's springs can be handed.
 * Lives beside the gesture because every host of it needs the same answer and
 * a second copy is how two surfaces start disagreeing about one setting.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    // A DOM without matchMedia (jsdom) means "no preference expressed" — the
    // caller keeps its motion rather than refusing to mount.
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Finger travel before the gesture claims an axis (MOCK 1345). */
export const AXIS_LOCK_PX = 6
/** Fraction of the pane's width that commits on release (MOCK 1365). */
export const COMMIT_FRACTION = 0.25
/** px/s — a flick commits regardless of distance (MOCK 1365-1366). */
export const COMMIT_VELOCITY = 550
/** Upward travel that fires `onSwipeUp`. */
export const SWIPE_UP_PX = 40

export interface HorizontalSlideOptions {
  /** How far one pane travels, measured WHEN IT IS NEEDED (never cached across
   *  a rotate). The host owns the measurement because it owns the element. */
  width: () => number
  /** The armed shift LANDS. Called with -1 or 1, at the spring's rest or the
   *  moment a new intention takes over. The host moves its own state here. */
  onCommit: (dir: -1 | 1) => void
  /** The armed direction changed (0 = disarmed). The host's chance to arm
   *  whatever else the travel interpolates — the panel's two grid heights. */
  onArm?: (dir: number) => void
  /** A fast upward swipe (the panel closes on it). Absent = no vertical verb,
   *  and a vertical intent simply yields to the page's own scrolling. */
  onSwipeUp?: () => void
  /** A pointer landed. The panel draws both neighbour months here, before the
   *  first move can measure them. */
  onGestureStart?: () => void
  /** Extra pixels this travel writes every frame, after the track's transform
   *  — the panel's interpolated grid height. NEVER React state: this runs
   *  inside the spring's own callback. */
  onFrame?: (x: number) => void
  /** `prefers-reduced-motion`. Live: the spring reads it off the options
   *  object it was handed, so a travel already in the air honours a change. */
  reduced: boolean
}

export interface HorizontalSlide {
  /** Spread onto the element that owns the gesture. */
  bind: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
  }
  /** The strip the spring translates — put it on the three-pane track. */
  trackRef: RefObject<HTMLDivElement | null>
  /** The armed direction as RENDER state, because the host's JSX needs it too
   *  (which pane may take a tap). */
  dir: number
  /** Bumped by every new travel request, so the host's layout effect — the one
   *  that calls `reseat` after its panes have re-keyed — has something to key
   *  on besides its own data. */
  travel: number
  /** Land the armed shift NOW. The interruption rule: a second intention
   *  closes the travel in flight before it opens its own. */
  commitPending: () => void
  /** Start a travel of `delta` (an arrow tap). */
  go: (delta: -1 | 1) => void
  /** Re-seat the track and (re)start the travel that is waiting. The host runs
   *  this in a LAYOUT effect, after the panes have re-keyed — the heights a
   *  host measures in `onArm` are then the panes actually on screen. */
  reseat: () => void
  /** Land nothing, arm nothing, sit at 0 — a travel left in flight across an
   *  open/close walked the panel off the month it had just reopened on. */
  reset: () => void
  /** Where the track is standing right now. */
  value: () => number
}

/**
 * @see DateJumpPanel.tsx for the field history behind every rule in here.
 */
export function useHorizontalSlide(options: HorizontalSlideOptions): HorizontalSlide {
  // ⚠ ONE holder, re-pointed every render. The spring is built ONCE and its
  // callbacks live for the component's life, so anything they read has to come
  // through here — a closed-over `onCommit` would be the one from the render
  // that happened to construct the spring. A mutated field on a long-lived
  // object, exactly like `slideOpts.reduced` below, rather than a ref written
  // in the render pass (which the repo's react-hooks/refs rule forbids).
  const held = useRef<{ o: HorizontalSlideOptions }>({ o: options }).current
  held.o = options

  const trackRef = useRef<HTMLDivElement>(null)

  /** The shift this travel commits when the spring comes to rest. */
  const pendingRef = useRef(0)
  /** The same number as RENDER state, because the host's JSX needs it too. A
   *  ref alone cannot re-render the panes when a flick arms a shift at
   *  pointerup. Both are written through `setPending` and never apart. */
  const [dir, setDir] = useState(0)
  const setPending = useCallback((k: number) => {
    pendingRef.current = k
    setDir(k)
  }, [])

  const [travel, setTravel] = useState(0)

  /** The live gesture. `null` = no finger owns the track. */
  const gesture = useRef<{
    id: number
    x0: number
    y0: number
    dx: number
    dir: number
    lastX: number
    lastT: number
    velocity: number
    axis: 'none' | 'x' | 'y'
  } | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `held` is one stable object
  const arm = useCallback((k: number) => held.o.onArm?.(k), [])

  /** MOCK 1079-1087. Lands the armed shift. The track's re-seat is NOT done
   *  here: it belongs to the same paint as the host's pane re-key, which is
   *  `reseat` — otherwise one frame shows the pane that just landed sitting at
   *  the old one's offset. */
  const commitPending = useCallback(() => {
    const k = pendingRef.current
    if (!k) return
    setPending(0)
    held.o.onCommit(k as -1 | 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `held` is one stable object
  }, [setPending])

  const slideOpts = useRef<SpringOptions>({
    response: 0.3,
    damping: 1,
    eps: 0.4,
    // `commitPending` reads only refs and `held`, so the one captured here is
    // the one every later render would have handed over anyway.
    onRest: () => commitPending(),
  }).current
  // Reduced motion: every `set` lands instantly. A slide has no fade to play
  // instead, so the pane is simply there.
  slideOpts.reduced = options.reduced

  const springRef = useRef<Spring | null>(null)
  if (!springRef.current) {
    springRef.current = makeSpring((x) => {
      const track = trackRef.current
      if (track) track.style.transform = `translate3d(${x}px,0,0)`
      held.o.onFrame?.(x)
    }, slideOpts)
  }
  const spring = springRef.current
  useEffect(() => () => spring.stop(), [spring])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `held` is one stable object
  const paneW = useCallback(() => held.o.width(), [])

  const reseat = useCallback(() => {
    const g = gesture.current
    if (g && g.axis === 'x') {
      // A finger owns the track — re-seat under it, not at 0.
      spring.jump(g.dx)
      arm(g.dir)
      return
    }
    spring.jump(0)
    const k = pendingRef.current
    arm(k)
    if (k) spring.set(-k * paneW())
  }, [spring, arm, paneW])

  /** MOCK 1134-1141. A second tap mid-slide LANDS the first instantly and then
   *  slides the next: the taps cannot race each other, because each one closes
   *  the travel before it opens its own. No queue, no commit timer. */
  const go = useCallback(
    (delta: -1 | 1) => {
      commitPending()
      setPending(delta)
      setTravel((n) => n + 1)
    },
    [commitPending, setPending],
  )

  const reset = useCallback(() => {
    setPending(0)
    spring.jump(0)
    arm(0)
  }, [setPending, spring, arm])

  // ── gestures: horizontal = slide, upward = the host's own verb ────────────
  // No rubber-band: neither track has a bound for a band to push back from.
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // ONE FINGER OWNS THE TRACK. Pointer capture is per-pointer-id, so a
    // second finger landing mid-drag (a palm, a second thumb) still reaches
    // this handler — and overwriting the single gesture slot froze the track
    // where the first finger left it: the first finger's moves were then
    // ignored (wrong id) and the second's release had no x-axis to settle.
    if (gesture.current?.axis === 'x') return
    held.o.onGestureStart?.()
    // Deliberately does NOT touch the slide — committing here changed the pane
    // under the finger between pointerdown and click, and she tapped 9/1 and
    // landed on 10/1 (R10). A tap leaves the travel in flight to its own spring.
    gesture.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      dir: 0,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
      axis: 'none',
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (g.axis === 'none') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (g.axis === 'x') {
        // NOW it is a drag, and a drag is a new intention: land what is moving
        // so the finger takes over from rest. Nothing inside can be tapped past
        // this point — the pointer is captured by the track's owner.
        commitPending()
        // Optional call: a stub DOM may not implement pointer capture, and the
        // drag still works without it.
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
    }
    if (g.axis === 'y') {
      if (dy <= -SWIPE_UP_PX) {
        gesture.current = null
        held.o.onSwipeUp?.()
      }
      return
    }
    const dt = Math.max(1, e.timeStamp - g.lastT)
    // px/s — the unit the spring's nudge speaks (MOCK 1351).
    g.velocity = ((e.clientX - g.lastX) / dt) * 1000
    g.lastX = e.clientX
    g.lastT = e.timeStamp
    const k0 = dx < 0 ? 1 : -1
    if (k0 !== g.dir) {
      g.dir = k0
      arm(k0)
    }
    g.dx = dx
    spring.jump(dx)
    e.preventDefault()
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current
    // Only the pointer that owns the gesture may end it (see onPointerDown).
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    // A gesture that never claimed the x axis never wrote the track: only an
    // x-owner does, so the x-owner's own up/cancel is the only settle there has
    // ever been anything to settle.
    if (g.axis !== 'x') return
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // MOCK 1364-1370: distance OR speed commits, and the flick's velocity is
    // handed into the spring so the release continues the throw.
    const dx = spring.value()
    const width = paneW()
    const k =
      dx < -width * COMMIT_FRACTION || g.velocity < -COMMIT_VELOCITY
        ? 1
        : dx > width * COMMIT_FRACTION || g.velocity > COMMIT_VELOCITY
          ? -1
          : 0
    spring.nudge(g.velocity)
    setPending(k)
    arm(k)
    spring.set(k ? -k * width : 0)
  }

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
    trackRef,
    dir,
    travel,
    commitPending,
    go,
    reseat,
    reset,
    value: () => spring.value(),
  }
}
