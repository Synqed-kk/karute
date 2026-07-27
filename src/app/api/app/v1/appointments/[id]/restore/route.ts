// Facade: restore (un-cancel) a booking (design-parity P-B 2/2). Single-
// source with the web action via restoreAppointmentCore — the only-terminal
// precondition and the status-only contract (a restore NEVER unburns a
// ticket) live in the core. RPC-style response, verbatim action shape.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
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

  const result = await restoreAppointmentCore(synqed, id, actingStaffId, {
    actorId: ctx.identity.authUserId,
    businessId,
    source: 'facade',
    requestId: ctx.meta.requestId,
  })
  return ok(ctx, result)
})

export const OPTIONS = POST
