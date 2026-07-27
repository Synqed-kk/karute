// Facade: create a booking (design-parity P-B 2/2). Single-source: the write
// runs through createAppointmentCore (the web action calls the same core) —
// hours validation, the never-NULL store landing, and the 409-overlap mapping
// all live there. RPC-style response: the web action's own result shape rides
// a 200/201 body verbatim ({ id } | { error }) so NewBookingDialog toasts the
// identical strings on both paths; HTTP statuses are reserved for the
// transport/security layers (401/403/400).
//
// Store lens: the store-id HEADER through resolveStoreForRequest — an
// out-of-scope store is a 403 (the facade's fail-closed posture; the web
// treats a stale cookie as unset because a cookie can go stale silently — an
// explicit header from the shell's switcher cannot). No header → the core's
// defaultBookingStore lands the booked staff's own store, same as web.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { resolveSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { validateAppointmentTime } from '@/lib/appointments'
import { createAppointmentCore } from '@/lib/appointments/mutations'

export const runtime = 'nodejs'

const CreateAppointmentSchema = z
  .object({
    staffProfileId: z.string().min(1),
    clientId: z.string().min(1),
    startTime: z.string().min(1),
    durationMinutes: z.number().int().positive(),
    tzOffsetMinutes: z.number().optional(),
    title: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict()

export const POST = facadeHandler('appointment.create', async (ctx) => {
  // Same gate as the web action (bookings.manage — every staff preset holds it).
  ensureCapability(ctx.identity.capabilities, 'bookings.manage')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = CreateAppointmentSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Header clamp before any write — 403 outside the caller's scope.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  // The dialog can only submit ROSTER staff; the facade enforces the same set
  // fail-closed (Greptile P1 on #566) — without this, the create-on-miss
  // resolver below would mint a synqed staff record for ANY profile id
  // (customer ids included) sent with bookings.manage.
  const roster = await staffListByBusinessOrThrow(businessId)
  if (!roster.some((s) => s.id === parsed.data.staffProfileId)) {
    throw new AppApiError(
      'validation',
      'staffProfileId is not a staff member of this business',
    )
  }

  // Validate hours BEFORE the resolver — the web action's own invariant:
  // resolveSynqedStaffId can CREATE a staff record on miss, and invalid input
  // must not leave that side effect behind. (The core re-validates; pure.)
  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const hoursError = await validateAppointmentTime(
    parsed.data,
    orgSettings?.operating_hours,
  )
  if (hoursError) return ok(ctx, { error: hoursError })

  // Profile → core staff id (create-on-miss, appointments FK to staff.id).
  // An unresolvable id returns the web action's own { error } string — the
  // dialog toasts it identically on both paths.
  let synqedStaffId: string
  try {
    synqedStaffId = await resolveSynqedStaffIdForBusiness(
      parsed.data.staffProfileId,
      businessId,
    )
  } catch (err) {
    return ok(ctx, { error: err instanceof Error ? err.message : 'Unknown error' })
  }

  const result = await createAppointmentCore(synqed, parsed.data, {
    synqedStaffId,
    preferredStoreId: clamp.storeId,
    operatingHours: orgSettings?.operating_hours,
    actor: { actorId: ctx.identity.authUserId, businessId, source: 'facade' },
  })
  return ok(ctx, result, 'id' in result ? 201 : 200)
})

export const OPTIONS = POST
