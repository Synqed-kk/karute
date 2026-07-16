'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getCurrentUserStaffId } from '@/lib/staff'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { getSynqedClient } from '@/lib/synqed/client'
import { isConsentCurrent, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { setKaruteOutcome } from '@/lib/karute/outcome'
import { ingestSessionMemory } from '@/lib/karute/memory-ingest'
import type { SaveKaruteInput } from '@/types/karute'
import type { KaruteRecord, KaruteEntry, KaruteEntryInput, SynqedClient, Appointment } from '@synqed-kk/client'

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
 * Occurrence-aware multiset merge that shields human-authored rows across an
 * idempotent save-retry. Core's update() FULL-REPLACES entries, so a stale
 * retry whose payload dropped (or never carried) a hand-authored row would
 * erase it — and a same-text AI row would DEMOTE it to regen-deletable. For
 * each existing is_manual row we claim ONE payload row that is itself human and
 * shares category+content (duplicates matched one-for-one, never double-claimed);
 * an AI payload row can never satisfy a human row. Matched rows inherit the
 * stored tags/sort_order the form omits (a retry never resets metadata); an
 * unmatched human row is re-appended whole. Promotion only — nothing demotes.
 * (I1: no path erases a human entry short of an explicit staff delete.)
 */
function mergeSurvivingHumanEntries(
  existing: KaruteEntry[],
  payload: KaruteEntryInput[],
): KaruteEntryInput[] {
  const merged = [...payload]
  const claimed = new Set<number>()
  for (const ex of existing) {
    if (!ex.is_manual) continue
    let matchIdx = -1
    for (let i = 0; i < merged.length; i++) {
      if (claimed.has(i)) continue
      const p = merged[i]
      if (p.is_manual && p.category === ex.category && p.content === ex.content) {
        matchIdx = i
        break
      }
    }
    if (matchIdx >= 0) {
      // Matched: carry the stored metadata the form-side payload leaves off.
      claimed.add(matchIdx)
      const p = merged[matchIdx]
      merged[matchIdx] = { ...p, tags: p.tags ?? ex.tags, sort_order: p.sort_order ?? ex.sort_order }
    } else {
      // Unmatched: re-append with every writable field so nothing is lost.
      merged.push({
        category: ex.category,
        content: ex.content,
        original_quote: ex.original_quote,
        confidence: ex.confidence,
        tags: ex.tags,
        sort_order: ex.sort_order,
        is_manual: ex.is_manual,
      })
    }
  }
  return merged
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
 * `fresh` tells the caller whether memory ingest should run — an update is a
 * retry of a transcript that was already ingested on the first save.
 * Residual race (concurrent first saves both passing the lookup) falls back
 * to core's dedupe, which is correct there: both carry identical content.
 */
export async function createOrUpdateKaruteRecord(
  synqed: SynqedClient,
  payload: Parameters<SynqedClient['karuteRecords']['create']>[0],
): Promise<{ id: string; fresh: boolean; transcriptChanged: boolean }> {
  const recordingSessionId = payload.recording_session_id
  if (recordingSessionId) {
    // ONLY a 404 means "no record yet". Any other lookup failure (timeout,
    // backend error) must FAIL the save so the client retries — falling
    // through to create() would re-enter core's idempotent dedupe and hand
    // back stale content as success: the exact bug this upsert exists to
    // prevent. Structural status check (not instanceof) so partial test
    // mocks of the client package can't break the detection.
    const existing = await synqed.karuteRecords
      .getByRecordingSession(recordingSessionId, { include_entries: true })
      .catch((err: unknown) => {
        const status =
          err && typeof err === 'object' && 'status' in err
            ? (err as { status: unknown }).status
            : undefined
        if (status === 404) return null
        throw err
      })
    if (existing) {
      // Full-replace would drop human rows the retry payload lost — merge them
      // back (occurrence-aware; promotion only) before handing core the replace.
      const entries = mergeSurvivingHumanEntries(existing.entries ?? [], payload.entries ?? [])
      await synqed.karuteRecords.update(existing.id, {
        transcript: payload.transcript,
        ai_summary: payload.ai_summary,
        entries,
        appointment_id: payload.appointment_id,
      })
      return {
        id: existing.id,
        fresh: false,
        // The retry EDITED the transcript → there's genuinely new material
        // for memory ingest; an identical transcript is just a resend.
        transcriptChanged: existing.transcript !== payload.transcript,
      }
    }
  }
  const record = await synqed.karuteRecords.create(payload)
  return { id: record.id, fresh: true, transcriptChanged: true }
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

    const { id, fresh, transcriptChanged } = await createOrUpdateKaruteRecord(synqed, {
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
        is_manual: entry.isManual ?? false,
      })),
    })
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

    const { id, fresh, transcriptChanged } = await createOrUpdateKaruteRecord(synqed, {
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
        is_manual: entry.isManual ?? false,
      })),
    })

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
