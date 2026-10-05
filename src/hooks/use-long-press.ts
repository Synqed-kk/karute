'use client'

// ─────────────────────────────────────────────────────────────
// useLongPress — press-and-hold hook for discreet reveal UX
// ─────────────────────────────────────────────────────────────
// Lifted from spike: src/lib/use-long-press.ts (verbatim, only
// minor TS style adjustments). Powers the DiscreetRecording-
// Indicator's "regular tap does nothing; hold 450ms reveals
// the popover" pattern.
//
// Threshold 450ms is the spike's empirical sweet spot:
//   <300ms → reads as a regular tap; users often miss it
//   >600ms → feels sluggish + buggy ("why isn't it working?")
//   450ms → clearly intentional, still snappy.
//
// Unified pointer events so touch (mobile) + mouse (desktop)
// behave identically.
//
// Movement tolerance: a drag is neither a tap nor a hold. The
// original relied on the browser's scroll firing pointercancel,
// but when the content FITS the viewport nothing scrolls, no
// pointercancel comes, and a scroll attempt fell through as a
// tap (or a hold, past the threshold). Any pointer travel past
// 10px (iOS's own long-press slop) now cancels both outcomes.

import { useCallback, useRef } from 'react'

/** Pointer travel past this cancels tap AND hold (px, straight-line). */
const MOVE_TOLERANCE_PX = 10

interface UseLongPressOptions {
  /** Threshold in ms. Default 450. */
  thresholdMs?: number
  /** Fires when the user holds past the threshold. */
  onLongPress: () => void
  /** Optional — fires on a regular tap (held < threshold). Runs from the
   *  element's CLICK, not its pointerup: a touch the engine never turns into
   *  a click (one that only stops a scroll glide, or one aimed at the fixed
   *  tab bar that the engine delivered to the row) opens nothing, and
   *  keyboard Enter/Space still opens. */
  onShortTap?: () => void
}

export function useLongPress({
  thresholdMs = 450,
  onLongPress,
  onShortTap,
}: UseLongPressOptions) {
  const timer = useRef<number | null>(null)
  const firedLong = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  const start = useCallback((e: React.PointerEvent) => {
    firedLong.current = false
    moved.current = false
    origin.current = { x: e.clientX, y: e.clientY }
    if (typeof window === 'undefined') return
    timer.current = window.setTimeout(() => {
      firedLong.current = true
      onLongPress()
    }, thresholdMs)
  }, [thresholdMs, onLongPress])

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const move = useCallback((e: React.PointerEvent) => {
    if (moved.current || origin.current === null) return
    const dx = e.clientX - origin.current.x
    const dy = e.clientY - origin.current.y
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
      moved.current = true
      cancel()
    }
  }, [cancel])

  const end = useCallback(() => {
    cancel()
    origin.current = null
  }, [cancel])

  // The tap itself. The click that trails a completed hold, or a drag that
  // left the slop, is swallowed (and the flags reset, so the next click —
  // keyboard included — opens). A click with no pointer sequence at all
  // (Enter/Space) sees both flags false and opens.
  const click = useCallback(() => {
    const swallow = firedLong.current || moved.current
    firedLong.current = false
    moved.current = false
    if (!swallow) onShortTap?.()
  }, [onShortTap])

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: end,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // Only when a tap means something: the hold-only callers spread these
    // handlers next to their own onClick and must keep it.
    ...(onShortTap ? { onClick: click } : {}),
  }
}
