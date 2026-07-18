// Facade: mint a recording_sessions row at record-start (packet 08 Decision 3).
// The facade twin of startRecordingSession — recorder-first attribution
// (selfStaffId) with the appointment-staff fallback, on the business-scoped
// client. Effectful row mint → Idempotency-Key REQUIRED (orphan rows stay the
// accepted degradation, packet-10 fact 3); records.write; revocation-sensitive
// (recordings.session.mint). Fail-OPEN contract (capture must NEVER block on
// the mint): like the web action, a genuine SDK failure is swallowed to
// { id: null } after logging — the mint core documents that callers swallow.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { startRecordingSessionWithClient } from '@/actions/recordings'
import { SessionMintSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.session.mint', async (ctx) => {
  // Recording a session = records.write (only recorders stage a session).
  ensureCapability(ctx.identity.capabilities, 'records.write')
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
  let result: { id: string } | null = null
  try {
    result = await startRecordingSessionWithClient(synqed, {
      customerId: parsed.data.customerId ?? null,
      appointmentId: parsed.data.appointmentId ?? null,
      selfStaffId,
    })
  } catch (err) {
    console.error('[recordings.session.mint] failed:', err)
  }
  return ok(ctx, { id: result?.id ?? null })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
