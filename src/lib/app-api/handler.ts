// Facade route wrapper (PLAN §5/§6/§11). Every `/api/app/v1/*` handler goes
// through here so the security + CORS + error contract is applied uniformly and
// a new route cannot forget a piece.
//
//   - CORS headers on every response; OPTIONS short-circuits to the preflight.
//   - Bearer identity resolved ONCE (cookie ignored) and handed to the handler.
//   - Any throw is normalized to a stable {error:{code,message}} + correct status
//     (jwks_unavailable→503, revoked→401, forbidden→403, …).
//   - Observability seam (packet point 10): request-id echoed; app-version +
//     platform read; a structured line emitted on 4xx/5xx for metrics/alerts.
//     (The metrics/Sentry sink itself is the separate observability packet.)

import { corsHeaders, preflightResponse } from './cors'
import { AppApiError, toAppApiError, errorBody } from './errors'
import { resolveBearerIdentity, type RequestIdentity } from './identity'
import { audit, FACADE_AUDIT_MAP, type FacadeEndpointKey } from '@/lib/audit'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'
import type { GetUserFn } from '@/lib/auth/revocation'

// Mirrors src/actions/audit-log.ts's UUID_RE (can't import — that file is
// 'use server', which only permits async function exports). Root-cause fix,
// 2026-08-29 packet: a non-UUID params.id (e.g. thin/ports/actions.vite.ts's
// MEMORY_ITEM_ID_SENTINEL '-') must never stamp a target — see logFacadeAudit.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface RouteContext<P = Record<string, string>> {
  params: Promise<P>
}

export interface FacadeContext<P = Record<string, string>> {
  req: Request
  identity: RequestIdentity
  origin: string | null
  route: RouteContext<P>
  /** Observability metadata carried by every facade request. */
  meta: { requestId: string; appVersion: string | null; platform: string | null }
  /** Extra detail a route hands to the success-hook emit (Wave V:
   *  karute.read's `transcript_shown` + the karute rows' `customer_id` name
   *  join). ADDITIVE ONLY — a route can enrich its map row's emit, never
   *  suppress or replace it. Set it synchronously before returning the
   *  response; the hook reads it once, right after the handler resolves.
   *  The TWO correlation keys are hook-owned and stripped if a route sets
   *  them: `client_request_id` (re-asserted from the real header after the
   *  merge) and `request_id` (a route-supplied one would ride into
   *  audit.ts's detailWithRequestId, which deliberately keeps a
   *  caller-supplied value, silently replacing the server mint on the
   *  durable row). Values are bounded (strings 256 chars, 8 ROUTE keys —
   *  the hook's own client_request_id rides on top, outside the cap, so
   *  route keys can never evict it) so a stray oversized route value can't
   *  balloon detail past core's ~2KB cap and truncate away sibling fields —
   *  the same eviction the client-header 128-char bound prevents. Sanity
   *  rails, not byte-exact budgeting (worst case ≈2.2KB sits just over the
   *  soft cap): real rows carry one or two flag/id keys. */
  auditDetail?: Record<string, string | number | boolean | null>
  /** Store lens for the hook's emit (Wave W2, same additive-only contract as
   *  auditDetail): a route that clamped its work to one store hands the
   *  clamped id here and the row becomes store-filterable (audit.ts
   *  storeId → core store_id). Never authority — display/filter color only;
   *  unset = business-wide row, exactly as before. */
  auditStoreId?: string
  /** Server-resolved TRUE target id (root-cause fix, 2026-08-29 packet): a
   *  route whose path param is decorative (e.g. the memory-item routes'
   *  itemId-only signature — thin/ports/actions.vite.ts fills the customer
   *  segment with a sentinel) sets this to the real owning id it already
   *  proved server-side. Same additive-only contract as auditDetail/
   *  auditStoreId. Unset falls back to params.id, but ONLY when it's
   *  UUID-shaped — see logFacadeAudit. */
  auditTargetId?: string
  /** Per-request opt-out from the success-hook emit (success-only audit law):
   *  a route that returns a 2xx whose BODY is a soft FAILURE (e.g. karute
   *  regenerate's `{error}` result — no transcript, extraction failed) sets a
   *  short reason here and the hook then writes nothing for this request.
   *  Same additive-only contract as auditDetail/auditStoreId/auditTargetId —
   *  additive per-request opt-out, never set on a real success. */
  auditSuppress?: string
}

type FacadeFn<P> = (ctx: FacadeContext<P>) => Promise<Response>

/** Inject the verifier config / getUser for tests; production uses env defaults. */
export interface FacadeDeps {
  config?: VerifierConfig
  getUser?: GetUserFn
}

function jsonResponse(body: unknown, status: number, origin: string | null, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'request-id': requestId,
      ...corsHeaders(origin),
    },
  })
}

/** JSON success helper for handlers — applies CORS + request-id. */
export function ok(ctx: FacadeContext, data: unknown, status = 200): Response {
  return jsonResponse(data, status, ctx.origin, ctx.meta.requestId)
}

/**
 * Wrap a facade handler. `endpoint` is the revocation-policy key (packet 01's
 * constant) AND the observability label.
 */
