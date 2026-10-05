// One allow-list scrub for every event Karute sends to Sentry (PR-A0).
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

/** The only request headers that may leave the app (compared lower-cased). */
export const HEADER_ALLOW_LIST = ['host', 'user-agent', 'content-type', 'content-length', 'accept']

/** The alarm's allowed facts — the ONE definition (PR-A1 imports these). */
export const ALARM_TAG_KEYS = ['alarm', 'alarm_kind', 'business_id']
export const ALARM_EXTRA_KEYS = [
  'rec_session_id', 'take_id', 'store_id', 'seconds_recorded', 'pieces_stored',
  'bytes_stored', 'newest_piece_at', 'age_minutes', 'reason', 'app_build',
  'os_version', 'count', 'business_count', 'take_ids',
]

const DROPPED_BREADCRUMB_CATEGORIES = new Set(['console', 'http', 'fetch', 'xhr'])

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

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v)
    }
    return out
  }
  return value
}

// ---- span / trace attributes ----

const SPAN_KEYS_DELETED = ['url.query', 'http.query', 'url.fragment', 'http.fragment']
const SPAN_KEYS_URL = ['url', 'http.url', 'url.full', 'http.target']

/** Removes header attributes and query/fragment attributes; strips the query off URL attributes. Mutates and returns `data`. */
export function scrubSpanData<T extends Record<string, unknown>>(data: T): T {
  const rec = data as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (key.startsWith('http.request.header.') || key.startsWith('http.response.header.')) {
      delete rec[key]
    }
  }
  for (const key of SPAN_KEYS_DELETED) delete rec[key]
  for (const key of SPAN_KEYS_URL) {
    const v = rec[key]
    if (typeof v === 'string') rec[key] = stripQuery(v)
  }
  return data
}

// ---- breadcrumbs ----

function stripNavigation(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== 'navigation' || !breadcrumb.data) return breadcrumb
  const data = { ...breadcrumb.data }
  if (typeof data.from === 'string') data.from = stripQuery(data.from)
  if (typeof data.to === 'string') data.to = stripQuery(data.to)
  return { ...breadcrumb, data }
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category && DROPPED_BREADCRUMB_CATEGORIES.has(breadcrumb.category)) return null
  return stripNavigation(breadcrumb)
}

// ---- events ----

function scrubOrdinary<T extends AnyEvent>(input: T): T | null {
  const event = scrubPii(input)
  if (!event) return null

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .filter((b) => !(b.category && DROPPED_BREADCRUMB_CATEGORIES.has(b.category)))
      .map(stripNavigation)
  }

  if (event.request) {
    const req = event.request
    if (typeof req.url === 'string') req.url = stripQuery(req.url)
    if (req.headers) {
      const kept: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (HEADER_ALLOW_LIST.includes(k.toLowerCase())) kept[k] = v
      }
      req.headers = kept
    }
    delete req.data
    delete req.query_string
    delete req.cookies
    delete req.env
  }

  const nextjs = event.contexts?.nextjs
  if (nextjs && typeof nextjs.request_path === 'string') {
    nextjs.request_path = stripQuery(nextjs.request_path)
  }

  if (typeof event.transaction === 'string') event.transaction = stripQuery(event.transaction)

  const traceData = event.contexts?.trace?.data
  if (traceData) scrubSpanData(traceData)

  return event
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
      const v = event.extra[key]
      if (key === 'take_ids') {
        if (
          Array.isArray(v) &&
          v.length <= 10 &&
          v.every((id) => typeof id === 'string' && id.length <= 64)
        ) {
          extra[key] = [...v]
        }
        continue
      }
      if (typeof v === 'number' && Number.isFinite(v)) extra[key] = v
      else if (typeof v === 'boolean') extra[key] = v
      else if (typeof v === 'string' && v.length <= 200) extra[key] = v
    }
    out.extra = extra
  }

  return out
}

/** beforeSend: alarm events are rebuilt from the allow-list; every other event is scrubbed. */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.tags?.alarm === '1') return buildAlarmEvent(event)
  return scrubOrdinary(event)
}

/** beforeSendTransaction: transactions never pass beforeSend, so they get the same scrub plus every span's data. */
export function scrubTransaction(event: TransactionEvent): TransactionEvent | null {
  const out = scrubOrdinary(event)
  if (!out) return null
  const traceData = out.contexts?.trace?.data
  if (traceData) scrubSpanData(traceData)
  if (out.spans) {
    for (const span of out.spans) {
      if (span.data) scrubSpanData(span.data)
    }
  }
  return out
}

/** The one object every Sentry.init spreads. */
export const sentryScrubOptions = {
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubTransaction,
  beforeBreadcrumb: scrubBreadcrumb,
}
