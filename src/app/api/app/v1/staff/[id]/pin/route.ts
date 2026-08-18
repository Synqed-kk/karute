// Facade: staff PIN set + remove (design-parity packet 12 §S4b). Single-
// source: both routes call the SAME cores the web actions call
// (setStaffPinCore / removeStaffPinCore, src/actions/staff-pin.ts).
//
// Gate: web's own setStaffPin/removeStaffPin have NO local gate beyond
// "signed in" — synqed-core enforces self-or-owner/admin server-side from
// the `actingStaffId` argument (staff-pin.ts's own doc comment). The facade
// mirrors that exactly: NO ensureCapability call here. `actingStaffId` is
// derived from the Bearer identity's roster row (resolveSelfStaffId — the
// selfRow idiom every other facade route uses), NEVER read from the request
// — a caller cannot spoof who is "acting" to borrow an owner's authority.
//
// Business-result passthrough: both cores' own { error? } result rides the
// 2xx body VERBATIM (RPC-style, same class as stores.update/org-settings
// PATCH) — PinSetup branches on `result.error` exactly as it does against
// the web action. PIN values are never logged/echoed (audit rows carry ids
// only, matching setStaffPinCore).
//
// revocation: 'staff.setPin'/'staff.removePin' were already pre-registered
// in REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts) — PIN
// changes are a security-sensitive class from packet 01.

import { z } from 'zod'
import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { ensureStaffWriteInScope } from '@/lib/app-api/store-clamp'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { setStaffPinCore, removeStaffPinCore } from '@/actions/staff-pin'

export const runtime = 'nodejs'

type Params = { id: string }

const SetPinBody = z.object({ pin: z.string() })

/** The Bearer twin of nonSelfPinDenial (src/actions/staff-pin.ts). Self stays
 *  gate-free — that is the whole point of the "no ensureCapability floor"
 *  note above. A PIN write aimed at SOMEONE ELSE is a staff-management act:
 *  `staff.manage` plus the actor store clamp, before the core. A caller the
 *  roster can't place (`actingStaffId` null) is left to the cores' own
 *  refusal, which already fails closed before the SDK. */
async function assertNonSelfPinAllowed(
  ctx: FacadeContext<Params>,
  synqed: ReturnType<typeof newSynqedClient>,
  targetStaffId: string,
  actingStaffId: string | null,
): Promise<void> {
  if (!actingStaffId || targetStaffId === actingStaffId) return
  ensureCapability(ctx.identity.capabilities, 'staff.manage')
  await ensureStaffWriteInScope({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    targetStaffId,
  })
}

export const PUT = facadeHandler<Params>('staff.setPin', async (ctx) => {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const actingStaffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  // Before the body parse (#715's clamp-before-body-parse ordering): a caller
  // who may not touch this row never has their payload read.
  await assertNonSelfPinAllowed(ctx, synqed, id, actingStaffId)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = SetPinBody.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((i) => i.message).join(', '))
  }

  const result = await setStaffPinCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade', requestId: ctx.meta.requestId },
    id,
    parsed.data.pin,
    actingStaffId,
  )
  return ok(ctx, result)
})

export const DELETE = facadeHandler<Params>('staff.removePin', async (ctx) => {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const actingStaffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  await assertNonSelfPinAllowed(ctx, synqed, id, actingStaffId)

  const result = await removeStaffPinCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade', requestId: ctx.meta.requestId },
    id,
    actingStaffId,
  )
  return ok(ctx, result)
})

export const OPTIONS = PUT // facadeHandler short-circuits OPTIONS before auth.
