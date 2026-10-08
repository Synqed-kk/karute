// U1 — unit tests for the exit's allow-list builders (item 102, rev 3 § 4).
import {
  bool, buildCheckIn, buildClientReport, buildEnvelopeHeader, buildItemHeader,
  buildSession, buildSessionAggregates, admittedItemType, enumOf, frameFile, id,
  iso, masked, num, numString, path, spaced, token, transactionName, ts,
} from '@/lib/observability/sentry-exit'

const at = (l: string, r: string) => [l, r].join('@')
const EMAIL = at('tanaka', 'example.com')
const UUID = '3f2b1c4d-1111-4222-8333-444455556666'
const HEX32 = '0123456789abcdef0123456789abcdef'
const HEX16 = '0123456789abcdef'

describe('U1 § 2.0 shapes', () => {
  it('id: anchored UUID or 16-32 hex; UUID with text around it is rejected', () => {
    expect(id(UUID)).toBe(UUID)
    expect(id(UUID.toUpperCase())).toBe(UUID.toUpperCase())
    expect(id(HEX32)).toBe(HEX32)
    expect(id(HEX16)).toBe(HEX16)
    expect(id(`x${UUID}`)).toBeUndefined()
    expect(id(`${UUID}x`)).toBeUndefined()
    expect(id(`${UUID}\n`)).toBeUndefined()
    expect(id('0123456789abcde')).toBeUndefined()
    expect(id(`${HEX32}0`)).toBeUndefined()
    expect(id(HEX32, true)).toBeUndefined()
    expect(id(42)).toBeUndefined()
  })

  it('num-string accepts the positive control 0.056030427000071326 and rejects a number', () => {
    expect(numString('0.056030427000071326')).toBe('0.056030427000071326')
    expect(numString('1')).toBe('1')
    expect(numString('1e-7')).toBe('1e-7')
    expect(numString('0.1 x')).toBeUndefined()
    expect(numString(0.1)).toBeUndefined()
  })

  it('iso', () => {
    expect(iso('2026-10-06T00:58:15.123Z')).toBe('2026-10-06T00:58:15.123Z')
    expect(iso('2026-10-06 00:58')).toBeUndefined()
  })

  it('token: no spaces, ASCII, bounded, email rule, narrower pattern', () => {
    expect(token('abc_1.2:3@x/y+z-', 40)).toBe('abc_1.2:3@x/y+z-')
    expect(token('has space', 40)).toBeUndefined()
    expect(token('藤井', 40)).toBeUndefined()
    expect(token('a'.repeat(41), 40)).toBeUndefined()
    expect(token('', 40)).toBeUndefined()
    expect(token('Abc', 40, /^[a-z]+$/)).toBeUndefined()
    expect(token(EMAIL, 100)).toBeUndefined()
  })

  it('path: stripQuery, charset, percent-encoded non-ASCII rejected, %5B / %28 legal', () => {
    expect(path('/ja/customers/abc?q=Tanaka#x', 300)).toBe('/ja/customers/abc')
    expect(path('/ja/customers/%E8%97%A4%E4%BA%95', 300)).toBeUndefined()
    expect(path('/a/%5Bid%5D/%28group%29', 300)).toBe('/a/%5Bid%5D/%28group%29')
    expect(path('/a b', 300)).toBeUndefined()
    expect(path('/藤井', 300)).toBeUndefined()
  })

  it('R-S103-1 positive controls pass path()', () => {
    for (const p of [
      'file:///var/task/node_modules/@supabase/supabase-js/dist/index.js',
      'app:///_next/static/chunks/app/%40modal/page.js',
      'webpack-internal:///(app-pages-browser)/./node_modules/@sentry/core/build/esm/index.js',
    ]) expect(path(p, 300)).toBe(p)
  })

  it('R-S103-1 email cases are rejected by token, path and spaced alike', () => {
    for (const s of [EMAIL, `/ja/customers/${EMAIL}/edit`, '/ja/customers/tanaka%40example.com']) {
      expect(token(s, 200)).toBeUndefined()
      expect(path(s, 300)).toBeUndefined()
      expect(spaced(s, 200)).toBeUndefined()
    }
  })

  it('F4 stated loss: logo@2x.png is rejected by path()', () => {
    expect(path('/_next/static/media/logo@2x.png', 300)).toBeUndefined()
  })

  it('spaced: printable ASCII with spaces only', () => {
    expect(spaced('Mac OS X', 40)).toBe('Mac OS X')
    expect(spaced('tab\there', 40)).toBeUndefined()
    expect(spaced('藤井', 40)).toBeUndefined()
    expect(spaced('a'.repeat(41), 40)).toBeUndefined()
  })

  it('masked: an email straddling n leaves masked (masking runs before the cut)', () => {
    const s = `${'x'.repeat(20)} tanaka.hanako@example.com`
    const out = masked(s, 30) as string
    expect(out).not.toContain('tanaka')
    expect(out).not.toContain('@')
    expect(out.length).toBeLessThanOrEqual(30)
  })

  it('F9 masked: Japanese removed, encoded non-ASCII removed, %40 email masked', () => {
    const a = masked('保存に失敗しました: 藤井美奈子 Tanaka', 200) as string
    expect(a).toMatch(/^[\x00-\x7F]*$/)
    expect(a).toContain('Tanaka')
    expect(masked('GET /ja/customers/%E8%97%A4%E4%BA%95 failed', 200)).not.toContain('%E8')
    // only masked content left → the field is dropped (R-S112-6 S2)
    expect(masked('tanaka%40example.com', 200)).toBeUndefined()
    expect(masked('mail tanaka%40example.com', 200)).toBe('mail <email>')
  })

  it('fix 5: frame filename literals', () => {
    expect(frameFile('<anonymous>')).toBe('<anonymous>')
    expect(frameFile('[native code]')).toBe('[native code]')
    expect(frameFile('native')).toBe('native')
    expect(frameFile('<anonymous2>')).toBeUndefined()
  })

  it('fix 6: transaction name rule', () => {
    expect(transactionName('/ja/customers/[id]')).toBe('/ja/customers/[id]')
    expect(transactionName('GET /ja/customers')).toBe('GET /ja/customers')
    expect(transactionName('middleware GET')).toBe('middleware GET')
    expect(transactionName('middleware GET /x')).toBeUndefined()
    expect(transactionName('middleware FETCH')).toBeUndefined()
    expect(transactionName('FETCH /x')).toBeUndefined()
    expect(transactionName('Tanaka Hanako')).toBeUndefined()
  })

  it('num / bool / ts / enum', () => {
    expect(num(1.5)).toBe(1.5)
    expect(num(NaN)).toBeUndefined()
    expect(num('1')).toBeUndefined()
    expect(bool(false)).toBe(false)
    expect(bool('true')).toBeUndefined()
    expect(ts(0)).toBe(0)
    expect(ts(-1)).toBeUndefined()
    expect(enumOf(['a', 'b'])('a')).toBe('a')
    expect(enumOf(['a', 'b'])('c')).toBeUndefined()
  })
})

