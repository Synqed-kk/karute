// A critically-damped spring, and NOTHING ELSE — the app's own home for it.
//
// ⚖ THE STUDIO MOTION STANDARD, PORTED RATHER THAN RE-INVENTED. This is the
// approved 日付ジャンプ mock's own `makeSpring`
// (date-jump-picker-20260914/DATE-JUMP-PICKER-MOCK.html:465-496), which is
// itself the 録音 mock's — same integrator, same defaults, same `set`/`jump`
// split, same reduced-motion answer. A second easing written by hand beside it
// would be a second motion language on one page, which is the thing the
// standard exists to prevent.
//
// ponytail: duplicate of src/business/lib/spring.ts until the Business-only
// repoint PR lands. The two are the same integrator; they are not ONE file yet
// because the Business fence forbids it in both directions — nothing outside
// Business territory may import Business code (src/__tests__/integration/
// business-isolation.test.ts), and a PR that touches a Business file may touch
// nothing else (scripts/business/check-business-isolation.mjs). Moving the
// shared copy is therefore a Business-only PR of its own, queued.
//
// Two things the Business copy does not have, both straight from the mock
// (DATE-JUMP-PICKER-MOCK.html:493-494): `nudge(velocity)` so a flick's speed
// hands off into the spring instead of being thrown away at pointerup, and
// `value()` so the finger can read where the spring is standing.
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
  /** How close counts as arrived. A panel's 0→1 opacity needs a far finer
   *  epsilon than a track's offset in pixels, which is why it is a knob rather
   *  than a constant. */
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
   *  `onRest`. Used to write the panel's CLOSED style before its first paint,
   *  and to re-seat the month track at 0 in the same paint as a pane re-key. */
  jump: (target: number) => void
  /** Hand the spring a velocity without changing where it is or where it is
   *  going — a flick's px/s at pointerup, so the release continues the throw
   *  instead of restarting from still. */
  nudge: (velocity: number) => void
  /** Where the spring is standing right now — what the finger reads when it
   *  takes over mid-flight. */
  value: () => number
  /** Stop the loop and drop the frame handle — the caller's unmount path. */
  stop: () => void
}

// ⚠ Resolved at CALL time, never captured at module load. A handle taken when
// this module is imported keeps scheduling on whatever `requestAnimationFrame`
// was then — so a test that installs fake timers afterwards drives a global the
// spring is no longer using, and the spring never reaches rest however far the
// clock is advanced. (Same for a DOM that defines rAF after import.)
const DEFAULT_RAF = (cb: (t: number) => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0
const DEFAULT_CANCEL = (handle: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
}

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
    // The caller can flip `reduced` on the options object it handed over while
    // a travel is in the air. `set` honours it on entry; without this check a
    // spring already moving finished its full ~300 ms on motion the user had
    // just switched off, and only the NEXT set landed instantly.
    if (opts.reduced) {
      x = target
      v = 0
      handle = null
      last = 0
      apply(x)
      opts.onRest?.(x)
      return
    }
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
    nudge(velocity) {
      v = velocity
    },
    value() {
      return x
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
