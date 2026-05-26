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

import { useCallback, useRef } from 'react'

interface UseLongPressOptions {
  /** Threshold in ms. Default 450. */
  thresholdMs?: number
  /** Fires when the user holds past the threshold. */
  onLongPress: () => void
  /** Optional — fires on a regular tap (held < threshold). */
  onShortTap?: () => void
}

export function useLongPress({
  thresholdMs = 450,
  onLongPress,
  onShortTap,
}: UseLongPressOptions) {
  const timer = useRef<number | null>(null)
  const firedLong = useRef(false)

  const start = useCallback(() => {
    firedLong.current = false
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

  const end = useCallback(() => {
    cancel()
    if (!firedLong.current && onShortTap) {
      onShortTap()
    }
  }, [cancel, onShortTap])

  return {
    onPointerDown: start,
    onPointerUp: end,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  }
}
