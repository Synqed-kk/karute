// Reserve S66 (DESIGN-BUILD2 §9 R10) — 受付ルール's ONE save, the booking-colours route's twin: strict same-origin ·
// admission (a refused reader gets 404) · X-Expected-Business vs the admitted business → 409 · body EXACTLY
// { storeId, policy, basedOn } (the six values' own checks are the door's, one truth) · the door export · 503
// honesty. The refusal carries the door's line, so the screen prints which rule refused.
import { requireBusinessAdmission } from '@/business/lib/admission'
import { setReservePolicy } from '@/business/lib/data'

const STATUS = { forbidden: 403, tenant: 409, stale: 409, invalid: 400, core: 503 } as const
type Reason = keyof typeof STATUS
const refuse = (reason: Reason, message?: string) => Response.json({ ok: false, reason, ...(message === undefined ? {} : { message }) }, { status: STATUS[reason] })

/** Strict same-origin, exactly booking-colors': an Origin must name this request's own scheme and `host`
 *  (never `x-forwarded-host`); without an Origin, only `Sec-Fetch-Site: same-origin` passes. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host') ?? ''
  if (origin !== null) {
    try {
      return host !== '' && new URL(origin).origin === `${new URL(req.url).protocol}//${host}`
    } catch {
      return false
    }
  }
  return req.headers.get('sec-fetch-site') === 'same-origin'
}

export async function PUT(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return refuse('forbidden')
  const admitted = await requireBusinessAdmission()
  if (req.headers.get('x-expected-business') !== admitted.businessId) return refuse('tenant')
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse('invalid')
  }
  if (
    typeof body !== 'object' || body === null || Array.isArray(body) ||
    Object.keys(body).length !== 3 || !('storeId' in body) || !('policy' in body) || !('basedOn' in body) ||
    typeof body.storeId !== 'string' || typeof body.basedOn !== 'string'
  ) return refuse('invalid')
  const result = await setReservePolicy(body.storeId, body.policy, body.basedOn)
  // The door's whole answer goes back: a 'stale' 409 carries core's current six + their basedOn (the screen keeps the draft).
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.reason] })
}
