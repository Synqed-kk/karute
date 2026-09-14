// Facade: the recorder's own SHARE TOGGLE for ONE karute's recording (⚖ Liam
// 2026-09-13 sharing law; 2026-09-14 design D6). The device twin of the web
// setRecordingShared() action, sharing the SAME body
// (setRecordingSharedWithClient, src/lib/recording/share.ts) so the two doors
// cannot answer the same karute differently, and one toggle files exactly
// one audit row.
//
// GATE: records.write, the same tier as the discard/finalize writers this
// door sits beside. REVOCATION-SENSITIVE (REVOCATION_SENSITIVE_ENDPOINTS) —
// a just-terminated staffer must not flip a share state on the local
// fast-path.
//
// audit: 'recordings.share' is a deliberate 'skip' in FACADE_AUDIT_MAP — the
// shared body alone knows whether a toggle actually WROTE anything (the
// idempotent no-op writes and audits nothing; the generic hook would emit on
// every 2xx, including that no-op).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { extractBearer } from '@/lib/app-api/identity'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { setRecordingSharedWithClient } from '@/lib/recording/share'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.share', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const b = body as { karuteId?: unknown; shared?: unknown } | null
  if (!b || typeof b.karuteId !== 'string' || !b.karuteId || typeof b.shared !== 'boolean') {
    throw new AppApiError('validation', 'karuteId (string) and shared (boolean) are required')
  }

  const businessId = ctx.identity.businessId
  let staffId: string | null
  try {
    staffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  } catch {
    // The roster read FAILED — we cannot say who is asking, so we do not
    // guess a null (which would read as "not the recorder" and refuse a
    // recorder her own toggle). 502 says we could not look — the same rule
    // the playback mint's route takes.
    throw new AppApiError('upstream_unavailable', 'the staff roster is unavailable')
  }

  const synqed = newSynqedClient(businessId, extractBearer(ctx.req))
  const result = await setRecordingSharedWithClient(
    synqed,
    {
      actorId: ctx.identity.authUserId,
      staffId,
      businessId,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    { karuteId: b.karuteId, shared: b.shared },
  )

  if ('error' in result) {
    if (result.error === 'forbidden') {
      throw new AppApiError('forbidden', "that recording is not this caller's to share")
    }
    if (result.error === 'not_found') throw new AppApiError('not_found', 'karute not found')
    // A genuinely distinct reason from `not_found` (the karute exists;
    // nothing to share hangs off it), but AppApiErrorCode carries no
    // separate wire code for it — the union stays closed. Same 404 status,
    // distinguished instead by `detail.reason`: errors.ts's errorBody
    // spreads `detail` directly into the JSON `error` object (handler.ts:169
    // → errors.ts:97-99), so the wire key is `error.reason`, a sibling of
    // `code`/`message` — not a nested `error.detail`. The port below reads
    // exactly that key.
    if (result.error === 'no_recording') {
      throw new AppApiError('not_found', 'no recording behind this karute', { reason: 'no_recording' })
    }
    throw new AppApiError('upstream_unavailable', 'the share could not be recorded')
  }

  return ok(ctx, { shared: result.shared })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
