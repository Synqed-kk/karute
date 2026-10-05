'use client'

/** ⚖ R93 (S49 fresh eyes) — the room's ONE switch, in its own file so every
 *  section that draws a switch uses this one rather than a copy with its own
 *  thumb CSS. Moved byte-for-byte out of SettingsScreen.tsx; behaviour and look
 *  are unchanged. The selection is an `aria-checked` switch; the thumb is
 *  decoration behind it, `pointer-events: none`, riding the room's spring. */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { makeSpring } from '@/business/lib/spring'
import './switch.css'

/** The response of the two controls whose STATE travels (segment + switch). */
export const SPRING_THUMB = 0.3

/** What a LOCKED control wears instead of `disabled` — the reason, reachable by
 *  keyboard and by a screen reader. Spelled as a type rather than inline so the
 *  two controls whose thumb travels take exactly what `Control` hands them. */
export type InertProps = { 'aria-disabled'?: 'true'; title?: string; 'aria-label'?: string }

/** ⚖ S54 R165(4) — the thumb's travel is NOT measured here. switch.css states
 *  it as a calc of the track's own tokens (track − 2×border − thumb − 2×inset);
 *  this component only rides a 0…1 progress on `--st-sw-p`. A switch mounted
 *  inside a `display: none` panel therefore draws right the moment it is shown
 *  (S54 attack S1: the old mount-time measure read 0 and never re-ran). */
const PROGRESS = '--st-sw-p'

export function Switch({
  on,
  aria,
  ariaLabelledBy,
  onLabel,
  offLabel,
  inert,
  reduced,
  onToggle,
}: {
  on: boolean
  /** The accessible name when no visible label names the switch. */
  aria?: string
  /** WCAG 2.5.3 — a switch with its own visible field label is named BY it (aria-labelledby
   *  instead of aria-label), so the spoken name contains the visible text. */
  ariaLabelledBy?: string
  /** Optional: a switch that has its own field label (特別営業日's 24:00閉店) shows no state word. */
  onLabel?: string
  offLabel?: string
  inert: InertProps
  reduced: boolean
  onToggle?: () => void
}) {
  const thumbRef = useRef<HTMLSpanElement>(null)
  const springRef = useRef<ReturnType<typeof makeSpring> | null>(null)
  const seated = useRef(false)

  /** Built unconditionally, keyed on `reduced`, so the flag can never be pinned
   *  at its first value (the same shape as the room's `Segment`). */
  useLayoutEffect(() => {
    springRef.current?.stop()
    springRef.current = makeSpring(
      (v) => { thumbRef.current?.style.setProperty(PROGRESS, v.toFixed(4)) },
      // eps in progress units: 0.01 of the 18–24px travel ≈ the old 0.3px
      { response: SPRING_THUMB, eps: 0.01, reduced },
    )
    seated.current = false
  }, [reduced])

  useLayoutEffect(() => {
    if (!springRef.current) return
    if (!seated.current) { seated.current = true; springRef.current.jump(on ? 1 : 0); return }
    springRef.current.set(on ? 1 : 0)
  }, [on, reduced])

  useEffect(() => () => springRef.current?.stop(), [])

  return (
    <div className="st-switchline">
      {onLabel !== undefined && offLabel !== undefined && (
        <span className={`st-state${on ? ' is-on' : ''}`}>{on ? onLabel : offLabel}</span>
      )}
      <button
        type="button"
        className="st-switch"
        role="switch"
        aria-checked={on}
        {...(ariaLabelledBy !== undefined ? { 'aria-labelledby': ariaLabelledBy } : { 'aria-label': aria })}
        {...inert}
        onClick={onToggle}
      >
        <span className="st-switch-thumb" aria-hidden="true" ref={thumbRef} />
      </button>
    </div>
  )
}
