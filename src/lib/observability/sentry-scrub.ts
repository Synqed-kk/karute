// Early trimming hooks. What leaves Karute is decided at the exit, sentry-exit.ts (the transport wrapper on the browser and node inits; the edge init until PR 2 keeps these hooks only). Until item 119, the alarm is rebuilt twice — buildAlarmEvent here and buildAlarmItem at the exit — sharing ALARM_TAG_KEYS, ALARM_EXTRA_KEYS and one copy of the validators.
// Runs in node, edge and the browser: no runtime imports, types only.
import type {
  Breadcrumb,
  ErrorEvent,
  NodeOptions,
} from '@sentry/nextjs'

// @sentry/nextjs does not re-export TransactionEvent (only @sentry/core does),
// so derive it from the beforeSendTransaction option it does export.
type TransactionEvent = Parameters<NonNullable<NodeOptions['beforeSendTransaction']>>[0]
type AnyEvent = ErrorEvent | TransactionEvent
// Same for SpanJSON (the type beforeSendSpan receives and must return).
type SpanJson = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0]

/** The only request headers that may leave the app (compared lower-cased). */
export const HEADER_ALLOW_LIST = ['host', 'user-agent', 'content-type', 'content-length', 'accept']

/** The alarm's allowed facts — the ONE definition (PR-A1 imports these). */
export const ALARM_TAG_KEYS = ['alarm', 'alarm_kind', 'business_id']
export const ALARM_EXTRA_KEYS = [
  'rec_session_id', 'take_id', 'store_id', 'seconds_recorded', 'pieces_stored',
  'bytes_stored', 'newest_piece_at', 'age_minutes', 'reason', 'app_build',
  'os_version', 'count', 'business_count', 'take_ids',
]

/** The part of a URL before the first `?` or `#`. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

// ---- moved unchanged from src/instrumentation.ts ----

export const PII_KEYS = new Set([
  'transcript', 'transcription', 'notes', 'note',
  'name', 'full_name', 'furigana', 'phone', 'email',
  'audio', 'audioblob', 'recording',
  'password', 'token', 'apikey', 'authorization',
])

export function scrubPii<T extends AnyEvent>(event: T): T | null {
  if (event.request) {
    delete event.request.cookies
    if (event.request.headers) {
      delete event.request.headers['cookie']
      delete event.request.headers['authorization']
      delete event.request.headers['x-api-key']
    }
    if (event.request.data && typeof event.request.data === 'object') {
      event.request.data = redact(event.request.data) as Record<string, unknown>
    }
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>
  if (event.contexts) event.contexts = redact(event.contexts) as typeof event.contexts
  return event
}

// FIX-4: cycle-safe (a back-reference to an ancestor becomes '[cycle]' instead
// of overflowing the stack and dropping the whole event); otherwise unchanged.
export function redact(value: unknown, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) return '[cycle]'
    ancestors.add(value)
    let out: unknown
    if (Array.isArray(value)) {
      out = value.map((v) => redact(v, ancestors))
    } else {
      const rec: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        rec[k] = PII_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, ancestors)
      }
      out = rec
    }
    ancestors.delete(value)
    return out
  }
  return value
}

// ---- span / trace attributes ----

const SPAN_KEYS_DELETED = ['url.query', 'http.query', 'url.fragment', 'http.fragment']
const SPAN_KEYS_URL = ['url', 'http.url', 'url.full', 'http.target']
/** Client / peer IP attributes (copies of x-forwarded-for or the socket peer). */
export const SPAN_KEYS_PEER_IP = [
  'http.client_ip', 'net.peer.ip', 'net.sock.peer.addr', 'client.address',
  'client.socket.address', 'network.peer.address', 'user.ip_address',
]

/** Removes header, peer-IP and query/fragment attributes; strips the query off URL attributes. Mutates and returns `data`. */
export function scrubSpanData<T extends Record<string, unknown>>(data: T): T {
  const rec = data as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (key.startsWith('http.request.header.') || key.startsWith('http.response.header.')) {
      delete rec[key]
    }
    // Bodies never leave (http.request.body, http.response.body.size, ...).
    if (key.startsWith('http.request.body') || key.startsWith('http.response.body')) {
      delete rec[key]
    }
  }
  for (const key of SPAN_KEYS_DELETED) delete rec[key]
  for (const key of SPAN_KEYS_PEER_IP) delete rec[key]
  for (const key of SPAN_KEYS_URL) {
    const v = rec[key]
    if (typeof v === 'string') rec[key] = stripQuery(v)
  }
  // The deep rule: any URL- or path-shaped string under ANY key, at any depth,
  // inside arrays too (lcp.url, asset.urls[], a `GET /photos?...` transaction).
  stripQueriesDeep(rec)
  return data
}

/**
 * The ONE URL-shape rule: a `/` appears before the first `?` or `#` (a path,
 * a protocol-relative or absolute URL, a method-prefixed path). `what?` does not.
 */
