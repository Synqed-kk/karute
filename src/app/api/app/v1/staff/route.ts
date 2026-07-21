// Facade: staff create (design-parity packet 12 §S4a). Single-source: calls
// the SAME createStaffCore the web createStaff action calls.
//
// Gate: 'staff.invite' (staff.ts:41 — NOT staff.manage; adding a teammate is
// the invite capability, matching the web action's own `can('staff.invite')`
// gate) + the plan gate (staffAddAllowed(), same function web calls). NOTE:
// staffAddAllowed() still resolves off the cookie session — it is not yet
// client-threaded, so on a Bearer-only request (no cookie) it fails open,
// the same fail-open posture every other soft failure in that gate already
// has (see src/lib/subscription/feature-gate.ts's doc comment). Flagged as a
// known limitation, not silently fixed here — S4a scope is the CRUD/authz
// surface, not a new staffAddAllowedWithClient twin.
//
// Idempotency-Key required: staff.create is create-class (S1 facts block —
// idemPost ONLY on createStaff + createInvite), matching stores.create.
//
// Business-result passthrough: createStaffCore's own { id } | { error }
// result rides the 2xx body VERBATIM — same RPC-style class as
// stores.create/org-settings PATCH. The plan-gate denial is likewise a soft
// 200 { error }, matching web's own `{ error: t('staffLimitReached') }`
// return (not a thrown/4xx failure).
//
// audit: createStaffCore emits staff.add itself — see the FACADE_AUDIT_MAP
// 'skip' row for 'staff.create' (src/lib/audit.ts).
//
// revocation: 'staff.create' is a facade WRITE and was already pre-
// registered in REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts)
// before this packet.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { createStaffCore } from '@/actions/staff'
import { staffProfileSchema } from '@/lib/validations/staff'
import { staffAddAllowed } from '@/lib/subscription/feature-gate'

export const runtime = 'nodejs'

export const POST = facadeHandler('staff.create', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.invite')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = staffProfileSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((i) => i.message).join(', '))
  }

  if (!(await staffAddAllowed()).allowed) {
    return ok(ctx, { error: 'Staff limit reached for the current plan.' })
  }

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const result = await createStaffCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade' },
    parsed.data,
  )
  return ok(ctx, result, 'id' in result ? 201 : 200)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
