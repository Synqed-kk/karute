'use client'

// Flag-gated cold-start attribution overlay — decomposes cold start into
// WebView boot → network transfer → render/hydration using stdlib
// Performance Timeline APIs only, so Liam can screenshot real numbers off
// his iPhone without a debugger. See karute-phase2 packet
// coldstart-attribution.md for the full brief.
//
// Gate: renders ONLY when `?perfdebug=1` is in the URL or
// localStorage.karutePerfdebug === '1'. The query param flips the
// localStorage flag on so one visit with the param in the shell makes every
// later cold launch show the overlay. Everything (marks, entry reads,
// re-renders) happens inside an effect gated by this check FIRST — flag
// absent means the effect does nothing else.
//
// This is deliberately SEPARATE from the #444 first-painted-frame splash
// script in layout.tsx — do not merge the two or touch that script.

import { useEffect, useState } from 'react'

const FLAG_KEY = 'karutePerfdebug'
const HYDRATION_MARK = 'karute-hydrated'

type Timings = {
  ttfb: number
  transferDone: number
  fcp: number | null
  hydration: number
  total: number
}

function isEnabled(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get('perfdebug') === '1') {
    window.localStorage.setItem(FLAG_KEY, '1')
    return true
  }
  return window.localStorage.getItem(FLAG_KEY) === '1'
}

export function ColdStartOverlay() {
  const [timings, setTimings] = useState<Timings | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isEnabled()) return // zero cost: no marks, no entry reads, no re-render

    // Double rAF so the mark lands after the first painted frame, same
    // reasoning as the splash-hide script (pixels beat interactivity) but a
    // separate mark/effect — this one measures, it doesn't hide anything.
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        performance.mark(HYDRATION_MARK)

        const [nav] = performance.getEntriesByType(
          'navigation'
        ) as PerformanceNavigationTiming[]
        const fcpEntry = performance
          .getEntriesByType('paint')
          .find((entry) => entry.name === 'first-contentful-paint')
        const hydrationEntry = performance.getEntriesByName(HYDRATION_MARK)[0]

        if (!nav || !hydrationEntry) return

        setTimings({
          ttfb: Math.round(nav.responseStart),
          transferDone: Math.round(nav.responseEnd),
          fcp: fcpEntry ? Math.round(fcpEntry.startTime) : null,
          hydration: Math.round(hydrationEntry.startTime),
          total: Math.round(hydrationEntry.startTime),
        })
      })
    })

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [])

  if (!timings || dismissed) return null

  const rows: Array<[string, number | null]> = [
    ['TTFB', timings.ttfb],
    ['Transfer done', timings.transferDone],
    ['FCP', timings.fcp],
    ['Hydration', timings.hydration],
    ['Total', timings.total],
  ]

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        background: 'rgba(0,0,0,0.85)',
        color: '#4ade80',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.6,
        padding: '8px 32px 8px 12px',
        paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
      }}
    >
      <button
        type="button"
        aria-label="Dismiss cold-start overlay"
        onClick={() => {
          window.localStorage.removeItem(FLAG_KEY)
          setDismissed(true)
        }}
        style={{
          position: 'absolute',
          top: 4,
          right: 8,
          background: 'none',
          border: 'none',
          color: '#4ade80',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 4,
        }}
      >
        ×
      </button>
      {rows.map(([label, value]) => (
        <div key={label}>
          {label}: {value === null ? 'n/a' : `${value}ms`}
        </div>
      ))}
    </div>
  )
}
