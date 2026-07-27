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
      const res = await fn({ req, identity, origin, route, meta })
      await logFacadeAudit(endpoint, res, identity, route, meta, clientRequestId)
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
): Promise<void> {
  try {
    // 2xx only — a redirect or other non-success must not read as a completed
    // action (Greptile round: redirects counted as actions under `< 400`).
    if (res.status < 200 || res.status >= 300) return
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
    const params = (await route.params) as Record<string, string> | undefined
    audit({
      category: rule.category,
      action: rule.action,
      actorId: identity.authUserId,
      actorType: 'staff',
      businessId: identity.businessId,
      targetType: rule.targetType,
      targetId: rule.targetType && params?.id ? params.id : undefined,
      requestId: meta.requestId,
      // Contract §7 / PR-M5 piece ③: the (possibly forged) client header is
      // never the row's requestId — kept only as a correlation hint.
      detail: clientRequestId ? { client_request_id: clientRequestId } : undefined,
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
