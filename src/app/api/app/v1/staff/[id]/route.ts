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

import { revalidateTag } from 'next/cache'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { ensureStaffWriteInScope } from '@/lib/app-api/store-clamp'
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

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  // Actor store scope BEFORE the body is even read — a refused edit touches
  // nothing and never depends on the payload (the avatar route's ordering, and
  // web's clamp-before-parse). Outside the try below: its store_forbidden must
  // reach the client as 403, not be reclassified by classifyStaffWriteError.
  await ensureStaffWriteInScope({
    synqed,
    businessId,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    targetStaffId: id,
  })

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

  try {
    const result = await updateStaffCore(
      synqed,
      businessId,
      { actorId: ctx.identity.authUserId, source: 'facade', requestId: ctx.meta.requestId },
      id,
      parsed.data,
    )
    // Bust the roster caches the WEB pages read from ('staff-list' tags
    // staffListByBusiness + storeStaffIdSetForBusiness, both 86400s), so a
    // phone-side edit — the 経営メンバー toggle above all — isn't invisible on
    // web for a day. revalidateTag, NOT updateTag: updateTag is Server-Action-
    // only and throws inside a Route Handler, which is the whole point of
    // facade-core-updatetag-ban.test.ts. That is also why this lives on the
    // route and never inside updateStaffCore, which web calls too (web's own
    // action wrapper already fires updateTag on its side).
    //
    // ponytail: this route only. Every other facade write has the same stale-
    // cache gap; that sweep is parked deliberately, not forgotten.
    if ('ok' in result) revalidateTag('staff-list', 'max')
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
  // Outside the try for the same reason as PATCH — the catch below would
  // rewrite a store_forbidden into a 502.
  await ensureStaffWriteInScope({
    synqed,
    businessId,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    targetStaffId: id,
  })
  try {
    const result = await deleteStaffCore(
      synqed,
      businessId,
      { actorId: ctx.identity.authUserId, source: 'facade', requestId: ctx.meta.requestId },
      id,
    )
    return ok(ctx, result)
  } catch {
    throw new AppApiError('upstream_unavailable', 'staff deletion failed')
  }
})

export const OPTIONS = PATCH // facadeHandler short-circuits OPTIONS before auth.
