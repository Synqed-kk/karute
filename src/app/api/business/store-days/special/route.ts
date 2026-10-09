// ⚖ PKT-S29-B1 — 特別営業日's LIVE add/remove, mirrored from
// store-days/closures/route.ts (itself mirrored from card-color/route.ts):
// strict same-origin · admission · X-Expected-Business → 409 · the door
// export · 503 honesty. `date` on DELETE travels as a QUERY PARAM, same
// reason as the closures route's `id`.
import { requireBusinessAdmission } from '@/business/lib/admission'
import { addStoreSpecialOpenDay, removeStoreSpecialOpenDay } from '@/business/lib/data'

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
    Object.keys(body).length !== 4 || !('storeId' in body) || !('date' in body) || !('open' in body) || !('close' in body) ||
    typeof body.storeId !== 'string' || typeof body.date !== 'string' || typeof body.open !== 'string' || typeof body.close !== 'string'
  ) return refuse('invalid')
  const result = await addStoreSpecialOpenDay(body.storeId, { date: body.date, open: body.open, close: body.close })
  return result.ok ? Response.json(result, { status: 200 }) : refuse(result.reason, result.message)
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return refuse('forbidden')
  const admitted = await requireBusinessAdmission()
  if (req.headers.get('x-expected-business') !== admitted.businessId) return refuse('tenant')
  const url = new URL(req.url)
  const storeId = url.searchParams.get('storeId')
  const date = url.searchParams.get('date')
  if (!storeId || !date) return refuse('invalid')
  const result = await removeStoreSpecialOpenDay(storeId, date)
  return result.ok ? Response.json(result, { status: 200 }) : refuse(result.reason, result.message)
}
