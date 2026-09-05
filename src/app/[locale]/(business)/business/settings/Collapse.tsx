'use client'

/**
 * 設定 — THE ROOM'S ONE DISCLOSURE, in one place.
 *
 * ⚖ S17 fix round 1 · F15. The room's twenty-two sections fold a row's extra
 * lines behind 詳しく — a real button with `aria-expanded`/`aria-controls`, a
 * height driven by the room's ONE spring, and a content fade behind it. 予約と確保
 * arrived from #812 with its caveat lines stacked in the open at every width, so
 * adopting the row grammar means adopting this disclosure too.
 *
 * It lives in its own file because BOTH files need it and neither may import the
 * other: `SettingsScreen` already imports `StorePolicySection`, so the section
 * importing the screen would be a cycle. One home, two readers — the alternative
 * was a second disclosure grammar on one page, which is the thing the ⚖ Studio
 * standard (「things that look the same must behave the same」) exists to stop.
 *
 * ⚠ NO SECOND EASING. `makeSpring` is the room's only motion engine; this file
 * adds none of its own.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { makeSpring } from '@/business/lib/spring'

/** The 詳しく panel's own response, in seconds. Slower than a thumb because it
 *  is a bigger surface travelling further (⚖ apple-design: response is not a
 *  duration — it is how quickly the value reaches the target). */
export const SPRING_HEIGHT = 0.34

/** A height that travels on the room's own spring, with the content fading
 *  behind it. `height: auto` is restored at rest so a row whose description
 *  rewraps at a new width is not stuck at the height it had at the old one. */
export function Collapse({
  open,
  id,
  reduced,
  children,
}: {
  open: boolean
  id: string
  reduced: boolean
  children: ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const springRef = useRef<ReturnType<typeof makeSpring> | null>(null)
  const builtWith = useRef<boolean | null>(null)
  const first = useRef(true)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const inner = innerRef.current
    if (!wrap || !inner) return
    // Same shape, same reason as `Segment`: rebuilt when `reduced` changes, so
    // the flag is never pinned at whatever it happened to be on the first pass.
    if (!springRef.current || builtWith.current !== reduced) {
      springRef.current?.stop()
      builtWith.current = reduced
      springRef.current = makeSpring(
        (v) => { if (wrapRef.current) wrapRef.current.style.height = `${Math.max(0, v).toFixed(2)}px` },
        {
          response: SPRING_HEIGHT,
          reduced,
          eps: 0.5,
          onRest: (v) => { if (wrapRef.current && v > 0) wrapRef.current.style.height = 'auto' },
        },
      )
    }
    const spring = springRef.current
    if (first.current) {
      first.current = false
      wrap.style.height = open ? 'auto' : '0px'
      spring.jump(open ? inner.scrollHeight : 0)
      return
    }
    // Re-seat at the CURRENT rendered height before moving, so a press during a
    // travel continues from where the panel actually is (⚖ apple-design §3 —
    // animate from the presentation value, never from the target).
    const now = wrap.getBoundingClientRect().height
    wrap.style.height = `${now}px`
    spring.jump(now)
    spring.set(open ? inner.scrollHeight : 0)
  }, [open, reduced])

  useEffect(() => () => springRef.current?.stop(), [])

  return (
    /* ⚠ `height: 0` HIDES A PANEL FROM EYES AND FROM NOBODY ELSE. A collapsed
       disclosure whose content is still in the accessibility tree means a screen
       reader reads four guardrail sentences for EVERY row of a settings page,
       always — the room would be quieter to look at and far louder to listen to.
       The sheet drops `visibility` when it is closed (with the transition
       delayed so the height still animates on the way down), which takes the
       content out of the tree without taking it out of the DOM the spring is
       measuring. `data-open` is what the sheet reads. */
    <div className="st-det-wrap" id={id} ref={wrapRef} data-open={open ? 'true' : 'false'}>
      <div className={`st-det-inner${open ? ' is-in' : ''}`} ref={innerRef}>
        {children}
      </div>
    </div>
  )
}

/** The 詳しく button itself — one markup, so the two files cannot drift into two
 *  disclosures that look alike and behave differently. */
export function DetailToggle({ open, controls, onToggle }: { open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="st-det-btn"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      詳しく
      <span className="st-det-caret" aria-hidden="true">⌄</span>
    </button>
  )
}
