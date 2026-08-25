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
import {
  discardRecordingWithClient,
  discardRecordingWithReasonRow,
} from '@/lib/recording/discard'

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
  const actor = {
    staffId: ctx.identity.authUserId,
    businessId,
    source: 'facade' as const,
    requestId: ctx.meta.requestId,
  }
  // P5-A: a STAFF discard arrives carrying its written reason, and takes the
  // door that writes the core discard row before the receipt. Everything else
  // is the receipt-only shape. ONE endpoint either way — the phone and the web
  // page must not be able to drift into different discard semantics, and both
  // shapes are `.strict()`, so a body is never ambiguous about which it is.
  const synqed = newSynqedClient(businessId)
  const hasReason =
    typeof body === 'object' && body !== null && 'reason' in (body as Record<string, unknown>)
  const result = hasReason
    ? await discardRecordingWithReasonRow(synqed, actor, body)
    : await discardRecordingWithClient(synqed, actor, body)

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
    // Covers 'discard_row_failed' too — the reason row is the trace, so
    // losing it is exactly as fatal as losing the receipt.
    throw new AppApiError('upstream_unavailable', 'the discard could not be recorded')
  }

  return ok(ctx, { receiptId: result.receiptId, duplicate: result.duplicate })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
