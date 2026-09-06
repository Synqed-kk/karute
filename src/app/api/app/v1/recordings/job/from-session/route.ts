// Facade: enqueue the recording→karute job against the audio the SERVER already
// holds for a session (build 23 slice ③). The phone twin of the web action
// enqueueRecordingJobFromSession; both call the one shared body
// (lib/recording/enqueue-from-session.ts), so the two doors cannot disagree
// about who may save a recording or where its bytes come from.
//
// WHAT MAKES IT A SEPARATE ROUTE from ../job: that one is handed an audioPath by
// the client that just uploaded it. Here nothing uploaded anything — the
// nightly assembler sealed a stranded take, or the phone finalized at stop and
// then died — so the path is DERIVED from the row and the schema refuses an
// audioPath key outright. There is no client-supplied storage key on this door
// at all, which is why it carries no isOwnRecordingKey fence: the fence exists
// for keys a caller can name, and a caller can name none.
//
// Capability records.write (only recorders save recordings); effectful write →
// Idempotency-Key + revocation-sensitive (recordings.job.enqueueFromSession) —
// a just-terminated staffer must not keep queuing jobs.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { extractBearer } from '@/lib/app-api/identity'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { resolveSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { RecordingJobFromSessionSchema } from '@/lib/app-api/record-schemas'
import { enqueueFromSessionWithClient } from '@/lib/recording/enqueue-from-session'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.job.enqueueFromSession', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = RecordingJobFromSessionSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = newSynqedClient(ctx.identity.businessId, extractBearer(ctx.req))

  // ROSTER GATE — the half a capability check cannot carry (#566), and the same
  // fail-closed posture as the ../job twin: the worker cannot attribute a record
  // with no staff, so this rejects rather than queueing an unattributable job.
  const selfStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  if (!selfStaffId) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; job not queued')
  }
  const jobStaffId = await resolveSynqedStaffIdForBusiness(
    selfStaffId,
    ctx.identity.businessId,
  ).catch(() => selfStaffId)

  // Store scope: the Bearer-path twin of the action's resolveStoreScope()
  // (cookie-only, unreachable here). No `store-id` header → the same
  // unset-cookie fallback shape, never a silent filter miss. OUTSIDE the shared
  // body on purpose — a store_forbidden throw must reach the client as 403.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  const result = await enqueueFromSessionWithClient(
    synqed,
    {
      staffId: selfStaffId,
      businessId: ctx.identity.businessId,
      holdsOwnerKeys: holdsOwnerKeys(ctx.identity.capabilities),
      source: 'facade',
      requestId: ctx.meta.requestId,
      jobStaffId,
      storeId: clamp.storeId,
    },
    { ...parsed.data, outcome: parsed.data.outcome ?? undefined },
  )

  // The refusals leave as real statuses rather than riding out in a 2xx where
  // no error log or metric would ever see them — this door has no soft-refusal
  // contract to keep (unlike finalize, whose client retries on the body).
  if ('error' in result) {
    if (result.error === 'forbidden') {
      throw new AppApiError('forbidden', 'that recording session is not yours to save')
    }
    if (result.error === 'not_found') {
      throw new AppApiError('not_found', 'recording not found in this business')
    }
    // A deliberate discard is a settled human decision, not a missing thing and
    // not a permission — 409, so a client can tell "somebody threw this away"
    // from "it is not yours" and from "it is not there".
    if (result.error === 'discarded') {
      throw new AppApiError('conflict', 'that recording was discarded by a staff member')
    }
    if (result.error === 'no_audio') {
      throw new AppApiError('not_found', 'the server does not hold this recording’s audio')
    }
    if (result.error === 'not_returning') {
      throw new AppApiError('validation', 'revisit requires a returning customer')
    }
    throw new AppApiError('upstream_unavailable', 'failed to enqueue the recording job')
  }

  void kickWorker(ctx.req)
  return ok(ctx, result)
})

/** Same-deployment worker kick as the ../job twin's — best-effort; the minutely
 *  cron is the safety net either way. Uses the request's own host. */
async function kickWorker(req: Request): Promise<void> {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) return
    const url = new URL(req.url)
    await fetch(`${url.protocol}//${url.host}/api/jobs/process`, {
      method: 'POST',
      headers: { 'x-worker-key': secret },
    })
  } catch {
    /* cron sweeps */
  }
}

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
