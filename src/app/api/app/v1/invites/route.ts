// Facade: staff invites create + list (design-parity packet 12 §S4b).
// Single-source: both routes call the SAME cores the web actions call
// (createInviteCore / listInvitesWithClient, src/actions/invites.ts).
//
// Gate: 'staff.invite' on BOTH — matches web's own requireCapability
// (invites.ts's requireInviteBusiness for create, and list's own gate).
//
// Plan gate (P4): staffAddAllowedWithClient — the same client-threaded twin
// the staff.create route uses (staff/route.ts) — mirrors web's own
// staffAddAllowed, skipped for re-invites (staffId present, ATTACHES to an
// existing row rather than adding a new member), inert until billing arms.
//
// Idempotency-Key required on POST only (create-class — S1 facts block:
// idemPost ONLY on createStaff + createInvite).
//
// `invitedBy` (the invite row's own field, NOT the audit actor) is derived
// from the Bearer identity's roster row (resolveSelfStaffId — the selfRow
// idiom), never caller-supplied — mirrors web's cookie-bound
// getCurrentUserStaffId().
//
// Business-result passthrough: createInviteCore's own { token } | { error }
// result rides the 2xx body VERBATIM — same RPC-style class as
// stores.create/staff.create. The plan-gate denial is likewise a soft 200
// { error: 'STAFF_LIMIT_REACHED' }, matching web's own machine-code return.
//
// audit: createInviteCore emits staff.invite_create itself — see the
// FACADE_AUDIT_MAP 'skip' row for 'invite.create' (src/lib/audit.ts). GET is
// a read; no audit row (list reads don't log, same ruling as every other
// settings-adjacent GET).
//
// revocation: 'invite.create' is a facade WRITE — a new key this packet
// registers in REVOCATION_SENSITIVE_ENDPOINTS. 'invite.list' stays OUT — a
// pure read, same posture as getStaffPermissions/getStaffStores GETs.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { ensureStaffWriteInScope } from '@/lib/app-api/store-clamp'
import { createInviteCore, listInvitesWithClient, memberEmailsForBusiness } from '@/actions/invites'
import { inviteSchema } from '@/lib/validations/invite'
import { staffAddAllowedWithClient } from '@/lib/subscription/feature-gate'

export const runtime = 'nodejs'

export const GET = facadeHandler('invite.list', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.invite')
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const invites = await listInvitesWithClient(
    synqed,
    await memberEmailsForBusiness(businessId),
    // Bearer twin of the lens web's listInvites passes: a RE-invite row whose
    // target card is out of this caller's stores is DROPPED, never shown and
    // then refused (isolation law). The write clamp's own throw is read as
    // "cannot see" — every one of its refusals is exactly that.
    (targetStaffId) =>
      ensureStaffWriteInScope({
        synqed,
        businessId,
        authUserId: ctx.identity.authUserId,
        capabilities: ctx.identity.capabilities,
        targetStaffId,
      }).then(
        () => true,
        () => false,
      ),
  )
  return ok(ctx, { invites })
})

export const POST = facadeHandler('invite.create', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.invite')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((i) => i.message).join(', '))
  }

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Re-invite only (staffId present = an EXISTING staff card, whose user_id
  // acceptInvite rewrites): the Bearer twin of the clamp invites.ts applies on
  // web. Fresh invites fall through to the plan gate, unchanged.
  //
  // AFTER the body parse, deliberately — the exception to #715's
  // clamp-before-parse ordering, and not an oversight. There the target rides
  // the URL, so it is known before a byte is read; here `staffId` IS a body
  // field, so the target cannot exist until the body is parsed. The parse is
  // schema validation on an already-authenticated request; nothing is written
  // before the clamp answers.
  if (parsed.data.staffId) {
    await ensureStaffWriteInScope({
      synqed,
      businessId,
      authUserId: ctx.identity.authUserId,
      capabilities: ctx.identity.capabilities,
      targetStaffId: parsed.data.staffId,
    })
  }

  if (!parsed.data.staffId) {
    const gate = await staffAddAllowedWithClient(synqed, businessId, async () => {
      return (await staffListByBusinessOrThrow(businessId)).length
    })
    if (!gate.allowed) return ok(ctx, { error: 'STAFF_LIMIT_REACHED' })
  }

  const invitedBy = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  const result = await createInviteCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade', requestId: ctx.meta.requestId },
    invitedBy,
    parsed.data,
  )
  return ok(ctx, result, 'token' in result ? 201 : 200)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
