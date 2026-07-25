'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getCurrentUserStaffId, getBusinessId, staffListByBusinessOrThrow, type StaffMember } from '@/lib/staff'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { getSynqedClient } from '@/lib/synqed/client'
import { isConsentCurrent, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { setKaruteOutcome } from '@/lib/karute/outcome'
import { ingestSessionMemory } from '@/lib/karute/memory-ingest'
import { audit } from '@/lib/audit'
import { resolveWebAuditContext } from '@/lib/audit-web'
import { SESSION_CATEGORY_TO_ENTRY_CATEGORY } from '@/lib/adapters/karute-detail'
import { ENTRY_CONTENT_INVALID_ERROR, type SaveKaruteInput } from '@/types/karute'
import type { KaruteRecord, SynqedClient, Appointment, EntryEditAction } from '@synqed-kk/client'
import type { SessionCategory } from '@/components/karute/redesign/detail/CurrentSessionCard'

/**
 * Resolve which store a karute record write should be stamped with. Reads are
 * already store-filtered (synqed-core PR #18); this is the write side.
 *
 * The booking's store is the truth of where the session happened, so an
 * appointment-linked save is stamped with ITS store_id — fetched fresh unless
 * the caller already pulled the appointment (e.g. for staff-id fallback), in
 * which case that's reused so a save never fetches the same appointment
 * twice. That store is authz-clamped: an out-of-scope appointmentId (a store
 * the caller isn't assigned to) REJECTS the save rather than stamping across
 * branches. With no appointment, fall back to the viewer's RESOLVED store scope
 * (resolveStoreScope): the active-store cookie for cross-store viewers, but a
 * branch-restricted staff is clamped to their assigned store — so an unset
 * cookie can't stamp the record with the primary store of a branch they're not
 * in (the write-side twin of the Ginza dashboard leak). Still non-null for any
 * business that has stores, so a viewer who simply hasn't touched the switcher
 * never mints a NULL-store record that vanishes from every store-scoped
 * カルテ list.
 */
async function resolveKaruteStoreId(
  synqed: SynqedClient,
  appointmentId: string | null | undefined,
  fetchedAppointment?: Appointment | null,
): Promise<string | null> {
  if (appointmentId) {
    const appt = fetchedAppointment ?? (await synqed.appointments.get(appointmentId).catch(() => null))
    const apptStore = appt?.store_id ?? null
    // Authz clamp (write-side twin of getAppointmentById's read clamp): the
    // booking's store is the truth of where the session happened, but a
    // branch-restricted staff handed an OUT-OF-SCOPE appointmentId (stale client
    // state, a crafted server-action call) must not stamp a record into a store
    // they're not assigned to. Allowed when the scope is viewAll (allowedStoreIds
    // null) or the store is one of the caller's assigned stores; otherwise REJECT
    // the save — never silently re-stamp to the caller's own store, which would
    // attach the record to an appointment sitting in a different store. A
    // NULL-store appointment keeps today's behavior (pre-existing, out of scope).
    if (apptStore) {
      const scope = await resolveStoreScope()
      if (scope.allowedStoreIds && !scope.allowedStoreIds.includes(apptStore)) {
        throw new Error('This booking belongs to a store you are not assigned to.')
      }
    }
    return apptStore
  }
  return (await resolveStoreScope()).storeId
}

/**
 * Create the karute record — or, if this recording session was ALREADY saved,
 * UPDATE that record with the newest content instead.
 *
 * Why: core's idempotent create (synqed-core #38) returns the EXISTING record
 * when recording_session_id repeats. If an autosave lands server-side but the
 * client sees a network error, the staff is routed to review, edits the
 * summary/entries, and re-saves — the bare create would hand back the OLD
 * record and report success while every edit silently vanished. Upserting by
 * recording session makes the record converge on what the staff last saw
 * (core's update does a FULL entries replace — verified in karute.service).
 *
 * `entriesMode` makes the entries decision on that collision EXPLICIT per
 * caller, not inferred: 'replace' always sends entries — the converge-on-
 * staff contract above, so staff edits/hand-adds (with their is_manual flags)
 * always land. 'fill-if-empty' omits entries when the existing record already
 * has some — for a caller with nothing newer to say (autosave resending the
 * same extraction), so it can't clobber edits made in between. Either mode
 * still sends entries when the existing record has none (a genuinely-first
 * upsert can always land its set).
 *
 * `fresh` tells the caller whether memory ingest should run — an update is a
 * retry of a transcript that was already ingested on the first save.
 * Residual race (concurrent first saves both passing the lookup) falls back
 * to core's dedupe, which is correct there: both carry identical content.
 *
 * Audit choke point (packet 30 §3): web saveKaruteRecord, web
 * saveKaruteRecordInline, and the facade POST all funnel here — ONE emit
 * covers all three. `actor` is threaded explicitly (this function has no
 * cookie/Bearer context of its own): facade callers pass their already-
 * resolved identity, web callers resolve it via resolveWebAuditContext()
 * BEFORE calling in. process-recording.ts does NOT call this function (its
 * own upsert, own pre-existing karute.save emit) — do not add it here.
 */
export async function createOrUpdateKaruteRecord(
  synqed: SynqedClient,
  payload: Parameters<SynqedClient['karuteRecords']['create']>[0],
  actor: { actorId: string | null; businessId: string | null; source: 'web' | 'facade' },
  entriesMode: 'replace' | 'fill-if-empty',
): Promise<{ id: string; fresh: boolean; transcriptChanged: boolean }> {
  const emitSave = (result: { id: string; fresh: boolean; transcriptChanged: boolean }) => {
    audit({
      category: 'karute',
      action: 'karute.save',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'karute',
      targetId: result.id,
      // customer_id rides in detail (ids only, PII rule) so the audit-log
      // viewer can resolve a name for this karute row — see AuditLogSection
      // §4 target-label join off detail.customer_id.
      detail: {
        fresh: result.fresh,
        transcript_changed: result.transcriptChanged,
        customer_id: payload.customer_id ?? null,
      },
      source: actor.source,
    })
    return result
  }

  const recordingSessionId = payload.recording_session_id
  if (recordingSessionId) {
    // ONLY a 404 means "no record yet". Any other lookup failure (timeout,
    // backend error) must FAIL the save so the client retries — falling
    // through to create() would re-enter core's idempotent dedupe and hand
    // back stale content as success: the exact bug this upsert exists to
    // prevent. Structural status check (not instanceof) so partial test
    // mocks of the client package can't break the detection.
    const existing = await synqed.karuteRecords
      .getByRecordingSession(recordingSessionId)
      .catch((err: unknown) => {
        const status =
          err && typeof err === 'object' && 'status' in err
            ? (err as { status: unknown }).status
            : undefined
        if (status === 404) return null
        throw err
      })
    if (existing) {
      // Collision on recording_session_id (fix round — the prior "this
      // branch's payload is the SAME content by construction" premise was
      // wrong: this branch is also reached by ReviewScreen's saveKaruteRecord
      // when an autosave landed server-side first, so the collision payload
      // can legitimately carry staff edits the existing record doesn't have
      // yet). entriesMode makes the decision explicit instead: a core
      // `entries` replace is a full replace (UpdateKaruteRecordInput.entries
      // "atomically replaces ALL entries"), so 'fill-if-empty' omits it when
      // the existing record already has entries — nothing to add for a caller
      // with nothing newer to say. 'replace' always sends entries — the
      // converge-on-staff contract this function's header describes. Either
      // way, an existing record with zero entries has nothing to lose, so
      // entries still go through.
      const existingHasEntries = Array.isArray(existing.entries) && existing.entries.length > 0
      const omitEntries = entriesMode === 'fill-if-empty' && existingHasEntries
      await synqed.karuteRecords.update(existing.id, {
        transcript: payload.transcript,
        ai_summary: payload.ai_summary,
        appointment_id: payload.appointment_id,
        ...(omitEntries ? {} : { entries: payload.entries }),
      })
      return emitSave({
        id: existing.id,
        fresh: false,
        // The retry EDITED the transcript → there's genuinely new material
        // for memory ingest; an identical transcript is just a resend.
        transcriptChanged: existing.transcript !== payload.transcript,
      })
    }
  }
  const record = await synqed.karuteRecords.create(payload)
  return emitSave({ id: record.id, fresh: true, transcriptChanged: true })
}

/**
 * The recent karute records for ONE customer, newest first — read from
 * synqed-core (the source of truth). The Supabase `karute_records` mirror is
 * empty post-migration, so the record page's "recent recordings" + first-visit
 * brief must read here, scoped to the recording-target customer. Best-effort:
 * returns [] on any failure.
 */
export async function getCustomerKaruteRecords(
  customerId: string,
  limit = 5,
): Promise<KaruteRecord[]> {
  return getCustomerKaruteRecordsWithClient(await getSynqedClient(), customerId, limit)
}

/** Client-threaded getCustomerKaruteRecords — the facade Bearer path (packet 07
 *  Decision 1: the AI body-prediction read fetches the customer's 8 recent records
 *  on the business-scoped client). Same best-effort []-on-failure contract. */
export async function getCustomerKaruteRecordsWithClient(
  synqed: Pick<SynqedClient, 'karuteRecords'>,
  customerId: string,
  limit = 5,
): Promise<KaruteRecord[]> {
  try {
    const res = await synqed.karuteRecords.list({
      customer_id: customerId,
      page_size: limit,
    })
    const rows = [...(res.karute_records ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )
    // The list endpoint omits per-entry detail (only entry_count). The
    // pre-session brief derives 会話のきっかけ / 前回の主訴 / 前回の商品提案 from the
    // MOST-RECENT record's entries — so fetch that one in full. Without this the
    // brief boxes were empty and the card fell back to its placeholder copy.
    // Best-effort: keep the lighter list row if the detail fetch fails.
    if (rows.length > 0) {
      const full = await synqed.karuteRecords
        .get(rows[0].id, { include_entries: true })
        .catch(() => null)
      if (full) rows[0] = full
    }
    return rows
  } catch (err) {
    console.error('[getCustomerKaruteRecords] failed:', err)
    return []
  }
}

/**
 * Save a karute record with all AI-extracted entries in a single atomic
 * API call.
 *
 * IMPORTANT: redirect() is called OUTSIDE the try/catch block.
 * redirect() throws a Next.js control-flow exception that would be swallowed
 * by try/catch, silently preventing navigation.
 */
export async function saveKaruteRecord(
  input: SaveKaruteInput,
): Promise<{ error: string } | void> {
  let recordId: string

  try {
    // Server-side gate: recording a session = records.write (owner / manager /
    // senior / practitioner — NOT frontdesk). The UI hid the recording flow from
    // frontdesk; this makes the server refuse it too. Thrown here so the existing
    // catch below returns the house { error } shape the client already toasts.
    await requireCapability('records.write')

    const synqed = await getSynqedClient()

    // Consent gate, server-enforced: a record must never persist for a customer
    // whose recording consent isn't CURRENT. The record page gates the START of
    // a booked take, but the walk-in flow attaches its customer only here at
    // save — the client shows the consent dialog first (ReviewScreen matches on
    // CONSENT_REQUIRED_ERROR), and this makes the rule hold regardless of path.
    // Fail closed: an unreadable consent rejects the save, never bypasses it.
    const { consent } = await synqed.customers.getConsent(input.customerId)
    if (!isConsentCurrent(consent)) {
      throw new Error(CONSENT_REQUIRED_ERROR)
    }

    // Attribute the record to whoever RECORDED it — the signed-in staff — NOT
    // the booking's staff. For your own bookings these are identical; when you
    // record a customer booked under ANOTHER staff (covering, swaps, days off),
    // the karte correctly saves under YOU. The appointment's staff is only a
    // fallback for an account with no staff identity, so the save never fails.
    let staffId: string | null = await getCurrentUserStaffId()
    let fetchedAppointment: Appointment | null = null
    if (!staffId && input.appointmentId) {
      fetchedAppointment = await synqed.appointments.get(input.appointmentId).catch(() => null)
      staffId = fetchedAppointment?.staff_id ?? null
    }
    if (!staffId) {
      return { error: 'No staff identity for the signed-in user.' }
    }

    const storeId = await resolveKaruteStoreId(synqed, input.appointmentId, fetchedAppointment)

    // Resolve BEFORE the write so a resolver hiccup can't orphan the emit
    // decision (packet 30 §3) — same tolerant identity seam the other web
    // audit writers use.
    const { actorId, businessId } = await resolveWebAuditContext()

    const { id, fresh, transcriptChanged } = await createOrUpdateKaruteRecord(
      synqed,
      {
        customer_id: input.customerId,
        store_id: storeId,
        staff_id: staffId,
        appointment_id: input.appointmentId ?? null,
        recording_session_id: input.recordingSessionId ?? null,
        transcript: input.transcript,
        ai_summary: input.summary,
        entries: input.entries.map((entry) => ({
          category: entry.category.toUpperCase() as 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE' | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER',
          content: entry.content,
          original_quote: entry.sourceQuote ?? null,
          confidence: entry.confidenceScore,
          // Provenance (edit-layer Wave 1): ReviewScreen computes this per
          // entry (staff-edited/hand-added → true); other callers (autosave)
          // never set it, which keeps their entries AI as before.
          is_manual: entry.isManual ?? false,
        })),
      },
      { actorId, businessId, source: 'web' },
      'replace',
    )
    recordId = id

    // Best-effort: persist the session outcome (the coaching training label).
    // NEVER gate the save/redirect on it — the recording is the critical
    // artifact, and setKaruteOutcome swallows its own errors. Runs on the
    // update path too (upsert semantics — the retry's outcome decision wins).
    if (input.outcome) {
      await setKaruteOutcome({
        karuteRecordId: recordId,
        customerId: input.customerId,
        status: input.outcome.status,
        reason: input.outcome.reason,
        isFirstVisit: input.outcome.isFirstVisit,
        decidedBy: staffId,
      })
    }

    // Best-effort: grow the customer's persistent memory from this transcript
    // (the personal-bits + body-trajectory loop). Awaited so it reliably runs in
    // serverless; never throws — the recording is the critical artifact.
    // Fresh saves — or a retry whose transcript was EDITED in review (new
    // material for memory). A retry resending an identical transcript is
    // skipped: re-extraction would only stack duplicate memory items.
    if (fresh || transcriptChanged) {
      await ingestSessionMemory({
        customerId: input.customerId,
        transcript: input.transcript,
        locale: await getLocale(),
        // Live-recording save — the session is today (JST).
        sessionDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
      })
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }

  // revalidate and redirect OUTSIDE try/catch — redirect() throws internally
  revalidatePath(`/customers/${input.customerId}`)
  revalidatePath('/dashboard')
  updateTag('dashboard')
  // Include the locale prefix so the redirect lands on /<locale>/karute/<id>
  // (not the bare /karute/<id> which bypasses next-intl's locale routing).
  const locale = await getLocale()
  redirect(`/${locale}/karute/${recordId}`)
}

/**
 * Same as saveKaruteRecord but returns the record ID instead of redirecting.
 * Used by ProcessingIndicator's background auto-save (the staff never comes
 * back to a review screen for a known customer + chosen outcome).
 */
export async function saveKaruteRecordInline(
  input: SaveKaruteInput,
): Promise<{ id: string } | { error: string }> {
  try {
    // Recording a session = records.write (see saveKaruteRecord). Caught below →
    // returned as the house { error } shape the RecordingPanel already toasts.
    await requireCapability('records.write')

    const synqed = await getSynqedClient()

    // Same server-enforced consent gate as saveKaruteRecord. Autosave takes are
    // appointment-bound (start-gated on the record page), so this normally
    // passes untouched; if it ever rejects (consent revoked mid-session), the
    // pipeline's error path falls back to review, whose consent dialog handles
    // it — the take is never lost.
    const { consent } = await synqed.customers.getConsent(input.customerId)
    if (!isConsentCurrent(consent)) {
      throw new Error(CONSENT_REQUIRED_ERROR)
    }

    // Same recorder-first attribution + appointment-staff fallback as
    // saveKaruteRecord: autosave only ever fires for appointment-bound takes
    // (global-pipeline requires appointmentCustomerId), which is exactly the
    // shape where the fallback works — without it, every autosave on a
    // PIN-less shared account failed over to manual review.
    let staffId: string | null = await getCurrentUserStaffId()
    let fetchedAppointment: Appointment | null = null
    if (!staffId && input.appointmentId) {
      fetchedAppointment = await synqed.appointments.get(input.appointmentId).catch(() => null)
      staffId = fetchedAppointment?.staff_id ?? null
    }
    if (!staffId) {
      return { error: 'No staff identity for the signed-in user.' }
    }

    const storeId = await resolveKaruteStoreId(synqed, input.appointmentId, fetchedAppointment)

    // Resolve BEFORE the write — same identity seam as saveKaruteRecord.
    const { actorId, businessId } = await resolveWebAuditContext()

    const { id, fresh, transcriptChanged } = await createOrUpdateKaruteRecord(
      synqed,
      {
        customer_id: input.customerId,
        store_id: storeId,
        staff_id: staffId,
        appointment_id: input.appointmentId ?? null,
        recording_session_id: input.recordingSessionId ?? null,
        transcript: input.transcript,
        ai_summary: input.summary,
        entries: input.entries.map((entry) => ({
          category: entry.category.toUpperCase() as 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE' | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER',
          content: entry.content,
          original_quote: entry.sourceQuote ?? null,
          confidence: entry.confidenceScore,
          // Provenance (edit-layer Wave 1): ReviewScreen computes this per
          // entry (staff-edited/hand-added → true); other callers (autosave)
          // never set it, which keeps their entries AI as before.
          is_manual: entry.isManual ?? false,
        })),
      },
      { actorId, businessId, source: 'web' },
      'fill-if-empty',
    )

    // Best-effort outcome write (the coaching label) — same as saveKaruteRecord.
    // Never gate the return on it; setKaruteOutcome swallows its own errors.
    if (input.outcome) {
      await setKaruteOutcome({
        karuteRecordId: id,
        customerId: input.customerId,
        status: input.outcome.status,
        reason: input.outcome.reason,
        isFirstVisit: input.outcome.isFirstVisit,
        decidedBy: staffId,
      })
    }

    // Best-effort memory ingest — same gate as saveKaruteRecord: fresh saves
    // or edited-transcript retries; identical resends skip.
    if (fresh || transcriptChanged) {
      await ingestSessionMemory({
        customerId: input.customerId,
        transcript: input.transcript,
        locale: await getLocale(),
        // Live-recording save — the session is today (JST).
        sessionDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
      })
    }

    revalidatePath(`/customers/${input.customerId}`)
    updateTag('dashboard')
    return { id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }
}

export async function deleteKaruteRecord(karuteId: string): Promise<{ success: true } | { error: string }> {
  try {
    // Destructive: deleting a karute = records.delete (owner / manager / senior —
    // NOT practitioner / frontdesk). Caught below → house { error } shape.
    await requireCapability('records.delete')

    const synqed = await getSynqedClient()
    await synqed.karuteRecords.delete(karuteId)
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Create a karute record from the manual-entry dialog (+ 新規カルテ on
 * the karute list). Separate from saveKaruteRecord, which is the
 * recording-flow path that lands with a transcript + AI-extracted
 * entries already in hand.
 *
 * Manual creation is a "draft" record — no transcript, no entries.
 * Staff fills in the entries themselves on the karute detail page,
 * OR they later attach a recording (and the AI pass populates the
 * entries from the transcript).
 *
 * service / duration_minutes / session_date are persisted on
 * synqed-core karute_records (2026-06-11 manual migration). The
 * installed @synqed-kk/client types predate the fields, so the
 * payload is widened structurally until the client republish.
 */
export async function createManualKaruteRecord(input: {
  customerId: string
  staffId: string
  sessionDate: string // YYYY-MM-DD — actual session day (backdating)
  durationMinutes: number
  service: string
}): Promise<{ error: string } | void> {
  let recordId: string

  try {
    // Creating a karute = records.write (owner / manager / senior / practitioner
    // — NOT frontdesk). The "+ 新規カルテ" dialog is otherwise ungated in the UI.
    // Thrown → caught below → house { error } shape (the dialog runs this inside
    // startTransition with NO try/catch, so a raw throw would surface as an
    // unhandled rejection — it must be returned, never thrown, to this caller).
    await requireCapability('records.write')

    // Never trust the client-supplied staffId. The dialog defaults the staff
    // dropdown to the signed-in user, but it can be changed to ANY staff. Saving
    // a record UNDER ANOTHER staff (backdating on their behalf) is a supervisory
    // act, so it needs records.delete — the marker the presets give owner /
    // manager / senior only (practitioner + frontdesk lack it). Assigning to
    // YOURSELF is always fine. This mirrors saveKaruteRecord, which never accepts
    // a client staff id at all.
    const ownStaffId = await getCurrentUserStaffId()
    if (input.staffId !== ownStaffId && !(await can('records.delete'))) {
      return { error: 'You do not have permission to record a session for another staff member.' }
    }

    const synqed = await getSynqedClient()

    // Manual creation has no linked appointment — store resolution falls
    // straight to the viewer's active-store cookie.
    const storeId = await resolveKaruteStoreId(synqed, null)

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      store_id: storeId,
      staff_id: input.staffId,
      status: 'DRAFT',
      // No transcript / no entries on manual create — staff fills
      // those in on the detail page (or via a later recording).
      transcript: null,
      ai_summary: null,
      entries: [],
      ...({
        service: input.service || null,
        duration_minutes: input.durationMinutes > 0 ? input.durationMinutes : null,
        session_date: input.sessionDate || null,
      } as Record<string, unknown>),
    })
    recordId = record.id
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }

  // revalidate + redirect outside try/catch — redirect() throws a
  // control-flow exception that try/catch would swallow.
  revalidatePath(`/customers/${input.customerId}`)
  revalidatePath('/karute')
  updateTag('dashboard')
  // Include the locale prefix so the redirect lands on /<locale>/karute/<id>
  // (not the bare /karute/<id> which bypasses next-intl's locale routing).
  const locale = await getLocale()
  redirect(`/${locale}/karute/${recordId}`)
}

// ---------------------------------------------------------------------------
// updateKaruteDetailEntry (edit-layer W2 PR-B — edit-save only, no delete)
// ---------------------------------------------------------------------------

export type UpdateKaruteEntryResult = { ok: true } | { conflict: true } | { error: string }

/** Core-only variant, distinct from {error} — a content-validation failure
 *  (facade maps it to 400) is not a generic upstream failure (facade maps
 *  {error} to a fixed generic 502, never the raw message). The web wrapper
 *  collapses this into {error} before returning — the sheet only ever sees
 *  {ok}|{conflict}|{error}. Kept structural (no shared string constant) so
 *  the facade route needs no extra import from this file — the
 *  updateTag-ban scanner (facade-core-updatetag-ban.test.ts) requires every
 *  action-module name a route imports to resolve to a function declaration. */
type CoreUpdateEntryResult = UpdateKaruteEntryResult | { validationError: string }

type SynqedEntryClient = Pick<SynqedClient, 'karuteRecords'>

/**
 * Per-entry edit-save CORE — CAS via expected_version. NEVER call core's
 * update({entries}): that full-replaces every entry (incl. human rows) —
 * updateEntry is the ONLY safe per-entry write. Shared by the web wrapper
 * below and the facade PATCH route (…/karute/[id]/entries/[entryId]). No
 * capability/revalidate here — callers own those; the spine emit IS here
 * (choke-point doctrine, mirrors createOrUpdateKaruteRecord's emitSave above)
 * so both callers get exactly one emit with no FACADE_AUDIT_MAP row (see the
 * "not a row here" comment in src/lib/audit.ts).
 */
export async function updateKaruteDetailEntryWithClient(
  synqed: SynqedEntryClient,
  recordId: string,
  entryId: string,
  input: {
    content?: string
    category?: SessionCategory
    expectedVersion: number
    actorStaffId: string | null
  },
  actor: { actorId: string | null; businessId: string | null; source: 'web' | 'facade' },
  customerId: string | null,
): Promise<CoreUpdateEntryResult> {
  // Content bounds checked HERE (not just the facade's zod) so the web path
  // is covered too — a whitespace-only edit or a >4000-char paste never
  // reaches updateEntry.
  if (input.content !== undefined) {
    const trimmed = input.content.trim()
    if (trimmed.length === 0 || input.content.length > 4000) {
      return { validationError: ENTRY_CONTENT_INVALID_ERROR }
    }
  }
  try {
    await synqed.karuteRecords.updateEntry(recordId, entryId, {
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.category !== undefined
        ? { category: SESSION_CATEGORY_TO_ENTRY_CATEGORY[input.category] }
        : {}),
      expected_version: input.expectedVersion,
      actor_staff_id: input.actorStaffId,
      action: 'EDIT',
    })
    audit({
      category: 'karute',
      action: 'karute.entry_edit',
      actorId: actor.actorId,
      actorType: 'staff',
      businessId: actor.businessId,
      targetType: 'karute',
      targetId: recordId,
      // customer_id rides in detail (ids only, PII rule) — same viewer
      // name-join rationale as karute.save's emitSave above.
      detail: { entry_id: entryId, category: input.category ?? null, customer_id: customerId },
      source: actor.source,
    })
    return { ok: true }
  } catch (err) {
    // Stale version → 409. Structural status check, not instanceof SynqedError
    // (same convention as createOrUpdateKaruteRecord's lookup above — a
    // partial test client can't break detection). current_version rides the
    // body, not the typed error — callers re-fetch. NEVER retry the CAS.
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status === 409) return { conflict: true }
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Cookie web wrapper — records.write gate (same as saveKaruteRecord) +
 *  business-scoped client + resolved identity, then the core (which owns the
 *  spine emit). */
export async function updateKaruteDetailEntry(
  recordId: string,
  entryId: string,
  input: {
    content?: string
    category?: SessionCategory
    expectedVersion: number
  },
): Promise<UpdateKaruteEntryResult> {
  try {
    await requireCapability('records.write')
    const synqed = await getSynqedClient()
    const actorStaffId = await getCurrentUserStaffId()
    // Resolve BEFORE the write — same tolerant identity seam as
    // createOrUpdateKaruteRecord (resolveWebAuditContext never throws).
    const { actorId, businessId } = await resolveWebAuditContext()
    // customer_id for the audit detail comes from the AUTHORITATIVE record —
    // never from the client (Greptile #616: a crafted action call could
    // mis-attribute the edit in the 監査ログ dispute view). Same derivation
    // the facade route gets from its proof-read; the extra GET is cheap on
    // this low-frequency manual path and also 404s a foreign record id
    // before any write is attempted.
    const record = (await synqed.karuteRecords.get(recordId, {
      include_entries: false,
    })) as { customer_id?: string | null } | null
    const result = await updateKaruteDetailEntryWithClient(
      synqed,
      recordId,
      entryId,
      {
        content: input.content,
        category: input.category,
        expectedVersion: input.expectedVersion,
        actorStaffId,
      },
      { actorId, businessId, source: 'web' },
      record?.customer_id ?? null,
    )
    if ('ok' in result) {
      revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    }
    // Collapse the core-only validationError variant — the sheet only ever
    // sees {ok}|{conflict}|{error}.
    if ('validationError' in result) return { error: result.validationError }
    return result
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// listEntryEditHistory (edit-layer W2 history sheet — 編集済み chip → the
// per-entry attribution panel; PR-B's trail read out loud)
// ---------------------------------------------------------------------------

export interface EntryEditHistoryRow {
  id: string
  entryIdOld: string | null
  entryIdNew: string | null
  action: EntryEditAction
  actorName: string | null
  contentBefore: string | null
  contentAfter: string | null
  createdAt: string
}

type SynqedEntryEditReadClient = Pick<SynqedClient, 'karuteRecords'>

/**
 * Per-entry edit trail CORE — read-only, shared by the web wrapper below and
 * the facade GET route (…/karute/[id]/entry-edits). Single page, newest
 * first — no pagination UI.
 * // ponytail: first 100 rows only; paginate if a record's trail outgrows it
 *
 * Name resolution is SERVER-side (denormalized-label idiom, audit-route
 * precedent — staffListByBusinessOrThrow's roster join): a roster failure
 * degrades every actorName to null, it NEVER throws — a staff-directory
 * hiccup must not take the whole history sheet down.
 */
export async function listEntryEditHistoryWithClient(
  synqed: SynqedEntryEditReadClient,
  businessId: string,
  karuteRecordId: string,
): Promise<{ edits: EntryEditHistoryRow[] }> {
  const { entry_edits } = await synqed.karuteRecords.listEntryEdits({
    karute_record_id: karuteRecordId,
    page_size: 100,
  })
  const roster = await staffListByBusinessOrThrow(businessId).catch(() => [] as StaffMember[])
  const nameById = new Map(roster.map((s) => [s.id, s.full_name]))
  const edits = entry_edits
    // Defensive sort — core already returns newest first, but nothing here
    // depends on that holding forever.
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((e) => ({
      id: e.id,
      entryIdOld: e.entry_id_old,
      entryIdNew: e.entry_id_new,
      action: e.action,
      actorName: (e.actor_staff_id ? nameById.get(e.actor_staff_id) : null) ?? null,
      contentBefore: e.content_before,
      contentAfter: e.content_after,
      createdAt: e.created_at,
    }))
  return { edits }
}

/** Cookie web wrapper — customers.view gate (same class gate as the detail
 *  screen read, screens/karute/[id]/route.ts:51). businessId scopes a REAL
 *  read (the roster join) here, not just the audit line, so it's resolved
 *  directly via getBusinessId() — a failure fails the whole read, same as
 *  resolveWebBusinessId's own doc comment prescribes for that case. */
export async function listEntryEditHistory(
  recordId: string,
): Promise<{ edits: EntryEditHistoryRow[] } | { error: string }> {
  try {
    await requireCapability('customers.view')
    const synqed = await getSynqedClient()
    const businessId = await getBusinessId()
    return await listEntryEditHistoryWithClient(synqed, businessId, recordId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