function hasSlashBeforeQuery(v: string): boolean {
  const cut = v.search(/[?#]/)
  return cut !== -1 && v.slice(0, cut).includes('/')
}

// ---- the ONE deep query rule ----

const DEPTH_CAP = 20

function walkStrip(node: unknown, depth: number, seen: WeakSet<object>, skip: readonly string[]): unknown {
  if (typeof node === 'string') return hasSlashBeforeQuery(node) ? stripQuery(node) : node
  if (!node || typeof node !== 'object') return node
  if (seen.has(node)) return node
  if (depth > DEPTH_CAP) return '[depth]'
  seen.add(node)
  const rec = node as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (skip.includes(key)) continue
    const v = rec[key]
    const next = walkStrip(v, depth + 1, seen, [])
    if (next !== v) rec[key] = next
  }
  return node
}

/**
 * The ONE deep query rule: walks objects and arrays (cycle-safe, depth cap 20 —
 * a deeper subtree becomes '[depth]') and strips the query off every string
 * that is URL- or path-shaped (hasSlashBeforeQuery). Mutates in place; the keys
 * in `skip` are left untouched at the top level only.
 */
export function stripQueriesDeep<T>(root: T, skip: readonly string[] = [], seen = new WeakSet<object>()): T {
  return walkStrip(root, 0, seen, skip) as T
}

/** Strips the query off a span's (or trace context's) name: browser resource spans are named by their URL. */
function stripSpanNames(span: object | undefined): void {
  if (!span) return
  const rec = span as Record<string, unknown>
  for (const key of ['description', 'name']) {
    const v = rec[key]
    if (typeof v === 'string') rec[key] = stripQuery(v)
  }
}

// ---- breadcrumbs ----

/**
 * The ONE breadcrumb rule (allow-list): only `navigation` is kept, REBUILT as
 * { type, category, level, timestamp, data: { from, to } } with from/to
 * query-stripped (each only if a string); `message` and every other key are dropped.
 */
export function keepBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category !== 'navigation') return null
  const out: Breadcrumb = { category: 'navigation' }
  if (breadcrumb.type !== undefined) out.type = breadcrumb.type
  if (breadcrumb.level !== undefined) out.level = breadcrumb.level
  if (breadcrumb.timestamp !== undefined) out.timestamp = breadcrumb.timestamp
  const src = breadcrumb.data
  if (src) {
    const data: Record<string, string> = {}
    if (typeof src.from === 'string') data.from = stripQuery(src.from)
    if (typeof src.to === 'string') data.to = stripQuery(src.to)
    out.data = data
  }
  return out
}

/** beforeBreadcrumb. Fails closed: any throw drops the breadcrumb. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  try {
    return keepBreadcrumb(breadcrumb)
  } catch {
    return null
  }
}

// ---- events ----

function scrubOrdinary<T extends AnyEvent>(input: T): T | null {
  // Body, query string, cookies and env are removed BEFORE any traversal, so a
  // huge or cyclic body is never walked.
  if (input.request) {
    delete input.request.data
    delete input.request.query_string
    delete input.request.cookies
    delete input.request.env
  }
  const event = scrubPii(input)
  if (!event) return null

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(keepBreadcrumb)
      .filter((b): b is Breadcrumb => b !== null)
  }

  if (event.request) {
    const req = event.request
    if (typeof req.url === 'string') req.url = stripQuery(req.url)
    else if (req.url != null) req.url = stripQuery(String(req.url))
    if (req.headers) {
      const kept: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (HEADER_ALLOW_LIST.includes(k.toLowerCase())) kept[k] = v
      }
      req.headers = kept
    }
  }

  const nextjs = event.contexts?.nextjs
  if (nextjs && typeof nextjs.request_path === 'string') {
    nextjs.request_path = stripQuery(nextjs.request_path)
  }

  if (typeof event.transaction === 'string') event.transaction = stripQuery(event.transaction)

  // Stack-frame URLs lose their query; nothing else in the exception is touched.
  for (const value of event.exception?.values ?? []) {
    for (const frame of value.stacktrace?.frames ?? []) {
      if (typeof frame.abs_path === 'string') frame.abs_path = stripQuery(frame.abs_path)
      if (typeof frame.filename === 'string') frame.filename = stripQuery(frame.filename)
    }
  }

  const traceData = event.contexts?.trace?.data
  if (traceData) scrubSpanData(traceData)
  stripSpanNames(event.contexts?.trace)

  // The deep rule over the WHOLE event, except the free text that is out of
  // PR-A0's scope (R-S97-3, queue item 102): message, logentry, extra and each
  // exception value stay byte-for-byte untouched.
  const seen = new WeakSet<object>()
  stripQueriesDeep(event, ['message', 'logentry', 'extra', 'exception'], seen)
  const exception = event.exception
  if (exception) {
    stripQueriesDeep(exception, ['values'], seen)
    for (const value of exception.values ?? []) stripQueriesDeep(value, ['value'], seen)
  }

  return event
}

/**
 * The alarm extra validators — ONE copy, called by buildAlarmEvent here and by
 * buildAlarmItem at the exit (sentry-exit.ts). take_ids: an array of at most 10
 * strings each at most 64 characters; any other key: a finite number, a boolean
 * or a string of at most 200 characters. Anything else → undefined (dropped).
 */
