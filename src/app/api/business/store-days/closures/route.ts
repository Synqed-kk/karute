// ⚖ PKT-S29-B1 — 臨時休業's LIVE add/remove, the route in territory, mirrored
// from card-color/route.ts: strict same-origin · admission (a refused reader
// gets 404) · X-Expected-Business vs the admitted business → 409 · the door
// export · 503 honesty. `id` on DELETE travels as a QUERY PARAM, never a body
// — core's own removeClosedDay route does the same, for the documented reason
// "DELETE body is unreliable across clients" (EV/CORE-READ-B1.md Q2).
import { requireBusinessAdmission } from '@/business/lib/admission'
import { addStoreClosedDay, removeStoreClosedDay } from '@/business/lib/data'

const STATUS = { forbidden: 403, tenant: 409, invalid: 400, core: 503 } as const
type Reason = keyof typeof STATUS
const refuse = (reason: Reason, message = '') => Response.json({ ok: false, reason, message }, { status: STATUS[reason] })

/** Strict same-origin, exactly card-color's. */
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

export async function POST(req: Request): Promise<Response> {
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
    Object.keys(body).length !== 3 || !('storeId' in body) || !('date' in body) || !('reason' in body) ||
    typeof body.storeId !== 'string' || typeof body.date !== 'string' || typeof body.reason !== 'string'
  ) return refuse('invalid')
  const result = await addStoreClosedDay(body.storeId, { date: body.date, reason: body.reason })
  return result.ok ? Response.json(result, { status: 200 }) : refuse(result.reason, result.message)
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return refuse('forbidden')
  const admitted = await requireBusinessAdmission()
  if (req.headers.get('x-expected-business') !== admitted.businessId) return refuse('tenant')
  const url = new URL(req.url)
  const storeId = url.searchParams.get('storeId')
  const id = url.searchParams.get('id')
  if (!storeId || !id) return refuse('invalid')
  const result = await removeStoreClosedDay(storeId, id)
  return result.ok ? Response.json(result, { status: 200 }) : refuse(result.reason, result.message)
}