describe('U1 § 2.1 envelope header', () => {
  const header = {
    event_id: HEX32,
    sent_at: '2026-10-06T00:00:00.000Z',
    sdk: { name: 'sentry.javascript.nextjs', version: '10.51.0', packages: ['x'] },
    dsn: 'https://k@o.ingest.example/1',
    trace: {
      trace_id: HEX32, public_key: HEX32, sample_rate: '0.1', sampled: 'true',
      sample_rand: '0.056030427000071326', release: 'r1', environment: 'preview', org_id: '12345',
      transaction: '/ja/customers/Tanaka', replay_id: HEX32,
    },
    rogue: 'x',
  }

  it('keeps each allow-list key; drops dsn, trace.transaction, replay_id and unnamed keys', () => {
    expect(buildEnvelopeHeader(header)).toEqual({
      event_id: HEX32,
      sent_at: '2026-10-06T00:00:00.000Z',
      sdk: { name: 'sentry.javascript.nextjs', version: '10.51.0' },
      trace: {
        trace_id: HEX32, public_key: HEX32, sample_rate: '0.1', sampled: 'true',
        sample_rand: '0.056030427000071326', release: 'r1', environment: 'preview', org_id: '12345',
      },
    })
  })

  it('a boolean sampled, a non-32-hex public_key and an unknown environment are rejected', () => {
    const out = buildEnvelopeHeader({ trace: { sampled: true, public_key: HEX16, environment: 'staging', org_id: 'o1' } })
    expect(out).toEqual({})
  })

  it('a non-object header builds {}', () => {
    expect(buildEnvelopeHeader(null)).toEqual({})
    expect(buildEnvelopeHeader('x')).toEqual({})
  })
})

describe('U1 § 2.2 item gate', () => {
  it('admits exactly the seven types and builds { type } only', () => {
    for (const t of ['event', 'transaction', 'span', 'session', 'sessions', 'client_report', 'check_in']) {
      expect(admittedItemType(t)).toBe(t)
    }
    for (const t of ['attachment', 'replay_event', 'replay_recording', 'profile', 'profile_chunk', 'log',
      'metric', 'trace_metric', 'feedback', 'user_report', 'raw_security', 'wat']) {
      expect(admittedItemType(t)).toBeUndefined()
    }
    expect(buildItemHeader('event')).toEqual({ type: 'event' })
  })
})

