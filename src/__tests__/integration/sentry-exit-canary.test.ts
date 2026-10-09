// C1 — THE EVERY-POSITION CANARY (item 102, rev 3 § 4 C1; R-S101-2, R-S102-1 (b),
// R-S102-5 fix 2/3, R-S103-1). One fixture envelope holding every admitted item
// type plus an attachment and an unknown 'wat' item. A walker appends a plant to
// every string and a rogue key `plant_<n>` at every object level; the rebuilt
// bytes are then checked against ONE hand-transcribed table (field → shape).
/* eslint-disable @typescript-eslint/no-explicit-any -- deep reads of the rebuilt output in the positive-control assertions */
import { rebuildEnvelope } from '@/lib/observability/sentry-exit'
import { BLOB200, F1_FORMS, JWT, KEY32, LABEL_FORMS, PHONE_HY, S2_CUT_SHAPES } from './helpers/sentry-exit-plants'

type J = Record<string, unknown>
const at = (l: string, r: string) => [l, r].join('@')
const UUID = '3f2b1c4d-1111-4222-8333-444455556666'
const DEBUG_ID = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111'
const TRACE = '0123456789abcdef0123456789abcdef'
const SPAN = '0123456789abcdef'
const SPAN2 = 'fedcba9876543210'
const PUBKEY = 'abcdefabcdefabcdefabcdefabcdef12'
const EV1 = 'a'.repeat(31) + '1'
const EV2 = 'a'.repeat(31) + '2'
const EV3 = 'a'.repeat(31) + '3'
const ISO = '2026-10-06T00:00:00.000Z'
const UA = 'Mozilla/5.0 (Macintosh)'

const LABELS = ['error', 'alarm', 'transaction', 'span', 'session', 'sessions', 'client_report', 'check_in', 'attachment', 'wat']
const ADMITTED_OUT = ['event', 'event', 'transaction', 'span', 'session', 'sessions', 'client_report', 'check_in']

const SDK = () => ({
  name: 'sentry.javascript.nextjs', version: '10.51.0', settings: { infer_ip: 'never' },
  integrations: ['Breadcrumbs'], packages: [{ name: 'npm:x', version: '1' }],
})

const CONTEXTS = (): J => ({
  trace: {
    trace_id: TRACE, span_id: SPAN, parent_span_id: SPAN2, op: 'pageload', status: 'ok', origin: 'auto.pageload.nextjs',
    data: { 'sentry.source': 'route', 'http.route': '/ja/customers', 'lcp.element': 'div.card', 'url.full': 'u' },
  },
  browser: { name: 'Chrome', version: '120.0' },
  os: { name: 'Mac OS X', version: '14.4' },
  device: { family: 'Mac', model: 'MacBookPro', arch: 'arm64' },
  runtime: { name: 'browser', version: '120' },
  culture: { locale: 'ja-JP', timezone: 'Asia/Tokyo' },
  app: { app_start_time: ISO },
  cloud_resource: { 'cloud.provider': 'vercel', 'cloud.region': 'hnd1' },
  nextjs: { request_path: '/ja/customers', router_kind: 'app', router_path: '/ja/customers', route_type: 'render' },
  response: { status_code: 200 }, user: { name: 'u' }, react: { version: '19' }, custom: { name: 'n' },
})

const OPS = ['resource.script', 'resource.css', 'browser.domContentLoadedEvent', 'http.client', 'mark', 'measure', 'ui.long-animation-frame']
const DESCS = ['/_next/static/chunks/a.js', '/_next/static/css/b.css', '/ja/customers', 'GET /api/customers', 'mark-a', 'measure-b', 'Main UI thread blocked']

