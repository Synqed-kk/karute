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
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { markNoShowAppointmentCore } from '@/lib/appointments/mutations'

export const runtime = 'nodejs'

type Params = { id: string }

const NoShowSchema = z.object({ burnPack: z.boolean() }).strict()

export const POST = facadeHandler<Params>('appointment.noShow', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'bookings.manage')
  // Captured, not just presence-checked: the ticket burn inside the core
  // forwards it to core's redemption dedup (#69). No NEW protection here — a
  // no-show burn always has an appointment_id, which the DB's partial unique
  // index already dedupes — it keeps the two burn paths consistent.
  const idempotencyKey = requireIdempotencyKey(ctx.req)

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

  // STORE LOCK input (⚖ Liam 2026-09-16). requestedStoreId: null on purpose —
  // the ASSIGNMENT is the basis, so a phone-set store-id header can neither
  // widen nor narrow the refusal (viewerAllowedStoreIds' own rule). A failed
  // assignment lookup THROWS store_forbidden here, fail-closed, before the
  // core is reached.
  const scope = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: null,
  })

  const result = await markNoShowAppointmentCore(synqed, id, parsed.data, actingStaffId, {
    actorId: ctx.identity.authUserId,
    businessId,
    source: 'facade',
    requestId: ctx.meta.requestId,
    idempotencyKey,
  }, scope)
  return ok(ctx, result)
})

export const OPTIONS = POST