describe('U1 § 2.6 / 2.7 sessions', () => {
  it('buildSession keeps the list; did / ip_address / user_agent are absent (R-S102-2 D5)', () => {
    const out = buildSession({
      sid: HEX32, init: true, started: '2026-10-06T00:00:00.000Z', timestamp: '2026-10-06T00:00:01.000Z',
      status: 'ok', errors: 0, duration: 1.5, abnormal_mechanism: 'anr_foreground', did: EMAIL,
      attrs: { release: 'r1', environment: 'production', ip_address: '1.2.3.4', user_agent: 'Mozilla/5.0 X' },
      rogue: 1,
    })
    expect(out).toEqual({
      sid: HEX32, init: true, started: '2026-10-06T00:00:00.000Z', timestamp: '2026-10-06T00:00:01.000Z',
      status: 'ok', errors: 0, duration: 1.5, abnormal_mechanism: 'anr_foreground',
      attrs: { release: 'r1', environment: 'production' },
    })
    expect(JSON.stringify(out)).not.toMatch(/did|ip_address|user_agent/)
  })

  it('buildSession rejects a wrong status and a spaced release', () => {
    expect(buildSession({ status: 'fine', attrs: { release: 'r 1' } })).toEqual({})
  })

  it('buildSessionAggregates keeps ≤ 100 aggregates with the named counts', () => {
    const agg = { started: '2026-10-06T00:00:00Z', exited: 1, errored: 0, crashed: 0, abnormal: 0, rogue: 'x' }
    const out = buildSessionAggregates({ attrs: { environment: 'preview' }, aggregates: Array(150).fill(agg) })
    expect((out.aggregates as unknown[]).length).toBe(100)
    expect((out.aggregates as unknown[])[0]).toEqual({ started: '2026-10-06T00:00:00Z', exited: 1, errored: 0, crashed: 0, abnormal: 0 })
    expect(out.attrs).toEqual({ environment: 'preview' })
  })
})

describe('U1 § 2.8 client report', () => {
  it('keeps ≤ 50 discarded events with snake-case reason/category', () => {
    const out = buildClientReport({
      timestamp: 1, discarded_events: [
        { reason: 'before_send', category: 'error', quantity: 2, rogue: 'x' },
        { reason: 'Before Send', category: 'error', quantity: 1 },
        ...Array(60).fill({ reason: 'sample_rate', category: 'transaction', quantity: 1 }),
      ],
    })
    const d = out.discarded_events as Record<string, unknown>[]
    expect(d.length).toBe(50)
    expect(d[0]).toEqual({ reason: 'before_send', category: 'error', quantity: 2 })
    expect(d[1]).toEqual({ category: 'error', quantity: 1 })
    expect(out.timestamp).toBe(1)
  })
})

describe('U1 § 2.9 check-in (PROVISIONAL)', () => {
  it('keeps the named keys; crontab value is spaced, interval value is a number', () => {
    const base = {
      check_in_id: HEX32, monitor_slug: 'rec-pulse', status: 'ok', duration: 3, release: 'r1',
      environment: 'production', rogue: 'x',
      contexts: { trace: { trace_id: HEX32, span_id: HEX16, rogue: 'x' }, other: { a: 1 } },
    }
    const cron = buildCheckIn({
      ...base,
      monitor_config: {
        schedule: { type: 'crontab', value: '*/5 * * * *', unit: 'minute' },
        checkin_margin: 1, max_runtime: 2, failure_issue_threshold: 3, recovery_threshold: 4, timezone: 'Asia/Tokyo',
      },
    })
    expect(cron).toEqual({
      check_in_id: HEX32, monitor_slug: 'rec-pulse', status: 'ok', duration: 3, release: 'r1', environment: 'production',
      monitor_config: {
        schedule: { type: 'crontab', value: '*/5 * * * *', unit: 'minute' },
        checkin_margin: 1, max_runtime: 2, failure_issue_threshold: 3, recovery_threshold: 4, timezone: 'Asia/Tokyo',
      },
      contexts: { trace: { trace_id: HEX32, span_id: HEX16 } },
    })
    const interval = buildCheckIn({ monitor_config: { schedule: { type: 'interval', value: 5 } } })
    expect(interval).toEqual({ monitor_config: { schedule: { type: 'interval', value: 5 } } })
    expect(buildCheckIn({ monitor_slug: 'Rec Pulse' })).toEqual({})
  })
})

// ---- stage 2b ------------------------------------------------------------------
import {
  buildAlarmItem, buildErrorEvent, buildSpan, buildTransactionEvent, rebuildEnvelope, spanDescription,
} from '@/lib/observability/sentry-exit'
import { keepBreadcrumb } from '@/lib/observability/sentry-scrub'

/** Walk a JSON value by keys (test-only reader). */
const dig = (o: unknown, ...keys: (string | number)[]): unknown =>
  keys.reduce<unknown>((a, k) => (a as Record<string | number, unknown>)[k], o)
const len = (o: unknown, ...keys: (string | number)[]) => (dig(o, ...keys) as unknown[]).length

