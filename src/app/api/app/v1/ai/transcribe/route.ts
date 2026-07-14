// Facade twin of POST /api/ai/transcribe (packet 08 Decision 2, leg 2). Takes a
// STORAGE PATH (never a URL): the server verifies `path` starts with
// `app_${identity.businessId}_` — a cross-tenant path → not_found — then mints
// its OWN signed READ url, so the SSRF guard surface disappears by construction.
// Runs the shared runTranscription core with the org diarization toggle + the
// FACADE CALLER's OWN enrollment clip via selfStaffId (voice-isolation rule #401
// on the Bearer path — extra-eyes MANDATORY). Plan gate BEFORE the rate-limit
// consume (F-A1); WithClient rate-limit; server-side object delete after
// transcription (parity). records.write; POST → revocation-sensitive (ai.transcribe).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { enforceAiRateLimitWithClient } from '@/lib/ai-rate-limit'
import { featureAllowedForBusiness } from '@/lib/subscription/feature-gate'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { createServiceClient } from '@/lib/supabase/service'
import {
  runTranscription,
  speakerIdMode,
  loadStaffReferenceForStaff,
} from '@/lib/ai/transcribe'
import { TranscribeSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'
export const maxDuration = 300

export const POST = facadeHandler('ai.transcribe', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = TranscribeSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }
  const { path } = parsed.data

  // TENANCY by construction: the object must live under THIS business's prefix —
  // a cross-tenant path is not_found before any signed-URL mint or Deepgram call.
  if (!path.startsWith(`app_${ctx.identity.businessId}_`)) {
    throw new AppApiError('not_found', 'recording not found in this business')
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  // Plan gate BEFORE the rate-limit consume (F-A1 ordering).
  if (!(await featureAllowedForBusiness(ctx.identity.businessId, 'aiKaruteGeneration'))) {
    throw new AppApiError('forbidden', 'aiKaruteGeneration plan required')
  }
  await enforceAiRateLimitWithClient(synqed, 'transcribe')

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const diarize = orgSettings?.speaker_diarization !== false
  const mode = speakerIdMode()
  // Voice-isolation: the FACADE CALLER's OWN enrollment clip (selfStaffId), never
  // another staffer's, never the roster.
  const selfStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const reference =
    mode === 'off' ? null : await loadStaffReferenceForStaff(orgSettings, selfStaffId)

  // Mint our OWN signed READ url from the tenant-proven path.
  const supabase = createServiceClient()
  const { data: signed, error: signErr } = await supabase.storage
    .from('recordings')
    .createSignedUrl(path, 3600)
  if (signErr || !signed?.signedUrl) {
    throw new AppApiError('upstream_unavailable', 'could not read the recording')
  }

  const result = await runTranscription({
    audio: { url: signed.signedUrl },
    locale: parsed.data.locale === 'en' ? 'en' : 'ja',
    diarize,
    reference,
    mode,
  })

  // Server-side delete after transcription (parity with the web flow, which
  // removes the object once Deepgram has read it).
  await supabase.storage
    .from('recordings')
    .remove([path])
    .catch(() => {})

  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
