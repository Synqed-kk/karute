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
import { KEY32, PHONE_HY } from './helpers/sentry-exit-plants'

const C = ['BCAN', 'ARY'].join('')
const LCP = C + '-LCP'
const INP = C + '-INP'
// item 102 C3: lcp.element on the root span, and THE HEADER PLANT in a route-sourced
// root name (it carries a space so the event-level `transaction` rule drops it too).
const ELEM = C + '-ELEM'
const HDR = C + '-HDR'
const hdrRoute = () => '/ja/customers/' + HDR + ' x'
// item 102 fix batch 1 (N8): phone, key and Bearer plants on the root span's data.
const n8Data = () => ({
  'next.route': '/search/' + PHONE_HY,
  'http.route': '/k/' + KEY32,
  'user_agent.original': 'Mozilla Bearer ' + KEY32.slice(4),
})

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
  root!.setAttribute('lcp.element', 'div.' + ELEM)
  root!.updateName(hdrRoute())
  root!.setAttribute('sentry.source', 'route')
  for (const [k, v] of Object.entries(n8Data())) root!.setAttribute(k, v)
  const inp = Sentry.startInactiveSpan(inpOptions())
  inp.addEvent('inp', { 'sentry.measurement_unit': 'millisecond', 'sentry.measurement_value': 120 })
  inp.end()
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
    for (const p of [PHONE_HY, KEY32.slice(4)]) expect(sent.join('\n')).not.toContain(p)
    const inpSpan = all.find((i) => i.type === 'span')!.payload as { measurements?: Record<string, { value?: number }> }
    expect(inpSpan.measurements?.inp?.value).toBe(120)
    // Positive control: the path survives, only the query is cut.
    const tx = all.find((i) => i.type === 'transaction')!.payload as {
      contexts: { trace: { data: Record<string, unknown> } }
    }
    expect(tx.contexts.trace.data['lcp.url']).toBe('https://p.supabase.co/storage/v1/object/sign/photos/b/c/a.jpg')
    const span = all.find((i) => i.type === 'span')!.payload
    // The exit (item 102 § 2.5): an INP span's description is always its op.
    expect(span.description).toBe('ui.interaction.click')
  }, 20000)
})

// A module, not a global script (the twin declares the same names).
export {}
