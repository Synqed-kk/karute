// Facade: "the recorder was shown the at-risk notice" (recording hole PR-7).
// The device twin of the web recordCaptureWarning action — both call the shared
// choke point (lib/recording/capture-warning.ts#recordCaptureWarningWithClient),
// so one raise files exactly one recording.capture_warned row.
// FACADE_AUDIT_MAP['recordings.captureWarning'] is a deliberate 'skip' for that
// reason, the finalize doctrine: the choke point alone knows whether a row was
// filed.
//
// Capability records.write (only recorders raise it); revocation-sensitive
// (recordings.captureWarning) like every facade write. Inert until the phone
// calls it (PR-6).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { extractBearer } from '@/lib/app-api/identity'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { CaptureWarningSchema } from '@/lib/app-api/record-schemas'
import { recordCaptureWarningWithClient } from '@/lib/recording/capture-warning'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.captureWarning', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = CaptureWarningSchema.safeParse(body)
  if (!parsed.success) throw new AppApiError('validation', 'invalid capture warning payload')

  const synqed = newSynqedClient(ctx.identity.businessId, extractBearer(ctx.req))

  // ROSTER GATE — same as the finalize twin (#566): a Bearer identity carries
  // no roster proof of its own.
  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  if (!staffId) {
    throw new AppApiError('forbidden', 'no acting staff identity for this user; nothing was written')
  }

  const result = await recordCaptureWarningWithClient(
    synqed,
    { staffId, businessId: ctx.identity.businessId, source: 'facade', requestId: ctx.meta.requestId },
    parsed.data,
  )

  // The security refusal leaves as a real 403 (finalize's rule); everything
  // else is the settled body the client branches on.
  if ('error' in result && result.error === 'forbidden') {
    throw new AppApiError('forbidden', 'that recording session is not yours')
  }
  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
