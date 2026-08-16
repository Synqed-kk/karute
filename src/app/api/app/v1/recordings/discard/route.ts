// Facade: file the DISCARD RECEIPT for a thrown-away take (recording-integrity
// PR A1). The device twin of the web discardRecordingReceipt action — both call
// the shared choke point discardRecordingWithClient (src/lib/recording/
// discard.ts, directive-free by design), so one discard writes
// exactly one recording.discard row (FACADE_AUDIT_MAP['recordings.discard'] is
// a deliberate 'skip' for that reason: the hook's generic on-2xx emit would
// both double-log AND be fire-and-forget, which a receipt may never be).
//
// Capability records.write (only recorders make takes to discard);
// revocation-sensitive (recordings.discard). No Idempotency-Key: this route's
// dedupe is SERVER-derived from recordingSessionId/takeId inside the choke
// point — a stronger key than a client-minted header, and one the A3 client
// wiring cannot forget to send.
//
// The response only reports success after the durable row landed (spec §3.6):
// a dropped write is a 502, never a 2xx with no receipt behind it.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { discardRecordingWithClient } from '@/lib/recording/discard'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.discard', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }

  const businessId = ctx.identity.businessId
  const result = await discardRecordingWithClient(
    newSynqedClient(businessId),
    {
      staffId: ctx.identity.authUserId,
      businessId,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    body,
  )

  if (!result.ok) {
    if (result.error === 'validation') {
      throw new AppApiError('validation', 'invalid discard payload')
    }
    // The chokepoint's own attribution guard — unreachable from here (Bearer
    // identity always carries both ids), mapped honestly rather than being
    // reported as an upstream failure if that ever stops being true.
    if (result.error === 'forbidden') {
      throw new AppApiError('forbidden', 'no staff identity for this receipt')
    }
    throw new AppApiError('upstream_unavailable', 'the discard receipt could not be recorded')
  }

  return ok(ctx, { receiptId: result.receiptId, duplicate: result.duplicate })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
