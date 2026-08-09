// Facade: enqueue the server-side recording→karute job (packet 22 B2). The
// client half of Anthony's server worker handoff (karute #576 + core #53):
// after stageForJob uploads the audio, this mints the core job row so the
// worker (this repo's /api/jobs/process, or the minutely cron) picks it up.
// Same attribution rule as the web action (src/actions/recording-jobs.ts):
// staff is resolved SERVER-side from the confirmed Bearer identity, never
// accepted from the body (a spoofed staffId would misattribute the coaching
// record). Effectful write → Idempotency-Key + revocation-sensitive
// (recordings.job.enqueue) — a just-terminated staffer must not keep queuing
// jobs on the local fast-path.
//
// NOTE the web action stays UNTOUCHED (its cookie-scoped getCurrentUserStaffId
// / resolveStoreScope can't be parameterized without touching a live-proven
// path) — this route reproduces the SAME payload shape from Bearer-safe
// primitives (resolveSelfStaffId + resolveStoreForRequest), the split
// recordings.session.mint / customer.consent.grant already use.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { resolveSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { RecordingJobEnqueueSchema } from '@/lib/app-api/record-schemas'
import { isReturningCustomerServerSide } from '@/lib/karute/revisit-guard'
import type { RecordingJobPayload } from '@/lib/jobs/process-recording'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.job.enqueue', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = RecordingJobEnqueueSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  // Tenant-prefix gate — the SAME by-construction check the transcribe twin
  // enforces (ai/transcribe/route.ts): audioPath is a client-supplied storage
  // key that the worker later reads AND deletes via a service-role client (no
  // RLS). Without this, a Bearer staffer at business A could point the job at
  // business B's `app_${B}_*.webm` object → B's audio transcribed into an A
  // record, then B's file deleted. The upload-url facade only ever mints
  // `app_${businessId}_*`, so a path that doesn't carry this caller's prefix is
  // not theirs → not_found, before any job is queued.
  if (!parsed.data.audioPath.startsWith(`app_${ctx.identity.businessId}_`)) {
    throw new AppApiError('not_found', 'recording not found in this business')
  }

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Revisit eligibility at ENQUEUE, not in the worker: processJob writes the
  // outcome only after Deepgram + OpenAI have run, and a throw there would
  // re-spend both on every retry. Rejecting here makes the job path safe by
  // construction — the worker keeps its untouched best-effort write, and the
  // chokepoint in outcome.ts is still the backstop if one ever slips through.
  if (
    parsed.data.outcome?.status === 'revisit' &&
    !(await isReturningCustomerServerSide(synqed, parsed.data.customerId, {
      // A RETAKE reuses this recording session and converges on the same
      // record, so take-1's row must not make take-2 look like a regular.
      recordingSessionId: parsed.data.recordingSessionId,
    }))
  ) {
    throw new AppApiError('validation', 'revisit requires a returning customer')
  }

  // Fail closed: no acting staff id ⇒ no job (the #452 posture, same as
  // customer.consent.grant). The worker cannot attribute a record with no
  // staff, so this must reject rather than enqueue an unattributable job.
  const selfStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  if (!selfStaffId) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; job not queued')
  }
  const staffId = await resolveSynqedStaffIdForBusiness(
    selfStaffId,
    ctx.identity.businessId,
  ).catch(() => selfStaffId)

  // Store scope: the Bearer-path twin of the action's resolveStoreScope()
  // (cookie-only, unreachable here). No `store-id` header → the same
  // unset-cookie fallback shape (primary/first-assigned store), never a
  // silent filter miss.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  const payload: RecordingJobPayload = {
    customer_id: parsed.data.customerId,
    staff_id: staffId,
    appointment_id: parsed.data.appointmentId ?? null,
    store_id: clamp.storeId,
    audio_path: parsed.data.audioPath,
    locale: parsed.data.locale ?? 'ja',
    duration_seconds: parsed.data.durationSeconds,
    outcome: parsed.data.outcome ?? undefined,
  }

  try {
    const job = await synqed.recordingJobs.enqueue({
      recording_session_id: parsed.data.recordingSessionId,
      payload: payload as unknown as Record<string, unknown>,
    })
    void kickWorker(ctx.req)
    return ok(ctx, { ok: true, jobId: job.id, status: job.status })
  } catch (err) {
    console.error('[recordings.job.enqueue] failed:', err)
    throw new AppApiError('upstream_unavailable', 'failed to enqueue the recording job')
  }
})

/** Same-deployment worker kick as the web action's kickWorker (src/actions/
 *  recording-jobs.ts) — best-effort; the minutely cron is the safety net
 *  either way. Uses the request's own host (no next/headers here). */
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
