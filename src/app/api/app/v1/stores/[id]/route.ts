// Facade: 店舗 (store) update (design-parity packet 12 §B-3 S2). Single-
// source: calls the SAME updateStoreCore the web updateStore action calls.
//
// Owner gate lives INSIDE updateStoreCore (roster + resolved Bearer identity)
// — a non-owner denial is elevated to a standard facade 403 (throw → 403,
// matching the org-settings PATCH route's authz-boundary convention). Every
// other business-level { error } (validation, a core write failure — e.g. an
// unknown/out-of-tenant id) rides the 2xx body VERBATIM, same RPC-style class
// as the stores POST route and org-settings PATCH.
//
// No Idempotency-Key: a field-level overwrite (last-write-wins), same class
// as customer PATCH / org-settings PATCH — a retried update can't duplicate
// anything the way a retried create could.
//
// audit: updateStoreCore emits settings.store_update itself — see the
// FACADE_AUDIT_MAP 'skip' row for 'stores.update' (src/lib/audit.ts).
//
// revocation: 'stores.update' is a facade WRITE → in
// REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { updateStoreCore } from '@/actions/stores'
import { STORE_OWNER_DENIAL, type StoreInput } from '@/lib/validations/store'

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

  const result = await updateStoreCore(
    synqed,
    businessId,
    { staffList, selfUserId: ctx.identity.authUserId, source: 'facade', requestId: ctx.meta.requestId },
    id,
    body as StoreInput,
  )
  if ('error' in result && result.error === STORE_OWNER_DENIAL) {
    throw new AppApiError('forbidden', result.error)
  }
  return ok(ctx, result)
})

export const OPTIONS = PATCH // facadeHandler short-circuits OPTIONS before auth.
