// The exit: every envelope found is rebuilt here from allow-lists; anything not named does not leave. The hooks in sentry-scrub.ts are early trimming only.
// Item 102 (PR-A0b). Runs in the browser and on node (edge in PR 2): no node,
// next, DOM or global-process access — only the sibling modules below and
// '@sentry/core'.
//
// WHAT STILL CAN LEAVE (the residual list, item 102 fix batches 1-3,
// R-S112-5/6/7, R-S113-4/5/6; every other string is a closed list, a fixed
// shape, or dropped):
// - Japanese writing, raw or percent-encoded to any depth, can leave in no
//   position; nor can an email address (with @, a full-width ＠ or %40, also
//   encoded, or with a domain in Japanese writing), a phone or card number of
//   10-16 digits (split by spaces, tabs, line breaks, dots, dashes, brackets,
//   `+ _ , /`, ・ or 〜, gaps of up to 3 such characters, +81 or 0), an
//   unbroken run of 10+ digits, a `Bearer` value, a credential-looking
//   `Basic` / `Token` value, anything after `Authorization:` or
//   `authorization=`, a value after a credential label (`password=`,
//   `token:`, `api_key=`, `secret:` …; one rule at every position, Greptile
//   #1159 G1), a JWT, or a Base64-looking run (24+ characters mixing
//   upper case, lower case and digits). In a web address, file path or code
//   field such a value drops the whole field; in the error text it is
//   replaced by a marker.
// - A name in English letters WITH a space (「Tanaka Hanako」) can leave in the
//   places that keep spaces: function names in a stack trace, the browser's
//   user-agent and accept text and its copy in span data, the system name
//   (「Mac OS X」), the alarm's system version, a check-in's cron value — and
//   in the error text (exception type and message, the alarm's message).
// - A name in English letters WITHOUT a space (「TanakaHanako」) can also leave
//   inside a web address or file path (route, request address, script file,
//   storage path) and in short code fields (release, module, op, origin,
//   status and similar), because it cannot be told from an identifier.
// - In the error text only: a romanised address or a date of birth
//   (「150-0001 Jingumae 1-2-3」, 「dob 1990-04-12」), an email written
//   without an @ sign or with spaces around it (「tanaka(at)gmail.com」), an
//   address with no dot-suffix (「tanaka@example」), and a secret after a
//   label the masks do not know (「Cookie: sid=…」, 「SECRET_KEY abc」).
//   Over-masking the other way: a date-plus-id route inside the error text
//   (「/api/2026/10/08/12345」) becomes `<phone>`, and the label rule turns
//   「Invalid Refresh Token: Refresh Token Not Found」 into 「Invalid Refresh
//   <label>=<redacted> Token Not Found」 (kept on purpose: a label followed
//   by `:` or `=` is masked; at a user-agent, accept, function-name or other
//   spaced or code field the same text now drops the field, as does any
//   path or code value holding `key=…` / `token:…`, e.g. 「monkey:banana」).
// - Wherever digits are judged: ten single digits spaced (「0 9 0 1 2 3 4 5 6
//   7」), letters for digits (「O9O-1234-5678」), JSON `\u002d` escapes for
//   the dashes, a number with a colon anywhere in it (「090:1234:5678」,
//   「090 : 1234 : 5678」, 「090-1234:5678」; R-S113-10: an address and port
//   must survive), and a dotted number with the version shape (no leading 0,
//   groups of at most 5 digits, at most one of 4+: 「90.123.456.789」).
// - Everywhere: a `Basic` / `Token` value under 16 characters (「Basic abc」);
//   only a credential-looking value is masked, so ordinary words after them
//   keep their meaning.
// - Plain `data:` / `blob:` text outside web address and file path fields
//   (it carries no content there; in those fields it drops).
// - At id positions (business_id, store_id, sid, check_in_id): a 16-32
//   character run of hex letters and digits holding a letter passes whole
//   (「deadbeef09012345678」) — the generic id shape.
// - In a web address, file path or code field: a number of up to 9 digits; a
//   phone split across path segments (「/090/1234/5678」: the rule runs per
//   segment, so a date-plus-id route survives as the error's location); a
//   Base64 or key run cut by `/` or `.` into pieces under 24 characters
//   (R-S112-7, per segment); a secret made only of hex letters and digits
//   (it counts as hex), or of lower case and digits only, or upper case and
//   digits only; a 10+-digit run inside a 16, 20, 32, 40 or 64-character hex
//   id holding a letter; and `javascript:` addresses (no content).
// - Lost, never leaked: a 16-digit chunk hash drops its frame field; a
//   user-agent whose version has a 4-digit build AND a 4-digit patch
//   (「130.0.6723.1000」) drops at spaced positions and masks to `<phone>` in
//   the error text.
// - Ruled shapes: a card number in a 16-hex span id field, a 32-digit
//   event_id in the constant alarm, a number of up to 20 digits in the trace
//   header's org_id (digits only, no guard: R-S113-4 (c)).
// - The sampling numbers in the envelope header (sample_rate, sample_rand)
//   are plain decimals and are not content-checked.
// - The SDK's own item-type names reach the drop log line and the drop count
//   when they are lower-case words (written by the SDK, never by a customer).
// Closure for the error text: item 115 (fixed error codes).
import { envelopeItemTypeToDataCategory } from '@sentry/core'
import type { BaseTransportOptions, DataCategory, Envelope, EnvelopeItemType, Transport } from '@sentry/core'
import {
  ALARM_EXTRA_KEYS,
  ALARM_TAG_KEYS,
  alarmExtraValue,
  keepBreadcrumb,
  stripQuery,
} from './sentry-scrub'
import { guardHits, masked, pctDecode } from '../text/mask-sensitive'

export { masked }

type Obj = Record<string, unknown>

