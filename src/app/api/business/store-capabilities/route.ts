// S49 P2 (DECISIONS-S49 R86) — お店ページ's switches, ONE save, mirrored from booking-colors/route.ts: strict
// same-origin · admission (a refused reader gets 404) · X-Expected-Business vs the admitted business → 409 · body
// EXACTLY { storeId, record, reset_keys, based_on } (A4; the record's strict parse is the door's, one truth) · the
// data seam · 503 honesty · 409 `stale` when the stored record moved since the page loaded it (R96).
// Real mode is DISCONNECTED until CORE-47 (data.ts STORE_CAPABILITIES_REAL_MODE): a non-practice business → 501.
import { requireBusinessAdmission } from '@/business/lib/admission'
import { writeStoreCapabilities } from '@/business/lib/data'

const STATUS = { forbidden: 403, tenant: 409, stale: 409, invalid: 400, core: 503, disconnected: 501 } as const
type Reason = keyof typeof STATUS
const refuse = (reason: Reason, locked?: string) => Response.json({ ok: false, reason, ...(locked !== undefined ? { locked } : {}) }, { status: STATUS[reason] })

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

const BODY_KEYS = ['storeId', 'record', 'reset_keys', 'based_on'] as const
const BASED_ON_MAX = 64

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
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return refuse('invalid')
  const b = body as Record<string, unknown>
  if (Object.keys(b).length !== BODY_KEYS.length || !BODY_KEYS.every((k) => Object.prototype.hasOwnProperty.call(b, k))) return refuse('invalid')
  const { storeId, record, reset_keys: resetKeys, based_on: basedOn } = b
  if (typeof storeId !== 'string' || typeof record !== 'object' || record === null || Array.isArray(record)) return refuse('invalid')
  if (!Array.isArray(resetKeys)) return refuse('invalid') // its members (known keys, once each) are the door's check
  if (typeof basedOn !== 'string' || basedOn === '' || basedOn.length > BASED_ON_MAX) return refuse('invalid')
  const result = await writeStoreCapabilities(storeId, record, resetKeys, basedOn)
  return result.ok ? Response.json(result, { status: 200 }) : refuse(result.reason, 'locked' in result ? result.locked : undefined)
}
