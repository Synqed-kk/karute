// First-paint probe marks (the acceptance gate, §2). Real measurements only —
// no fabricated numbers. The A/B question: does the LOCAL BUNDLE reach first
// pixel faster than the REMOTE SHELL (live site in the WebView) on the SAME
// device? These in-page marks are measured relative to navigationStart; the
// native-launch→first-pixel gap is captured natively (see the run doc).

export const MARKS = {
  firstPixel: 'thin:first-pixel',
  interactive: 'thin:interactive',
  dataReady: 'thin:data-ready',
} as const

export function mark(name: string): void {
  if (typeof performance !== 'undefined') performance.mark(name)
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
