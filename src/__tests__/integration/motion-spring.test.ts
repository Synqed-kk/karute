/**
 * The studio spring (src/lib/motion/spring.ts) — the integrator the 日付ジャンプ
 * panel's open/close and month slide both run on.
 *
 * Driven by an INJECTED `raf`, never the real one: a spring tested through a
 * real frame loop is a test of the browser's scheduler. Every frame here is a
 * hand-stepped timestamp, so "reaches rest", "calls onRest exactly once" and
 * "nudge changed the next step" are facts about the maths rather than about how
 * busy the machine was.
 */
import { makeSpring } from '@/lib/motion/spring'

/** A frame scheduler under the test's thumb: `step(ms)` runs one frame. */
function driver() {
  let queued: ((t: number) => void) | null = null
  let cancelled = 0
  let t = 0
  return {
    raf: (cb: (time: number) => void) => {
      queued = cb
      return 1
    },
    cancel: () => {
      queued = null
      cancelled += 1
    },
    get cancelled() {
      return cancelled
    },
    get pending() {
      return queued !== null
    },
    /** Advance one frame of `ms`. Returns false when nothing was scheduled. */
    step(ms = 16) {
      const cb = queued
      if (!cb) return false
      queued = null
      t += ms
      cb(t)
      return true
    },
    /** Run frames until the loop stops, with a hard ceiling. */
    run(maxFrames = 600, ms = 16) {
      let n = 0
      while (this.step(ms)) {
        n += 1
        if (n >= maxFrames) break
      }
      return n
    },
  }
}

