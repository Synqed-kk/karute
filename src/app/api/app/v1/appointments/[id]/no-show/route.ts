// Facade: mark a booking NO_SHOW (design-parity P-B 2/2). Single-source with
// the web action via markNoShowAppointmentCore — the terminal guard, the ONE
// fixed 無断 reason, the FIFO burn target, and the status-first/burn-last
// money ordering all live in the core. RPC-style response, verbatim
// MarkNoShowResult body — the sheet branches on `code` and `burnError`.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { markNoShowAppointmentCore } from '@/lib/appointments/mutations'

export const runtime = 'nodejs'

type Params = { id: string }

const NoShowSchema = z.object({ burnPack: z.boolean() }).strict()

export const POST = facadeHandler<Params>('appointment.noShow', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'bookings.manage')
  requireIdempotencyKey(ctx.req)

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'appointment id is required')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = NoShowSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const actingStaffId = await lookupSynqedStaffIdForBusiness(
    ctx.identity.authUserId,
    businessId,
  ).catch(() => null)

  const result = await markNoShowAppointmentCore(synqed, id, parsed.data, actingStaffId, {
    actorId: ctx.identity.authUserId,
    businessId,
    source: 'facade',
  })
  return ok(ctx, result)
})

export const OPTIONS = POST