function fixture(): unknown[] {
  const header = {
    event_id: EV1, sent_at: ISO, sdk: { name: 'sentry.javascript.nextjs', version: '10.51.0' }, dsn: 'http://k@127.0.0.1:9/1',
    trace: {
      trace_id: TRACE, public_key: PUBKEY, sample_rate: '0.1', sampled: 'true', sample_rand: '0.056030427000071326',
      release: 'rel1', environment: 'preview', org_id: '123', transaction: '/ja/customers', replay_id: TRACE,
    },
  }
  const error = {
    event_id: EV1, timestamp: 1700000000, platform: 'javascript', level: 'error', environment: 'preview', release: 'rel1', dist: 'd1',
    sdk: SDK(), transaction: '/ja/customers', transaction_info: { source: 'route' }, fingerprint: ['fp1', 'fp2'],
    tags: { business_id: UUID, store_id: UUID, runtime: 'browser', turbopack: 'yes', customer_name: 'cn' },
    extra: { __serialized__: 'ser', customer: 'c' }, message: 'msg', logentry: { message: 'm' },
    user: { email: 'u', ip_address: 'ip' }, server_name: 'host1', modules: { a: '1' }, logger: 'lg',
    exception: {
      values: [0, 1, 2].map((i) => ({
        type: 'TypeError', value: 'boom',
        mechanism: { type: 'generic', handled: true, synthetic: false, source: 'cause', exception_id: i, parent_id: 0, data: { d: 'x' } },
        stacktrace: {
          frames: [{
            filename: 'app:///_next/static/chunks/a.js', abs_path: 'app:///_next/static/chunks/a.js', function: 'onClick',
            module: 'chunks.a', lineno: 10, colno: 5, in_app: true, vars: { v: 'x' }, pre_context: ['p'], context_line: 'c',
            post_context: ['q'], debug_id: DEBUG_ID,
          }],
        },
      })),
    },
    debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///_next/static/chunks/a.js', debug_id: DEBUG_ID }] },
    request: {
      method: 'GET', url: 'https://karute.app/ja/customers',
      headers: {
        host: 'karute.app', 'user-agent': UA, 'content-type': 'application/json; charset=utf-8', accept: 'text/html',
        'content-length': '12', referer: 'r', cookie: 'c', 'x-forwarded-for': 'x',
      },
      cookies: { a: 'b' }, data: 'body', query_string: 'q=1', env: { REMOTE_ADDR: 'x' },
    },
    contexts: CONTEXTS(),
    breadcrumbs: [
      { category: 'navigation', level: 'info', timestamp: 1, data: { from: '/ja', to: '/ja/customers' } },
      { category: 'navigation', timestamp: 2, data: { from: '/ja/customers', to: '/ja/customers/abc' } },
      { category: 'ui.click', message: 'button.card' },
    ],
  }
  const alarm = {
    event_id: EV2, timestamp: 1700000000, platform: 'javascript', level: 'error', environment: 'preview', release: 'rel1',
    message: 'recording cut', fingerprint: ['alarm', 'rec_cut'],
    tags: { alarm: '1', alarm_kind: 'rec_cut', business_id: UUID, store_id: UUID },
    extra: {
      rec_session_id: 'rs1', take_id: 't1', store_id: 's1', seconds_recorded: 30, pieces_stored: 3, bytes_stored: 1000,
      newest_piece_at: '2026-10-06T00:00:00Z', age_minutes: 5, reason: 'cut', app_build: '42', os_version: '17.4',
      count: 1, business_count: 1, take_ids: ['t1', 't2'], other: 'x',
    },
    contexts: CONTEXTS(), request: { url: '/ja/x' }, breadcrumbs: [{ category: 'navigation', data: { to: '/ja' } }],
  }
  const spans = Array.from({ length: 25 }, (_, i) => ({
    span_id: i.toString(16).padStart(2, '0') + 'a'.repeat(14), trace_id: TRACE, parent_span_id: SPAN,
    start_timestamp: 1, timestamp: 1.5, op: OPS[i % 7], description: DESCS[i % 7], origin: 'auto.resource', status: 'ok',
    data: {
      'sentry.op': OPS[i % 7], 'sentry.origin': 'auto.resource', 'http.response_content_length': 10, 'url.same_origin': true,
      'server.address': 'localhost', 'url.scheme': 'https', 'resource.render_blocking_status': 'blocking', 'http.method': 'GET',
      'url.full': 'https://x/y', 'code.filepath': 'f', 'browser.script.invoker': 'inv',
    },
  }))
  const transaction = {
    event_id: EV3, type: 'transaction', timestamp: 2, start_timestamp: 1, platform: 'javascript', environment: 'preview',
    release: 'rel1', sdk: SDK(), transaction: '/ja/customers', transaction_info: { source: 'route' },
    contexts: { trace: { trace_id: TRACE, span_id: SPAN, op: 'pageload', origin: 'auto.pageload.nextjs', status: 'ok' } },
    measurements: { lcp: { value: 1200, unit: 'millisecond' }, 'ttfb.requestTime': { value: 3, unit: 'millisecond' } },
    spans,
  }
  const inp = {
    span_id: SPAN2, trace_id: TRACE, start_timestamp: 1, timestamp: 1.2, op: 'ui.interaction.click',
    description: 'body > div.card > button', exclusive_time: 120, is_segment: true, segment_id: SPAN2,
    origin: 'auto.http.browser.inp', measurements: { inp: { value: 120, unit: 'millisecond' } },
    data: {
      'sentry.op': 'ui.interaction.click', 'sentry.origin': 'auto.http.browser.inp', 'sentry.exclusive_time': 120,
      'sentry.source': 'route', 'sentry.sample_rate': 1, transaction: '/ja/customers', 'user_agent.original': UA,
      release: 'rel1', environment: 'preview', effectiveConnectionType: '4g', deviceMemory: '8', hardwareConcurrency: '8',
      connectionType: 'wifi', replay_id: TRACE, profile_id: TRACE, user: 'u', 'client.address': '1.2.3.4', url: '/x',
    },
  }
  const session = {
    sid: TRACE, init: true, started: ISO, timestamp: ISO, status: 'ok', errors: 0, duration: 10, did: 'device1',
    ip_address: '1.2.3.4', user_agent: 'UA', abnormal_mechanism: 'anr_foreground',
    attrs: { release: 'rel1', environment: 'preview', ip_address: 'x', user_agent: 'UA' },
  }
  const sessions = {
    attrs: { release: 'rel1', environment: 'preview' },
    aggregates: [{ started: ISO, exited: 1, errored: 0, crashed: 0, abnormal: 0, did: 'd' }],
  }
  const clientReport = { timestamp: 1700000000, discarded_events: [{ reason: 'before_send', category: 'error', quantity: 2 }] }
  const checkIn = {
    check_in_id: TRACE, monitor_slug: 'pulse', status: 'ok', duration: 1, release: 'rel1', environment: 'preview',
    monitor_config: {
      schedule: { type: 'crontab', value: '0 * * * *', unit: 'minute' }, checkin_margin: 1, max_runtime: 1,
      failure_issue_threshold: 1, recovery_threshold: 1, timezone: 'Asia/Tokyo',
    },
    contexts: { trace: { trace_id: TRACE, span_id: SPAN } },
  }
  return [header, [
    [{ type: 'event' }, error], [{ type: 'event' }, alarm], [{ type: 'transaction' }, transaction], [{ type: 'span' }, inp],
    [{ type: 'session' }, session], [{ type: 'sessions' }, sessions], [{ type: 'client_report' }, clientReport],
    [{ type: 'check_in' }, checkIn], [{ type: 'attachment', length: 3, filename: 'a.txt' }, 'abc'], [{ type: 'wat' }, { x: 'y' }],
  ]]
}

