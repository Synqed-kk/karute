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
import { audit, FACADE_AUDIT_MAP } from '@/lib/audit'
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
  endpoint: string,
  fn: FacadeFn<P>,
  deps: FacadeDeps = {},
) {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const origin = req.headers.get('origin')
    const requestId = req.headers.get('request-id') ?? cryptoRandomId()
    const meta = {
      requestId,
      appVersion: req.headers.get('app-version'),
      platform: req.headers.get('platform'),
    }

    if (req.method === 'OPTIONS') return preflightResponse(origin)

    try {
      const identity = await resolveBearerIdentity(req, endpoint, deps)
      const res = await fn({ req, identity, origin, route, meta })
      await logFacadeAudit(endpoint, res, identity, route, meta)
      return res
    } catch (err) {
      const apiErr = toAppApiError(err)
      logFacadeError(endpoint, apiErr, meta)
      return jsonResponse(errorBody(apiErr), apiErr.status, origin, requestId)
    }
  }
}

/** Audit hook — every facade success flows through here (AUDIT-LOG-DESIGN.md).
 *  Classification is table-driven (FACADE_AUDIT_MAP, deny-default): mutations +
 *  single-record opens emit one event; list endpoints are deliberately exempt.
 *  Best-effort by design: an audit emit failure must never break the response
 *  (the interim sink is a console line; the evidentiary rule is "the log proves
 *  presence, never absence"). */
async function logFacadeAudit(
  endpoint: string,
  res: Response,
  identity: RequestIdentity,
  route: { params: Promise<unknown> },
  meta: FacadeContext['meta'],
): Promise<void> {
  try {
    // 2xx only — a redirect or other non-success must not read as a completed
    // action (Greptile round: redirects counted as actions under `< 400`).
    if (res.status < 200 || res.status >= 300) return
    const rule = FACADE_AUDIT_MAP[endpoint]
    if (!rule || rule.kind === 'skip') return
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
      source: 'facade',
    })
  } catch {
    // Never let auditing break the request path.
  }
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