const fullError = () => ({
  event_id: HEX32, timestamp: 1, platform: 'javascript', level: 'error', environment: 'preview',
  release: 'r1', dist: 'd1', type: undefined, server_name: 'host-1', user: { email: EMAIL },
  modules: { a: '1' }, extra: { __serialized__: 'x' }, message: 'm', logentry: { message: 'm' },
  sdk: { name: 'sentry.javascript.nextjs', version: '10.51.0', integrations: ['a'], settings: { infer_ip: 'never' } },
  transaction: '/ja/customers/[id]', transaction_info: { source: 'route' },
  fingerprint: ['a', 'b c', 'c', 'd', 'e', 'f', 'g'],
  tags: { business_id: UUID, store_id: UUID, runtime: 'browser', turbopack: true, customer_name: 'x' },
  exception: { values: [{
    type: 'Error', value: 'boom', mechanism: { type: 'generic', handled: true, source: 'cause', data: { a: 1 } },
    stacktrace: { frames: [{ filename: 'app:///_next/a.js', abs_path: 'app:///_next/a.js', function: 'Foo.bar',
      module: 'a.b:c', lineno: 1, colno: 2, in_app: true, vars: { a: 1 }, context_line: 'x', debug_id: UUID }] },
  }] },
  debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///_next/a.js', debug_id: UUID }] },
  request: { method: 'GET', url: 'https://karute.test/ja/customers?q=1', cookies: { a: 1 }, data: 'x',
    query_string: 'q=1', headers: { 'User-Agent': 'Mozilla/5.0 (X)', Referer: 'https://x', cookie: 'c',
      'content-type': 'application/json; charset=utf-8', 'x-forwarded-for': '1.2.3.4' } },
  contexts: {
    trace: { trace_id: HEX32, span_id: HEX16, op: 'pageload', data: { 'lcp.element': 'div', 'lcp.size': 3 } },
    os: { name: 'Mac OS X', version: '14.0' }, culture: { locale: 'ja-JP', timezone: 'Asia/Tokyo', calendar: 'x' },
    user: { a: 1 }, response: { a: 1 }, app: { app_start_time: '2026-10-06T00:00:00.000Z', app_memory: 1 },
  },
  breadcrumbs: [{ category: 'ui.click', message: 'div' }, { category: 'navigation', data: { from: '/a?x=1', to: '/b' } }],
})

describe('U1 § 2.3 buildErrorEvent', () => {
  it('keeps exactly the allow-listed keys', () => {
    expect(buildErrorEvent(fullError())).toEqual({
      event_id: HEX32, timestamp: 1, platform: 'javascript', level: 'error', environment: 'preview', release: 'r1', dist: 'd1',
      sdk: { name: 'sentry.javascript.nextjs', version: '10.51.0', settings: { infer_ip: 'never' } },
      transaction: '/ja/customers/[id]', transaction_info: { source: 'route' },
      fingerprint: ['a', 'c', 'd', 'e', 'f'],
      tags: { business_id: UUID, store_id: UUID, runtime: 'browser' },
      exception: { values: [{ type: 'Error', value: 'boom', mechanism: { type: 'generic', handled: true, source: 'cause' },
        stacktrace: { frames: [{ filename: 'app:///_next/a.js', abs_path: 'app:///_next/a.js', function: 'Foo.bar',
          module: 'a.b:c', lineno: 1, colno: 2, in_app: true }] } }] },
      debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///_next/a.js', debug_id: UUID }] },
      request: { method: 'GET', url: 'https://karute.test/ja/customers',
        headers: { 'user-agent': 'Mozilla/5.0 (X)', 'content-type': 'application/json; charset=utf-8' } },
      contexts: {
        trace: { trace_id: HEX32, span_id: HEX16, op: 'pageload', data: { 'lcp.size': 3 } },
        os: { name: 'Mac OS X', version: '14.0' }, culture: { locale: 'ja-JP', timezone: 'Asia/Tokyo' },
        app: { app_start_time: '2026-10-06T00:00:00.000Z' },
      },
      breadcrumbs: [{ category: 'navigation', data: { from: '/a', to: '/b' } }],
    })
  })

  it('a failing event_id drops the event (required field)', () => {
    expect(buildErrorEvent({ ...fullError(), event_id: 'nope' })).toBeNull()
  })

  it('array limits: last 10 exceptions, last 200 frames, last 20 breadcrumbs', () => {
    const e = buildErrorEvent({
      event_id: HEX32,
      exception: { values: Array.from({ length: 12 }, (_, i) => ({ type: `E${i}`,
        stacktrace: { frames: Array.from({ length: 250 }, (_, j) => ({ lineno: j })) } })) },
      breadcrumbs: Array.from({ length: 30 }, (_, i) => ({ category: 'navigation', data: { to: `/p${i}` } })),
    })
    expect(len(e, 'exception', 'values')).toBe(10)
    expect(dig(e, 'exception', 'values', 0, 'type')).toBe('E2')
    expect(len(e, 'exception', 'values', 0, 'stacktrace', 'frames')).toBe(200)
    expect(dig(e, 'exception', 'values', 0, 'stacktrace', 'frames', 199, 'lineno')).toBe(249)
    expect(len(e, 'breadcrumbs')).toBe(20)
    expect(dig(e, 'breadcrumbs', 0, 'data', 'to')).toBe('/p10')
  })

  it('keepBreadcrumb is exported (one definition)', () => {
    expect(keepBreadcrumb({ category: 'ui.click' })).toBeNull()
  })
})