export function facadeHandler<P = Record<string, string>>(
  endpoint: FacadeEndpointKey,
  fn: FacadeFn<P>,
  deps: FacadeDeps = {},
) {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const origin = req.headers.get('origin')
    // Contract §7 / PR-M5 piece ③: the server ALWAYS mints the canonical id —
    // an untrusted client header can no longer become the row's requestId.
    // The client's own value (when sent) is kept only as a correlation hint
    // on the audit row's detail.client_request_id (logFacadeAudit below); the
    // response 'request-id' header echoes the SERVER mint, same as before for
    // a request with no client header, but now ALSO for one that sent a
    // (possibly forged) value.
    const requestId = cryptoRandomId()
    const clientRequestId = req.headers.get('request-id')
    const meta = {
      requestId,
      appVersion: req.headers.get('app-version'),
      platform: req.headers.get('platform'),
    }

    if (req.method === 'OPTIONS') return preflightResponse(origin)

    try {
      const identity = await resolveBearerIdentity(req, endpoint, deps)
      const ctx: FacadeContext<P> = { req, identity, origin, route, meta }
      const res = await fn(ctx)
      await logFacadeAudit(
        endpoint,
        res,
        identity,
        route,
        meta,
        clientRequestId,
        ctx.auditDetail,
        ctx.auditStoreId,
        ctx.auditTargetId,
        ctx.auditSuppress,
      )
      return res
    } catch (err) {
      const apiErr = toAppApiError(err)
      logFacadeError(endpoint, apiErr, meta)
      return jsonResponse(errorBody(apiErr), apiErr.status, origin, requestId)
    }
  }
}

/** Audit hook — every facade success flows through here (AUDIT-LOG-DESIGN.md).
 *  Classification is table-driven (FACADE_AUDIT_MAP, TOTAL as of PR-M4):
 *  mutations + single-record opens emit one event; list endpoints and
 *  `pendingWave` rows (dated tracked-TODO, contract C2/F6) are deliberately
 *  exempt. Best-effort by design: an audit emit failure must never break the
 *  response in production (the interim sink is a console line; the
 *  evidentiary rule is "the log proves presence, never absence") — dev/test
 *  is the one exception (CP6, below): loud failures while building beat a
 *  silently-broken audit trail in prod. */
async function logFacadeAudit(
  endpoint: FacadeEndpointKey,
  res: Response,
  identity: RequestIdentity,
  route: { params: Promise<unknown> },
  meta: FacadeContext['meta'],
  clientRequestId: string | null,
  routeDetail?: FacadeContext['auditDetail'],
  routeStoreId?: string,
  routeTargetId?: string,
  routeSuppress?: string,
): Promise<void> {
  try {
    // 2xx only — a redirect or other non-success must not read as a completed
    // action (Greptile round: redirects counted as actions under `< 400`).
    if (res.status < 200 || res.status >= 300) return
    // Success-only audit law: a route can mark its own 2xx body a soft
    // failure — see FacadeContext.auditSuppress. Presence-based
    // (`!== undefined`), same as this function's pendingWave gate below —
    // an empty-string reason is still a route DECIDING to suppress, so
    // truthiness (which would let '' fall through and emit) is wrong here.
    if (routeSuppress !== undefined) return
    // FACADE_AUDIT_MAP is a TOTAL Record<FacadeEndpointKey,...> — `rule` can
    // only be undefined here if a bogus key reached this function past the
    // compile-time union (a JS-boundary caller, e.g. `as FacadeEndpointKey`,
    // or a future refactor). That is exactly CP6's belt.
    const rule = FACADE_AUDIT_MAP[endpoint]
    if (!rule) {
      reportUnmappedEndpoint(endpoint, identity, meta)
      return
    }
    if (rule.kind === 'skip' || rule.pendingWave !== undefined) return
    // Load-bearing narrow (contract §8 taxonomy typing): FacadeAuditRule.action
    // is `AuditAction | ''` ('' only ever appears on a 'skip' row, already
    // returned above), but tsc can't see that invariant — AuditEvent.action
    // is `AuditAction` with no empty-string member, so this guard is what
    // makes the emit below type-check, not just documentation.
    if (!rule.action) return
    const params = (await route.params) as Record<string, string> | undefined
    // Route-supplied detail is additive color, never authority (see the
    // FacadeContext.auditDetail doc): the two hook-owned correlation keys
    // are STRIPPED (request_id would hijack the server mint downstream —
    // audit.ts's detailWithRequestId keeps a caller-supplied one; the real
    // client_request_id is written after the loop), string values are capped
    // at 256 chars and keys at 8, so a stray route value can't push detail
    // past core's ~2KB cap and truncate away siblings.
    const detail: Record<string, string | number | boolean | null> = {}
    if (routeDetail) {
      for (const [k, v] of Object.entries(routeDetail)) {
        if (k === 'request_id' || k === 'client_request_id') continue
        if (Object.keys(detail).length >= 8) break
        detail[k] = typeof v === 'string' ? v.slice(0, 256) : v
      }
    }
    if (clientRequestId) detail.client_request_id = clientRequestId.slice(0, 128)
    audit({
      category: rule.category,
      action: rule.action,
      actorId: identity.authUserId,
      actorType: 'staff',
      businessId: identity.businessId,
      targetType: rule.targetType,
      // Precedence: a route's server-resolved true id (routeTargetId — set
      // when the path param is decorative or poisoned) wins verbatim;
      // otherwise params.id counts only when UUID-shaped. A rule with
      // targetType but no usable id writes a null target — honest, matches
      // this emitter's own targetId ?? null (audit.ts).
      targetId: rule.targetType
        ? (routeTargetId ?? (params?.id && UUID_RE.test(params.id) ? params.id : undefined))
        : undefined,
      storeId: routeStoreId,
      requestId: meta.requestId,
      // Contract §7 / PR-M5 piece ③: the (possibly forged) client header is
      // never the row's requestId — kept only as a correlation hint, BOUNDED
      // (Greptile #634 r1): it's untrusted input, and unbounded it could
      // balloon detail past core's ~2KB cap, whose truncation would eat
      // sibling fields. 128 chars fits any legitimate id (UUID = 36).
      detail: Object.keys(detail).length > 0 ? detail : undefined,
      source: 'facade',
    })
  } catch (err) {
    // CP6 loud floor (contract §8): this rethrow covers ANY failure that
    // reaches this catch — not only reportUnmappedEndpoint's throw below.
    // That broadened scope is deliberate: loud while building, so any
    // post-handler audit failure fails the request in dev/test; production
    // never breaks the response (this rethrow is skipped there — same
    // best-effort contract as forwardToCore's own catch in audit.ts).
    if (process.env.NODE_ENV !== 'production') {
      throw err
    }
    // Contract §5 (failure is never silent): production used to swallow this
    // catch entirely — now it gets the same structured-line + drop-counter
    // treatment as audit.ts's forwardToCore catch (PR-M5 piece ⑤).
    facadeAuditDropCount += 1
    console.warn(JSON.stringify({ evt: 'facade_audit_error', endpoint, err: String(err) }))
  }
}

