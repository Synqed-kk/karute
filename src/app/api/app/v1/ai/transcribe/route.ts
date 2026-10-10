// Facade twin of POST /api/ai/transcribe (packet 08 Decision 2, leg 2). Takes a
// STORAGE PATH (never a URL): the server verifies `path` is exactly a key minted
// for `identity.businessId` — a cross-tenant path → not_found — then mints
// its OWN signed READ url, so the SSRF guard surface disappears by construction.
// Runs the shared transcription core with the org diarization toggle + the
// FACADE CALLER's OWN enrollment clip via selfStaffId (voice-isolation rule #401
// on the Bearer path — extra-eyes MANDATORY). Plan gate FIRST (F-A1); the AI
// ceiling is asked inside runMeteredTranscription, which also debits the minutes
// on the provider's answer (the spend wall); ⚖ the object is READ and never
// deleted (PR4). records.write; POST → revocation-sensitive (ai.transcribe).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { featureAllowedForBusiness } from '@/lib/subscription/feature-gate'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { createServiceClient } from '@/lib/supabase/service'
import {
  runMeteredTranscription,
  speakerIdMode,
  loadStaffReferenceForStaff,
} from '@/lib/ai/transcribe'
import { transcriptionReceiptSeverity } from '@/lib/ai/transcription-receipt'
import { TranscribeSchema } from '@/lib/app-api/record-schemas'
import { isOwnRecordingKey } from '@/lib/recording/key-grammar'
import { takeKeyHolder } from '@/lib/recording/take-binding'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { viewerAllowedStoreIds } from '@/lib/app-api/store-clamp'

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

  // TENANCY by construction: the object must be EXACTLY a key minted for THIS
  // business — matched positively against the shared grammar, so a traversal
  // body or a query suffix riding on this caller's own prefix is refused too.
  // Anything else is not_found before any signed-URL mint or Deepgram call.
  if (!isOwnRecordingKey(path, ctx.identity.businessId)) {
    throw new AppApiError('not_found', 'recording not found in this business')
  }

  // ⚖ AND NOTHING HERE DELETES IT (capture pipeline PR4). Every exit — plan
  // gate, rate limit, signed-URL failure, transcription failure, success — used
  // to remove the object in a `finally`, because the client staged a throwaway
  // copy for this one call. The path it is handed is the take's own FINALIZED
  // object now: the recording itself, which nothing in this app destroys.
  const supabase = createServiceClient()
  const synqed = newSynqedClient(ctx.identity.businessId)
  // Plan gate BEFORE the rate-limit consume (F-A1 ordering).
  if (!(await featureAllowedForBusiness(ctx.identity.businessId, 'aiKaruteGeneration'))) {
    throw new AppApiError('forbidden', 'aiKaruteGeneration plan required')
  }
  // ⚖ THE CEILING IS ASKED ONCE, INSIDE THE METER (the spend wall, 2026-09-08).
  // This route used to consume('transcribe') on this line; the meter consumes at
  // the provider call now, and two consumes per request would count the hourly
  // cap twice. facadeHandler still maps the classified rate_limited it throws
  // to the same 429 this line's refusal produced.

  const orgSettings = await orgSettingsWithClient(synqed).catch(() => null)
  const diarize = orgSettings?.speaker_diarization !== false
  const mode = speakerIdMode()
  // Voice-isolation: the FACADE CALLER's OWN enrollment clip (selfStaffId), never
  // another staffer's, never the roster.
  const selfStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const reference =
    mode === 'off' ? null : await loadStaffReferenceForStaff(orgSettings, selfStaffId)

  // ⚖ S46: the row names its recorder, before anything is signed (the
  // upload-url twin's actor). A colleague's take gets this door's existing
  // refusal; no row keeps today's answer.
  const pairHeld = holdsOwnerKeys(ctx.identity.capabilities)
  const holder = await takeKeyHolder(async () => synqed, path, parsed.data.recordingSessionId, async () => ({
    staffId: selfStaffId,
    businessId: ctx.identity.businessId,
    holdsOwnerKeys: pairHeld,
    allowedStoreIds: pairHeld
      ? await viewerAllowedStoreIds({
          synqed,
          authUserId: ctx.identity.authUserId,
          capabilities: ctx.identity.capabilities,
          selfStaffId,
        })
      : null,
  }))
  if (holder === 'foreign') throw new AppApiError('not_found', 'recording not found in this business')
  if (holder === 'unreadable') throw new AppApiError('upstream_unavailable', 'could not read the recording')

  // Mint our OWN signed READ url from the tenant-proven path.
  const { data: signed, error: signErr } = await supabase.storage
    .from('recordings')
    .createSignedUrl(path, 3600)
  if (signErr || !signed?.signedUrl) {
    throw new AppApiError('upstream_unavailable', 'could not read the recording')
  }

  // staffId: selfStaffId, already resolved above (voice reference) — never a
  // second lookup. This door names a storage path, never a customer, so the
  // meter carries no customerId. audioKey: the same tenant-proven path, so a
  // take this door (or any other) already paid for is answered from its memo.
  const { result, receipt } = await runMeteredTranscription(
    {
      synqed,
      businessId: ctx.identity.businessId,
      door: 'app',
      staffId: selfStaffId,
      audioKey: path,
    },
    {
      audio: { url: signed.signedUrl },
      locale: parsed.data.locale === 'en' ? 'en' : 'ja',
      diarize,
      reference,
      mode,
      // Deepgram keyterm prompting (a85b6bf6 fold) — same derivation as the web
      // route, from the identity-threaded org settings.
      businessType: orgSettings?.business_type ?? null,
    },
  )
  // The spend wall's numbers ride the hook's OWN recording.transcribe row
  // (FACADE_AUDIT_MAP['ai.transcribe']) rather than a second one from the
  // meter: one call, one receipt. Six keys with staff_id (PR-5 added
  // `replayed`) — seven on a replay that left an owed true-up to the lease's
  // holder (S57, `debit_deferred_reason`), or seven on a call whose true-up
  // marker would not land (S58, `debit_mark`; the two never co-occur) — still
  // inside the hook's cap of 8. The receipt is server-side only — the client is
  // answered with `result`, the provider body, exactly as before.
  // staff_id: selfStaffId, already resolved above — never a second lookup.
  // This door names a storage path, never a customer, so no customer_id key.
  ctx.auditDetail = { ...receipt, ...(selfStaffId ? { staff_id: selfStaffId } : {}) }
  // Severity: the meter's ONE rule (S57) — a lease-busy replay is filed soft,
  // never as a lost debit.
  const severity = transcriptionReceiptSeverity(receipt)
  if (severity) ctx.auditSeverity = severity
  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