describe('U1 § 2.3a buildAlarmItem', () => {
  it('keeps the alarm tags/extra with exit shapes; no request/contexts/breadcrumbs/exception', () => {
    const out = buildAlarmItem({
      event_id: HEX32, message: 'recording cut 藤井', level: 'error',
      tags: { alarm: '1', alarm_kind: 'exit_drop', business_id: UUID, store_id: UUID },
      extra: { take_id: 't1', reason: 'two words', os_version: 'iOS 18.1', newest_piece_at: '2026-10-06T00:00:00Z',
        count: 3, take_ids: ['a', 'b c'], customer: 'x' },
      request: { url: '/x' }, contexts: { os: { name: 'x' } }, breadcrumbs: [{ category: 'navigation' }],
      exception: { values: [{ type: 'E' }] },
    })
    expect(out).toEqual({
      event_id: HEX32, level: 'error', message: 'recording cut <text>', // maskSensitive marks the Japanese first
      tags: { alarm: '1', alarm_kind: 'exit_drop', business_id: UUID },
      extra: { take_id: 't1', os_version: 'iOS 18.1', newest_piece_at: '2026-10-06T00:00:00Z', count: 3, take_ids: ['a'] },
    })
  })
  it('a failing event_id drops the alarm', () => {
    expect(buildAlarmItem({ event_id: 'x', tags: { alarm: '1' } })).toBeNull()
  })
})

describe('U1 § 2.5 buildSpan + § 2.4 transaction', () => {
  it('description rule: INP element never leaves; listed ops keep a path; http ops need the method prefix', () => {
    expect(spanDescription('ui.interaction.click', 'body > button[aria-label="藤井"]')).toBe('ui.interaction.click')
    expect(spanDescription('mark', 'Tanaka')).toBe('mark')
    expect(spanDescription('resource.script', '/_next/a.js?x=1')).toBe('/_next/a.js')
    expect(spanDescription('browser.request', 'https://karute.test/ja/x?q')).toBe('https://karute.test/ja/x')
    expect(spanDescription('http.client', 'GET /api/x?q=1')).toBe('GET /api/x')
    expect(spanDescription('http.client', '/api/x')).toBe('http.client')
    expect(spanDescription('resource.img', '/a b.png')).toBe('resource.img')
  })
  it('span_id / trace_id are required; data is allow-listed', () => {
    expect(buildSpan({ trace_id: HEX32 })).toBeNull()
    expect(buildSpan({ span_id: HEX16, trace_id: HEX32, op: 'ui.interaction.click', description: 'x',
      exclusive_time: 5, measurements: { inp: { value: 40, unit: 'millisecond' } },
      data: { 'sentry.op': 'ui.interaction.click', user: 'x', 'url.full': 'x', 'lcp.element': 'x', 'user_agent.original': 'Mozilla/5.0 (X)' },
      links: [{ a: 1 }] })).toEqual({ span_id: HEX16, trace_id: HEX32, op: 'ui.interaction.click', description: 'ui.interaction.click',
      exclusive_time: 5, measurements: { inp: { value: 40, unit: 'millisecond' } },
      data: { 'sentry.op': 'ui.interaction.click', 'user_agent.original': 'Mozilla/5.0 (X)' } })
  })
  it('transaction: spans first 1000, a bad entry dropped and reported; a bad unit keeps the value', () => {
    const dropped: unknown[][] = []
    const out = buildTransactionEvent({ event_id: HEX32, type: 'transaction', start_timestamp: 1, timestamp: 2,
      transaction: 'GET /ja/customers', measurements: { 'ttfb.requestTime': { value: 1, unit: 'milli second' } },
      spans: [{ span_id: 'bad', trace_id: HEX32 }, ...Array(1100).fill({ span_id: HEX16, trace_id: HEX32 })] },
    (reason, count) => { dropped.push([reason, count]) }) as Record<string, unknown>
    // the bad entry, then the 101 spans past the first 1000 as one counted tail
    expect(dropped).toEqual([['required_field', undefined], ['over_limit', 101]])
    expect(len(out, 'spans')).toBe(999)
    expect(out.measurements).toEqual({ 'ttfb.requestTime': { value: 1 } })
    expect(out.transaction).toBe('GET /ja/customers')
    expect(out.type).toBe('transaction')
  })
})

