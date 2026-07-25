// Facade: SAVE a karute record (packet 08 Decision 3) — ONE route serving BOTH
// web save flavors (the thin port maps saveKaruteRecordInline → this POST, and
// saveKaruteRecord → this POST then a client-side navigate). Server order:
// capability records.write → tenancy proof → CONSENT GATE (fail-closed) → staff
// attribution (selfStaffId first, appointment fallback) → store id → the shared
// idempotent createOrUpdateKaruteRecord (the recording_session_id dedupe is the
// SECOND idempotency layer) → best-effort outcome + memory ingest. Idempotency-Key
// REQUIRED; revocation-sensitive (karute.save). Transcript/entries/summary are
// CLIENT-SUPPLIED by design — the client is the ORIGINATION point of the take.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { SaveKaruteSchema } from '@/lib/app-api/record-schemas'
import { isConsentCurrent, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { createOrUpdateKaruteRecord } from '@/actions/karute'
import { setKaruteOutcomeWithClient } from '@/lib/karute/outcome'
import { ingestSessionMemory } from '@/lib/karute/memory-ingest'
import type { SynqedClient, Appointment } from '@synqed-kk/client'

export const runtime = 'nodejs'

type EntryCat =
  | 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE'
  | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER'

/** Store for the write — the booking's store (authz-clamped against the caller's
 *  header-resolved assignment) or the clamp's active store. Mirrors the web
 *  resolveKaruteStoreId with the facade clamp instead of the cookie scope. */
async function resolveSaveStore(
  synqed: Pick<SynqedClient, 'appointments'>,
  appointmentId: string | null | undefined,
  fetchedAppt: Appointment | null,
  clamp: { storeId: string | null; allowedStoreIds: string[] | null },
): Promise<string | null> {
  if (appointmentId) {
    const appt = fetchedAppt ?? (await synqed.appointments.get(appointmentId).catch(() => null))
    const apptStore = (appt as { store_id?: string | null } | null)?.store_id ?? null
    if (apptStore && clamp.allowedStoreIds && !clamp.allowedStoreIds.includes(apptStore)) {
      throw new AppApiError('store_forbidden', 'this booking belongs to a store you are not assigned to')
    }
    return apptStore
  }
  return clamp.storeId
}

export const POST = facadeHandler('karute.save', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')
  requireIdempotencyKey(ctx.req)

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = SaveKaruteSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }
  const input = parsed.data

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Store clamp (403 store_forbidden) before any write.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  // Tenancy proof FIRST — cross-tenant/missing customerId → 404, upstream → 502,
  // BEFORE the consent read or any write.
  await readCustomerRaw(synqed, input.customerId)

  // CONSENT GATE, fail-closed: a record never persists for a customer whose
  // recording consent isn't CURRENT. An UNREADABLE consent REJECTS (never
  // bypasses) — mapped to the same stable CONSENT_REQUIRED_ERROR the thin
  // ReviewScreen matches to re-prompt the consent dialog.
  let consentOk = false
  try {
    const { consent } = await synqed.customers.getConsent(input.customerId)
    consentOk = isConsentCurrent(consent)
  } catch {
    consentOk = false // unreadable → fail closed
  }
  if (!consentOk) {
    throw new AppApiError('forbidden', CONSENT_REQUIRED_ERROR, { reason: 'CONSENT_REQUIRED' })
  }

  // Attribution: selfStaffId first, appointment-staff fallback (web parity);
  // unresolvable → 403-class.
  let staffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  let fetchedAppt: Appointment | null = null
  if (!staffId && input.appointmentId) {
    fetchedAppt = (await synqed.appointments.get(input.appointmentId).catch(() => null)) as Appointment | null
    staffId = (fetchedAppt as { staff_id?: string | null } | null)?.staff_id ?? null
  }
  if (!staffId) {
    throw new AppApiError('forbidden', 'no staff identity for the signed-in user')
  }

  const storeId = await resolveSaveStore(synqed, input.appointmentId, fetchedAppt, clamp)

  const { id, fresh, transcriptChanged } = await createOrUpdateKaruteRecord(
    synqed as unknown as SynqedClient,
    {
      customer_id: input.customerId,
      store_id: storeId,
      staff_id: staffId,
      appointment_id: input.appointmentId ?? null,
      recording_session_id: input.recordingSessionId ?? null,
      transcript: input.transcript,
      ai_summary: input.summary,
      entries: input.entries.map((entry) => ({
        category: entry.category.toUpperCase() as EntryCat,
        content: entry.content,
        original_quote: entry.sourceQuote ?? null,
        confidence: entry.confidenceScore,
        is_manual: entry.isManual ?? false,
      })),
    },
    { actorId: ctx.identity.authUserId, businessId, source: 'facade' },
    input.entriesMode,
  )

  // Best-effort outcome (the coaching label) — never gate the save on it.
  if (input.outcome) {
    await setKaruteOutcomeWithClient(synqed, {
      karuteRecordId: id,
      customerId: input.customerId,
      status: input.outcome.status,
      reason: input.outcome.reason ?? null,
      isFirstVisit: input.outcome.isFirstVisit,
      decidedBy: staffId,
    })
  }

  // Best-effort memory ingest — identity-threaded gate (businessId); fresh saves
  // or edited-transcript retries only. Never throws.
  if (fresh || transcriptChanged) {
    await ingestSessionMemory({
      customerId: input.customerId,
      businessId,
      transcript: input.transcript,
      locale: new URL(ctx.req.url).searchParams.get('locale') === 'en' ? 'en' : 'ja',
      sessionDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    })
  }

  return ok(ctx, { id })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
