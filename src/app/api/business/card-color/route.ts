// ⚖ A2 (Liam 9/24, PKT-A2-CORE-WRITE §7 R-A2-13) — カードの見た目's ONE save, the route in territory.
// #847's checklist (MERGE-MAP §4): strict same-origin · admission (a refused reader gets 404 — Next turns
// admission's notFound() into a bare 404 in a route, app-route/module.js:475) · X-Expected-Business vs the
// admitted business → 409 · body EXACTLY { color } · the door export · 503 honesty. The page offers this
// only while the practice door is ON (page.tsx); OFF, the door answers 'tenant' here too.
import { requireBusinessAdmission } from '@/business/lib/admission'
import { writeReserveCardColor } from '@/business/lib/data'

const STATUS = { forbidden: 403, tenant: 409, invalid: 400, core: 503 } as const
type Reason = keyof typeof STATUS
const refuse = (reason: Reason) => Response.json({ ok: false, reason }, { status: STATUS[reason] })

/** Strict same-origin. With an Origin header, it must name this host (the host Next itself compares
 *  for server actions: x-forwarded-host, else host). Without one, only `Sec-Fetch-Site: same-origin`
 *  passes. Neither → refused. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim()
  if (origin !== null) {
    try {
      return host !== '' && new URL(origin).host === host
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
    Object.keys(body).length !== 1 || !('color' in body) ||
    (body.color !== null && typeof body.color !== 'string')
  ) return refuse('invalid')
  const result = await writeReserveCardColor(body.color)
  return result.ok ? Response.json(result, { status: 200 }) : refuse(result.reason)
}