export function alarmExtraValue(key: string, v: unknown): unknown {
  if (key === 'take_ids') {
    return Array.isArray(v) && v.length <= 10 && v.every((id) => typeof id === 'string' && id.length <= 64)
      ? [...v]
      : undefined
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  if (typeof v === 'string' && v.length <= 200) return v
  return undefined
}

function buildAlarmEvent(event: ErrorEvent): ErrorEvent {
  const out: ErrorEvent = { type: undefined }
  if (event.event_id !== undefined) out.event_id = event.event_id
  if (event.timestamp !== undefined) out.timestamp = event.timestamp
  if (event.platform !== undefined) out.platform = event.platform
  if (event.level !== undefined) out.level = event.level
  if (typeof event.message === 'string') out.message = event.message.slice(0, 120)
  if (event.environment !== undefined) out.environment = event.environment
  if (event.release !== undefined) out.release = event.release
  if (event.dist !== undefined) out.dist = event.dist
  if (event.sdk) out.sdk = { name: event.sdk.name, version: event.sdk.version }

  if (Array.isArray(event.fingerprint)) {
    out.fingerprint = event.fingerprint
      .filter((f): f is string => typeof f === 'string')
      .slice(0, 5)
      .map((f) => f.slice(0, 100))
  }

  if (event.tags) {
    const tags: NonNullable<ErrorEvent['tags']> = {}
    for (const key of ALARM_TAG_KEYS) {
      const v = event.tags[key]
      if (typeof v === 'string') tags[key] = v.slice(0, 100)
      else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') tags[key] = v
    }
    out.tags = tags
  }

  if (event.extra) {
    const extra: Record<string, unknown> = {}
    for (const key of ALARM_EXTRA_KEYS) {
      const kept = alarmExtraValue(key, event.extra[key])
      if (kept !== undefined) extra[key] = kept
    }
    out.extra = extra
  }

  // The rebuilt event also passes the ONE deep query rule: no message,
  // fingerprint, tag or extra string may carry a URL query.
  stripQueriesDeep(out)
  return out
}

/** beforeSend: alarm events are rebuilt from the allow-list; every other event is scrubbed. Fails closed: any throw drops the event. */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  try {
    if (event.tags?.alarm === '1') return buildAlarmEvent(event)
    return scrubOrdinary(event)
  } catch {
    return null
  }
}

/** beforeSendTransaction: transactions never pass beforeSend, so they get the same scrub plus every span's data and name. Fails closed: any throw drops the event. */
export function scrubTransaction(event: TransactionEvent): TransactionEvent | null {
  try {
    const out = scrubOrdinary(event)
    if (!out) return null
    const traceData = out.contexts?.trace?.data
    if (traceData) scrubSpanData(traceData)
    if (out.spans) {
      for (const span of out.spans) {
        if (span.data) scrubSpanData(span.data)
        stripSpanNames(span)
      }
    }
    return out
  } catch {
    return null
  }
}

// ---- spans (beforeSendSpan) ----

/** Reads one property; a throwing getter reads as undefined. */
function safeRead(obj: object, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/** The fail-closed span: ids and timestamps kept, description = op without its query (or ''), data = {}. Never throws. */
function blankSpan(span: SpanJson): SpanJson {
  // Even the fallback never copies text raw: op loses its query before it is
  // used as op and as description.
  const rawOp = safeRead(span, 'op')
  const op = typeof rawOp === 'string' ? stripQuery(rawOp) : rawOp
  const out: SpanJson = {
    span_id: '',
    trace_id: '',
    start_timestamp: 0,
    data: {},
    description: typeof op === 'string' ? op : '',
  }
  if (typeof op === 'string') out.op = op
  for (const key of ['span_id', 'trace_id', 'parent_span_id', 'segment_id'] as const) {
    const v = safeRead(span, key)
    if (typeof v === 'string') out[key] = v
  }
  for (const key of ['start_timestamp', 'timestamp'] as const) {
    const v = safeRead(span, key)
    if (typeof v === 'number') out[key] = v
  }
  const seg = safeRead(span, 'is_segment')
  if (typeof seg === 'boolean') out.is_segment = seg
  return out
}

/**
 * beforeSendSpan: standalone spans (envelope item type `span`, e.g. INP) pass no
 * other hook. The SDK runs it on those, and on a transaction's root and child
 * spans before beforeSendTransaction. Returning null is disallowed in 10.51.0:
 * the SDK then sends the RAW span (core envelope.js:130-133, client.js:1054-1084).
 * So it fails closed by returning a blanked copy, never the raw span, never a throw.
 */
export function scrubSpan(span: SpanJson): SpanJson {
  try {
    if (span.data) scrubSpanData(span.data)
    stripSpanNames(span)
    return span
  } catch {
    return blankSpan(span)
  }
}

/** The one object every Sentry.init spreads. */
export const sentryScrubOptions = {
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubTransaction,
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSendSpan: scrubSpan,
}
