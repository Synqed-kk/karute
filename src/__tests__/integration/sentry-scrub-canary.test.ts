/**
 * PR-A0 canary (T1): the REAL Sentry SDK (@sentry/nextjs init, default
 * integrations ON — console breadcrumbs and contextLines included) sends every
 * event through `sentryScrubOptions` into a recording transport. No planted
 * secret header, body, query, cookie or customer text may reach an envelope.
 * The twin file sentry-scrub-canary-control.test.ts runs the same pipeline
 * WITHOUT the scrub and proves each plant does arrive there (else this test
 * would be hollow).
 *
 * PLANT RULE: every plant is joined from fragments, so this source text holds
 * no whole plant (contextLines copies source lines around each capture call
 * into the event), and every capture call sits far below these constants.
 */
const C = ['CAN', 'ARY'].join('')
const FUJII = ['藤', '井'].join('')
const MINAKO = ['美奈', '子'].join('')
const KEY = C + '-KEY'
const AUTH = 'Bearer ' + C + '-AUTH'
const COOKIE = 'sid=' + C + '-COOKIE'
const VERCEL = C + '-VERCEL'
const BODY = 'body ' + C + '-BODY'
const QS = 'qs=' + C + '-QS'
const URLQ = C + '-URLQ'
const NAME = C + '-NAME ' + FUJII + ' ' + MINAKO
const REC = C + '-REC'
const CUST = C + '-CUST'
const SPAN = C + '-SPAN'
const PATH = C + '-PATH'

import {
  init,
  createTransport,
  withIsolationScope,
  captureException,
  captureMessage,
  captureRequestError,
  startSpan,
  flush,
  close,
} from '@sentry/nextjs'
import { sentryScrubOptions } from '@/lib/observability/sentry-scrub'

type TransportOptions = Parameters<typeof createTransport>[0]
type TransportRequest = Parameters<Parameters<typeof createTransport>[1]>[0]

const envelopes: string[] = []

function recorder(options: TransportOptions) {
  return createTransport(options, async (request: TransportRequest) => {
    const body = request.body
    envelopes.push(typeof body === 'string' ? body : new TextDecoder().decode(body))
    return { statusCode: 200 }
  })
}

type Item = { type: string; payload: Record<string, unknown> }

/** Envelope = header line, then (item header line, item payload line) pairs. */
function items(): Item[] {
  const out: Item[] = []
  for (const env of envelopes) {
    const lines = env.split('\n').filter((l) => l.length > 0)
    for (let i = 1; i + 1 < lines.length; i += 2) {
      const header = JSON.parse(lines[i]) as { type: string }
      out.push({ type: header.type, payload: JSON.parse(lines[i + 1]) as Record<string, unknown> })
    }
  }
  return out
}

function plantRequest() {
  return {
    headers: {
      'x-worker-key': KEY,
      authorization: AUTH,
      cookie: COOKIE,
      'x-vercel-id': VERCEL,
      'user-agent': 'jest',
    },
    data: BODY,
    query_string: QS,
    url: 'https://karute.test/api/jobs/process?token=' + URLQ,
    method: 'POST',
  }
}

function spanAttributes() {
  const u = 'https://x.test/a?token=' + SPAN
  return { 'url.full': u, url: u, 'http.url': u, 'http.query': 'token=' + SPAN }
}

function logName() {
  console.log(NAME)
}

const ALARM_TAGS = { alarm: '1', alarm_kind: 'finalize_refused', business_id: 'b-1' }
const ALARM_FP = ['karute-alarm', 'finalize_refused', 't-1']
function alarmExtra() {
  return { take_id: 't-1', recording: REC, customer_name: CUST }
}
const REQ_PATH_PREFIX = '/api/x?token='
const REQ_CONTEXT = { routerKind: 'App Router', routePath: '/api/x', routeType: 'route' }

// ---------------------------------------------------------------------------
// The pipeline. Capture calls start here, far below every plant constant.
// ---------------------------------------------------------------------------

describe('PR-A0 canary: real SDK with sentryScrubOptions', () => {
  it('sends no planted secret, body, query or customer text in any envelope', async () => {
    init({
      dsn: 'https://public@example.invalid/1',
      tracesSampleRate: 1,
      sendDefaultPii: false,
      transport: recorder,
      ...sentryScrubOptions,
    })

    await withIsolationScope(async (scope) => {
      scope.setSDKProcessingMetadata({ normalizedRequest: plantRequest() })
      logName()

      captureException(new Error('boom'))

      captureMessage('alarm test', {
        tags: ALARM_TAGS,
        extra: alarmExtra(),
        fingerprint: ALARM_FP,
      })

      startSpan({ name: 'canary-tx' }, () => {
        startSpan({ name: 'canary-child', attributes: spanAttributes() }, () => undefined)
      })

      captureRequestError(
        new Error('req'),
        { path: REQ_PATH_PREFIX + PATH, method: 'POST', headers: { 'x-worker-key': KEY } },
        REQ_CONTEXT,
      )

      await flush(2000)
    })
    await close()

    const all = items()
    const events = all.filter((i) => i.type === 'event').map((i) => i.payload)
    const transactions = all.filter((i) => i.type === 'transaction').map((i) => i.payload)
    const errors = events.filter((e) => e.exception !== undefined)
    const messages = events.filter((e) => e.message !== undefined)

    // Never pass on an empty transport.
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(transactions.length).toBeGreaterThanOrEqual(1)

    const joined = envelopes.join('\n')
    expect(joined).not.toContain(C)
    expect(joined).not.toContain(FUJII)
    expect(joined).not.toContain(MINAKO)

    // Positive control: the alarm's allowed facts survive the scrub.
    const alarm = messages.find(
      (e) => (e.tags as Record<string, unknown> | undefined)?.alarm_kind === 'finalize_refused',
    )
    expect(alarm).toBeDefined()
    expect((alarm?.extra as Record<string, unknown> | undefined)?.take_id).toBe('t-1')
    expect((alarm?.sdk as { name?: string } | undefined)?.name).toBe('sentry.javascript.nextjs')
  }, 30000)
})
