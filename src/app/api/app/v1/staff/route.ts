// Facade: staff create (design-parity packet 12 §S4a). Single-source: calls
// the SAME createStaffCore the web createStaff action calls.
//
// Gate: 'staff.invite' (staff.ts:41 — NOT staff.manage; adding a teammate is
// the invite capability, matching the web action's own `can('staff.invite')`
// gate) + the plan gate via staffAddAllowedWithClient — the client-threaded
// twin of the staffAddAllowed the web action calls (same counting rules +
// fail-open posture; the cookie path delegates to the same twin, so the two
// doors can't disagree). The cookie-bound staffAddAllowed() would have
// silently failed open on every Bearer request — a dead gate, not a gate.
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
import { staffAddAllowedWithClient } from '@/lib/subscription/feature-gate'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { resolveWriteStoreScope } from '@/lib/app-api/store-clamp'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'

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

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  const gate = await staffAddAllowedWithClient(synqed, businessId, async () => {
    return (await staffListByBusinessOrThrow(businessId)).length
  })
  if (!gate.allowed) {
    return ok(ctx, { error: 'Staff limit reached for the current plan.' })
  }
  // ⚖ Liam 2026-09-16: the same subset rule as web, resolved from the Bearer
  // identity rather than the cookie session.
  //
  // ⚖ FOLD ROUND 3 (fresh-eyes F7) — through resolveWriteStoreScope, the one
  // home store-clamp.ts names for "every Bearer door that must FAIL CLOSED".
  // resolveStoreForRequest alone cannot tell an UNPLACEABLE caller from a
  // floating one — core answers `{ store_ids: [] }` for both — so a phone still
  // holding a token for somebody taken off the roster read as floating, i.e.
  // unclamped, and could mint staff into any store. The placement check has to
  // happen outside the clamp, and it lives there.
  const { allowedStoreIds } = await resolveWriteStoreScope({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    selfStaffId: await resolveSelfStaffId(businessId, ctx.identity.authUserId),
  })
  const result = await createStaffCore(
    synqed,
    businessId,
    {
      actorId: ctx.identity.authUserId,
      source: 'facade',
      requestId: ctx.meta.requestId,
      creatorAllowedStoreIds: allowedStoreIds,
    },
    parsed.data,
  )
  return ok(ctx, result, 'id' in result ? 201 : 200)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