describe('the spring reaches rest and says so once', () => {
  it('animates from 0 to 1 and calls onRest exactly once, at the target', () => {
    const d = driver()
    const seen: number[] = []
    const rests: number[] = []
    const spring = makeSpring((v) => seen.push(v), {
      response: 0.3,
      damping: 1,
      eps: 0.004,
      onRest: (v) => rests.push(v),
      raf: d.raf,
      cancel: d.cancel,
    })

    spring.set(1)
    const frames = d.run()

    expect(frames).toBeGreaterThan(6) // a real curve, not a jump
    expect(frames).toBeLessThan(120) // and it does settle
    expect(seen[0]).toBeLessThan(0.5) // it started near the closed end
    expect(seen[seen.length - 1]).toBe(1)
    expect(rests).toEqual([1])
    expect(spring.value()).toBe(1)
    // Critically damped: it arrives without ever passing the target.
    expect(Math.max(...seen)).toBeLessThanOrEqual(1)
    // And monotonic on the way there — the panel never dips back.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  })

  it('a second set mid-flight reverses from where it stands, not from 0', () => {
    const d = driver()
    const seen: number[] = []
    const spring = makeSpring((v) => seen.push(v), {
      eps: 0.004,
      raf: d.raf,
      cancel: d.cancel,
    })
    spring.set(1)
    d.step()
    d.step()
    d.step()
    const mid = spring.value()
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)

    spring.set(0)
    const after = seen.length
    d.step()
    // The very next frame continues FROM `mid` — the velocity it had is still
    // carrying it, so it does not teleport to 0 and does not restart from 0.
    expect(Math.abs(seen[after] - mid)).toBeLessThan(0.05)
    expect(seen[after]).toBeGreaterThan(mid / 2)
    // …and from there it comes all the way back down the same path.
    d.run()
    expect(spring.value()).toBe(0)
    expect(seen[seen.length - 1]).toBe(0)
  })
})

describe('jump re-seats without moving and without arriving', () => {
  it('writes the value immediately and never calls onRest', () => {
    const d = driver()
    const seen: number[] = []
    const onRest = jest.fn()
    const spring = makeSpring((v) => seen.push(v), { onRest, raf: d.raf, cancel: d.cancel })

    spring.jump(0)
    expect(seen).toEqual([0]) // applied synchronously, in the caller's frame
    expect(onRest).not.toHaveBeenCalled()
    expect(d.pending).toBe(false) // and it scheduled nothing

    spring.jump(-377)
    expect(spring.value()).toBe(-377)
    expect(onRest).not.toHaveBeenCalled()
  })

  it('cancels a loop in flight', () => {
    const d = driver()
    const spring = makeSpring(() => {}, { raf: d.raf, cancel: d.cancel })
    spring.set(1)
    d.step()
    expect(d.pending).toBe(true)
    spring.jump(0)
    expect(d.cancelled).toBe(1)
    expect(d.pending).toBe(false)
    expect(spring.value()).toBe(0)
  })
})

describe('reduced motion', () => {
  it('lands instantly on set, applies once, and still calls onRest', () => {
    const d = driver()
    const seen: number[] = []
    const onRest = jest.fn()
    const spring = makeSpring((v) => seen.push(v), {
      reduced: true,
      onRest,
      raf: d.raf,
      cancel: d.cancel,
    })

    spring.set(1)
    expect(seen).toEqual([1])
    expect(onRest).toHaveBeenCalledTimes(1)
    expect(onRest).toHaveBeenCalledWith(1)
    // No frame was ever scheduled — the state changed, it simply did not move.
    expect(d.pending).toBe(false)
  })
})

describe('a flip to reduce mid-flight', () => {
  it('lands the spring at once instead of finishing on physics', () => {
    const d = driver()
    const seen: number[] = []
    const onRest = jest.fn()
    // The caller owns the flag and flips it on the options object it handed
    // over (the panel does exactly that: `slideOpts.reduced = reduced` during
    // render). `set` honours it on entry — but a travel already in the air
    // kept running the full ~300 ms on motion the user had just switched off.
    const opts = { eps: 0.4, onRest, raf: d.raf, cancel: d.cancel, reduced: false }
    const spring = makeSpring((v) => seen.push(v), opts)

    spring.set(-377)
    d.step()
    d.step()
    const mid = spring.value()
    expect(mid).toBeLessThan(0)
    expect(mid).toBeGreaterThan(-377)
    expect(onRest).not.toHaveBeenCalled()

    opts.reduced = true
    d.step()
    expect(spring.value()).toBe(-377)
    expect(seen[seen.length - 1]).toBe(-377)
    expect(onRest).toHaveBeenCalledTimes(1)
    expect(onRest).toHaveBeenCalledWith(-377)
    // …and the loop is over — nothing is left scheduled.
    expect(d.pending).toBe(false)
  })
})

describe('nudge hands a flick into the spring', () => {
  it('changes the next frame’s step', () => {
    const plain = driver()
    const flicked = driver()
    const a: number[] = []
    const b: number[] = []
    const mk = (d: ReturnType<typeof driver>, out: number[]) =>
      makeSpring((v) => out.push(v), { eps: 0.4, raf: d.raf, cancel: d.cancel })

    const s1 = mk(plain, a)
    const s2 = mk(flicked, b)
    s1.set(-377)
    s2.nudge(-1200) // px/s, the same sign as the travel
    s2.set(-377)

    // The first frame of a fresh `set` measures no elapsed time (the mock's own
    // `last = 0` seeding), so the flick shows up on the frame after it.
    plain.step()
    plain.step()
    flicked.step()
    flicked.step()
    // The flicked spring is further along after two identical frames.
    expect(b[1]).toBeLessThan(a[1])
  })

  it('does not change the target, only the speed', () => {
    const d = driver()
    const spring = makeSpring(() => {}, { eps: 0.4, raf: d.raf, cancel: d.cancel })
    spring.set(-377)
    spring.nudge(-2000)
    d.run()
    expect(spring.value()).toBe(-377)
  })
})

describe('stop', () => {
  it('cancels the frame loop and leaves the value where it was', () => {
    const d = driver()
    const spring = makeSpring(() => {}, { raf: d.raf, cancel: d.cancel })
    spring.set(1)
    d.step()
    d.step()
    const where = spring.value()
    spring.stop()
    expect(d.cancelled).toBe(1)
    expect(d.pending).toBe(false)
    expect(spring.value()).toBe(where)
  })
})

describe('value() tracks x', () => {
  it('follows the integrator frame by frame', () => {
    const d = driver()
    const seen: number[] = []
    const spring = makeSpring((v) => seen.push(v), { eps: 0.004, raf: d.raf, cancel: d.cancel })
    spring.set(1)
    for (let i = 0; i < 4; i += 1) {
      d.step()
      expect(spring.value()).toBe(seen[seen.length - 1])
    }
  })

  it('a long frame cannot fling it past the target (dt is clamped to 1/30 s)', () => {
    const run = (secondFrameMs: number) => {
      const d = driver()
      const seen: number[] = []
      const spring = makeSpring((v) => seen.push(v), { eps: 0.004, raf: d.raf, cancel: d.cancel })
      spring.set(1)
      d.step(16) // seeds the clock; this frame measures no elapsed time
      d.step(secondFrameMs)
      return seen[seen.length - 1]
    }
    // A backgrounded tab's first frame back hands over five seconds of delta.
    // Clamped, it steps exactly as far as a 1/30 s frame would — no further.
    const clamped = run(1000 / 30)
    const enormous = run(5000)
    expect(enormous).toBeCloseTo(clamped, 10)
    expect(enormous).toBeLessThanOrEqual(1)
    expect(enormous).toBeGreaterThan(0)
  })
})
