// Facade: assign the staff of a booking that has none (PR-B, 担当未定).
// Single-source with the web action assignAppointmentStaff via
// assignStaffToBooking — the store lock, the terminal guard, the
// already-has-a-staff refusal and the staff check (active, this business, works
// at the booking's store) all live in the core, so neither transport can drift.
// Shape copied from the sibling cancel / no-show / restore routes: capability
// first, Idempotency-Key required, strict body, the store clamp resolved from
// the ASSIGNMENT, RPC-style 200 body ({ success } | { error }).

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { resolveSynqedStaffIdForBusiness, StaffProfileNotFoundError } from '@/lib/synqed/staff-map'
import { resolveWriteStoreScope } from '@/lib/app-api/store-clamp'
import { assignStaffToBooking, STAFF_NOT_ELIGIBLE } from '@/lib/appointments/mutations'

export const runtime = 'nodejs'

type Params = { id: string }

const AssignStaffSchema = z.object({ staffProfileId: z.string().min(1) }).strict()

export const POST = facadeHandler<Params>('appointment.assignStaff', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'bookings.manage')
  const idempotencyKey = requireIdempotencyKey(ctx.req)

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'appointment id is required')

  let body: unknown
  try {
    body = JSON.parse((await ctx.req.text()) || 'null')
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = AssignStaffSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  // STORE LOCK input — the same clamp cancel/no-show/restore resolve (see
  // cancel/route.ts): the assignment is the basis, never a phone header.
  const scope = await resolveWriteStoreScope({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    selfStaffId: await resolveSelfStaffId(businessId, ctx.identity.authUserId),
  })
  // The web action's resolveSynqedStaffId, Bearer-safe twin (same on-demand
  // creation of a core staff row; the core judges the resolved row).
  // An unknown profile, or one outside this business, makes the resolver
  // throw StaffProfileNotFoundError: that is the caller's bad input, so a 4xx
  // with the same refusal an ineligible staff gets. Every other throw (a core
  // 5xx, the network, a missing env) is rethrown as-is, so the facade answers
  // its usual 5xx — never a 400 "cannot take this booking". Nothing is written
  // either way.
  let staffId: string
  try {
    staffId = await resolveSynqedStaffIdForBusiness(parsed.data.staffProfileId, businessId)
  } catch (err) {
    if (err instanceof StaffProfileNotFoundError) {
      throw new AppApiError('validation', STAFF_NOT_ELIGIBLE)
    }
    throw err
  }

  const result = await assignStaffToBooking(
    synqed,
    id,
    staffId,
    {
      actorId: ctx.identity.authUserId,
      businessId,
      source: 'facade',
      requestId: ctx.meta.requestId,
      idempotencyKey,
    },
    scope,
  )
  return ok(ctx, result)
})

export const OPTIONS = POST