// ---- THE TABLE (transcribed by hand from rev 3 § 2; never computed from the validators) ----
// [shape, length cap, does the narrower pattern (⊂) also accept `_TanakaHanako`? (default yes)]
// A position NOT in the table (enum, id, iso, num-string, num, dropped, unnamed) carries no plant out.
type Shape = 'token' | 'path' | 'spaced' | 'masked' | 'desc'
type Entry = [Shape, number, boolean?]
const IDENTITY: Record<string, Entry> = {
  'sdk.name': ['token', 60], 'sdk.version': ['token', 20], release: ['token', 100], dist: ['token', 40],
}
const SPAN_DATA: Record<string, Entry> = {
  'sentry.op': ['token', 60], 'sentry.origin': ['token', 60], 'sentry.idle_span_finish_reason': ['token', 40],
  'http.route': ['path', 200], 'server.address': ['token', 253, false], 'resource.render_blocking_status': ['token', 20],
  'http.response_delivery_type': ['token', 20], 'lcp.url': ['path', 200], effectiveConnectionType: ['token', 10],
  connectionType: ['token', 20], deviceMemory: ['token', 10], hardwareConcurrency: ['token', 10], release: ['token', 100],
  transaction: ['path', 200], 'user_agent.original': ['spaced', 300], 'next.route': ['path', 200],
  'next.span_type': ['token', 60], 'next.page': ['path', 200],
}
const TRACE_CTX: Record<string, Entry> = {
  'contexts.trace.status': ['token', 40], 'contexts.trace.origin': ['token', 60],
  ...prefixed('contexts.trace.data.', SPAN_DATA),
}
const EVENT: Record<string, Entry> = {
  ...IDENTITY, transaction: ['path', 200], 'fingerprint[]': ['token', 100],
  'exception.values[].type': ['masked', 100], 'exception.values[].value': ['masked', 200],
  'exception.values[].mechanism.type': ['token', 60], 'exception.values[].mechanism.source': ['path', 30, true],
  'exception.values[].stacktrace.frames[].filename': ['path', 300], 'exception.values[].stacktrace.frames[].abs_path': ['path', 300],
  'exception.values[].stacktrace.frames[].function': ['spaced', 200], 'exception.values[].stacktrace.frames[].module': ['token', 200],
  'debug_meta.images[].code_file': ['path', 300],
  'request.url': ['path', 300], 'request.headers.host': ['token', 200], 'request.headers.content-length': ['token', 200],
  // content-type + '_TanakaHanako' makes `charset=utf-8_TanakaHanako`, a 26-char
  // upper+lower+digit run: the content guard (R-S112-7) drops it, so false
  'request.headers.content-type': ['token', 100, false], 'request.headers.user-agent': ['spaced', 400],
  'request.headers.accept': ['spaced', 200],
  ...TRACE_CTX,
  'contexts.browser.name': ['token', 40], 'contexts.browser.version': ['token', 40], 'contexts.os.name': ['spaced', 40],
  'contexts.os.version': ['token', 60], 'contexts.device.family': ['token', 60], 'contexts.device.model': ['token', 60],
  'contexts.device.arch': ['token', 20], 'contexts.runtime.name': ['token', 40], 'contexts.runtime.version': ['token', 40],
  'contexts.culture.locale': ['token', 20], 'contexts.culture.timezone': ['token', 60],
  'contexts.cloud_resource.cloud.provider': ['token', 40], 'contexts.cloud_resource.cloud.region': ['token', 40],
  'contexts.nextjs.request_path': ['path', 300], 'contexts.nextjs.router_kind': ['token', 40],
  'contexts.nextjs.router_path': ['path', 300], 'contexts.nextjs.route_type': ['token', 40],
  'breadcrumbs[].type': ['token', 20], 'breadcrumbs[].data.from': ['path', 300], 'breadcrumbs[].data.to': ['path', 300],
}
const TABLE: Record<string, Entry> = {
  'header:sdk.name': ['token', 60], 'header:sdk.version': ['token', 20], 'header:trace.release': ['token', 100],
  'header:trace.public_key': ['token', 32, false], 'header:trace.org_id': ['token', 20, false],
  ...prefixed('error:', EVENT),
  ...prefixed('alarm:', {
    ...IDENTITY, message: ['masked', 120], 'fingerprint[]': ['token', 100], 'tags.alarm_kind': ['token', 40, false],
    'extra.rec_session_id': ['token', 200], 'extra.take_id': ['token', 200], 'extra.store_id': ['token', 200],
    'extra.reason': ['token', 200], 'extra.app_build': ['token', 200], 'extra.os_version': ['spaced', 40],
    'extra.take_ids[]': ['token', 64],
  }),
  ...prefixed('transaction:', {
    ...IDENTITY, transaction: ['path', 200], ...TRACE_CTX,
    'measurements.lcp.unit': ['token', 20], 'measurements.ttfb.requestTime.unit': ['token', 20],
    'spans[].status': ['token', 40], 'spans[].origin': ['token', 60], 'spans[].description': ['desc', 300],
    ...prefixed('spans[].data.', SPAN_DATA),
  }),
  ...prefixed('span:', {
    origin: ['token', 60], description: ['desc', 300], 'measurements.inp.unit': ['token', 20],
    ...prefixed('data.', SPAN_DATA),
  }),
  'session:abnormal_mechanism': ['token', 40], 'session:attrs.release': ['token', 100],
  'sessions:attrs.release': ['token', 100],
  'client_report:discarded_events[].reason': ['token', 40, false], 'client_report:discarded_events[].category': ['token', 40, false],
  'check_in:monitor_slug': ['token', 100, false], 'check_in:release': ['token', 100],
  'check_in:monitor_config.schedule.value': ['spaced', 60], 'check_in:monitor_config.schedule.unit': ['token', 20],
  'check_in:monitor_config.timezone': ['token', 60],
}
// THE DESCRIPTION RULE's ops whose description may be path-shaped (§ 2.5), by hand.
const DESC_OPS = ['http.client', 'http.server', 'navigation', 'pageload', 'function.nextjs', 'middleware.nextjs', 'http.route']
const descListed = (op: string) => op.startsWith('resource.') || op.startsWith('browser.') || DESC_OPS.includes(op)

