'use client'

// Hold-to-confirm gesture — fills a pill from 0→1 over `ms`, firing
// onComplete at 1 and bursting away. Extracted from CancelBookingSheet's
// original cancel pill so the no-show pill can reuse the EXACT same
// mechanics (Liam's spec) without duplicating the RAF/pointer plumbing.
// Visual styling stays at the call site — this hook only owns state.

import { useCallback, useEffect, useRef, useState } from 'react'

export function useHoldToConfirm(ms: number, onComplete: () => Promise<void>) {
  const [progress, setProgress] = useState(0)
  const [burst, setBurst] = useState(false)
  const raf = useRef(0)
  const holdStart = useRef(0)
  const firing = useRef(false)

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const reset = useCallback(() => {
    firing.current = false
    setBurst(false)
    setProgress(0)
  }, [])

  const fire = useCallback(async () => {
    if (firing.current) return
    firing.current = true
    setBurst(true)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(30)
    await onComplete()
  }, [onComplete])

  const begin = useCallback(
    (e: React.PointerEvent) => {
      if (firing.current) return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      holdStart.current = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - holdStart.current) / ms)
        setProgress(p)
        if (p >= 1) void fire()
        else raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    },
    [ms, fire],
  )

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    if (!firing.current) setProgress(0)
  }, [])

  return { progress, burst, begin, stop, reset }
}
