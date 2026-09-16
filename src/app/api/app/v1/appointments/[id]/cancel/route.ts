// Facade: cancel a booking (design-parity P-B 2/2). Single-source with the
// web action via cancelAppointmentCore — reason vocabulary, the same-day-
// contact⇄burn pairing, the terminal guard, and the status-first/burn-last
// ordering all live in the core. RPC-style response: the MarkNoShowResult
// shape rides the 200 body VERBATIM ({ success, burnError? } | { error,
// code? }) — CancelBookingSheet branches on `code` and `burnError`, so an
// HTTP-normalized error would lose the discriminators the UI needs.
//
// STORE LOCK (⚖ Liam 2026-09-16): the core refuses an appointment outside
// this caller's store assignment BEFORE it mutates — byte-identically to a
// missing id, so the refusal is no existence oracle. The clamp resolved here
// is the same one the web action passes; the rule itself lives in the core,
// so neither transport can drift. The business-scoped client still fences the
// tenant on top.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { resolveWriteStoreScope } from '@/lib/app-api/store-clamp'
import { cancelAppointmentCore } from '@/lib/appointments/mutations'

export const runtime = 'nodejs'

type Params = { id: string }

const CancelSchema = z
  .object({
    reason: z.string().optional(),
    burnPack: z.boolean().optional(),
  })
  .strict()

export const POST = facadeHandler<Params>('appointment.cancel', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'bookings.manage')
  // Captured, not just presence-checked: the ticket burn inside the core
  // forwards it to core's redemption dedup (#69). No NEW protection here — a
  // cancel burn always has an appointment_id, which the DB's partial unique
  // index already dedupes — it keeps the two burn paths consistent.
  const idempotencyKey = requireIdempotencyKey(ctx.req)

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'appointment id is required')

  // Body is optional (a plain cancel sends none) — absent parses as {}.
  const raw = await ctx.req.text()
  let body: unknown = {}
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new AppApiError('validation', 'request body must be JSON')
    }
  }
  const parsed = CancelSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  // Best-effort audit stamp in core's staff-id space (the web action's
  // resolveActingStaffId posture): null = omitted, never blocking.
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

  const result = await cancelAppointmentCore(synqed, id, parsed.data, actingStaffId, {
    actorId: ctx.identity.authUserId,
    businessId,
    source: 'facade',
    requestId: ctx.meta.requestId,
    idempotencyKey,
  }, scope)
  return ok(ctx, result)
})

export const OPTIONS = POST
