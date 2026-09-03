// Facade: mint a recording_sessions row at record-start (packet 08 Decision 3).
// The facade twin of startRecordingSession — recorder-first attribution
// (selfStaffId) with the appointment-staff fallback, on the business-scoped
// client. Effectful row mint → Idempotency-Key REQUIRED (orphan rows stay the
// accepted degradation, packet-10 fact 3); records.write; revocation-sensitive
// (recordings.session.mint). Fail-OPEN contract (capture must NEVER block on
// the mint): like the web action, a genuine SDK failure is swallowed to
// { id: null } after logging — the mint core documents that callers swallow.
//
// FIX ROUND 10 — BORN RESERVED. The body may now carry { takeId, mimeType }, and
// when it does the row is created WITH that take's storage key already on it
// (see startRecordingSessionWithClient for why one atomic create replaces the
// upload mint's update). That pair is the ONE thing here that is NOT fail-open:
// a take id or container this server will not store is a client error with a
// name, because a 200 {id:null} would tell the caller "carry on regardless"
// about a key it has to fix first. The tenant prefix the key carries comes from
// the VERIFIED Bearer identity, never from the body.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import {
  startRecordingSessionWithClient,
  type StartRecordingSessionResult,
} from '@/actions/recordings'
import { SessionMintSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.session.mint', async (ctx) => {
  // Recording a session = records.write (only recorders stage a session).
  ensureCapability(ctx.identity.capabilities, 'records.write')
  // UNCHANGED by fix round 10. Presence/format only: this route validates a
  // bounded key and discards it — it forwards nothing to core, unlike the money
  // paths that spend theirs (packs/redeem, cancel, no-show; see
  // karute/manual/route.ts's note for the same posture spelled out). What the
  // take pair adds is on the CLIENT's side: a retried start should carry the
  // key derived from its own takeId, so the retry is one act to the caller too.
  // The server cannot prove that and does not pretend to — a second start with
  // the same take composes the same storage key, and core's unique index is
  // what actually refuses the duplicate reservation.
  requireIdempotencyKey(ctx.req)

  // An empty/absent body is valid (walk-in with no ids yet) — but a non-empty
  // body that fails to parse is a client error, NOT a walk-in: silently minting
  // an unassociated session would drop the customer/appointment link the
  // caller tried to send.
  let body: unknown = {}
  const raw = await ctx.req.text()
  if (raw.trim() !== '') {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new AppApiError('validation', 'malformed JSON body')
    }
  }
  const parsed = SessionMintSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  const selfStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)

  // Fail-OPEN parity with the web action: a null mint (unresolvable staff) is
  // NOT an error, and a genuine SDK throw is swallowed to { id: null } too —
  // the client proceeds without dedupe, capture never blocks on the mint.
  let result: StartRecordingSessionResult = null
  try {
    result = await startRecordingSessionWithClient(synqed, {
      customerId: parsed.data.customerId ?? null,
      appointmentId: parsed.data.appointmentId ?? null,
      selfStaffId,
      // The VERIFIED tenant, never a body field — it is the prefix the composed
      // key carries, and therefore the whole fence on a service-role key.
      businessId: ctx.identity.businessId,
      takeId: parsed.data.takeId ?? null,
      mimeType: parsed.data.mimeType ?? null,
    })
  } catch (err) {
    console.error('[recordings.session.mint] failed:', err)
  }
  // Named, so the recorder can renegotiate its container rather than retry
  // blind. Checked OUTSIDE the try: an AppApiError thrown inside it would be
  // swallowed by the fail-open catch above and answered as a 200.
  if (result && 'error' in result) {
    throw new AppApiError('validation', result.error)
  }
  return ok(ctx, { id: result?.id ?? null })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