// Drop counter for logFacadeAudit's outer catch — the twin of audit.ts's
// coreForwardDropCount (PR-M5 piece ⑤). ponytail: a `let` + getter, same as
// the audit.ts counter — no shared metrics layer for two counters.
let facadeAuditDropCount = 0
export function getFacadeAuditDropCount(): number {
  return facadeAuditDropCount
}
/** Test seam — reset between cases. */
export function _resetFacadeAuditDropCount(): void {
  facadeAuditDropCount = 0
}

/** Rate-limits the durable `audit.unmapped_endpoint` warning row: one per key
 *  per instance per window — flood-safe if a bad deploy hammers the same
 *  bogus key repeatedly. In-memory, best-effort (module-scoped, resets on
 *  cold start; ponytail: a shared/durable limiter is unwarranted for a
 *  belt-and-braces net the console line already covers primarily). */
const unmappedEndpointLastWarned = new Map<string, number>()
const UNMAPPED_ENDPOINT_WARN_WINDOW_MS = 5 * 60 * 1000

/** CP6 loud floor (contract §2.1/§8): fires when a key reaches this function
 *  that isn't in FACADE_AUDIT_MAP — the compile-time union can't be escaped
 *  from a route.ts call site, but a JS-boundary caller or a future refactor
 *  still can. The console line is the PRIMARY alert net (always, first,
 *  every environment — an outage-time record even if the durable write
 *  below never lands); production then rate-limits a durable warning row;
 *  dev/test throws instead, so the gap is impossible to miss while building. */
function reportUnmappedEndpoint(
  endpoint: string,
  identity: RequestIdentity,
  meta: FacadeContext['meta'],
): void {
  console.warn(JSON.stringify({ evt: 'audit_unmapped_endpoint', endpoint, at: new Date().toISOString() }))

  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`unmapped facade endpoint: '${endpoint}' is not in FACADE_AUDIT_MAP`)
  }

  const now = Date.now()
  const last = unmappedEndpointLastWarned.get(endpoint) ?? 0
  if (now - last < UNMAPPED_ENDPOINT_WARN_WINDOW_MS) return
  unmappedEndpointLastWarned.set(endpoint, now)
  audit({
    category: 'privacy',
    action: 'audit.unmapped_endpoint',
    actorId: identity.authUserId,
    actorType: 'staff',
    businessId: identity.businessId,
    severity: 'warning',
    detail: { endpoint },
    requestId: meta.requestId,
    source: 'facade',
  })
}

/** Structured error line — the seam metrics/alerts attach to (packet point 10).
 *  Never logs token/PII, only the classified code + labels. */
function logFacadeError(
  endpoint: string,
  err: AppApiError,
  meta: FacadeContext['meta'],
): void {
  console.warn(
    JSON.stringify({
      evt: 'facade_error',
      endpoint,
      code: err.code,
      status: err.status,
      requestId: meta.requestId,
      appVersion: meta.appVersion,
      platform: meta.platform,
    }),
  )
}

function cryptoRandomId(): string {
  // globalThis.crypto is present in Node 20+ and the Edge/Web runtime.
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
}
