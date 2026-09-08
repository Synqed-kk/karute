// Facade: "this take is complete" (capture pipeline PR2). The device twin of
// the web finalizeTake action — both call the shared choke point
// (lib/recording/finalize-take.ts#finalizeTakeWithClient), so one finalize
// writes exactly one audio pointer and at most one recording.capture_finalized
// row. FACADE_AUDIT_MAP['recordings.finalize'] is a deliberate 'skip' for that
// reason: the generic on-2xx hook would emit for the SOFT refusals this route
// returns in a 2xx body (object_missing, already-finalized), which is the
// success-only audit law's exact failure mode.
//
// Capability records.write (only recorders finalize takes); revocation-
// sensitive (recordings.finalize). NO Idempotency-Key, same as the discard
// sibling: the dedupe is SERVER-derived (the row's own audio_storage_path,
// read before write) — a stronger key than a client-minted header, and one the
// PR3 client wiring cannot forget to send.
//
// The body never carries a storage PATH. takeId + mimeType are re-composed
// into the key against the Bearer identity's own business, so a cross-tenant
// pointer cannot be named here at all.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { extractBearer } from '@/lib/app-api/identity'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { viewerAllowedStoreIds } from '@/lib/app-api/store-clamp'
import { FinalizeTakeSchema } from '@/lib/app-api/record-schemas'
import { finalizeTakeWithClient } from '@/lib/recording/finalize-take'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.finalize', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = FinalizeTakeSchema.safeParse(body)
  if (!parsed.success) throw new AppApiError('validation', 'invalid finalize payload')

  const synqed = newSynqedClient(ctx.identity.businessId, extractBearer(ctx.req))

  // ROSTER GATE — the half a capability check cannot carry (#566). The web
  // twin's getCurrentUserStaffId IS a roster-membership probe; ctx.identity
  // .authUserId carries no such proof, and the core would otherwise write a row
  // on behalf of a profile that is not on this business's roster.
  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  if (!staffId) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; nothing was written')
  }

  // Finalize still CHOOSES no store — it never mints a row; the mint does (see
  // the session twin). What it now needs is the caller's own store REACH.
  // ③ THE OWNER'S HAND REACHES ONLY WHERE THE PERSON CAN SEE. The Bearer twin
  // of web's viewerScopeForActs, and the same call the regenerate/relearn act
  // routes already make (karute/[id]/regenerate/route.ts). Resolved ONLY when
  // the pair is held: a recorder acting on her OWN session never reaches the
  // store leg, so an assignment blip must not cost her the take. It reads the
  // ASSIGNMENT, never the `store-id` header — a phone-set pin can neither
  // widen nor narrow the owner's hand.
  const callerHoldsOwnerKeys = holdsOwnerKeys(ctx.identity.capabilities)
  const allowedStoreIds = callerHoldsOwnerKeys
    ? await viewerAllowedStoreIds({
        synqed,
        authUserId: ctx.identity.authUserId,
        capabilities: ctx.identity.capabilities,
        selfStaffId: staffId,
      })
    : null

  const result = await finalizeTakeWithClient(
    synqed,
    {
      staffId,
      businessId: ctx.identity.businessId,
      holdsOwnerKeys: callerHoldsOwnerKeys,
      allowedStoreIds,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    parsed.data,
  )

  // The core's ONE security refusal leaves as a real 403 rather than riding out
  // in a 2xx where no error log or metric would ever see it.
  if ('error' in result && result.error === 'forbidden') {
    throw new AppApiError('forbidden', 'that recording session is not yours to finalize')
  }
  // Everything else IS the answer the client branches on (retry vs settle):
  // object_missing means the PUT has not landed and the drain tries again,
  // while not_reserved / superseded are TERMINAL — this key was never bound to
  // this row, and no retry can bind it now. not_found stays in this soft body
  // too (house pattern), unlike the mint twin's real 404: finalize confirms a
  // take the client already believes is bound, so "which of several terminal
  // reasons" is the same answer shape as every other refusal here.
  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
