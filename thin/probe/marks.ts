// First-paint probe marks (the acceptance gate, §2). Real measurements only —
// no fabricated numbers. The A/B question: does the LOCAL BUNDLE reach first
// pixel faster than the REMOTE SHELL (live site in the WebView) on the SAME
// device? These in-page marks are measured relative to navigationStart; the
// native-launch→first-pixel gap is captured natively (see the run doc).

export const MARKS = {
  firstPixel: 'thin:first-pixel',
  interactive: 'thin:interactive',
  dataReady: 'thin:data-ready',
  // When the AuthGate actually dropped the native splash (boot gate resolved).
  // firstPixel stays the raw first paint, which lands under the splash — this
  // is the user-visible reveal. Set after reportMarks() on cold boots; read it
  // off performance.getEntriesByName on device runs.
  splashReleased: 'thin:splash-released',
} as const

export function mark(name: string): void {
  // Guard the API, not just the object: jsdom (jest) ships a Performance
  // without user timing.
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function')
    performance.mark(name)
}

/** Log ms-since-navigationStart for every mark set so far. A device run reads
 *  these off the WebView console; repeated cold launches give p50/p95. */
export function reportMarks(): Record<string, number> {
  if (typeof performance === 'undefined') return {}
  const out: Record<string, number> = {}
  for (const name of Object.values(MARKS)) {
    const [entry] = performance.getEntriesByName(name)
    if (entry) out[name] = Math.round(entry.startTime)
  }
  // eslint-disable-next-line no-console
  console.info('[thin probe] marks (ms since navigationStart):', out)
  return out
}
