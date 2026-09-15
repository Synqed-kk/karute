// Facade: 営業時間 (per-store weekly hours) save — the phone door for 1c-D.
// Single-source: calls the SAME setStoreHoursCore the web setStoreHours action
// calls, so the two doors can never diverge on the seven-keys invariant, the
// open-before-close rule or the owner gate.
//
// Endpoint key: 'stores.update' — the sibling PATCH's key, reused deliberately.
// Both routes are the same classification in every mechanism that reads it:
// FACADE_AUDIT_MAP's 'skip' row (the core emits its own row — here
// settings.store_hours_update, there settings.store_update) and
// REVOCATION_SENSITIVE_ENDPOINTS' write entry. A second key would have to
// restate both, with nothing to distinguish them.
//
// Owner gate lives INSIDE setStoreHoursCore (roster + resolved Bearer
// identity) — a non-owner denial is elevated to a standard facade 403, the
// same convention the sibling stores PATCH uses. Every other business-level
// { error } (STORE_HOURS_WEEK_INCOMPLETE, STORE_HOURS_INVALID_WINDOW, a core
// write failure) rides the 2xx body VERBATIM, same RPC-style class.
//
// No Idempotency-Key: the whole week is overwritten last-write-wins, same
// class as the sibling stores PATCH — a retried save can't duplicate anything.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { setStoreHoursCore } from '@/actions/stores'
import { STORE_OWNER_DENIAL } from '@/lib/validations/store'

export const runtime = 'nodejs'

type Params = { id: string }

export const PATCH = facadeHandler<Params>('stores.update', async (ctx) => {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'store id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const staffList = await staffListByBusinessOrThrow(businessId)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }

  // The body IS the week ({ weekly_hours }), unwrapped here so the core only
  // ever sees the seven-weekday object — nothing else on the body can reach
  // core's policy row.
  const weeklyHours = (body as { weekly_hours?: unknown } | null)?.weekly_hours

  // core's acting_staff_id is CORE's staff-id space, NOT the token's profile
  // id — the Bearer-safe twin of the web door's resolveSynqedStaffId, and it
  // must never touch the cookie session. `null` refuses the save inside the
  // core (STORE_HOURS_ACTOR_UNRESOLVED); a profile id must never reach core.
  const actingStaffId = await lookupSynqedStaffIdForBusiness(
    ctx.identity.authUserId,
    businessId,
  ).catch(() => null)

  const result = await setStoreHoursCore(
    synqed,
    businessId,
    {
      staffList,
      selfUserId: ctx.identity.authUserId,
      actingStaffId,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    id,
    weeklyHours,
  )
  if ('error' in result && result.error === STORE_OWNER_DENIAL) {
    throw new AppApiError('forbidden', result.error)
  }
  return ok(ctx, result)
})

export const OPTIONS = PATCH // facadeHandler short-circuits OPTIONS before auth.
