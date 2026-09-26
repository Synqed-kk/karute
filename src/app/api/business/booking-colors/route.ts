// ⚖ PKT-S38 R4 (Liam 9/25 「make it work」) — 予約の色分け's ONE save, the route in territory, mirrored from
// card-color/route.ts: strict same-origin · admission (a refused reader gets 404) · X-Expected-Business vs the
// admitted business → 409 · body EXACTLY { storeId, colors } (the colours' own checks are the door's, one
// truth) · the door export · 503 honesty. The page offers this only while the practice door is ON (page.tsx);
// OFF, the door answers 'tenant' here too.
import { requireBusinessAdmission } from '@/business/lib/admission'
import { writeBookingColors } from '@/business/lib/data'

const STATUS = { forbidden: 403, tenant: 409, invalid: 400, core: 503 } as const
type Reason = keyof typeof STATUS
const refuse = (reason: Reason) => Response.json({ ok: false, reason }, { status: STATUS[reason] })

/** Strict same-origin, exactly card-color's: with an Origin header it must name this request's own scheme
 *  and the `host` this server received — never `x-forwarded-host`, which the client can send. Without an
 *  Origin, only `Sec-Fetch-Site: same-origin` passes. Neither → refused. */
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
    Object.keys(body).length !== 2 || !('storeId' in body) || !('colors' in body) ||
    typeof body.storeId !== 'string' ||
    typeof body.colors !== 'object' || body.colors === null || Array.isArray(body.colors)
  ) return refuse('invalid')
  const result = await writeBookingColors(body.storeId, body.colors)
  return result.ok ? Response.json(result, { status: 200 }) : refuse(result.reason)
}
