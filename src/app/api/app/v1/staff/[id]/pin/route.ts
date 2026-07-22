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
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { setStaffPinCore, removeStaffPinCore } from '@/actions/staff-pin'

export const runtime = 'nodejs'

type Params = { id: string }

const SetPinBody = z.object({ pin: z.string() })

export const PUT = facadeHandler<Params>('staff.setPin', async (ctx) => {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

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

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const actingStaffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)

  const result = await setStaffPinCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade' },
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

  const result = await removeStaffPinCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade' },
    id,
    actingStaffId,
  )
  return ok(ctx, result)
})

export const OPTIONS = PUT // facadeHandler short-circuits OPTIONS before auth.