describe('U1 rebuildEnvelope', () => {
  const ev = () => [{ type: 'event' }, { event_id: HEX32 }]
  it('the item-type gate drops unknown types and reports each drop', () => {
    const drops: string[] = []
    const out = rebuildEnvelope([{ event_id: HEX32 }, [ev(), [{ type: 'attachment', filename: 'a' }, new Uint8Array(1)],
      [{ type: 'wat' }, {}], [{ type: 'Tanaka Hanako' }, {}]]], (t, r) => drops.push(`${t}:${r}`)) as unknown as [unknown, unknown[]]
    expect(out[1]).toEqual([[{ type: 'event' }, { event_id: HEX32 }]])
    // a type name that is not snake-case is never counted or logged by name
    expect(drops).toEqual(['attachment:type_not_admitted', 'wat:type_not_admitted', 'unknown:type_not_admitted'])
  })
  it('a dropped client_report calls no onDrop', () => {
    const onDrop = jest.fn()
    const bad = { get timestamp() { throw new Error('x') } }
    expect(rebuildEnvelope([{}, [[{ type: 'client_report' }, bad]]], onDrop)).toBeNull()
    expect(onDrop).not.toHaveBeenCalled()
  })
  it('a throwing getter drops the item, not the envelope', () => {
    const drops: string[] = []
    const bad = { event_id: HEX32, get exception() { throw new Error('x') } }
    const out = rebuildEnvelope([{}, [[{ type: 'event' }, bad], ev()]], (t, r) => drops.push(`${t}:${r}`)) as unknown as [unknown, unknown[]]
    expect(out[1].length).toBe(1)
    expect(drops).toEqual(['event:builder_threw'])
  })
  it('alarm info is handed to onDrop; an unreadable tag counts as unreadable', () => {
    const infos: unknown[] = []
    rebuildEnvelope([{}, [[{ type: 'event' }, { event_id: 'x', environment: 'preview', tags: { alarm: '1' } }],
      [{ type: 'event' }, { event_id: HEX32, get tags() { throw new Error('x') } }]]], (_t, _r, i) => infos.push(i))
    expect(infos).toEqual([{ alarm: true, eventId: 'x', environment: 'preview' }, { alarm: 'unreadable', eventId: HEX32, environment: undefined }])
  })
  it('never throws; returns null for nothing left; onDrop throwing is contained', () => {
    expect(rebuildEnvelope(null)).toBeNull()
    expect(rebuildEnvelope([{}, []])).toBeNull()
    expect(rebuildEnvelope([{}, [[{ type: 'wat' }, {}]]], () => { throw new Error('x') })).toBeNull()
  })
})

// ---- stage 2c: U1 fuzz — rebuildEnvelope never throws (rev 3 § 4 U1) ----
describe('U1 fuzz: 500 random envelopes', () => {
  it('never throws; the output is JSON-serialisable', () => {
    let seed = 102
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
    const TYPES = ['event', 'transaction', 'span', 'session', 'sessions', 'client_report', 'check_in', 'attachment', 'wat', 'constructor', '__proto__']
    const KEYS = [
      'event_id', 'tags', 'alarm', 'exception', 'values', 'stacktrace', 'frames', 'filename', 'spans', 'span_id', 'trace_id',
      'op', 'description', 'data', 'contexts', 'trace', 'request', 'headers', 'breadcrumbs', 'category', 'measurements',
      'value', 'unit', 'sdk', 'settings', 'attrs', 'aggregates', 'discarded_events', 'extra', 'take_ids', 'monitor_config',
      'schedule', 'debug_meta', 'images', 'fingerprint', 'message', 'environment', 'sid', '__proto__',
    ]
    const STRINGS = ['藤井', 'x', UUID, '1', '', HEX32, 'GET /a', at('a', 'b.co'), 'navigation', 'event', 'x'.repeat(5000)]
    // Own data properties (a '__proto__' key becomes an own key: the prototype-pollution case).
    const set = (o: object, k: string, v: unknown) =>
      Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
    const gen = (depth: number): unknown => {
      const r = rnd()
      if (depth > 5 || r < 0.15) return pick(STRINGS)
      if (r < 0.22) return pick([0, -1, NaN, Infinity, 1e308, 1.5])
      if (r < 0.25) return BigInt(7)
      if (r < 0.28) return Symbol('s')
      if (r < 0.31) return pick([null, undefined, true, false])
      if (r < 0.33) return new Array(20000).fill(pick(STRINGS))
      if (r < 0.43) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(depth + 1))
      if (r < 0.49) {
        const o: Record<string, unknown> = {}
        set(o, pick(KEYS), gen(depth + 1))
        Object.defineProperty(o, pick(KEYS), { enumerable: true, configurable: true, get() { throw new Error('getter') } })
        return o
      }
      if (r < 0.53) {
        const o: Record<string, unknown> = {}
        set(o, 'self', o)
        set(o, pick(KEYS), o)
        return o
      }
      if (r < 0.55) {
        return new Proxy({}, {
          get() { throw new Error('proxy') },
          ownKeys() { throw new Error('keys') },
          has() { throw new Error('has') },
        })
      }
      const o: Record<string, unknown> = {}
      for (let i = 0; i < 1 + Math.floor(rnd() * 6); i++) set(o, pick(KEYS), gen(depth + 1))
      return o
    }
    for (let i = 0; i < 500; i++) {
      const items = rnd() < 0.05
        ? gen(0)
        : Array.from({ length: Math.floor(rnd() * 6) }, () => (rnd() < 0.1 ? gen(1) : [{ type: pick(TYPES) }, gen(1)]))
      const env = rnd() < 0.05 ? gen(0) : [gen(1), items]
      let out: unknown
      expect(() => { out = rebuildEnvelope(env, () => undefined) }).not.toThrow()
      expect(() => JSON.stringify(out)).not.toThrow()
    }
  })
})