// ---- § 2.0 shapes -----------------------------------------------------------
// Every validator returns the value when it has the shape, else undefined
// (the field is then omitted). Strings never leave unshaped.

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_ID = /^[0-9a-f]{16,32}$/
const NUM_STRING = /^[0-9](\.[0-9]{1,25})?(e-[0-9]{1,3})?$/
const ISO = /^[0-9T:.Z+-]{1,40}$/
const PCT_NON_ASCII = /%[89A-Fa-f][0-9A-Fa-f]/
/** THE EMAIL RULE: unanchored search; neither side may contain `/`. */
export const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/

const reCache = new Map<string, RegExp>()
function bounded(cls: string, n: number): RegExp {
  const key = `${cls}|${n}`
  let re = reCache.get(key)
  if (!re) {
    re = new RegExp(`^[${cls}]{1,${n}}$`)
    reCache.set(key, re)
  }
  return re
}
const TOKEN_CLS = 'A-Za-z0-9_.:@/+-'
const PATH_CLS = 'A-Za-z0-9_.~:@/%+,=()\\[\\]-'
const SPACED_CLS = '\\x20-\\x7E'

/** True when the string carries an email shape after `%40` → `@` (on a copy). */
export function looksLikeEmail(s: string): boolean {
  return EMAIL_SHAPE.test(s.split('%40').join('@'))
}

function narrowOk(s: string, narrow?: RegExp): boolean {
  return narrow === undefined || narrow.test(s)
}

export function enumOf<T extends string>(list: readonly T[]) {
  return (v: unknown): T | undefined =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined
}

export function id(v: unknown, uuidOnly = false): string | undefined {
  if (typeof v !== 'string') return undefined
  if (UUID_ID.test(v)) return v
  // a hex id holds at least one of a-f: an all-digit run is a card or phone
  // number, never an id (R-S112-5 F3)
  return !uuidOnly && HEX_ID.test(v) && /[a-f]/.test(v) ? v : undefined
}

/** Fixed-length hex ids (R-S112-8 (b), R-S113-6): span_id is EXACTLY 16
 *  lowercase hex, as are parent_span_id and segment_id (R-S113-1: span ids
 *  too — core 10.51.0 sentrySpan.js:204 sets segment_id to the root span's
 *  spanId), trace_id and event_id EXACTLY 32 — the fixed length is the shape,
 *  nothing else passes (no UUID, no other length), and NO a-f letter is
 *  required here. The F3 letter rule stays on id()'s generic 16-32 branch. */
const FIXED_HEX: Record<16 | 32, RegExp> = { 16: /^[0-9a-f]{16}$/, 32: /^[0-9a-f]{32}$/ }
export function fixedId(v: unknown, n: 16 | 32): string | undefined {
  return typeof v === 'string' && FIXED_HEX[n].test(v) ? v : undefined
}

export function numString(v: unknown): string | undefined {
  return typeof v === 'string' && NUM_STRING.test(v) ? v : undefined
}

export function iso(v: unknown): string | undefined {
  return typeof v === 'string' && ISO.test(v) && !guardHits(v) ? v : undefined
}

export function token(v: unknown, n: number, narrow?: RegExp): string | undefined {
  if (typeof v !== 'string' || !bounded(TOKEN_CLS, n).test(v)) return undefined
  if (!narrowOk(v, narrow) || looksLikeEmail(v)) return undefined
  return guardHits(v) ? undefined : v
}

/** `data:` and `blob:` values never leave where a path or URL is admitted. */
const INLINE_URL = /^\s*(data|blob):/i

/** path(n): stripQuery, then the inline-URL rule, the class, encoded
 *  non-ASCII, the narrower pattern, the email rule and the content guard (per
 *  `/` segment) on BOTH the value and its stable percent-decoded copy
 *  (R-S113-6 F-S113-3: `%64ata:` is `data:`); the ORIGINAL is what leaves. */
export function path(v: unknown, n: number, narrow?: RegExp): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = stripQuery(v)
  const d = pctDecode(s)
  if (d === null) return undefined
  for (const c of s === d ? [s] : [s, d]) {
    if (INLINE_URL.test(c) || !bounded(PATH_CLS, n).test(c) || PCT_NON_ASCII.test(c)) return undefined
    if (!narrowOk(c, narrow) || looksLikeEmail(c) || guardHits(c, true)) return undefined
  }
  return s
}

/** spaced(n): printable ASCII, the email rule and the content guard on BOTH the
 *  value and its stable percent-decoded copy; the ORIGINAL is what leaves. */
