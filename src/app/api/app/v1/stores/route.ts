// Facade: 店舗 (stores) list + create (design-parity packet 12 §B-3 S2).
// Single-source: both routes call the SAME cores the web actions call
// (listStoresWithClient / createStoreCore, src/actions/stores.ts) — the P-B
// pattern this design-parity effort standardizes on.
//
// GET gate: 'stores.viewAll', a deliberate least-privilege divergence from
// web's ungated listStores() action — this is a NEW callable Bearer surface
// (web never exposed a stores endpoint over HTTP), and its only consumer is
// the viewAll-gated 店舗 tab (S1 voice_enrollments precedent: a facade-only
// surface may gate tighter than the web action it mirrors, since nothing on
// web reaches this route directly). listStoresWithClient's lazy 本店-create
// is shared with web via the twin (race-tolerant, no audit row) — a
// zero-store tenant is provisioned here exactly as it is on web, so the
// native 店舗 tab never has to fall back to a synthetic placeholder row
// (Greptile P1, PR #579: a fake 'primary' row was interactive with nothing
// real behind it).
//
// POST: owner gate lives INSIDE createStoreCore (roster + resolved Bearer
// identity, same predicate requireOwnerBusiness() applies on web) — a
// non-owner denial is elevated to a standard facade 403 here (throw → 403,
// NOT the web action's own soft { error } 200 — same authz-boundary
// convention as the org-settings PATCH route). Every other business-level
// { error } (STORE_LIMIT_REACHED, validation, business_type required, a core
// write failure) rides the 2xx body VERBATIM — RPC-style, same class as the
// org-settings PATCH / appointments statusCall precedent — because web
// itself treats those identically to a soft return, not an HTTP failure.
//
// audit: createStoreCore emits settings.store_create itself (ONE row, same
// core both paths call) — see the FACADE_AUDIT_MAP 'skip' row for
// 'stores.create' (src/lib/audit.ts): a facade audit rule here would
// double-log it.
//
// revocation: 'stores.create' is a facade WRITE, so it is in
// REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts) — a
// just-terminated staffer's Bearer token can't create a store on the local
// fast-path (the exhaustive coverage test enforces this for every write key).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey } from '@/lib/app-api/customer-facade'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listStoresWithClient, createStoreCore } from '@/actions/stores'
import { STORE_OWNER_DENIAL, type StoreInput } from '@/lib/validations/store'

export const runtime = 'nodejs'

export const GET = facadeHandler('stores.list', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'stores.viewAll')
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  try {
    const stores = await listStoresWithClient(synqed, businessId)
    return ok(ctx, { stores })
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'store list unavailable')
  }
})

export const POST = facadeHandler('stores.create', async (ctx) => {
  requireIdempotencyKey(ctx.req)
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const staffList = await staffListByBusinessOrThrow(businessId)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }

  const result = await createStoreCore(
    synqed,
    businessId,
    { staffList, selfUserId: ctx.identity.authUserId, source: 'facade' },
    body as StoreInput,
  )
  if ('error' in result && result.error === STORE_OWNER_DENIAL) {
    throw new AppApiError('forbidden', result.error)
  }
  return ok(ctx, result, 'id' in result ? 201 : 200)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
