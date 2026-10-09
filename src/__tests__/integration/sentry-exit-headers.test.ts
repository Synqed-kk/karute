// N6 — the exit keeps its OWN header list (R-S112-6 S4): a name added to the
// hooks' list in sentry-scrub.ts can neither throw in the exit nor drop the event.
jest.mock('@/lib/observability/sentry-scrub', () => {
  const actual = jest.requireActual('@/lib/observability/sentry-scrub')
  return { ...actual, HEADER_ALLOW_LIST: [...actual.HEADER_ALLOW_LIST, 'referer', 'constructor', 'x-new'] }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rebuildEnvelope } = require('@/lib/observability/sentry-exit') as typeof import('@/lib/observability/sentry-exit')

describe('N6 headers: own list, no throw', () => {
  it('names without a shape are dropped by name; the event and the shaped headers stay', () => {
    const drops: string[] = []
    const ev = JSON.parse(`{"event_id": "${'a'.repeat(32)}", "request": {"method": "GET", "headers": {
      "Referer": "https://karute.app/ja/customers/x", "constructor": "x", "x-new": "y", "toString": "z", "__proto__": "p",
      "Accept": "text/html", "host": "karute.app"}}}`)
    const out = rebuildEnvelope([{}, [[{ type: 'event' }, ev]]], (t, r) => drops.push(`${t}:${r}`)) as unknown as unknown[][][]
    expect(drops).toEqual([])
    expect(out).not.toBeNull()
    const req = (out[1][0][1] as Record<string, Record<string, unknown>>).request
    expect(req.headers).toEqual({ accept: 'text/html', host: 'karute.app' })
    expect(Object.getPrototypeOf(req.headers)).toBe(Object.prototype)
  })

  it('the exit no longer imports the hooks header list', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src/lib/observability/sentry-exit.ts'), 'utf8') as string
    expect(src).not.toMatch(/HEADER_ALLOW_LIST/)
  })
})