export function spaced(v: unknown, n: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const d = pctDecode(v)
  if (d === null) return undefined
  for (const c of v === d ? [v] : [v, d]) {
    if (!bounded(SPACED_CLS, n).test(c) || PCT_NON_ASCII.test(c) || looksLikeEmail(c) || guardHits(c)) return undefined
  }
  return v
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

export function ts(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

export const ENVIRONMENTS = ['production', 'preview', 'development'] as const
export const environment = enumOf(ENVIRONMENTS)

/** THE TRANSACTION NAME RULE (§ 2.0). */
const METHOD_PREFIX = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /
const MIDDLEWARE_NAME = /^middleware (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/
export function transactionName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  if (MIDDLEWARE_NAME.test(v)) return v
  const m = METHOD_PREFIX.exec(v)
  if (m) {
    const rest = path(v.slice(m[0].length), 200)
    return rest === undefined ? undefined : m[0] + rest
  }
  return path(v, 200)
}

/** FRAME FILENAMES (§ 2.0): the three literals, else path(300). */
const FRAME_LITERALS = ['<anonymous>', '[native code]', 'native']
export function frameFile(v: unknown): string | undefined {
  if (typeof v === 'string' && FRAME_LITERALS.includes(v)) return v
  return path(v, 300)
}

// ---- helpers ----------------------------------------------------------------

export function asObj(v: unknown): Obj | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : undefined
}

/** A key that can never re-prototype or shadow on the rebuilt object (R-S112-5 F5). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export function safeKey(k: string): boolean {
  return !UNSAFE_KEYS.has(k)
}

/** Set `key` on `out` only when the value passed its shape and the key is safe. */
function put(out: Obj, key: string, v: unknown): void {
  if (v !== undefined && safeKey(key)) out[key] = v
}

/** An object with at least one key, else undefined (empty sub-objects are omitted). */
function nonEmpty(o: Obj): Obj | undefined {
  return Object.keys(o).length > 0 ? o : undefined
}

function first<T>(v: unknown, n: number): unknown[] {
  return Array.isArray(v) ? (v as T[]).slice(0, n) : []
}

// ---- § 2.1 envelope header ----------------------------------------------------

const SAMPLED = enumOf(['true', 'false'])

function buildSdkNameVersion(v: unknown): Obj | undefined {
  const sdk = asObj(v)
  if (!sdk) return undefined
  const out: Obj = {}
  put(out, 'name', token(sdk.name, 60))
  put(out, 'version', token(sdk.version, 20))
  return nonEmpty(out)
}

/** trace.org_id (R-S113-4 (c)): its own validator — digits only, at most 20,
 *  NO content guard: the shape is the proof (the SDK writes it from the DSN),
 *  and a 16-digit Sentry org id must not be dropped by the digit rule. */
const ORG_ID = /^[0-9]{1,20}$/
function orgId(v: unknown): string | undefined {
  return typeof v === 'string' && ORG_ID.test(v) ? v : undefined
}

export function buildEnvelopeHeader(header: unknown): Obj {
  const h = asObj(header) ?? {}
  const out: Obj = {}
  put(out, 'event_id', fixedId(h.event_id, 32))
  put(out, 'sent_at', iso(h.sent_at))
  put(out, 'sdk', buildSdkNameVersion(h.sdk))
  const t = asObj(h.trace)
  if (t) {
    const trace: Obj = {}
    put(trace, 'trace_id', fixedId(t.trace_id, 32))
    const pk = id(t.public_key)
    put(trace, 'public_key', pk !== undefined && /^[0-9a-f]{32}$/.test(pk) ? pk : undefined)
    put(trace, 'sample_rate', numString(t.sample_rate))
    put(trace, 'sampled', SAMPLED(t.sampled))
    put(trace, 'sample_rand', numString(t.sample_rand))
    put(trace, 'release', token(t.release, 100))
    put(trace, 'environment', environment(t.environment))
    put(trace, 'org_id', orgId(t.org_id))
    put(out, 'trace', nonEmpty(trace))
  }
  return out
}

// ---- § 2.2 item types ------------------------------------------------------------

export const ADMITTED_ITEM_TYPES = [
  'event', 'transaction', 'span', 'session', 'sessions', 'client_report', 'check_in',
] as const
export type AdmittedItemType = (typeof ADMITTED_ITEM_TYPES)[number]
export const admittedItemType = enumOf(ADMITTED_ITEM_TYPES)

/** The rebuilt item header: `{ type }` only. */
export function buildItemHeader(type: AdmittedItemType): { type: AdmittedItemType } {
  return { type }
}

// ---- § 2.6 / 2.7 sessions ----------------------------------------------------------

const SESSION_STATUS = enumOf(['ok', 'exited', 'crashed', 'abnormal'])

function buildSessionAttrs(v: unknown): Obj | undefined {
  const a = asObj(v)
  if (!a) return undefined
  const out: Obj = {}
  put(out, 'release', token(a.release, 100))
  put(out, 'environment', environment(a.environment))
  return nonEmpty(out)
}

export function buildSession(payload: unknown): Obj {
  const p = asObj(payload) ?? {}
  const out: Obj = {}
  put(out, 'sid', id(p.sid))
  put(out, 'init', bool(p.init))
  put(out, 'started', iso(p.started))
  put(out, 'timestamp', iso(p.timestamp))
  put(out, 'status', SESSION_STATUS(p.status))
  put(out, 'errors', num(p.errors))
  put(out, 'duration', num(p.duration))
  put(out, 'abnormal_mechanism', token(p.abnormal_mechanism, 40))
  put(out, 'attrs', buildSessionAttrs(p.attrs))
  return out
}

export function buildSessionAggregates(payload: unknown): Obj {
  const p = asObj(payload) ?? {}
  const out: Obj = {}
  put(out, 'attrs', buildSessionAttrs(p.attrs))
  const aggregates: Obj[] = []
  for (const raw of first(p.aggregates, 100)) {
    const a = asObj(raw)
    if (!a) continue
    const agg: Obj = {}
    put(agg, 'started', iso(a.started))
    put(agg, 'exited', num(a.exited))
    put(agg, 'errored', num(a.errored))
    put(agg, 'crashed', num(a.crashed))
    put(agg, 'abnormal', num(a.abnormal))
    if (nonEmpty(agg)) aggregates.push(agg)
  }
  if (aggregates.length > 0) out.aggregates = aggregates
  return out
}

// ---- § 2.8 client report ----------------------------------------------------------

const SNAKE40 = /^[a-z_]{1,40}$/

export function buildClientReport(payload: unknown): Obj {
  const p = asObj(payload) ?? {}
  const out: Obj = {}
  put(out, 'timestamp', num(p.timestamp))
  const discarded: Obj[] = []
  for (const raw of first(p.discarded_events, 50)) {
    const d = asObj(raw)
    if (!d) continue
    const e: Obj = {}
    put(e, 'reason', token(d.reason, 40, SNAKE40))
    put(e, 'category', token(d.category, 40, SNAKE40))
    put(e, 'quantity', num(d.quantity))
    if (nonEmpty(e)) discarded.push(e)
  }
  if (discarded.length > 0) out.discarded_events = discarded
  return out
}

// ---- § 2.9 check-in (PROVISIONAL: PR-A1 owns and confirms this shape) ---------------

const CHECKIN_STATUS = enumOf(['in_progress', 'ok', 'error'])
const SCHEDULE_TYPE = enumOf(['crontab', 'interval'])

export function buildCheckIn(payload: unknown): Obj {
  const p = asObj(payload) ?? {}
  const out: Obj = {}
  put(out, 'check_in_id', id(p.check_in_id))
  put(out, 'monitor_slug', token(p.monitor_slug, 100, /^[a-z0-9_-]{1,100}$/))
  put(out, 'status', CHECKIN_STATUS(p.status))
  put(out, 'duration', num(p.duration))
  put(out, 'release', token(p.release, 100))
  put(out, 'environment', environment(p.environment))
  const mc = asObj(p.monitor_config)
  if (mc) {
    const cfg: Obj = {}
    const sc = asObj(mc.schedule)
    if (sc) {
      const schedule: Obj = {}
      put(schedule, 'type', SCHEDULE_TYPE(sc.type))
      // A crontab value has spaces (spaced, assigned by the fold); an interval value is a number.
      put(schedule, 'value', num(sc.value) ?? spaced(sc.value, 60))
      put(schedule, 'unit', token(sc.unit, 20))
      put(cfg, 'schedule', nonEmpty(schedule))
    }
    put(cfg, 'checkin_margin', num(mc.checkin_margin))
    put(cfg, 'max_runtime', num(mc.max_runtime))
    put(cfg, 'failure_issue_threshold', num(mc.failure_issue_threshold))
    put(cfg, 'recovery_threshold', num(mc.recovery_threshold))
    put(cfg, 'timezone', token(mc.timezone, 60))
    put(out, 'monitor_config', nonEmpty(cfg))
  }
  const trace = asObj(asObj(p.contexts)?.trace)
  if (trace) {
    const t: Obj = {}
    put(t, 'trace_id', fixedId(trace.trace_id, 32))
    put(t, 'span_id', fixedId(trace.span_id, 16))
    const tt = nonEmpty(t)
    if (tt) out.contexts = { trace: tt }
  }
  return out
}

// ---- § 2.5 spans ----------------------------------------------------------------

const METHOD = enumOf(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const SOURCE = enumOf(['route', 'url', 'custom', 'component', 'task', 'view', 'unknown'])
const LEVEL = enumOf(['fatal', 'error', 'warning', 'log', 'info', 'debug'])
/** MEASUREMENT NAMES (R-S112-6 S5, R-S112-7): the names the installed SDK
 *  emits, plus the mobile names the ruling lists; every other key is dropped
 *  and counted. Sources (@sentry-internal/browser-utils 10.51.0,
 *  build/cjs/metrics/): browserMetrics.js:204 cls · :217 lcp · :229 ttfb ·
 *  :286 fp · :289 fcp · :664 connection.rtt · :768 ttfb.requestTime ·
 *  inp.js:127 inp · cls.js:82 cls · lcp.js:104 lcp (span events become
 *  measurements keyed by the event name, @sentry/core
 *  build/cjs/tracing/measurement.js:27). fid: named by the ruling. */
export const MEASUREMENT_NAMES: readonly string[] = [
  'cls', 'lcp', 'ttfb', 'ttfb.requestTime', 'fp', 'fcp', 'inp', 'fid', 'connection.rtt',
  'app_start_cold', 'app_start_warm', 'frames_total', 'frames_slow', 'frames_frozen',
  'stall_count', 'stall_total_time', 'stall_longest_time', 'time_to_initial_display', 'time_to_full_display',
]

export function buildMeasurements(v: unknown, onKeyDrop?: () => void): Obj | undefined {
  const m = asObj(v)
  if (!m) return undefined
  const out: Obj = {}
  for (const key of Object.keys(m)) {
    if (!MEASUREMENT_NAMES.includes(key) || !safeKey(key)) {
      onKeyDrop?.()
      continue
    }
    const entry = asObj(m[key])
    const value = num(entry?.value)
    if (value === undefined) continue
    const one: Obj = { value }
    put(one, 'unit', token(entry?.unit, 20))
    put(out, key, one)
  }
  return nonEmpty(out)
}

type V = (v: unknown) => unknown
/** SPAN DATA ALLOW-LIST (§ 2.5): only these keys, each with its shape. */
const SPAN_DATA: Record<string, V> = {
  'sentry.op': (v) => token(v, 60),
  'sentry.origin': (v) => token(v, 60),
  'sentry.source': SOURCE,
  'sentry.exclusive_time': num,
  'sentry.sample_rate': num,
  'sentry.idle_span_finish_reason': (v) => token(v, 40),
  'http.method': METHOD,
  'http.request.method': METHOD,
  'http.response.status_code': num,
  'http.status_code': num,
  'http.route': (v) => path(v, 200),
  'http.response_content_length': num,
  'http.response_transfer_size': num,
  'http.decoded_response_content_length': num,
  'http.redirect_count': num,
  'http.request.prefetch': bool,
  'url.scheme': enumOf(['http', 'https']),
  'url.same_origin': bool,
  'server.address': (v) => token(v, 253, /^[A-Za-z0-9.:-]{1,253}$/),
  'resource.render_blocking_status': (v) => token(v, 20),
  'http.response_delivery_type': (v) => token(v, 20),
  'lcp.size': num,
  'lcp.loadTime': num,
  'lcp.renderTime': num,
  'lcp.url': (v) => path(v, 200),
  'performance.timeOrigin': num,
  'performance.activationStart': num,
  effectiveConnectionType: (v) => token(v, 10),
  connectionType: (v) => token(v, 20),
  deviceMemory: (v) => token(v, 10),
  hardwareConcurrency: (v) => token(v, 10),
  release: (v) => token(v, 100),
  environment,
  transaction: transactionName,
  'user_agent.original': (v) => spaced(v, 300),
  'next.route': (v) => path(v, 200),
  'next.span_type': (v) => token(v, 60),
  'next.rsc': bool,
  'next.page': (v) => path(v, 200),
}

export function buildSpanData(v: unknown): Obj | undefined {
  const d = asObj(v)
  if (!d) return undefined
  const out: Obj = {}
  for (const key of Object.keys(SPAN_DATA)) {
    if (Object.prototype.hasOwnProperty.call(d, key)) put(out, key, SPAN_DATA[key](d[key]))
  }
  return nonEmpty(out)
}

const DESCRIPTION_PATH_OPS = new Set([
  'http.client', 'http.server', 'navigation', 'pageload', 'function.nextjs', 'middleware.nextjs', 'http.route',
])

/** THE DESCRIPTION RULE (§ 2.5): a path-like description only for the listed ops, else the op. */
export function spanDescription(op: string | undefined, description: unknown): string | undefined {
  if (op === undefined) return undefined
  const listed = op.startsWith('resource.') || op.startsWith('browser.') || DESCRIPTION_PATH_OPS.has(op)
  if (!listed) return op
  if (op === 'http.client' || op === 'http.server') {
    if (typeof description !== 'string') return op
    const m = METHOD_PREFIX.exec(description)
    const rest = m ? path(description.slice(m[0].length), 300) : undefined
    return m && rest !== undefined ? m[0] + rest : op
  }
  return path(description, 300) ?? op
}

/** contexts.trace: the buildSpan subset (fix 10 of rev 1). */
function buildTraceContext(v: unknown): Obj | undefined {
  const t = asObj(v)
  if (!t) return undefined
  const out: Obj = {}
  put(out, 'trace_id', fixedId(t.trace_id, 32))
  put(out, 'span_id', fixedId(t.span_id, 16))
  put(out, 'parent_span_id', fixedId(t.parent_span_id, 16))
  put(out, 'op', token(t.op, 60))
  put(out, 'status', token(t.status, 40))
  put(out, 'origin', token(t.origin, 60))
  put(out, 'data', buildSpanData(t.data))
  return nonEmpty(out)
}

/** A standalone span item, a spans[] entry. null = span_id or trace_id failed (dropped). */
export function buildSpan(payload: unknown, onKeyDrop?: () => void): Obj | null {
  const s = asObj(payload)
  if (!s) return null
  const spanId = fixedId(s.span_id, 16)
  const traceId = fixedId(s.trace_id, 32)
  if (spanId === undefined || traceId === undefined) return null
  const out: Obj = { span_id: spanId, trace_id: traceId }
  put(out, 'parent_span_id', fixedId(s.parent_span_id, 16))
  put(out, 'segment_id', fixedId(s.segment_id, 16))
  put(out, 'is_segment', bool(s.is_segment))
  put(out, 'start_timestamp', ts(s.start_timestamp))
  put(out, 'timestamp', ts(s.timestamp))
  put(out, 'exclusive_time', num(s.exclusive_time))
  const op = token(s.op, 60)
  put(out, 'op', op)
  put(out, 'status', token(s.status, 40))
  put(out, 'origin', token(s.origin, 60))
  put(out, 'measurements', buildMeasurements(s.measurements, onKeyDrop))
  put(out, 'description', spanDescription(op, s.description))
  put(out, 'data', buildSpanData(s.data))
  return out
}

// ---- § 2.3 error event ---------------------------------------------------------------

const PLATFORM = enumOf(['javascript', 'node'])
const INFER_IP = enumOf(['never', 'auto'])

/** event_id (required), timestamp, platform, level, environment, release, dist, sdk. null = event_id failed. */
function buildIdentity(e: Obj): Obj | null {
  const eventId = fixedId(e.event_id, 32)
  if (eventId === undefined) return null
  const out: Obj = { event_id: eventId }
  put(out, 'timestamp', ts(e.timestamp))
  put(out, 'platform', PLATFORM(e.platform))
  put(out, 'level', LEVEL(e.level))
  put(out, 'environment', environment(e.environment))
  put(out, 'release', token(e.release, 100))
  put(out, 'dist', token(e.dist, 40))
  const sdkIn = asObj(e.sdk)
  if (sdkIn) {
    const sdk: Obj = buildSdkNameVersion(sdkIn) ?? {}
    const infer = INFER_IP(asObj(sdkIn.settings)?.infer_ip)
    if (infer !== undefined) sdk.settings = { infer_ip: infer }
    put(out, 'sdk', nonEmpty(sdk))
  }
  return out
}

function buildFingerprint(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const f of v) {
    const ok = token(f, 100)
    if (ok !== undefined) out.push(ok)
    if (out.length === 5) break
  }
  return out.length > 0 ? out : undefined
}

const SOURCE_NAME = /^[a-zA-Z0-9_[\]]{1,30}$/

function buildException(v: unknown): Obj | undefined {
  const values = asObj(v)?.values
  if (!Array.isArray(values)) return undefined
  const out: Obj[] = []
  for (const raw of values.slice(-10)) {
    const x = asObj(raw)
    if (!x) continue
    const one: Obj = {}
    put(one, 'type', masked(x.type, 100))
    put(one, 'value', masked(x.value, 200))
    const m = asObj(x.mechanism)
    if (m) {
      const mech: Obj = {}
      put(mech, 'type', token(m.type, 60))
      put(mech, 'handled', bool(m.handled))
      put(mech, 'synthetic', bool(m.synthetic))
      put(mech, 'source', path(m.source, 30, SOURCE_NAME))
      put(mech, 'exception_id', num(m.exception_id))
      put(mech, 'parent_id', num(m.parent_id))
      put(mech, 'is_exception_group', bool(m.is_exception_group))
      put(one, 'mechanism', nonEmpty(mech))
    }
    const frames = asObj(x.stacktrace)?.frames
    if (Array.isArray(frames)) {
      const kept: Obj[] = []
      for (const rf of frames.slice(-200)) {
        const f = asObj(rf)
        if (!f) continue
        const fr: Obj = {}
        put(fr, 'filename', frameFile(f.filename))
        put(fr, 'abs_path', frameFile(f.abs_path))
        put(fr, 'function', spaced(f.function, 200))
        put(fr, 'module', token(f.module, 200))
        put(fr, 'lineno', num(f.lineno))
        put(fr, 'colno', num(f.colno))
        put(fr, 'in_app', bool(f.in_app))
        if (nonEmpty(fr)) kept.push(fr)
      }
      // every frame dropped → no stacktrace at all (R-S112-6 empties rule, R-S113-6 NIT)
      if (kept.length > 0) one.stacktrace = { frames: kept }
    }
    out.push(one)
  }
  return out.length > 0 ? { values: out } : undefined
}

function buildDebugMeta(v: unknown): Obj | undefined {
  const images = asObj(v)?.images
  if (!Array.isArray(images)) return undefined
  const out: Obj[] = []
  for (const raw of images.slice(0, 200)) {
    const im = asObj(raw)
    if (!im) continue
    const one: Obj = {}
    put(one, 'type', enumOf(['sourcemap'])(im.type))
    put(one, 'code_file', frameFile(im.code_file))
    put(one, 'debug_id', id(im.debug_id, true))
    if (nonEmpty(one)) out.push(one)
  }
  return out.length > 0 ? { images: out } : undefined
}

const CONTENT_TYPE = /^[a-z0-9.+/-]{1,100}(; ?[a-z-]+=[A-Za-z0-9._-]{1,60})?$/
const HEADER_SHAPE: Record<string, V> = {
  host: (v) => token(v, 200),
  'content-length': (v) => token(v, 200),
  'content-type': (v) => (typeof v === 'string' && CONTENT_TYPE.test(v) && !guardHits(v) ? v : undefined),
  'user-agent': (v) => spaced(v, 400),
  accept: (v) => spaced(v, 200),
}

function buildRequest(v: unknown): Obj | undefined {
  const r = asObj(v)
  if (!r) return undefined
  const out: Obj = {}
  put(out, 'method', METHOD(r.method))
  put(out, 'url', path(r.url, 300))
  const h = asObj(r.headers)
  if (h) {
    const headers: Obj = {}
    // The exit's OWN header list = the names it has a shape for; a name
    // without a shape is dropped by name, never thrown on (R-S112-6 S4).
    for (const key of Object.keys(h)) {
      const lower = key.toLowerCase()
      if (!Object.prototype.hasOwnProperty.call(HEADER_SHAPE, lower)) continue
      put(headers, lower, HEADER_SHAPE[lower]?.(h[key]))
    }
    put(out, 'headers', nonEmpty(headers))
  }
  return nonEmpty(out)
}

function sub(v: unknown, shape: Record<string, V>): Obj | undefined {
  const o = asObj(v)
  if (!o) return undefined
  const out: Obj = {}
  for (const key of Object.keys(shape)) {
    if (Object.prototype.hasOwnProperty.call(o, key)) put(out, key, shape[key](o[key]))
  }
  return nonEmpty(out)
}

const CONTEXTS: Record<string, Record<string, V>> = {
  browser: { name: (v) => token(v, 40), version: (v) => token(v, 40) },
  os: { name: (v) => spaced(v, 40), version: (v) => token(v, 60) },
  device: { family: (v) => token(v, 60), model: (v) => token(v, 60), arch: (v) => token(v, 20) },
  runtime: { name: (v) => token(v, 40), version: (v) => token(v, 40) },
  culture: { locale: (v) => token(v, 20), timezone: (v) => token(v, 60) },
  app: { app_start_time: iso },
  cloud_resource: { 'cloud.provider': (v) => token(v, 40), 'cloud.region': (v) => token(v, 40) },
  nextjs: {
    request_path: (v) => path(v, 300),
    router_kind: (v) => token(v, 40),
    router_path: (v) => path(v, 300),
    route_type: (v) => token(v, 40),
  },
}

function buildContexts(v: unknown): Obj | undefined {
  const c = asObj(v)
  if (!c) return undefined
  const out: Obj = {}
  put(out, 'trace', buildTraceContext(c.trace))
  for (const name of Object.keys(CONTEXTS)) put(out, name, sub(c[name], CONTEXTS[name]))
  return nonEmpty(out)
}

function buildBreadcrumbs(v: unknown): Obj[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Obj[] = []
  for (const raw of v.slice(-20)) {
    const b = asObj(raw)
    if (!b || b.category !== 'navigation') continue
    const kept = keepBreadcrumb(b) as Obj | null
    if (!kept) continue
    const one: Obj = { category: 'navigation' }
    put(one, 'type', token(kept.type, 20))
    put(one, 'level', LEVEL(kept.level))
    put(one, 'timestamp', ts(kept.timestamp))
    const d = asObj(kept.data)
    if (d) {
      const data: Obj = {}
      put(data, 'from', path(d.from, 300))
      put(data, 'to', path(d.to, 300))
      put(one, 'data', nonEmpty(data))
    }
    out.push(one)
  }
  return out.length > 0 ? out : undefined
}

const ORDINARY_TAGS: Record<string, V> = {
  business_id: (v) => id(v),
  store_id: (v) => id(v),
  runtime: enumOf(['node', 'edge', 'browser']), // PROVISIONAL (item 116)
}

/** § 2.3: an `event` item without tags.alarm === '1'. null = event_id failed. */
export function buildErrorEvent(payload: unknown): Obj | null {
  const e = asObj(payload)
  if (!e) return null
  const out = buildIdentity(e)
  if (!out) return null
  put(out, 'transaction', transactionName(e.transaction))
  const ti = asObj(e.transaction_info)
  if (ti) put(out, 'transaction_info', nonEmpty(sub(ti, { source: SOURCE }) ?? {}))
  put(out, 'fingerprint', buildFingerprint(e.fingerprint))
  put(out, 'tags', sub(e.tags, ORDINARY_TAGS))
  put(out, 'exception', buildException(e.exception))
  put(out, 'debug_meta', buildDebugMeta(e.debug_meta))
  put(out, 'request', buildRequest(e.request))
  put(out, 'contexts', buildContexts(e.contexts))
  put(out, 'breadcrumbs', buildBreadcrumbs(e.breadcrumbs))
  return out
}

// ---- § 2.3a alarm event ------------------------------------------------------------

const ALARM_TAG_SHAPE: Record<string, V> = {
  alarm: enumOf(['1']),
  alarm_kind: (v) => token(v, 40, /^[a-z_]{1,40}$/),
  business_id: (v) => id(v),
}

/** The exit-only shape on top of the shared validators (R-S102-1 (a)). */
function alarmExtraShape(key: string, v: unknown): unknown {
  if (key === 'take_ids') {
    if (!Array.isArray(v)) return undefined
    return v.map((t) => token(t, 64)).filter((t): t is string => t !== undefined)
  }
  if (typeof v !== 'string') return v
  if (key === 'os_version') return spaced(v, 40)
  if (key === 'newest_piece_at') return iso(v)
  return token(v, 200)
}

/** § 2.3a: an `event` item with tags.alarm === '1'. null = event_id failed. */
export function buildAlarmItem(payload: unknown): Obj | null {
  const e = asObj(payload)
  if (!e) return null
  const out = buildIdentity(e)
  if (!out) return null
  put(out, 'message', masked(e.message, 120))
  put(out, 'fingerprint', buildFingerprint(e.fingerprint))
  const tagsIn = asObj(e.tags)
  if (tagsIn) {
    const tags: Obj = {}
    for (const key of ALARM_TAG_KEYS) put(tags, key, ALARM_TAG_SHAPE[key]?.(tagsIn[key]))
    put(out, 'tags', nonEmpty(tags))
  }
  const extraIn = asObj(e.extra)
  if (extraIn) {
    const extra: Obj = {}
    for (const key of ALARM_EXTRA_KEYS) {
      const kept = alarmExtraValue(key, extraIn[key])
      if (kept !== undefined) put(extra, key, alarmExtraShape(key, kept))
    }
    put(out, 'extra', nonEmpty(extra))
  }
  return out
}

// ---- § 2.4 transaction event ----------------------------------------------------------

/** § 2.4: everything in § 2.3 plus the transaction fields. Each spans[] entry
 *  that fails span_id / trace_id is dropped and reported through `onSpanDrop`. */
export function buildTransactionEvent(
  payload: unknown,
  onSpanDrop?: (reason: 'required_field' | 'over_limit', count?: number) => void,
  onKeyDrop?: () => void,
): Obj | null {
  const out = buildErrorEvent(payload)
  if (!out) return null
  const e = payload as Obj
  put(out, 'type', enumOf(['transaction'])(e.type))
  put(out, 'start_timestamp', ts(e.start_timestamp))
  put(out, 'measurements', buildMeasurements(e.measurements, onKeyDrop))
  if (Array.isArray(e.spans)) {
    const spans: Obj[] = []
    for (const raw of e.spans.slice(0, 1000)) {
      const s = buildSpan(raw, onKeyDrop)
      if (s) spans.push(s)
      else onSpanDrop?.('required_field')
    }
    // spans past the first 1000 are cut AND counted (R-S112-6 NIT)
    if (e.spans.length > 1000) onSpanDrop?.('over_limit', e.spans.length - 1000)
    out.spans = spans
  }
  return out
}

// ---- rebuildEnvelope ----------------------------------------------------------------

export type DropInfo = { alarm: boolean | 'unreadable'; eventId?: unknown; environment?: unknown }
/** One call per dropped item (count 1), or one call carrying a count for a
 *  cut tail (spans past 1000). */
export type OnDrop = (type: string, reason: string, info?: DropInfo, count?: number) => void

/** A type name safe to count or log (never content). */
function safeTypeName(t: unknown): string {
  return token(t, 40, /^[a-z_]{1,40}$/) ?? 'unknown'
}

/**
 * Builds a NEW envelope: header from § 2.1, each item from § 2.2-2.9, unknown
 * item types dropped, null when nothing is left. Every dropped item calls
 * onDrop — except a dropped client_report. Never throws.
 */
export function rebuildEnvelope(envelope: unknown, onDrop?: OnDrop): Envelope | null {
  const drop = (type: string, reason: string, info?: DropInfo, count?: number): void => {
    if (type === 'client_report') return
    try {
      onDrop?.(type, reason, info, count)
    } catch {
      // counting never breaks the rebuild
    }
  }
  try {
    if (!Array.isArray(envelope)) {
      drop('envelope', 'unreadable')
      return null
    }
    let header: Obj
    try {
      header = buildEnvelopeHeader(envelope[0])
    } catch {
      header = {}
    }
    const items: unknown = envelope[1]
    const out: unknown[] = []
    if (!Array.isArray(items)) {
      drop('envelope', 'unreadable')
      return null
    }
    const list: unknown[] = items
    for (const item of list) {
      let type = 'unknown'
      let info: DropInfo | undefined
      try {
        type = safeTypeName(asObj((item as unknown[])[0])?.type)
        const admitted = admittedItemType(type)
        if (!admitted) {
          drop(type, 'type_not_admitted')
          continue
        }
        const payload = (item as unknown[])[1]
        let built: Obj | null
        if (admitted === 'event') {
          let alarm: boolean | 'unreadable'
          try {
            alarm = asObj(asObj(payload)?.tags)?.alarm === '1'
          } catch {
            alarm = 'unreadable'
          }
          info = { alarm }
          try {
            info.eventId = asObj(payload)?.event_id
          } catch {
            // unreadable id: the constant alarm generates its own
          }
          try {
            info.environment = asObj(payload)?.environment
          } catch {
            // unreadable environment: omitted
          }
          if (alarm === 'unreadable') {
            drop(type, 'alarm_tag_unreadable', info)
            continue
          }
          built = alarm ? buildAlarmItem(payload) : buildErrorEvent(payload)
        } else if (admitted === 'transaction') {
          built = buildTransactionEvent(
            payload,
            (reason, count) => drop('span', reason, undefined, count),
            () => drop('measurement', 'key_not_admitted'),
          )
        } else if (admitted === 'span') {
          built = buildSpan(payload, () => drop('measurement', 'key_not_admitted'))
        } else if (admitted === 'session') {
          built = buildSession(payload)
        } else if (admitted === 'sessions') {
          built = buildSessionAggregates(payload)
        } else if (admitted === 'client_report') {
          built = buildClientReport(payload)
        } else {
          built = buildCheckIn(payload)
        }
        if (built === null) {
          drop(type, 'required_field', info)
          continue
        }
        out.push([buildItemHeader(admitted), built])
      } catch {
        drop(type, 'builder_threw', info)
      }
    }
    return out.length > 0 ? ([header, out] as unknown as Envelope) : null
  } catch {
    drop('envelope', 'builder_threw')
    return null
  }
}

// ---- wrapTransport (§ 1.2) ------------------------------------------------------------

const HEX = '0123456789abcdef'

/** THE CONSTANT ALARM (§ 1.2, R-S102-3 (b)): literals only, plus a validated id and environment. */
export function constantAlarm(info?: DropInfo, count = 1): Obj {
  let eventId = fixedId(info?.eventId, 32)
  if (eventId === undefined) {
    eventId = ''
    for (let i = 0; i < 32; i++) eventId += HEX[Math.floor(Math.random() * 16)]
  }
  const out: Obj = {
    event_id: eventId,
    level: 'error',
    message: 'alarm dropped at exit',
    tags: { alarm: '1', alarm_kind: 'exit_drop' },
    extra: { count: Number.isSafeInteger(count) && count > 0 ? count : 1 },
    platform: 'javascript',
    timestamp: Date.now() / 1000,
  }
  put(out, 'environment', environment(info?.environment))
  return out
}

/** The drop's data category (core's own map); a non-string result counts as 'default'. */
function categoryOf(type: string): DataCategory {
  const c: unknown = envelopeItemTypeToDataCategory(type as EnvelopeItemType)
  return typeof c === 'string' ? (c as DataCategory) : 'default'
}

/**
 * The transport wrapper passed as `transport` to Sentry.init. Every envelope is
 * rebuilt by rebuildEnvelope; each drop is counted (recordDroppedEvent) and, with
 * `log`, the envelope's drops are logged as ONE line of {item, reason, count}.
 * Dropped alarms are replaced by ONE constant alarm carrying their count
 * (R-S101-4, R-S112-5 F6, R-S112-6 NITs). Everything except `inner.send` fails closed; a
 * rejection or throw inside `inner.send` propagates untouched (R-S102-2 D5).
 */
export function wrapTransport<O extends BaseTransportOptions>(
  inner: (opts: O) => Transport,
  flags?: { log?: boolean },
): (opts: O) => Transport {
  return (opts: O): Transport => {
    const transport = inner(opts)
    return {
      send(envelope: Envelope) {
        let out: Envelope | null = null
        try {
          // ONE constant alarm per envelope, carrying how many alarms dropped;
          // drops aggregated per envelope as {item, reason, count} for ONE log line
          let alarmInfo: DropInfo | undefined
          let alarmCount = 0
          const tally = new Map<string, { item: string; reason: string; count: number }>()
          out = rebuildEnvelope(envelope, (type, reason, info, count) => {
            const n = typeof count === 'number' && count > 0 ? count : 1
            if (info && info.alarm !== false) {
              alarmInfo ??= info
              alarmCount += 1
            }
            try {
              // a dropped measurement key is a field, not an item: logged, never a client-report count
              if (type !== 'measurement') opts.recordDroppedEvent('before_send', categoryOf(type), n)
            } catch {
              // counting never blocks the send
            }
            const key = `${type}|${reason}`
            const t = tally.get(key)
            if (t) t.count += n
            else tally.set(key, { item: type, reason, count: n })
          })
          if (flags?.log === true && tally.size > 0) {
            try {
              console.error('[sentry-exit] dropped', JSON.stringify([...tally.values()]))
            } catch {
              // logging never blocks the send
            }
          }
          const alarms: Obj[] = []
          if (alarmCount > 0) {
            try {
              alarms.push(constantAlarm(alarmInfo, alarmCount))
            } catch {
              // building the constant alarm never blocks the rebuilt envelope
            }
          }
          if (alarms.length > 0) {
            try {
              let header: Obj
              if (out) header = out[0] as unknown as Obj
              else {
                try {
                  header = buildEnvelopeHeader((envelope as unknown as unknown[])[0])
                } catch {
                  header = {}
                }
              }
              const items: unknown[] = out ? [...(out[1] as unknown[])] : []
              for (const a of alarms) items.push([buildItemHeader('event'), a])
              out = [header, items] as unknown as Envelope
            } catch {
              // the rebuilt envelope (if any) still goes
            }
          }
        } catch {
          out = null // fail closed
        }
        if (out === null) return Promise.resolve({})
        return transport.send(out)
      },
      flush: (timeout?: number) => transport.flush(timeout),
    }
  }
}
