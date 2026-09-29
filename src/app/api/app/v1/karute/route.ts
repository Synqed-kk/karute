// Facade: SAVE a karute record (packet 08 Decision 3) — ONE route serving BOTH
// web save flavors (the thin port maps saveKaruteRecordInline → this POST, and
// saveKaruteRecord → this POST then a client-side navigate). Server order:
// capability records.write → tenancy proof → PLACEMENT/store lock (selfStaffId,
// fail-closed on an unplaceable caller — ⚖ 2026-09-19 fold) → CONSENT GATE
// (fail-closed) → store id → the shared idempotent createOrUpdateKaruteRecord
// (the recording_session_id dedupe is the SECOND idempotency layer) →
// best-effort outcome + memory ingest. Idempotency-Key REQUIRED;
// revocation-sensitive (karute.save). Transcript/entries/summary are
// CLIENT-SUPPLIED by design — the client is the ORIGINATION point of the take.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readCustomerRaw } from '@/lib/app-api/karute-facade'
import { resolveStoreForRequest, resolveWriteStoreScope } from '@/lib/app-api/store-clamp'
import { reachesNoStore, UNASSIGNED_STORE_DENIAL } from '@/lib/auth/store-gate'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { SaveKaruteSchema } from '@/lib/app-api/record-schemas'
import { isConsentCurrent, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { createOrUpdateKaruteRecord } from '@/lib/karute/karute.core'
import { durationMinutesFromSeconds } from '@/lib/karute/duration-minutes'
import { writeOutcomeFate, outcomeReply, type OutcomeLink } from '@/lib/karute/outcome-fate'
import { ingestSessionMemory } from '@/lib/karute/memory-ingest'
import {
  appointmentLinkOf,
  readAppointmentForSave,
  resolveAutoAppointmentLink,
  type AppointmentLinkReason,
  type AppointmentRead,
  type AutoAppointmentLink,
} from '@/lib/karute/appointment-link'
import type { SynqedClient, Appointment } from '@synqed-kk/client'

export const runtime = 'nodejs'

type EntryCat =
  | 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE'
  | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER'

/** Store + appointment link for the write — the booking's store (authz-clamped
 *  against the caller's header-resolved assignment) or the clamp's active
 *  store. Mirrors the web resolveKaruteStoreId with the facade clamp instead of
 *  the cookie scope, including its rule for a booking that cannot be used: the
 *  save lands in the caller's lens, never refused, never NULL-store — 404 and
 *  out-of-scope drop the link (identical to the caller, so no existence
 *  oracle), an unreadable booking keeps it; `linkReason` names which. */
async function resolveSaveStore(
  synqed: Pick<SynqedClient, 'appointments'>,
  appointmentId: string | null | undefined,
  fetchedAppt: Appointment | null,
  clamp: { storeId: string | null; allowedStoreIds: string[] | null; degraded?: boolean },
): Promise<{
  storeId: string | null
  appointment: Appointment | null
  appointmentId: string | null
  linkReason: AppointmentLinkReason | null
}> {
  if (clamp.degraded) throw new AppApiError('store_forbidden', STORE_SCOPE_UNVERIFIED)
  if (reachesNoStore(clamp)) {
    throw new AppApiError('store_forbidden', UNASSIGNED_STORE_DENIAL)
  }

  // Web-parity: also hands back the read appointment so the save can copy
  // the booked menu (service) into the record without a second fetch.
  if (appointmentId) {
    const read: AppointmentRead = fetchedAppt
      ? { appointment: fetchedAppt, state: 'ok' }
      : await readAppointmentForSave(synqed.appointments, appointmentId)
    if (read.state !== 'ok') {
      // 404 → the id is a lie, drop it; unreadable → keep it for a re-stamp.
      return read.state === 'not_found'
        ? { storeId: clamp.storeId, appointment: null, appointmentId: null, linkReason: 'appointment_not_found' }
        : { storeId: clamp.storeId, appointment: null, appointmentId, linkReason: 'appointment_unreadable' }
    }
    const apptStore = (read.appointment as { store_id?: string | null }).store_id ?? null
    if (apptStore && clamp.allowedStoreIds && !clamp.allowedStoreIds.includes(apptStore)) {
      return { storeId: clamp.storeId, appointment: null, appointmentId: null, linkReason: 'appointment_out_of_scope' }
    }
    return { storeId: apptStore, appointment: read.appointment, appointmentId, linkReason: null }
  }
  // No linked booking: the record's store is the caller's verified lens.
  return { storeId: clamp.storeId, appointment: null, appointmentId: null, linkReason: null }
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

  // PLACEMENT FIRST (⚖ 2026-09-19 fold, Greptile finding 1): establish WHO the
  // caller is and whether the roster can place them BEFORE anything is read on
  // their behalf. The old order read consent, then fell back to an
  // appointment's staff id when the roster couldn't place the caller, then hit
  // the store lock last — so an unplaceable Bearer caller got a DIFFERENT
  // refusal for an appointmentId that existed vs one that didn't, an existence
  // oracle. Now the roster placement + store lock run first, so every
  // unplaceable caller gets the ONE answer below whatever ids they sent, and
  // no consent/appointment read ever runs for them.
  const selfStaffId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)
  if (!selfStaffId) {
    // resolveWriteStoreScope below throws this exact same answer for a null
    // selfStaffId; checked here too so it fires before the consent read, and
    // so `staffId` below is provably a string rather than string | null.
    throw new AppApiError('store_forbidden', STORE_SCOPE_UNVERIFIED)
  }
  // The converge branch's store lock scope — the same shape every other karute
  // facade write door passes (outcome / summary / entries): the ASSIGNMENT is the
  // basis, so the store-id header can neither widen nor narrow it, and an
  // unplaceable caller is refused rather than read as floating (⚖ fold round 2).
  // Deliberately NOT the `clamp` above: that one carries the header pin because
  // it also decides where a walk-in karute is STAMPED, which is a different
  // question from what this caller may overwrite.
  const lockScope = await resolveWriteStoreScope({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    selfStaffId,
  })

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

  // Attribution: the caller's own staff id is the only attribution on this
  // door now — no appointment-staff fallback. That fallback used to let a
  // caller the roster cannot place reach this far on an appointment's staff
  // id, but lockScope above already refuses any such caller, so it could
  // never change the outcome — only leak whether the appointment existed
  // (⚖ 2026-09-19 fold, Greptile finding 1).
  const staffId = selfStaffId

  const { storeId, appointment: linkedAppointment, appointmentId, linkReason } = await resolveSaveStore(
    synqed,
    input.appointmentId,
    null,
    clamp,
  )

  // S2/S5 (PR-O commit 2, RULING-S67-PRO-STOP1 R-O2): the coaching label is
  // written INSIDE the save, after the record and before its one karute.save
  // row (deferred emit), by the fate function the worker shares. It never
  // throws — the karute is already durable, so a label problem never turns a
  // persisted save into a failure response (Greptile #689 r2); it becomes the
  // fate the row and this reply carry instead.
  let outcomeLink: OutcomeLink = 'skipped:not_sent'
  // S7 (PR-O commit 4): a save that names NO booking may link the ONE
  // unambiguous booking of this session's day (resolveAutoAppointmentLink —
  // the function the worker shares); needs the session for its start.
  let autoLink: AutoAppointmentLink | null = null
  const recordingSessionId = input.recordingSessionId ?? null
  const { id, fresh, transcriptChanged } = await createOrUpdateKaruteRecord(
    synqed as unknown as SynqedClient,
    {
      customer_id: input.customerId,
      store_id: storeId,
      staff_id: staffId,
      appointment_id: appointmentId,
      recording_session_id: input.recordingSessionId ?? null,
      // Booked menu + recording minutes — web-parity fill (see
      // saveKaruteRecord); the choke's update path never sends these.
      service: (linkedAppointment as { title?: string | null } | null)?.title ?? null,
      duration_minutes: durationMinutesFromSeconds(input.duration),
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
    { actorId: ctx.identity.authUserId, businessId, source: 'facade', requestId: ctx.meta.requestId },
    input.entriesMode,
    lockScope,
    linkReason,
    async (saved) => {
      const fate = await writeOutcomeFate(synqed as unknown as SynqedClient, {
        karuteRecordId: saved.id,
        customerId: input.customerId,
        staffId,
        fresh: saved.fresh,
        outcome: input.outcome ?? null,
        outcomeMissing: input.outcomeMissing ?? null,
        logTag: '[karute.save]',
      })
      outcomeLink = fate.link
      return fate.link
    },
    !input.appointmentId && recordingSessionId
      ? async (record) => {
          // SF-1: the RECORD's store (a converge keeps the existing one), never
          // this request's clamp store.
          const auto = await resolveAutoAppointmentLink(synqed as unknown as SynqedClient, {
            customerId: input.customerId,
            storeId: record.storeId,
            recordingSessionId,
          })
          autoLink = auto.link
          return auto
        }
      : undefined,
  )

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

  // S2: the save answers with the answer's fate and the booking link's
  // (additive — an older client reads `id` and ignores the rest).
  // appointment_link = the SAME value the karute.save row carries (one vocabulary,
  // one expression: appointmentLinkOf).
  return ok(ctx, { id, outcome: outcomeReply(outcomeLink), appointment_link: appointmentLinkOf(linkReason, autoLink) })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
