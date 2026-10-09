/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://karute.test/customers/c-1"}
 */
/**
 * PR-A0 BROWSER canary: the REAL src/instrumentation-client.ts (browser build of
 * @sentry/nextjs, its default BrowserTracing on) with a stubbed window.fetch as
 * the wire. The node SDK sends a standalone span as a `transaction` item (OTel),
 * never as an item of type `span`, so the standalone (INP-shaped) path is only
 * reachable here. Plants: `lcp.url` on the pageload root span (what
 * browserMetrics.js:704 sets) and a standalone span (what INP sends,
 * metrics/utils.js:113-118) with a planted description, `url.full` and `transaction`.
 * The twin sentry-scrub-browser-canary-control.test.ts runs the same pipeline
 * with the scrub options emptied and proves both plants arrive there.
 *
 * PLANT RULE: every plant is joined from fragments.
 */
const C = ['BCAN', 'ARY'].join('')
const LCP = C + '-LCP'
const INP = C + '-INP'

const sent: string[] = []

type Item = { type: string; payload: Record<string, unknown> }

/** Envelope = header line, then (item header line, item payload line) pairs. */
function items(): Item[] {
  const out: Item[] = []
  for (const env of sent) {
    const lines = env.split('\n').filter((l) => l.length > 0)
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const header = JSON.parse(lines[i]) as { type: string }
      out.push({ type: header.type, payload: JSON.parse(lines[i + 1]) as Record<string, unknown> })
    }
  }
  return out
}

function lcpUrl() {
  return 'https://p.supabase.co/storage/v1/object/sign/photos/b/c/a.jpg?token=' + LCP
}

function inpOptions() {
  return {
    name: '/photos?token=' + INP,
    op: 'ui.interaction.click',
    attributes: { transaction: '/c?token=' + INP, 'url.full': 'https://x.test/a?token=' + INP },
    experimental: { standalone: true },
  }
}

async function runPipeline(): Promise<Item[]> {
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.invalid/1'
  jest.spyOn(Math, 'random').mockReturnValue(0.01) // under tracesSampleRate 0.1
  const perf = performance as unknown as Record<string, unknown>
  perf.getEntriesByType = () => []
  perf.getEntries = () => []
  perf.getEntriesByName = () => []
  const w = window as unknown as { fetch: unknown }
  w.fetch = async (_url: string, init: { body: unknown }) => {
    const b = init.body
    sent.push(typeof b === 'string' ? b : new TextDecoder().decode(b as Uint8Array))
    return { status: 200, headers: { get: () => null } }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the SDK must load after the fetch stub
  const Sentry = require('@sentry/nextjs') as typeof import('@sentry/nextjs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- importing runs the real browser init
  require('@/instrumentation-client')
  const root = Sentry.getActiveSpan()
  expect(root).toBeDefined()
  root!.setAttribute('lcp.url', lcpUrl())
  Sentry.startInactiveSpan(inpOptions()).end()
  root!.end()
  await Sentry.flush(3000)
  return items()
}

describe('PR-A0 browser canary: real instrumentation-client with the scrub', () => {
  it('neither the lcp.url plant nor the standalone-span plant leaves', async () => {
    const all = await runPipeline()
    const types = all.map((i) => i.type)
    // Never pass on an empty wire: both item types were sent.
    expect(types).toContain('span')
    expect(types).toContain('transaction')
    expect(sent.join('\n')).not.toContain(C)
    // Positive control: the path survives, only the query is cut.
    const tx = all.find((i) => i.type === 'transaction')!.payload as {
      contexts: { trace: { data: Record<string, unknown> } }
    }
    expect(tx.contexts.trace.data['lcp.url']).toBe('https://p.supabase.co/storage/v1/object/sign/photos/b/c/a.jpg')
    const span = all.find((i) => i.type === 'span')!.payload
    expect(span.description).toBe('/photos')
  }, 20000)
})

// A module, not a global script (the twin declares the same names).
export {}
