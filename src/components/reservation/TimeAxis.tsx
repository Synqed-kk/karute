'use client'

import { useEffect, useState } from 'react'

export interface BusinessHours {
  start: number // e.g. 10 (10:00)
  end: number   // e.g. 20 (20:00)
}

interface TimeAxisProps {
  businessHours: BusinessHours
  /** Pixels per minute. */
  ppm: number
}

const AXIS_HEIGHT = 32

export function TimeAxis({ businessHours, ppm }: TimeAxisProps) {
  const { start, end } = businessHours
  const hourWidth = ppm * 60
  const hours: number[] = []
  for (let h = start; h <= end; h++) hours.push(h)

  return (
    <div
      className="relative border-b border-border bg-background"
      style={{ height: AXIS_HEIGHT }}
    >
      {hours.map((h, i) => (
        <span
          key={h}
          className="absolute top-1 text-[11px] font-medium tabular-nums text-muted-foreground"
          style={{ left: i * hourWidth }}
        >
          {String(h).padStart(2, '0')}:00
        </span>
      ))}
      {hours.slice(1).map((h, i) => (
        <span
          key={`tick-${h}`}
          className="absolute top-0 h-full w-px bg-border"
          style={{ left: (i + 1) * hourWidth }}
          aria-hidden
        />
      ))}
    </div>
  )
}

interface CurrentTimeIndicatorProps {
  businessHours: BusinessHours
  /** Pixels per minute. */
  ppm: number
  /** Lane container height in px (so the line + badge spans the grid). */
  height: number
}

function useNowEveryMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function CurrentTimeIndicator({ businessHours, ppm, height }: CurrentTimeIndicatorProps) {
  const now = useNowEveryMinute()
  const minutesFromStart = (now.getHours() - businessHours.start) * 60 + now.getMinutes()
  const totalMinutes = (businessHours.end - businessHours.start) * 60
  if (minutesFromStart < 0 || minutesFromStart > totalMinutes) return null

  const left = minutesFromStart * ppm
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <div
      className="pointer-events-none absolute top-0 z-10"
      style={{ left, height }}
      aria-label="current time"
    >
      <span className="absolute -top-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
        {hm}
      </span>
      <span className="absolute top-2 h-full w-px bg-amber-500" />
    </div>
  )
}
