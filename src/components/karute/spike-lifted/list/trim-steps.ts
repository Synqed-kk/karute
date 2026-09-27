'use client'

// TRIM STEPS — a one-line row that gives things up, in a fixed order, as the
// phone narrows (⚖ S46 option C, Liam's own rule for the カルテ chip row:
// 「Just slowly cut bits and pieces off as the phone gets more narrow」).
//
// The caller names an ORDERED list of steps. Step k applies only when steps
// 0..k-1 are applied and the row STILL leaves less than TRIM_SPARE_MIN px
// spare — so the result is always a prefix of the list, and a new step slots in
// by inserting it into the array where it belongs (the 新規 chip's count goes
// between the badge step and the own-row step; nothing else moves).
//
// Spare = the px the row may use − the px its items need on ONE line
// (max-content), measured on what is actually rendered. No motion: a trim
// change is instant.
//
// When it measures (⚖ phone motion = butter smooth — never a flash, never
// layout work on scroll):
//  - after every commit that changed what the row holds or the step list:
//    back to nothing trimmed, then walk forward — in a layout effect, whose
//    state updates re-render synchronously before the browser paints, so the
//    whole walk lands in the same frame;
//  - when the row's WIDTH changes (rotation, a resized window): a
//    ResizeObserver restarts the walk inside flushSync, still before paint.
//    Only the width counts — a trim changes the row's height, never its width;
//  - once when the web fonts finish loading (glyph widths change under an
//    unchanged row width, which no ResizeObserver on the row would see).
// A row that is not laid out (display:none, a layout-less test DOM) measures
// 0px available and trims nothing.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'

/** The row must keep at least this many px spare, or the next step applies
 *  (the S45 option-C measurement's rule, c-measure.md). */
export const TRIM_SPARE_MIN = 6

export interface TrimMeasure {
  /** px the row may use — its own width. */
  available: number
  /** px its items need on one line with the steps applied right now. */
  natural: number
}

/** The row's width, and its max-content width (how the S45 fit harness
 *  measured "natural"). */
export function measureRow(row: HTMLElement): TrimMeasure {
  const available = row.clientWidth
  const prev = row.style.width
  row.style.width = 'max-content'
  const natural = row.getBoundingClientRect().width
  row.style.width = prev
  return { available, natural }
}

export function useTrimSteps<S extends string, E extends HTMLElement = HTMLDivElement>(
  /** In trim order. A step with nothing to trim right now should be left out. */
  steps: readonly S[],
  /** Everything the row's natural width depends on, as one string: a change
   *  restarts the walk from nothing trimmed. */
  content: string,
  measure: (row: E) => TrimMeasure = measureRow,
): { ref: RefObject<E | null>; applied: readonly S[]; has: (step: S) => boolean } {
  const ref = useRef<E>(null)
  const [level, setLevel] = useState(0)
  const [pass, setPass] = useState(0)

  // Restart DURING RENDER (React's "adjusting state when a prop changes"
  // recipe), so no committed frame pairs new content with an old trim.
  const key = `${steps.join(' ')}\n${content}`
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setLevel(0)
  }

  useLayoutEffect(() => {
    const row = ref.current
    if (!row || level >= steps.length) return
    const { available, natural } = measure(row)
    if (available <= 0) return
    if (available - natural < TRIM_SPARE_MIN) setLevel(level + 1)
  }, [level, key, pass, steps.length, measure])

  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    const restart = () =>
      flushSync(() => {
        setLevel(0)
        setPass((p) => p + 1)
      })
    let width = row.clientWidth
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (row.clientWidth === width) return
            width = row.clientWidth
            restart()
          })
    ro?.observe(row)
    let live = true
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    if (fonts && fonts.status !== 'loaded') {
      void fonts.ready.then(() => {
        if (live) restart()
      })
    }
    return () => {
      live = false
      ro?.disconnect()
    }
  }, [])

  const applied = steps.slice(0, level)
  return { ref, applied, has: (step) => applied.includes(step) }
}