function prefixed(p: string, t: Record<string, Entry>): Record<string, Entry> {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [p + k, v]))
}

// ---- THE WALKER ----
const norm = (label: string, segs: string[]) =>
  `${label}:${segs.reduce((s, x) => (/^\d+$/.test(x) ? `${s}[]` : s ? `${s}.${x}` : x), '')}`
const concrete = (label: string, segs: string[]) => `${label}:${segs.join('.')}`

function structural(label: string, segs: string[]): boolean {
  const last = segs[segs.length - 1]
  if (['event_id', 'trace_id', 'span_id', 'op'].includes(last)) return true
  if (last === 'alarm' && segs[segs.length - 2] === 'tags') return true
  if (last === 'category' && segs[0] === 'breadcrumbs') return true
  return label.endsWith('#h') && last === 'type'
}

type Walked = { env: unknown[]; planted: Map<string, string>; skipped: Map<string, string> }
function mutate(plant: string, pathOnly = false): Walked {
  const planted = new Map<string, string>()
  const skipped = new Map<string, string>()
  let n = 0
  const walk = (v: unknown, label: string, segs: string[]): unknown => {
    if (typeof v === 'string') {
      const key = concrete(label, segs)
      if (structural(label, segs)) {
        skipped.set(key, v)
        return v
      }
      const shape = TABLE[norm(label, segs)]?.[0]
      if (pathOnly && shape !== 'path' && shape !== 'desc') return v
      planted.set(key, v)
      return v + plant
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, label, [...segs, String(i)]))
    if (v && typeof v === 'object') {
      const o: J = {}
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, label, [...segs, k])
      o[`plant_${n++}`] = plant
      return o
    }
    return v
  }
  const [h, items] = fixture() as [unknown, unknown[][]]
  const env = [
    walk(h, 'header', []),
    items.map((it, i) => [walk(it[0], `${LABELS[i]}#h`, []), walk(it[1], LABELS[i], [])]),
  ]
  return { env, planted, skipped }
}

