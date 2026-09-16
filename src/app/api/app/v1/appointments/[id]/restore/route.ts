// Facade: restore (un-cancel) a booking (design-parity P-B 2/2). Single-
// source with the web action via restoreAppointmentCore — the only-terminal
// precondition and the status-only contract (a restore NEVER unburns a
// ticket) live in the core. RPC-style response, verbatim action shape.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { resolveWriteStoreScope } from '@/lib/app-api/store-clamp'
import { restoreAppointmentCore } from '@/lib/appointments/mutations'

export const runtime = 'nodejs'

type Params = { id: string }

export const POST = facadeHandler<Params>('appointment.restore', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'bookings.manage')
  requireIdempotencyKey(ctx.req)

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'appointment id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const actingStaffId = await lookupSynqedStaffIdForBusiness(
    ctx.identity.authUserId,
    businessId,
  ).catch(() => null)

  // STORE LOCK input (⚖ Liam 2026-09-16). requestedStoreId: null on purpose —
  // the ASSIGNMENT is the basis, so a phone-set store-id header can neither
  // widen nor narrow the refusal (viewerAllowedStoreIds' own rule). A failed
  // assignment lookup THROWS store_forbidden here, fail-closed, before the
  // core is reached.
  const scope = await resolveWriteStoreScope({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    // ⚖ fold round 2: the roster PLACEMENT is part of the scope now. Core
    // answers `{ store_ids: [] }` for an auth id it holds no staff row for,
    // so without this a caller the roster cannot place walks the lock as
    // floating — refused here instead, fail-closed.
    selfStaffId: await resolveSelfStaffId(businessId, ctx.identity.authUserId),
  })

  const result = await restoreAppointmentCore(synqed, id, actingStaffId, {
    actorId: ctx.identity.authUserId,
    businessId,
    source: 'facade',
    requestId: ctx.meta.requestId,
  }, scope)
  return ok(ctx, result)
})

export const OPTIONS = POST
