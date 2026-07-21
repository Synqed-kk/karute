// Facade: staff update + delete (design-parity packet 12 §S4a). Single-
// source: both routes call the SAME cores the web actions call
// (updateStaffCore / deleteStaffCore, src/actions/staff.ts).
//
// Gate: 'staff.manage' for both — matches web's own can('staff.manage')
// gate on updateStaff/deleteStaff. Owner-target protection lives INSIDE
// deleteStaffCore/updateStaffCore's own profile-vs-synqed branching + the
// synqed SDK's own last-member/attributed-records guard (identical to web —
// the UI also just hides the delete control for the owner row).
//
// Business-result passthrough: updateStaffCore/deleteStaffCore's own
// { ok: true } | { error } result rides the 2xx body VERBATIM — same
// RPC-style class as stores.update/org-settings PATCH. deleteStaffCore's
// 400-guard { error } (last-member / attributed-records) is the SDK's own
// already-localized message, same as web.
//
// No Idempotency-Key: PATCH is a field-level overwrite and DELETE is
// naturally idempotent (a repeat delete on an already-gone id is treated as
// success by the core), same class as customer PATCH / stores PATCH.
//
// audit: both cores emit their own row (staff.update / staff.remove) — see
// the FACADE_AUDIT_MAP 'skip' rows for 'staff.update' / 'staff.delete'
// (src/lib/audit.ts).
//
// revocation: 'staff.update' and 'staff.delete' are facade WRITEs and were
// already pre-registered in REVOCATION_SENSITIVE_ENDPOINTS
// (src/lib/auth/revocation.ts) before this packet.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { SynqedError } from '@synqed-kk/client'
import { updateStaffCore, deleteStaffCore } from '@/actions/staff'
import { staffProfileSchema } from '@/lib/validations/staff'

/** Only core's REAL not-found maps to 404 (an unknown/foreign staff id is a
 *  permanent failure the client must not retry); everything else stays 502 —
 *  the same classification the customer routes adopted after #486's review
 *  round (classifyCustomerLookupError). deleteStaffCore never rethrows a 404
 *  (already-gone = success, web parity), so this applies to PATCH only. */
function classifyStaffWriteError(err: unknown): AppApiError {
  if (err instanceof AppApiError) return err
  if (err instanceof SynqedError && err.status === 404) {
    return new AppApiError('not_found', 'staff not found in this business')
  }
  return new AppApiError('upstream_unavailable', 'staff update failed')
}

export const runtime = 'nodejs'

type Params = { id: string }

export const PATCH = facadeHandler<Params>('staff.update', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

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
  try {
    const result = await updateStaffCore(
      synqed,
      businessId,
      { actorId: ctx.identity.authUserId, source: 'facade' },
      id,
      parsed.data,
    )
    return ok(ctx, result)
  } catch (err) {
    throw classifyStaffWriteError(err)
  }
})

export const DELETE = facadeHandler<Params>('staff.delete', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  try {
    const result = await deleteStaffCore(
      synqed,
      businessId,
      { actorId: ctx.identity.authUserId, source: 'facade' },
      id,
    )
    return ok(ctx, result)
  } catch {
    throw new AppApiError('upstream_unavailable', 'staff deletion failed')
  }
})

export const OPTIONS = PATCH // facadeHandler short-circuits OPTIONS before auth.
