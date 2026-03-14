'use client'
import { useState, useEffect, useRef } from 'react'

/**
 * Tracks elapsed recording time in seconds.
 * Returns a formatted MM:SS string and the raw elapsed seconds.
 * Timer runs when `isRunning` is true, FREEZES (does not reset) when false.
 * Resets to 0 when isRunning transitions from false → true (new recording start).
 */
export function useRecordingTimer(isRunning: boolean) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const wasRunningRef = useRef(false)

  useEffect(() => {
    if (isRunning) {
      // Reset if starting fresh (was not running before)
      if (!wasRunningRef.current) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on isRunning false→true transition
        setElapsedSeconds(0)
      }
      wasRunningRef.current = true
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(s => s + 1)
      }, 1000)
    } else {
      // Freeze (do not reset) — paused state keeps the timer value
      if (intervalRef.current) clearInterval(intervalRef.current)
      // Only clear wasRunning when explicitly reset (discard)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning])

  const formatted = formatTime(elapsedSeconds)

  return { elapsedSeconds, formatted }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