// ---- stage 3a: A1 THE DROPPED-ALARM TEST + wrapTransport (rev 3 § 1.2, § 4 A1) ----
import { constantAlarm, wrapTransport } from '@/lib/observability/sentry-exit'
import type { BaseTransportOptions, Envelope, Transport } from '@sentry/core'

describe('A1 wrapTransport', () => {
  type Item = [Record<string, unknown>, Record<string, unknown>]
  type H = { sent: unknown[]; counted: unknown[][]; opts: BaseTransportOptions; inner: jest.Mock; send: jest.Mock; flush: jest.Mock }
  function harness(sendImpl?: (env: unknown) => unknown, recordImpl?: () => void): H {
    const sent: unknown[] = []
    const counted: unknown[][] = []
    const send = jest.fn((env: unknown) => {
      sent.push(env)
      return sendImpl ? sendImpl(env) : Promise.resolve({ statusCode: 200 })
    })
    const flush = jest.fn(() => Promise.resolve(true))
    const inner = jest.fn(() => ({ send, flush }) as unknown as Transport)
    const opts = {
      url: 'http://127.0.0.1:9/1',
      recordDroppedEvent: (r: unknown, c: unknown) => {
        counted.push([r, c])
        recordImpl?.()
      },
    } as unknown as BaseTransportOptions
    return { sent, counted, opts, inner, send, flush }
  }
  const HEADER = { event_id: HEX32, sdk: { name: 'sentry.javascript.nextjs', version: '10.51.0' } }
  const envOf = (...items: unknown[]) => [{ ...HEADER, dsn: 'x' }, items] as unknown as Envelope
  const alarmEv = (over: Record<string, unknown> = {}) => ({
    event_id: HEX32, environment: 'preview', tags: { alarm: '1', alarm_kind: 'rec_cut' }, message: 'm', ...over,
  })
  const okEv = () => [{ type: 'event' }, { event_id: HEX32, level: 'error' }]
  const sentItems = (h: H, n = 0) => (h.sent[n] as [unknown, Item[]])[1]
  const throwing = (o: Record<string, unknown>, key: string) => {
    Object.defineProperty(o, key, { enumerable: true, configurable: true, get() { throw new Error('getter') } })
    return o
  }
  let spy: jest.SpyInstance
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => spy.mockRestore())

  it('an alarm whose event_id fails `id` reaches inner as the constant exit_drop alarm; counted and logged', async () => {
    const h = harness()
    await wrapTransport(h.inner, { log: true })(h.opts).send(envOf([{ type: 'event' }, alarmEv({ event_id: 'not-an-id' })]))
    const items = sentItems(h)
    expect(items).toHaveLength(1)
    expect(items[0][0]).toEqual({ type: 'event' })
    const a = items[0][1]
    expect(Object.keys(a).sort()).toEqual(['environment', 'event_id', 'extra', 'level', 'message', 'platform', 'tags', 'timestamp'])
    expect(a.extra).toEqual({ count: 1 })
    expect(a).toMatchObject({
      level: 'error', message: 'alarm dropped at exit', tags: { alarm: '1', alarm_kind: 'exit_drop' },
      platform: 'javascript', environment: 'preview',
    })
    expect(a.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect((h.sent[0] as unknown[])[0]).toEqual(HEADER)
    expect(h.counted).toEqual([['before_send', 'error']])
    expect(spy).toHaveBeenCalledWith('[sentry-exit] dropped', JSON.stringify([{ item: 'event', reason: 'required_field', count: 1 }]))
  })

  it('an alarm whose getter throws (tag unreadable / builder throws) → the constant alarm with the original event_id', async () => {
    for (const ev of [throwing(alarmEv(), 'tags'), throwing(alarmEv(), 'message')]) {
      const h = harness()
      await wrapTransport(h.inner)(h.opts).send(envOf([{ type: 'event' }, ev]))
      const a = sentItems(h)[0][1]
      expect(a.event_id).toBe(HEX32)
      expect(a.tags).toEqual({ alarm: '1', alarm_kind: 'exit_drop' })
      expect(h.counted).toEqual([['before_send', 'error']])
    }
    expect(spy).not.toHaveBeenCalled() // no log flag → no log line
  })

  it('the constant alarm omits an environment that fails the enum', async () => {
    const h = harness()
    await wrapTransport(h.inner)(h.opts).send(envOf([{ type: 'event' }, alarmEv({ event_id: 'x', environment: 'Tanaka' })]))
    expect(sentItems(h)[0][1].environment).toBeUndefined()
    expect(constantAlarm({ alarm: true, environment: 'production' }).environment).toBe('production')
  })

  it('an ordinary event (alarm tag readable, not "1") whose builder throws: dropped and counted, NO constant alarm', async () => {
    const h = harness()
    const ev = throwing({ event_id: HEX32, tags: { alarm: '0' } }, 'exception')
    const r = await wrapTransport(h.inner, { log: true })(h.opts).send(envOf([{ type: 'event' }, ev]))
    expect(r).toEqual({})
    expect(h.send).not.toHaveBeenCalled()
    expect(h.counted).toEqual([['before_send', 'error']])
    expect(spy).toHaveBeenCalledWith('[sentry-exit] dropped', JSON.stringify([{ item: 'event', reason: 'builder_threw', count: 1 }]))
  })

  it('a dropped client_report item is never counted', async () => {
    const h = harness()
    await wrapTransport(h.inner, { log: true })(h.opts).send(envOf([{ type: 'client_report' }, throwing({}, 'discarded_events')], okEv()))
    expect(h.counted).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    expect(sentItems(h)).toHaveLength(1)
  })

  it('a rejection or a throw inside inner.send propagates exactly (no catch around it)', async () => {
    const err = new Error('network')
    const h = harness(() => Promise.reject(err))
    await expect(wrapTransport(h.inner)(h.opts).send(envOf(okEv()))).rejects.toBe(err)
    const h2 = harness(() => { throw err })
    expect(() => wrapTransport(h2.inner)(h2.opts).send(envOf(okEv()))).toThrow(err)
  })

  it('a throw while counting or logging never prevents sending the rebuilt envelope (with the constant alarm)', async () => {
    spy.mockImplementation(() => { throw new Error('log') })
    const h = harness(undefined, () => { throw new Error('count') })
    await wrapTransport(h.inner, { log: true })(h.opts).send(
      envOf(okEv(), [{ type: 'wat' }, {}], [{ type: 'event' }, alarmEv({ event_id: 'bad' })]),
    )
    const items = sentItems(h)
    expect(items.map((i) => i[0].type)).toEqual(['event', 'event'])
    expect(items[1][1].message).toBe('alarm dropped at exit')
  })

  it('opts reach inner unchanged; flush is forwarded; categories come from core; nothing left → resolves {} unsent', async () => {
    const h = harness()
    const t = wrapTransport(h.inner)(h.opts)
    expect(h.inner).toHaveBeenCalledWith(h.opts)
    await expect(t.flush(5)).resolves.toBe(true)
    expect(h.flush).toHaveBeenCalledWith(5)
    const r = await t.send(envOf([{ type: 'attachment' }, 'x'], [{ type: 'replay_event' }, {}], [{ type: '__proto__' }, {}]))
    expect(r).toEqual({})
    expect(h.send).not.toHaveBeenCalled()
    expect(h.counted).toEqual([['before_send', 'attachment'], ['before_send', 'replay'], ['before_send', 'default']])
  })

  it('an unreadable envelope is dropped (fail closed), never thrown', async () => {
    const h = harness()
    await expect(wrapTransport(h.inner)(h.opts).send(42 as unknown as Envelope)).resolves.toEqual({})
    expect(h.send).not.toHaveBeenCalled()
  })
})

describe('N4 ids are hex, not digits (R-S112-5 F3)', () => {
  it('an all-digit 16-32 run is not an id; a real hex id is', () => {
    expect(id('4111111111111111')).toBeUndefined()
    expect(id('0000009012345678')).toBeUndefined()
    expect(id('0'.repeat(32))).toBeUndefined()
    expect(id('0123456789abcdef')).toBe('0123456789abcdef')
    expect(id('3f2b1c4d111142228333444455556666')).toBe('3f2b1c4d111142228333444455556666')
    expect(id('3f2b1c4d-1111-4222-8333-444455556666')).toBe('3f2b1c4d-1111-4222-8333-444455556666')
  })
})
