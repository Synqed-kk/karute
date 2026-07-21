// Facade: per-staff store assignment read + write (design-parity packet 12
// §S4a). Single-source: both routes call the SAME cores the web actions call
// (getStaffStoresWithClient / setStaffStoresCore, src/actions/stores.ts).
//
// GET gate: web's own getStaffStores() has NO gate at all (stores.ts:457) —
// this facade adds an ensureCapability('staff.manage') floor, a DELIBERATE
// DIVERGENCE from web (same least-privilege posture the S1 voice_enrollments
// read and the S2 stores.list GET already established for new facade-only
// surfaces). No UI delta: StaffForm only ever calls this under
// canManageStaff, so nothing that already works on web starts failing.
//
// PUT gate: requireOwner MIRROR (stores.ts:474-479, roster
// display_role==='owner') — STRICTER than staff.manage, kept as-is (RBAC
// upgrade to settings.manage would apply here too when it lands, same as
// createStoreCore/updateStoreCore). The owner check lives INSIDE
// setStaffStoresCore; a non-owner denial (STORE_OWNER_DENIAL) is elevated to
// a standard facade 403 here, matching the stores POST/PATCH routes'
// convention — no separate ensureCapability call on the PUT.
//
// Business-result passthrough: setStaffStoresCore's own { ok: true } |
// { error } rides the 2xx body VERBATIM for every OTHER error, same
// RPC-style class as stores.update.
//
// audit: setStaffStoresCore emits settings.staff_stores_change itself — see
// the FACADE_AUDIT_MAP 'skip' row for 'staffStores.set' (src/lib/audit.ts).
//
// revocation: 'staffStores.set' is a facade WRITE → in
// REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts) — one of the
// two keys this packet's S1 facts block flagged as MISSING. The GET stays
// OUT (a pure read, same posture as every other non-sensitive GET).

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { getStaffStoresWithClient, setStaffStoresCore } from '@/actions/stores'
import { STORE_OWNER_DENIAL } from '@/lib/validations/store'

export const runtime = 'nodejs'

type Params = { id: string }

const SetStoresBody = z.object({
  storeIds: z.array(z.string()),
})

export const GET = facadeHandler<Params>('staffStores.get', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

  const synqed = newSynqedClient(ctx.identity.businessId)
  const storeIds = await getStaffStoresWithClient(synqed, id)
  return ok(ctx, { storeIds })
})

export const PUT = facadeHandler<Params>('staffStores.set', async (ctx) => {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = SetStoresBody.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((i) => i.message).join(', '))
  }

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const staffList = await staffListByBusinessOrThrow(businessId)

  const result = await setStaffStoresCore(
    synqed,
    businessId,
    { staffList, selfUserId: ctx.identity.authUserId, source: 'facade' },
    id,
    parsed.data.storeIds,
  )
  if ('error' in result && result.error === STORE_OWNER_DENIAL) {
    throw new AppApiError('forbidden', result.error)
  }
  return ok(ctx, result)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
