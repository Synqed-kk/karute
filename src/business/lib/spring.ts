// A critically-damped spring, and NOTHING ELSE.
//
// ⚖ THE STUDIO MOTION STANDARD, PORTED RATHER THAN RE-INVENTED. This is the
// approved 録音 mock's own `makeSpring` (RECORDING-DESKTOP-MOCK-v1.html:1135) —
// same integrator, same defaults, same `set`/`jump` split, same reduced-motion
// answer. A second easing written by hand beside it would be a second motion
// language on one page, which is the thing the standard exists to prevent.
//
// PURE OF REACT AND OF THE DOM. It reads no element, measures nothing and knows
// no component: the caller hands it an `apply` and drives it from a ref or a
// rAF. That is what lets one integrator serve a height, a translate and a scale
// without any of the three learning about the others.

/** What a spring is asked to do with its current value, every frame. */
export type SpringApply = (value: number) => void

export interface SpringOptions {
  /** Seconds to settle — the mock's own vocabulary. 0.30 is the house default;
   *  a height panel uses 0.34, a press 0.26. */
  response?: number
  /** 1.0 = critically damped: it arrives without overshooting. The overshoot
   *  curve this family reserves for a press is a CSS cubic-bezier, not this. */
  damping?: number
  /** How close counts as arrived. A press scale needs a far finer epsilon than
   *  a height in pixels, which is why it is a knob rather than a constant. */
  eps?: number
  /** Called once, when the spring actually comes to rest — never on `jump`,
   *  which re-seats the integrator mid-flight and is not an arrival. */
  onRest?: (value: number) => void
  /** ⚠ REDUCED MOTION IS A CONSTRUCTOR ARGUMENT, not a media query read in
   *  here. A pure module must not touch `window`, and the caller already knows
   *  the answer (it renders a `prefers-reduced-motion` branch anyway). When it
   *  is true every `set` lands instantly — the state still changes, it simply
   *  stops moving, which is the family's own rule. */
  reduced?: boolean
  /** The frame scheduler. Defaults to `requestAnimationFrame` where one exists,
   *  so a test (or a server render that never runs) can drive it by hand. */
  raf?: (cb: (t: number) => void) => number
  cancel?: (handle: number) => void
}

export interface Spring {
  /** Animate toward `target`. */
  set: (target: number) => void
  /** Re-seat the integrator AT `target` with zero velocity: no motion, no
   *  `onRest`. Used to hand a collapse panel its measured height before it
   *  starts moving, and to place the segmented thumb on first layout. */
  jump: (target: number) => void
  /** Stop the loop and drop the frame handle — the caller's unmount path. */
  stop: () => void
}

const DEFAULT_RAF: (cb: (t: number) => void) => number =
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame : () => 0
const DEFAULT_CANCEL: (h: number) => void =
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : () => {}

/**
 * One integrator, reused by every spring on the page.
 *
 * The maths is the mock's, unchanged: an angular frequency derived from the
 * response time, an acceleration of `-w²(x - target) - 2ζwv`, and a rest test on
 * both the distance and the velocity — a spring that stopped on distance alone
 * would freeze at the top of its travel while still moving.
 *
 * `dt` is CLAMPED to 1/30s. A backgrounded tab hands the first frame after it
 * wakes a delta measured in seconds, and an unclamped integrator answers that
 * with a single enormous step — the panel jumps past its target and swings back.
 */
export function makeSpring(apply: SpringApply, opts: SpringOptions = {}): Spring {
  const response = opts.response ?? 0.3
  const damping = opts.damping ?? 1.0
  const eps = opts.eps ?? 0.08
  const raf = opts.raf ?? DEFAULT_RAF
  const cancel = opts.cancel ?? DEFAULT_CANCEL
  const w = (2 * Math.PI) / response

  let x = 0
  let v = 0
  let target = 0
  let handle: number | null = null
  let last = 0

  function frame(t: number) {
    if (!last) last = t
    const dt = Math.min((t - last) / 1000, 1 / 30)
    last = t
    const a = -w * w * (x - target) - 2 * damping * w * v
    v += a * dt
    x += v * dt
    if (Math.abs(x - target) < eps && Math.abs(v) < eps * 8) {
      x = target
      v = 0
      handle = null
      last = 0
      apply(x)
      opts.onRest?.(x)
      return
    }
    apply(x)
    handle = raf(frame)
  }

  return {
    set(next) {
      target = next
      if (opts.reduced) {
        x = next
        v = 0
        apply(x)
        opts.onRest?.(x)
        return
      }
      if (handle === null) {
        last = 0
        handle = raf(frame)
      }
    },
    jump(next) {
      target = next
      x = next
      v = 0
      if (handle !== null) {
        cancel(handle)
        handle = null
        last = 0
      }
      apply(x)
    },
    stop() {
      if (handle !== null) {
        cancel(handle)
        handle = null
        last = 0
      }
    },
  }
}
