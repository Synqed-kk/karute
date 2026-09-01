// Facade: ＋新規カルテ manual create — the phone arm's twin of the web
// createManualKaruteRecord() action, calling the SAME shared body
// (createManualKaruteRecordWithClient) so the two doors cannot drift. The P-B
// pattern of the 新規顧客 pair (#810). The karute tree had save/window/reveal
// but no MANUAL create door, which is why the thin port was a soft stub.
//
// Gate 'records.write' + the other-staff 'records.delete' escalation: both are
// the web action's own predicates, re-checked here. Assigning to YOURSELF is
// always fine; an unresolvable self staff id fails closed (karute/route.ts's
// attribution rule). Idempotency-Key required — a durable create, so a retry
// on a flaky phone connection must not mint a second カルテ.
//
// ⚖ STORE ISOLATION LAW: the store comes from the BEARER clamp
// (resolveStoreForRequest) and NOTHING else — the two guards and which one is
// load-bearing are documented on the shared body itself. Web parity: the
// action's resolveKaruteStoreId(synqed, null) reads the cookie's active store;
// the clamp is the Bearer equivalent, as karute/reveal documents.
//
// NO consent gate, deliberately — unlike karute/route.ts (save), which needs
// one because it persists a RECORDING's transcript. A manual card has no
// transcript and the web action has no such gate; adding one would make the
// phone refuse work web accepts.
//
// audit + revocation: 'karute.manualCreate' is a LIVE FACADE_AUDIT_MAP mutation
// row (see that entry for why a row is safe here but not for karute.save) and
// is registered in REVOCATION_SENSITIVE_ENDPOINTS. No path param → the target
// comes from ctx.auditTargetId.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { ManualKaruteCreateSchema } from '@/lib/app-api/record-schemas'
import { createManualKaruteRecordWithClient } from '@/actions/karute'
import type { SynqedClient } from '@synqed-kk/client'

export const runtime = 'nodejs'

/** The wire shape, parsed at the door — the audit-log/破棄の記録 convention: a
 *  rename inside the shared body would otherwise reach a baked phone silently.
 *  Deliberately NOT inside a try/catch: a shape drift here is OUR bug (500),
 *  never an upstream outage (502). */
const ManualKaruteCreatedDTO = z.object({ id: z.string() })

export const POST = facadeHandler('karute.manualCreate', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = ManualKaruteCreateSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }
  const input = parsed.data

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Store clamp (403 store_forbidden) before any write — same order as the
  // save sibling.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  // Tenancy proof FIRST — cross-tenant/missing customerId → 404, upstream →
  // 502, BEFORE any write. karute/route.ts's own rule; the web action gets
  // this for free from its cookie-scoped client, a Bearer door must prove it.
  await readCustomerRaw(synqed, input.customerId)

  // Attribution + the supervisory escalation, mirroring the web action.
  const ownStaffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  if (!ownStaffId) {
    throw new AppApiError('forbidden', 'no staff identity for the signed-in user')
  }
  if (input.staffId !== ownStaffId && !ctx.identity.capabilities.has('records.delete')) {
    // Same refusal the web action returns, kept as a literal on each door:
    // facade-core-updatetag-ban.test.ts requires route imports from an action
    // file to be FUNCTION cores, and neither string ever reaches the user (the
    // dialog swaps in its own generic copy).
    throw new AppApiError('forbidden', 'You do not have permission to record a session for another staff member.')
  }

  const result = await createManualKaruteRecordWithClient(
    synqed as unknown as SynqedClient,
    {
      customerId: input.customerId,
      staffId: input.staffId,
      // ⚖ The clamp's store — never input's, which cannot carry one.
      storeId: clamp.storeId,
      sessionDate: input.sessionDate,
      durationMinutes: input.durationMinutes,
      service: input.service,
    },
  )
  if ('error' in result) {
    // Unlike the 新規顧客 sibling's inherited 400-vs-502 conflation, this body's
    // { error } can ONLY be a core write failure: the shape rejection already
    // happened at the door above. So it maps honestly to 502, not 400.
    throw new AppApiError('upstream_unavailable', result.error)
  }

  ctx.auditTargetId = result.id
  return ok(ctx, ManualKaruteCreatedDTO.parse(result), 201)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