function rebuilt(env: unknown): [J, [J, J][]] {
  const out = rebuildEnvelope(env)
  expect(out).not.toBeNull()
  return out as unknown as [J, [J, J][]]
}

/** Concrete paths of every output string containing `marker`. */
function found(out: [J, [J, J][]], marker: string): string[] {
  const hits: string[] = []
  const walk = (v: unknown, label: string, segs: string[]) => {
    if (typeof v === 'string') {
      if (v.includes(marker)) hits.push(concrete(label, segs))
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, label, [...segs, k])
    }
  }
  walk(out[0], 'header', [])
  out[1].forEach((it, i) => walk(it[1], LABELS[i], []))
  return hits.sort()
}

function expected(w: Walked, kind: 'EN' | 'EN-NOSPACE', suffix: string): string[] {
  const keep: string[] = []
  for (const [key, orig] of w.planted) {
    const [label, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    const e = TABLE[norm(label, rest ? rest.split('.') : [])]
    if (!e) continue
    const [shape, cap, nospace = true] = e
    if (orig.length + suffix.length > cap) continue
    if (kind === 'EN') {
      if (shape === 'spaced' || shape === 'masked') keep.push(key)
      continue
    }
    if (!nospace) continue
    if (shape === 'desc') {
      const op = w.skipped.get(key.replace(/description$/, 'op'))
      if (op !== undefined && descListed(op)) keep.push(key)
      continue
    }
    keep.push(key)
  }
  return keep.sort()
}

function itemsOutEqualItemsIn(out: [J, [J, J][]]) {
  expect(out[1].map((it) => it[0].type)).toEqual(ADMITTED_OUT)
  const s = JSON.stringify(out)
  expect(s).not.toMatch(/"type":"(attachment|wat)"/)
  expect(s).not.toMatch(/plant_/)
  return s
}

const EMAIL = at('tanaka', 'example.com')
const JP = '藤井美奈子'
const JP_ENC = '%E8%97%A4%E4%BA%95'

describe('C1 every-position canary', () => {
  it('JP: appears nowhere; the output is pure ASCII', () => {
    const s = itemsOutEqualItemsIn(rebuilt(mutate(JP).env))
    expect(s).not.toContain(JP)
    expect(/[^\x00-\x7F]/.test(s)).toBe(false)
  })

  it.each([` ${EMAIL}`, `_${EMAIL}`])('EMAIL %j: appears nowhere', (plant) => {
    const s = itemsOutEqualItemsIn(rebuilt(mutate(plant).env))
    expect(s).not.toContain(EMAIL)
    expect(s).not.toContain('tanaka%40example.com')
  })

  it('JP-ENC at path positions: appears nowhere', () => {
    const w = mutate(JP_ENC, true)
    expect(w.planted.size).toBeGreaterThan(20)
    const s = itemsOutEqualItemsIn(rebuilt(w.env))
    expect(s).not.toContain('%E8')
  })

  it('EMAIL-ENC at path positions: appears nowhere', () => {
    const w = mutate('_tanaka%40example.com', true)
    const s = itemsOutEqualItemsIn(rebuilt(w.env))
    expect(s).not.toContain('tanaka%40example.com')
    expect(s).not.toContain(EMAIL)
  })

  it('EN (with a space): EXACTLY at the spaced + masked positions', () => {
    const w = mutate(' Tanaka Hanako')
    const out = rebuilt(w.env)
    itemsOutEqualItemsIn(out)
    const exp = expected(w, 'EN', ' Tanaka Hanako')
    expect(exp.length).toBeGreaterThan(10)
    expect(found(out, 'Tanaka Hanako')).toEqual(exp)
  })

  it('EN-NOSPACE: EXACTLY at the token/path/spaced/masked positions whose ⊂ accepts it', () => {
    const w = mutate('_TanakaHanako')
    const out = rebuilt(w.env)
    itemsOutEqualItemsIn(out)
    const exp = expected(w, 'EN-NOSPACE', '_TanakaHanako')
    expect(exp.length).toBeGreaterThan(50)
    expect(found(out, '_TanakaHanako')).toEqual(exp)
  })

  it('UNMUTATED: the positive controls survive byte-equal', () => {
    const out = rebuilt(fixture())
    itemsOutEqualItemsIn(out)
    const [h, items] = out
    const [error, alarm, txn, inp, session, , report, checkIn] = items.map((it) => it[1]) as J[]
    const trace = h.trace as J
    expect([trace.sample_rate, trace.sampled, trace.sample_rand]).toEqual(['0.1', 'true', '0.056030427000071326'])
    expect(trace.transaction).toBeUndefined()
    expect(h.dsn).toBeUndefined()
    const e = error as any
    expect(e.debug_meta.images[0].debug_id).toBe(DEBUG_ID)
    expect(e.exception.values[0].stacktrace.frames[0]).toMatchObject({ filename: 'app:///_next/static/chunks/a.js', lineno: 10 })
    expect(e.contexts.trace.trace_id).toBe(TRACE)
    expect(e.transaction).toBe('/ja/customers')
    expect(e.sdk.settings.infer_ip).toBe('never')
    // COLD C10: a route-sourced name with no ? or # keeps source 'route' through the exit.
    expect((txn as any).transaction_info.source).toBe('route')
    expect((txn as any).transaction).toBe('/ja/customers')
    const i = inp as any
    expect([i.op, i.exclusive_time, i.measurements.inp]).toEqual(['ui.interaction.click', 120, { value: 120, unit: 'millisecond' }])
    expect(i.description).toBe('ui.interaction.click')
    expect(session.status).toBe('ok')
    expect((report as any).discarded_events[0].quantity).toBe(2)
    expect(checkIn.monitor_slug).toBe('pulse')
    expect(alarm.tags).toEqual({ alarm: '1', alarm_kind: 'rec_cut', business_id: UUID })
    expect(Object.keys(alarm.extra as J).sort()).toEqual([
      'age_minutes', 'app_build', 'bytes_stored', 'business_count', 'count', 'newest_piece_at', 'os_version',
      'pieces_stored', 'reason', 'rec_session_id', 'seconds_recorded', 'store_id', 'take_id', 'take_ids',
    ].sort())
  })
})

describe('C1 F1 forms at the masked positions (R-S112-5 F1)', () => {
  it.each(F1_FORMS)('%j at exception.value, exception.type and the alarm message', (form) => {
    const [h, items] = fixture() as [J, [J, any][]]
    for (const v of items[0][1].exception.values) {
      v.value = form
      v.type = form.slice(0, 100)
    }
    items[1][1].message = form
    const out = rebuilt([h, items])
    const [error, alarm] = out[1].map((it) => it[1]) as any[]
    const left = [
      ...error.exception.values.flatMap((v: J) => [v.value, v.type]),
      alarm.message,
    ] as (string | undefined)[]
    expect(left).toHaveLength(7)
    // a value whose only content was masked is dropped (R-S112-6 S2)
    if (!/[A-Za-z]{3}/.test(form.replace(/\d/g, ''))) expect(left.every((s) => s === undefined)).toBe(true)
    for (const s of left.filter((x): x is string => x !== undefined)) {
      expect(s).not.toMatch(/\d/)
      expect(s).not.toMatch(/tanaka|hanako/i)
    }
  })
})

describe('C1 N8 plants: phone, key, JWT, Base64, Bearer, query string, encoded content', () => {
  const NOSPACE: [string, string, string[]][] = [
    ['PHONE', `_${PHONE_HY}`, [PHONE_HY, '4321-8765']],
    ['KEY32', `_${KEY32}`, [KEY32.slice(8)]],
    ['JWT', `_${JWT}`, [JWT.split('.')[1], JWT.split('.')[2]]],
    ['BLOB', `_${BLOB200}`, [BLOB200.slice(40, 70), BLOB200.slice(120, 150)]],
  ]
  it.each(NOSPACE)('%s appended to every string: appears nowhere', (_n, plant, needles) => {
    const s = itemsOutEqualItemsIn(rebuilt(mutate(plant).env))
    for (const n of needles) expect(s).not.toContain(n)
  })

  it('Bearer and Authorization text appended to every string: the secret appears nowhere', () => {
    for (const plant of [` Bearer ${KEY32.slice(8)}`, ` Authorization: Basic ${KEY32.slice(10)}`]) {
      const s = itemsOutEqualItemsIn(rebuilt(mutate(plant).env))
      expect(s).not.toContain(KEY32.slice(10))
    }
  })

  it('encoded content at path positions appears nowhere (F2)', () => {
    for (const [plant, needle] of [['/Tanaka%20Hanako', 'Tanaka'], ['/a%2540b.jp', '2540'], ['/a%40b%2Ejp', '%40b'], [`/${PHONE_HY.split('-').join('%2D')}`, '%2D4321']]) {
      const w = mutate(plant, true)
      expect(w.planted.size).toBeGreaterThan(20)
      expect(itemsOutEqualItemsIn(rebuilt(w.env))).not.toContain(needle)
    }
  })

  it('a query string appended everywhere is cut by stripQuery at path positions; the paths stay', () => {
    // path positions only: masked free text keeps a literal `?q=` by design
    const w = mutate('?q=QSECRET#FSECRET', true)
    expect(w.planted.size).toBeGreaterThan(20)
    const out = rebuilt(w.env)
    const s = itemsOutEqualItemsIn(out)
    expect(s).not.toContain('QSECRET')
    expect(s).not.toContain('FSECRET')
    const e = out[1][0][1] as any
    expect(e.request.url).toBe('https://karute.app/ja/customers')
    expect(e.exception.values[0].stacktrace.frames[0].filename).toBe('app:///_next/static/chunks/a.js')
    expect(e.transaction).toBe('/ja/customers')
  })
})

describe('C1 R-S115-1 plants: label forms and S2 look-alike cuts through the transport', () => {
  const secret = ['Zk4', 'pVw9'].join('')
  const ev = (value: string, ua: string) => ({
    event_id: 'b'.repeat(32),
    exception: { values: [{ type: 'Error', value }] },
    request: { headers: { 'user-agent': ua } },
  })
  it.each(LABEL_FORMS.map((f) => [f(secret)]))('%s at exception.value and the user-agent', (form) => {
    const out = JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, ev(`failed ${form}`, `Mozilla/5.0 ${form}`)]]]))
    expect(out).not.toContain(secret)
    expect(out).toContain('failed') // positive control: the value itself left, masked
  })
  it.each(S2_CUT_SHAPES)('%s cut at 2000 in exception.value leaves no digit group or local part', (_n, shape) => {
    for (let k = 1965; k <= 1999; k++) {
      const out = JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, ev('あ'.repeat(k) + shape + 'ん'.repeat(60), 'x')]]]))
      expect(out).not.toMatch(/090|1234|5678|tanak|hanak/)
    }
  })
})
