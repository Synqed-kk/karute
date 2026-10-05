/**
 * PR-A0 — unit tests for the one Sentry scrub (src/lib/observability/sentry-scrub.ts).
 * No Sentry init in this file: the canary through the real SDK lives in
 * sentry-scrub-canary*.test.ts.
 *
 * PLANT RULE: every plant is built from fragments, so this source text holds no
 * whole plant string and no whole customer name.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'
import {
  HEADER_ALLOW_LIST,
  scrubBreadcrumb,
  scrubEvent,
  scrubPii,
  scrubTransaction,
  stripQuery,
} from '@/lib/observability/sentry-scrub'

const C = ['PL', 'ANT'].join('')
const SURNAME = ['藤', '井'].join('')
const GIVEN = ['美奈', '子'].join('')
const KEY = C + '-KEY'
const BODY = C + '-BODY'
const QS = C + '-QS'
const URLQ = C + '-URLQ'
const PATHQ = C + '-PATH'
const COOKIE = C + '-COOKIE'
const NAME = SURNAME + ' ' + GIVEN
const REC = C + '-REC'

type TxEvent = Parameters<typeof scrubTransaction>[0]

function assertClean(value: unknown) {
  const json = JSON.stringify(value)
  expect(json).not.toContain(C)
  expect(json).not.toContain(SURNAME)
  expect(json).not.toContain(GIVEN)
}

function requestErrorEvent(data: unknown): ErrorEvent {
  return {
    type: undefined,
    exception: { values: [{ type: 'Error', value: 'req' }] },
    breadcrumbs: [
      { category: 'console', message: 'audit ' + NAME },
      { category: 'fetch', data: { url: 'https://x.test/a?token=' + URLQ } },
      { category: 'navigation', data: { from: '/a?q=' + URLQ, to: '/b#' + URLQ } },
      { category: 'ui.click', message: 'button' },
    ],
    request: {
      method: 'POST',
      url: 'https://karute.test/api/x?token=' + URLQ,
      headers: {
        host: 'karute.test',
        'user-agent': 'jest',
        'x-worker-key': KEY,
        authorization: 'Bearer ' + KEY,
        cookie: 'sid=' + COOKIE,
        'x-api-key': KEY,
        'x-vercel-id': KEY,
        referer: 'https://karute.test/p?token=' + URLQ,
        'x-forwarded-for': KEY,
      },
      data,
      query_string: 'token=' + QS,
      cookies: { sid: COOKIE },
      env: { SECRET: KEY },
    },
    contexts: {
      nextjs: { request_path: '/api/x?token=' + PATHQ, router_kind: 'App Router' },
    },
    transaction: 'POST /api/x?token=' + PATHQ,
  }
}

describe('T2 scrubEvent on an onRequestError-shaped event', () => {
  it.each([
    ['object body', { customer: NAME, note: BODY, nested: { other: BODY } }],
    ['string body', 'customer=' + NAME + '&body=' + BODY],
  ])('%s: keeps method + host, no plant survives', (_label, data) => {
    const out = scrubEvent(requestErrorEvent(data))
    expect(out).not.toBeNull()
    expect(out!.request!.method).toBe('POST')
    expect(out!.request!.headers).toEqual({ host: 'karute.test', 'user-agent': 'jest' })
    expect(out!.request!.url).toBe('https://karute.test/api/x')
    expect(out!.request).not.toHaveProperty('data')
    expect(out!.request).not.toHaveProperty('query_string')
    expect(out!.request).not.toHaveProperty('cookies')
    expect(out!.request).not.toHaveProperty('env')
    expect(out!.contexts!.nextjs!.request_path).toBe('/api/x')
    expect(out!.transaction).toBe('POST /api/x')
    expect(out!.breadcrumbs!.map((b) => b.category)).toEqual(['navigation', 'ui.click'])
    expect(out!.breadcrumbs![0].data).toEqual({ from: '/a', to: '/b' })
    assertClean(out)
  })

  it('HEADER_ALLOW_LIST is exactly the five allowed headers', () => {
    expect(HEADER_ALLOW_LIST).toEqual(['host', 'user-agent', 'content-type', 'content-length', 'accept'])
  })

  it('stripQuery cuts at the first ? or #', () => {
    expect(stripQuery('/a/b?x=1#y')).toBe('/a/b')
    expect(stripQuery('/a/b#y?x')).toBe('/a/b')
    expect(stripQuery('/a/b')).toBe('/a/b')
  })
})

describe('T2b alarm event is rebuilt from the allow-list', () => {
  it('keeps take_id / alarm_kind / business_id; drops everything else', () => {
    const event: ErrorEvent = {
      type: undefined,
      event_id: 'e1',
      level: 'warning',
      message: 'alarm test',
      platform: 'node',
      environment: 'test',
      tags: { alarm: '1', alarm_kind: 'finalize_refused', business_id: 'b-1', other: C },
      extra: { take_id: 't-1', customer_name: NAME, recording: REC, take_ids: ['t-1', 't-2'] },
      fingerprint: ['karute-alarm', 'finalize_refused', 't-1'],
      breadcrumbs: [{ category: 'console', message: NAME }],
      request: { url: 'https://x.test/?q=' + URLQ, headers: { 'x-worker-key': KEY } },
      user: { email: C + '@x.test' },
      contexts: { app: { note: NAME, other: C } },
      server_name: C,
      sdk: {
        name: 'sentry.javascript.nextjs',
        version: '10.51.0',
        integrations: ['Console'],
        packages: [{ name: 'npm:' + C, version: '1' }],
      },
    }
    const out = scrubEvent(event)
    expect(out).not.toBeNull()
    expect(out!.extra).toEqual({ take_id: 't-1', take_ids: ['t-1', 't-2'] })
    expect(out!.tags).toEqual({ alarm: '1', alarm_kind: 'finalize_refused', business_id: 'b-1' })
    expect(out!.sdk).toEqual({ name: 'sentry.javascript.nextjs', version: '10.51.0' })
    expect(out!.fingerprint).toEqual(['karute-alarm', 'finalize_refused', 't-1'])
    for (const k of ['breadcrumbs', 'request', 'user', 'contexts', 'server_name', 'exception']) {
      expect(out).not.toHaveProperty(k)
    }
    assertClean(out)
  })
})

describe('T3 scrubBreadcrumb', () => {
  it.each(['console', 'http', 'fetch', 'xhr'])('drops %s', (category) => {
    expect(scrubBreadcrumb({ category, message: NAME })).toBeNull()
  })

  it('navigation loses its query and fragment', () => {
    const out = scrubBreadcrumb({
      category: 'navigation',
      data: { from: '/customers/1?q=' + URLQ, to: '/customers/2#' + URLQ },
    })
    expect(out).not.toBeNull()
    expect(out!.data).toEqual({ from: '/customers/1', to: '/customers/2' })
    assertClean(out)
  })

  it('another category passes unchanged', () => {
    const crumb: Breadcrumb = { category: 'ui.click', message: 'button.save', level: 'info' }
    expect(scrubBreadcrumb(crumb)).toEqual({ category: 'ui.click', message: 'button.save', level: 'info' })
  })
})

function spanAttributes(): Record<string, string> {
  return {
    url: 'https://x.test/a/path?token=' + URLQ,
    'http.url': 'https://x.test/a/path?token=' + URLQ,
    'url.full': 'https://x.test/a/path#' + URLQ,
    'http.target': '/a/path?token=' + URLQ,
    'http.query': '?token=' + URLQ,
    'url.query': '?token=' + URLQ,
    'http.fragment': '#' + URLQ,
    'url.fragment': '#' + URLQ,
    'http.request.header.referer': 'https://x.test/p?token=' + URLQ,
    'http.request.header.x_vercel_id': KEY,
    'http.response.header.set_cookie': COOKIE,
    'http.method': 'GET',
  }
}

function expectSpanDataScrubbed(data: Record<string, unknown> | undefined) {
  expect(data).toBeDefined()
  for (const k of Object.keys(data!)) {
    expect(k.startsWith('http.request.header.')).toBe(false)
    expect(k.startsWith('http.response.header.')).toBe(false)
  }
  expect(data).toEqual({
    url: 'https://x.test/a/path',
    'http.url': 'https://x.test/a/path',
    'url.full': 'https://x.test/a/path',
    'http.target': '/a/path',
    'http.method': 'GET',
  })
}

describe('T3b scrubTransaction', () => {
  it('trace data and every span lose header attributes and queries; paths survive', () => {
    const tx: TxEvent = {
      type: 'transaction',
      transaction: 'GET /a/path?token=' + URLQ,
      contexts: { trace: { trace_id: 't', span_id: 's', data: spanAttributes() } },
      spans: [
        {
          span_id: 's2',
          trace_id: 't',
          start_timestamp: 1,
          data: spanAttributes(),
        },
      ],
      breadcrumbs: [{ category: 'console', message: NAME }],
      request: { url: 'https://x.test/a/path?token=' + URLQ, headers: { 'x-worker-key': KEY } },
    }
    const out = scrubTransaction(tx)
    expect(out).not.toBeNull()
    expectSpanDataScrubbed(out!.contexts!.trace!.data)
    expectSpanDataScrubbed(out!.spans![0].data)
    expect(out!.transaction).toBe('GET /a/path')
    assertClean(out)
  })
})

describe('T3c scrubEvent on an error carrying header span attributes', () => {
  it('removes them from contexts.trace.data', () => {
    const event: ErrorEvent = {
      type: undefined,
      contexts: { trace: { trace_id: 't', span_id: 's', data: spanAttributes() } },
    }
    const out = scrubEvent(event)
    expect(out).not.toBeNull()
    expectSpanDataScrubbed(out!.contexts!.trace!.data)
    assertClean(out)
  })
})

describe('T4 the moved scrubPii keeps every behaviour of the old function', () => {
  it('deletes request.cookies', () => {
    const out = scrubPii({ type: undefined, request: { cookies: { sid: COOKIE } } } as ErrorEvent)
    expect(out!.request).not.toHaveProperty('cookies')
  })

  it('deletes the cookie, authorization and x-api-key headers, keeps the others', () => {
    const out = scrubPii({
      type: undefined,
      request: { headers: { cookie: COOKIE, authorization: KEY, 'x-api-key': KEY, host: 'h' } },
    } as ErrorEvent)
    expect(out!.request!.headers).toEqual({ host: 'h' })
  })

  it('redacts PII keys in an object body, case-insensitively, through nesting and arrays', () => {
    const out = scrubPii({
      type: undefined,
      request: { data: { Name: NAME, items: [{ phone: C }], keep: 'ok' } },
    } as ErrorEvent)
    expect(out!.request!.data).toEqual({ Name: '[redacted]', items: [{ phone: '[redacted]' }], keep: 'ok' })
  })

  it('leaves a string body unchanged (scrubEvent removes it afterwards)', () => {
    const body = 'x=' + BODY
    const out = scrubPii({ type: undefined, request: { data: body } } as ErrorEvent)
    expect(out!.request!.data).toBe(body)
  })

  it('redacts PII keys in extra', () => {
    const out = scrubPii({ type: undefined, extra: { transcript: NAME, count: 3 } } as ErrorEvent)
    expect(out!.extra).toEqual({ transcript: '[redacted]', count: 3 })
  })

  it('redacts PII keys in contexts', () => {
    const out = scrubPii({ type: undefined, contexts: { app: { email: C, ok: 1 } } } as ErrorEvent)
    expect(out!.contexts).toEqual({ app: { email: '[redacted]', ok: 1 } })
  })

  it('every PII key is redacted', () => {
    const keys = [
      'transcript', 'transcription', 'notes', 'note', 'name', 'full_name', 'furigana', 'phone',
      'email', 'audio', 'audioblob', 'recording', 'password', 'token', 'apikey', 'authorization',
    ]
    const extra = Object.fromEntries(keys.map((k) => [k, C]))
    const out = scrubPii({ type: undefined, extra } as ErrorEvent)
    expect(out!.extra).toEqual(Object.fromEntries(keys.map((k) => [k, '[redacted]'])))
  })

  it('returns the same event (never null) when there is nothing to scrub', () => {
    const event = { type: undefined, message: 'm' } as ErrorEvent
    expect(scrubPii(event)).toBe(event)
  })
})

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const FORBIDDEN: RegExp[] = [
  /from\s*['"](node:[^'"]*|next(\/[^'"]*)?|fs|path|crypto|os|http|https|stream|buffer|child_process)['"]/,
  /^\s*import\s*['"]/m,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\b(window|document|navigator)\./,
]

function stripForScan(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/import\s+type[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
}

const flagged = (src: string) => FORBIDDEN.some((re) => re.test(stripForScan(src)))

describe('T5 the scrub module runs in node, edge and the browser', () => {
  it('has no node-only, next/* or browser-only reference', () => {
    const src = stripForScan(read('src/lib/observability/sentry-scrub.ts'))
    for (const re of FORBIDDEN) expect(src).not.toMatch(re)
  })

  it('NEGATIVE CONTROL: the same checks flag each forbidden sample', () => {
    const samples = [
      "import fs from 'node:fs'",
      "import {\n  NextResponse\n} from 'next/server'",
      "import 'node:fs'",
      "import path from 'path'",
      'const x = window.location',
    ]
    for (const s of samples) expect([s, flagged(s)]).toEqual([s, true])
  })
})

// PIN: PR-A1 (alarm check-ins) updates this pin ON PURPOSE when it switches
// check-ins on; nothing else may switch on logs, replay or feedback silently.
describe('T6 pin: no Sentry channel the scrub hooks never see is switched on', () => {
  it.each(['src/instrumentation.ts', 'src/instrumentation-client.ts'])('%s', (rel) => {
    const src = read(rel)
    expect(src).not.toMatch(/enableLogs/)
    expect(src).not.toMatch(/replayIntegration/)
    expect(src).not.toMatch(/feedbackIntegration/)
    expect((src.match(/sendDefaultPii:\s*false/g) ?? []).length).toBeGreaterThanOrEqual(1)
    expect(src).toMatch(/\.\.\.sentryScrubOptions/)
  })
})
