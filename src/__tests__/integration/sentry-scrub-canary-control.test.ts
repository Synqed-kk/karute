/**
 * PR-A0 canary CONTROL (T1-CONTROL): the same real-SDK pipeline and plants as
 * sentry-scrub-canary.test.ts, but WITHOUT `sentryScrubOptions`. Each plant
 * must arrive here unscrubbed — that is what makes T1's "nothing arrives"
 * meaningful. Exactly one Sentry init in this file (OTel globals register once
 * per jest file).
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
// item 102 C2: new plants (exception value in Japanese, scope tag, extra, context, user email).
const JPX = ['田', '中'].join('')
const TAGP = C + '-TAG'
const EXTRAP = C + '-EXTRA'
const CTXP = C + '-CTX'
const USERP = [C.toLowerCase() + '-user', 'example.com'].join('@')
// item 102 fix batch 1 (N8): phone, full-width email, Bearer key, Base64 blob in
// the error text; a phone path + query string in a transaction name.
const QPL = C + '-QPL'
const n8Text = () => ['call', PHONE_SP, 'mail', FW_MAIL, 'auth Bearer', KEY32, 'blob', BLOB200].join(' ')
const n8Route = () => 'GET /search/' + PHONE_HY + '?q=' + QPL

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
import { BLOB200, FW_MAIL, KEY32, PHONE_HY, PHONE_SP } from './helpers/sentry-exit-plants'

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

function tryJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

/** Envelope = header line, then (item header line, item payload line) pairs. */
function items(): Item[] {
  const out: Item[] = []
  for (const env of envelopes) {
    const lines = env.split('\n').filter((l) => l.length > 0)
    for (let i = 1; i + 1 < lines.length; i += 2) {
      // Guard (TRANSPORT A6): a non-JSON line (e.g. a binary attachment) is skipped, never parsed.
      const header = tryJson(lines[i]) as { type?: unknown } | undefined
      if (!header || typeof header.type !== 'string') {
        i -= 1
        continue
      }
      const payload = tryJson(lines[i + 1])
      if (payload === undefined) continue
      out.push({ type: header.type, payload: payload as Record<string, unknown> })
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

describe('PR-A0 canary control: real SDK WITHOUT the scrub', () => {
  it('every plant reaches the envelopes when nothing scrubs', async () => {
    init({
      dsn: 'https://public@example.invalid/1',
      tracesSampleRate: 1,
      sendDefaultPii: false,
      transport: recorder,
    })

    await withIsolationScope(async (scope) => {
      scope.setSDKProcessingMetadata({ normalizedRequest: plantRequest() })
      logName()

      scope.setTag('customer_name', TAGP)
      scope.setExtra('customer', EXTRAP)
      scope.setContext('custom', { name: CTXP })
      scope.setUser({ email: USERP })
      captureException(new Error('boom ' + JPX))
      captureException(new Error(n8Text()))

      captureMessage('alarm test', {
        tags: ALARM_TAGS,
        extra: alarmExtra(),
        fingerprint: ALARM_FP,
      })

      startSpan({ name: n8Route() }, () => undefined)
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
    expect(joined).toContain(C)
    expect(joined).toContain(FUJII)
    expect(joined).toContain(MINAKO)
    for (const p of [JPX, TAGP, EXTRAP, CTXP, USERP]) expect(joined).toContain(p)
    const N8 = [PHONE_SP, PHONE_HY, FW_MAIL.slice(0, 8), KEY32, BLOB200.slice(40, 70), QPL]
    for (const p of N8) expect(joined).toContain(p)

    const plants = { KEY, AUTH, COOKIE, VERCEL, BODY, QS, URLQ, NAME, REC, CUST, SPAN, PATH }
    const missing = Object.entries(plants)
      .filter(([, value]) => !joined.includes(value))
      .map(([label]) => label)
    expect(missing).toEqual([])
    const sdk = (messages[0]?.sdk as { name?: string } | undefined)?.name
    expect(sdk).toBe('sentry.javascript.nextjs')
  }, 30000)
})
