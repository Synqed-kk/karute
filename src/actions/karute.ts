'use server'

import { revalidatePath, revalidateTag, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getCurrentUserStaffId, getBusinessId, getStaffList } from '@/lib/staff'
import { listAllCustomersCached } from '@/lib/customers/list-all'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'
import {
  isValidKaruteMonth,
  isValidKaruteYmd,
  loadKaruteWindowRows,
} from '@/lib/karute/karute-window'
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { coreFailureLine, classifyCoreThrow } from '@/lib/auth/core-failure-line'
import { getSynqedClient } from '@/lib/synqed/client'
import { isConsentCurrent, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { resolveStoreScope, customerLensFor, storeStaffIdSet } from '@/lib/auth/store-scope'
import { sourceStoreOutOfScope, STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'
import { reachesNoStore, UNASSIGNED_STORE_DENIAL } from '@/lib/auth/store-gate'
import { setKaruteOutcome } from '@/lib/karute/outcome'
import { durationMinutesFromSeconds } from '@/lib/karute/duration-minutes'
import { ingestSessionMemory } from '@/lib/karute/memory-ingest'
import { audit } from '@/lib/audit'
import { ensureRecordStoreInScopeAudited } from '@/lib/audit-store-lock'
import { resolveWebAuditContext, auditWeb } from '@/lib/audit-web'
import { type SaveKaruteInput } from '@/types/karute'
import type { SynqedClient, Appointment } from '@synqed-kk/client'
import type { SessionCategory } from '@/components/karute/redesign/detail/CurrentSessionCard'
import { AppApiError } from '@/lib/app-api/errors'
import { readKaruteRaw, readKaruteMetaRaw, KARUTE_NOT_FOUND } from '@/lib/app-api/karute-facade'
// The eight karute cores left this file for a server-only module
// (PKT-SEC-CORES-D2, 2026-09-23): every runtime export here is a
// browser-callable server action with no authentication of its own, and these
// eight are internal reads/writes that take an already-scoped client (or read
// the session themselves). Never re-export them from this file.
import {
  createManualKaruteRecordWithClient,
  createOrUpdateKaruteRecord,
  listEntryEditHistoryWithClient,
  reassignKaruteCustomerWithClient,
  updateKaruteDetailEntryWithClient,
  updateKaruteDetailSummaryWithClient,
} from '@/lib/karute/karute.core'
import { readAppointmentForSave, type AppointmentLinkReason } from '@/lib/karute/appointment-link'

// Type ALIASES, not `export type { … } from` re-exports: Next's 'use server'
// transform registers every export NAME as a server reference at runtime, and
// a re-exported type name has no runtime binding → ReferenceError at build
// (the same note sits over MarkNoShowResult in src/actions/appointments.ts,
// and over StoreRow in src/actions/stores.ts). Each shape lives with the core
// that produces it; this file keeps publishing the names it always published.
export type ReassignPreview = import('@/lib/karute/karute.core').ReassignPreview
export type ReassignSuccess = import('@/lib/karute/karute.core').ReassignSuccess
export type UpdateKaruteEntryResult = import('@/lib/karute/karute.core').UpdateKaruteEntryResult
export type KaruteStoreLock = import('@/lib/karute/karute.core').KaruteStoreLock
export type UpdateKaruteDetailSummaryResult =
  import('@/lib/karute/karute.core').UpdateKaruteDetailSummaryResult
export type EntryEditHistoryRow = import('@/lib/karute/karute.core').EntryEditHistoryRow

/** Redeclared, not imported (same "redeclare the shape" convention
 *  thin/ports/actions.vite.ts uses for StoreRow/AuditLogEvent, and for the
 *  identical reason): CustomerCombobox.tsx is a 'use client' component that
 *  resolves a next-intl namespace at its own module scope — even a
 *  type-only import of its CustomerOption type makes that namespace
 *  reachable from every entry point that imports this 'use server' file
 *  (the i18n client-message closure walker matches on the raw import
 *  clause text, not import kind — this exact shape tripped it; fixed by
 *  never importing the component file here at all). Keep in sync with
 *  CustomerOption's real shape if that ever changes. */
export interface ReassignCustomerOption {
  id: string
  name: string
  furigana?: string | null
  phone?: string | null
}

/**
 * Resolve which store a karute record write should be stamped with, and which
 * appointment link it keeps. Reads are already store-filtered (synqed-core
 * PR #18); this is the write side.
 *
 * The booking's store is the truth of where the session happened, so an
 * appointment-linked save whose booking reads OK and sits in the caller's
 * scope is stamped with ITS store_id. When the booking
 * cannot be used, the save is NEVER refused and NEVER stamped NULL-store (⚖
 * never lose a karute): it lands in the caller's own verified lens and the
 * link depends on why (readAppointmentForSave splits the read) — core says 404
 * → the link is dropped (a dangling id is a lie); the booking is in a store
 * the caller isn't assigned to → the link and the booked menu are dropped, and
 * the record is never stamped across branches; the read failed twice for any
 * other reason → the link is KEPT for a later re-stamp. Not-found and
 * out-of-scope look byte-identical to the caller, so the save is no oracle for
 * whether a booking exists in a store they cannot see; each degraded case
 * rides a notice on the one karute.save audit row (`linkReason`). A booking
 * that reads OK with a NULL store keeps today's behaviour (pre-existing, out
 * of scope). With no appointment, the store is the viewer's RESOLVED store
 * scope (resolveStoreScope): the active-store cookie for cross-store viewers,
 * but a branch-restricted staff is clamped to their assigned store — so an
 * unset cookie can't stamp the record with the primary store of a branch
 * they're not in (the write-side twin of the Ginza dashboard leak). That lens
 * is non-null for any business that has stores, so neither path mints a
 * NULL-store record that vanishes from every store-scoped カルテ list.
 */
async function resolveKaruteStoreId(
  synqed: SynqedClient,
  appointmentId: string | null | undefined,
): Promise<{
  storeId: string | null
  appointment: Appointment | null
  appointmentId: string | null
  linkReason: AppointmentLinkReason | null
}> {
  const scope = await resolveStoreScope()
  if (scope.degraded) throw new AppApiError('store_forbidden', STORE_SCOPE_UNVERIFIED)
  if (reachesNoStore(scope)) throw new Error(UNASSIGNED_STORE_DENIAL)

  // Also hands back the appointment it read so callers can copy booking
  // metadata (service = the booked menu) into the record without a second
  // appointments.get for the same save.
  if (appointmentId) {
    const read = await readAppointmentForSave(synqed.appointments, appointmentId)
    if (read.state !== 'ok') {
      // 404 → the id is a lie, drop it; unreadable → keep it for a re-stamp.
      return read.state === 'not_found'
        ? { storeId: scope.storeId, appointment: null, appointmentId: null, linkReason: 'appointment_not_found' }
        : { storeId: scope.storeId, appointment: null, appointmentId, linkReason: 'appointment_unreadable' }
    }
    const apptStore = read.appointment.store_id ?? null
    // Authz clamp (write-side twin of getAppointmentById's read clamp): a
    // branch-restricted staff handed an OUT-OF-SCOPE appointmentId (stale client
    // state, a crafted server-action call) must not stamp a record into a store
    // they're not assigned to, nor carry that booking's link or menu. Allowed
    // when the scope is viewAll (allowedStoreIds null) or the store is one of
    // the caller's assigned stores.
    if (apptStore && scope.allowedStoreIds && !scope.allowedStoreIds.includes(apptStore)) {
      return { storeId: scope.storeId, appointment: null, appointmentId: null, linkReason: 'appointment_out_of_scope' }
    }
    return { storeId: apptStore, appointment: read.appointment, appointmentId, linkReason: null }
  }
  // No linked appointment: the record's store is the actor's verified lens.
  return { storeId: scope.storeId, appointment: null, appointmentId: null, linkReason: null }
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
): Promise<{ error: string; code?: AppApiError['code'] } | void> {
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
    // the karte correctly saves under YOU. The booking's staff is never stamped,
    // not even as a fallback — web = facade (#990).
    const staffId = await getCurrentUserStaffId()
    if (!staffId) {
      // Honest floor: a karute row needs a staff_id and the only one it may
      // carry is the caller's own. No identity (removed from the roster while
      // the auth session lives on) = refused before any booking is read —
      // requireCapability above already refuses this caller; this is the belt.
      // The take is not lost — it stays on review for a retry (see
      // saveKaruteRecordInline's consent note).
      return { error: 'No staff identity for the signed-in user.' }
    }

    const { storeId, appointment: linkedAppointment, appointmentId, linkReason } = await resolveKaruteStoreId(
      synqed,
      input.appointmentId,
    )

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
        appointment_id: appointmentId,
        recording_session_id: input.recordingSessionId ?? null,
        // 施術メニュー + 録音時間, so the カルテ list's "menu · minutes" line is
        // real for recorded karute, not only manual entries. The choke's
        // update path never sends these, so an existing value (manual entry,
        // pipeline-written duration) is never overwritten by a re-save.
        service: linkedAppointment?.title ?? null,
        duration_minutes: durationMinutesFromSeconds(input.duration),
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
      { actorId, businessId, source: 'web', requestId: crypto.randomUUID() },
      'replace',
      // The converge branch's store lock (same cookie scope the karute delete
      // door passes) — resolveStoreScope is cached per request, so this costs
      // no second assignment read.
      await resolveStoreScope(),
      // Why the booking link degraded, if it did — the notice on the one audit row.
      linkReason,
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
        // Post-persist, same as the facade twin: the record is created above,
        // so an unverifiable check must not silently cost an honest label.
        onUnverifiable: 'write',
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
    if (err instanceof AppApiError) return { error: (await coreFailureLine(err, '[karute]')) ?? err.message, code: err.code }
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
): Promise<{ id: string } | { error: string; code?: AppApiError['code'] }> {
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

    // Same recorder-only attribution as saveKaruteRecord: the record carries
    // the signed-in staff's id, never the booking's (web = facade, #990).
    const staffId = await getCurrentUserStaffId()
    if (!staffId) {
      // Honest floor: no identity (removed from the roster) = refused before
      // any booking is read — requireCapability above already refuses this
      // caller; this is the belt. The take is not lost — it stays on review
      // for a retry (see the consent note above: "never lost").
      return { error: 'No staff identity for the signed-in user.' }
    }

    const { storeId, appointment: linkedAppointment, appointmentId, linkReason } = await resolveKaruteStoreId(
      synqed,
      input.appointmentId,
    )

    // Resolve BEFORE the write — same identity seam as saveKaruteRecord.
    const { actorId, businessId } = await resolveWebAuditContext()

    const { id, fresh, transcriptChanged } = await createOrUpdateKaruteRecord(
      synqed,
      {
        customer_id: input.customerId,
        store_id: storeId,
        staff_id: staffId,
        appointment_id: appointmentId,
        recording_session_id: input.recordingSessionId ?? null,
        // Same booked-menu + recording-minutes fill as saveKaruteRecord.
        service: linkedAppointment?.title ?? null,
        duration_minutes: durationMinutesFromSeconds(input.duration),
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
      { actorId, businessId, source: 'web', requestId: crypto.randomUUID() },
      'fill-if-empty',
      // Same converge-branch store lock as saveKaruteRecord above.
      await resolveStoreScope(),
      linkReason,
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
        // Post-persist, same as the facade twin: the record is created above,
        // so an unverifiable check must not silently cost an honest label.
        onUnverifiable: 'write',
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
    if (err instanceof AppApiError) return { error: (await coreFailureLine(err, '[karute]')) ?? err.message, code: err.code }
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }
}

export async function deleteKaruteRecord(karuteId: string): Promise<{ success: true } | { error: string }> {
  try {
    // Destructive: deleting a karute = records.delete (owner / manager / senior —
    // NOT practitioner / frontdesk). Caught below → house { error } shape.
    await requireCapability('records.delete')

    const synqed = await getSynqedClient()
    // Read BEFORE the delete — a deleted karute leaves no row of its own, so
    // this is the only chance to capture the ids the audit row carries
    // (packet PR B2 §1: without a row here, a deleted karute vanishes with
    // no trace at all). ruling 9/11: no delete without its evidence row — a
    // failed read (fail-closed) refuses the delete rather than losing the
    // ids; include_entries: false keeps it to metadata (repo convention,
    // src/actions/audit-log.ts:437) so the full clinical text never ships
    // over the wire just to read four ids.
    const record = await readKaruteMetaRaw(synqed, karuteId)
    // Resolved BEFORE the lock now (it was resolved just below): the REFUSAL
    // files its own row too, and it needs the same identity the success row
    // carries. resolveWebAuditContext never throws.
    const { actorId, businessId } = await resolveWebAuditContext()
    // STORE LOCK (⚖ Liam 2026-09-16) — a clamped actor holding records.delete
    // must not be able to delete another branch's karute by id. Refuses with
    // the SAME not_found readKaruteMetaRaw throws for a missing/cross-tenant
    // id, so this door is no existence oracle either. Web-only door: no
    // facade twin exists (verified by grep, 2026-09-16).
    ensureRecordStoreInScopeAudited(record, await resolveStoreScope(), KARUTE_NOT_FOUND, {
      actor: { actorId, businessId, source: 'web' },
      category: 'karute',
      targetType: 'karute',
      targetId: karuteId,
      door: 'karute.delete',
    })
    await synqed.karuteRecords.delete(karuteId)

    // Emit BEFORE revalidatePath/updateTag (F6) — if either throws after a
    // successful delete, the row still landed; audit() itself never throws
    // (src/lib/audit.ts:77-92), so the reverse risk does not exist.
    audit({
      category: 'karute',
      action: 'karute.delete',
      actorId,
      actorType: 'staff',
      businessId,
      targetType: 'karute',
      targetId: karuteId,
      // A deleted clinical record is a 警告 row, same tier as scheduling a
      // customer deletion (src/actions/customers.ts:388) — F2.
      severity: 'warning',
      storeId: record.store_id ?? undefined,
      // ids only (PII rule) — staff_id here is the record's OWN 担当
      // (who the karute was attributed to), not the deleter; the deleter is
      // actorId above.
      detail: {
        customer_id: record.customer_id ?? null,
        recording_session_id: record.recording_session_id ?? null,
        appointment_id: record.appointment_id ?? null,
        staff_id: record.staff_id ?? null,
      },
      requestId: crypto.randomUUID(),
      source: 'web',
    })

    revalidatePath('/dashboard')
    updateTag('dashboard')

    return { success: true }
  } catch (err) {
    // S33 (D-S33-1): the delete is a raw SDK call — classify its outage before asking the line.
    return { error: (await coreFailureLine(classifyCoreThrow(err), '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}

// ---------------------------------------------------------------------------
// reassignKaruteCustomer (F4 — re-point a saved karute to another customer)
// ---------------------------------------------------------------------------

export type ReassignKaruteCustomerResult =
  | ReassignPreview
  | { success: true; linkedBurnCount: number; sameDayBurnCount: number; photoCount: number }
  | { error: string }

/** Cookie web wrapper — records.reassign gate + business-scoped client +
 *  cookie store scope, then the core (which owns neither). Success-only
 *  audit emit (⚖ HELD): nothing is written on the preview phase or on any
 *  refusal. First action in the codebase to touch TWO customer profile
 *  pages in one write (census B §Q5) — both are revalidated, never just one. */
export async function reassignKaruteCustomer(
  karuteId: string,
  toCustomerId: string,
  opts: { confirmed: boolean },
): Promise<ReassignKaruteCustomerResult> {
  try {
    await requireCapability('records.reassign')
    const synqed = await getSynqedClient()
    const { viewAll, allowedStoreIds, degraded } = await resolveStoreScope()
    const { actorId, businessId } = await resolveWebAuditContext()
    const result = await reassignKaruteCustomerWithClient(
      synqed,
      karuteId,
      toCustomerId,
      opts,
      { viewAll, allowedStoreIds, degraded },
      { actorId, businessId, source: 'web' },
    )
    if ('requiresConfirm' in result) return result

    await auditWeb({
      category: 'karute',
      action: 'karute.customer_reassign',
      targetType: 'karute',
      targetId: karuteId,
      detail: {
        from_customer_id: result.fromCustomerId,
        to_customer_id: result.toCustomerId,
        // R3-2 (fix round 3): renamed burn_count → same_day_burn_count so
        // the receipt never overclaimed precision.
        // R11-1 (fix round 11, Greptile round-6 closure): split further —
        // linked_burn_count is the provable count, same_day_burn_count is
        // presence-only. Conflating them into one key was exactly the
        // attribution finding this round closes; the audit receipt must not
        // re-introduce it.
        linked_burn_count: result.linkedBurnCount,
        same_day_burn_count: result.sameDayBurnCount,
        photo_count: result.photoCount,
      },
      requestId: crypto.randomUUID(),
    })

    // First write to ever touch two customer profile pages at once — every
    // sibling write only ever revalidates the ONE customer_id it wrote
    // (census B §Q5). Locale-pattern form (fix round 2, item F): routing.ts
    // has no localePrefix override, so next-intl defaults to 'always' (its
    // own receiveRoutingConfig source: `mode: a || "always"`) and the ONLY
    // customer page route is [locale]/(app)/customers/[id] — a bare
    // '/customers/{id}' matches no page and is a no-op. packs.ts:34-35
    // already carries the correct idiom for this exact route
    // (revalidateProfile); src/actions/customers.ts's 10 call sites still use
    // the bare (broken) form — a pre-existing sibling bug, queued, not fixed
    // here (scope discipline).
    revalidatePath('/[locale]/(app)/customers/[id]', 'page')
    revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    updateTag('dashboard')
    // 未保存カルテ rollup dedupes by customer_id (60s TTL otherwise) —
    // census B §Q5. 'max' profile = immediate invalidation, same convention
    // as staff/[id]/route.ts's revalidateTag('staff-list', 'max').
    revalidateTag('customers', 'max')

    return {
      success: true,
      linkedBurnCount: result.linkedBurnCount,
      sameDayBurnCount: result.sameDayBurnCount,
      photoCount: result.photoCount,
    }
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}

/** The reassign picker's roster (packet §2g) — STORE-SCOPED, never the
 *  detail page's own `listAllCustomers` numbering fetch (that one is
 *  business-wide, census A §Q3 — reusing it for a picker would leak another
 *  branch's customers to a clamped actor). Current customer excluded
 *  server-side (hide, never filter-after-ship).
 *
 *  A degraded scope (the actor's own store assignment lookup failed) is
 *  refused BEFORE any list fetch — customerLensFor's read-plane convention
 *  would otherwise ship this actor the BUSINESS-WIDE roster (it ignores
 *  `degraded` by design), and ensureReassignStoreScope then refuses every
 *  pick from it anyway. Showing a roster full of other branches' customers
 *  behind a doomed picker is show-and-refuse — this file's own
 *  menuStoresForScope (store-scope.ts) names the same rule for the store
 *  picker (isolation law: hide, never show-and-refuse; Greptile P1 on #707).
 *
 *  R3-1: the SAME source-store refusal ensureReassignStoreScope enforces on
 *  the write is run here too, before the roster is built — a clamped actor
 *  must not even see a picker for a karute record that itself sits outside
 *  their assignment.
 *
 *  R9-2 (existence-oracle class): that refusal's message now matches
 *  readKaruteRaw's not_found string exactly — same reasoning as
 *  ensureReassignStoreScope's own R9-2 comment above. */
export async function listReassignCustomerOptions(
  karuteId: string,
): Promise<{ customers: ReassignCustomerOption[] } | { error: string }> {
  try {
    await requireCapability('records.reassign')
    const synqed = await getSynqedClient()
    const record = await readKaruteRaw(synqed, karuteId)
    const scope = await resolveStoreScope()
    if (scope.degraded) {
      return { error: 'could not verify your store assignment (fail-closed)' }
    }
    if (sourceStoreOutOfScope(record, scope)) {
      return { error: 'karute not found in this business' }
    }
    const lens = customerLensFor(scope)
    // Lazy import — cached.ts value-imports @synqed-kk/client at module scope
    // (constructs its own SynqedClient inside the unstable_cache callback),
    // the same module-graph-pollution concern the toCustomerInScope helper's
    // lazy list-all.ts import documents above.
    const { getCachedCustomerList } = await import('@/lib/customers/cached')
    const list = lens === null ? [] : await getCachedCustomerList(lens)
    return {
      customers: list
        .filter((c) => c.id !== record.customer_id)
        .map((c) => ({ id: c.id, name: c.name, furigana: c.furigana, phone: c.phone })),
    }
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
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
  let storeId: string | null

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
    ;({ storeId } = await resolveKaruteStoreId(synqed, null))

    const result = await createManualKaruteRecordWithClient(synqed, { ...input, storeId })
    // The shared body's catch already produced this door's exact { error }
    // shape (same message, same 'Unexpected error' fallback), so returning it
    // is byte-equivalent to the throw reaching the catch below.
    if ('error' in result) return result
    recordId = result.id
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unexpected error') }
  }

  // Audit (packet PR B2 §2): the WEB "+ 新規カルテ" door was genuinely
  // untracked — only the facade twin auto-emitted via
  // FACADE_AUDIT_MAP['karute.manualCreate']. Never in the shared body
  // (createManualKaruteRecordWithClient stays audit-free, PHONEWIRE-2A) —
  // that body also runs under the facade door, and an emit there would
  // double-write on the phone. Manual creation has no linked appointment
  // (see resolveKaruteStoreId(synqed, null) above), so appointment_id is
  // always null here.
  const { actorId, businessId } = await resolveWebAuditContext()
  audit({
    category: 'karute',
    action: 'karute.manual_create',
    actorId,
    actorType: 'staff',
    businessId,
    targetType: 'karute',
    targetId: recordId,
    storeId: storeId ?? undefined,
    detail: {
      customer_id: input.customerId,
      staff_id: input.staffId,
      appointment_id: null,
    },
    requestId: crypto.randomUUID(),
    source: 'web',
  })

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
    // readKaruteMetaRaw, not a bare get: it classifies a missing/cross-tenant
    // id into the SAME not_found the store lock below throws, so the two
    // refusals read identically on this transport (the facade twin already
    // does this via readKaruteRaw). Still include_entries:false — the full
    // clinical text never ships just to read two ids.
    const record = await readKaruteMetaRaw(synqed, recordId)
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
      { actorId, businessId, source: 'web', requestId: crypto.randomUUID() },
      record?.customer_id ?? null,
      { recordStoreId: record?.store_id ?? null, scope: await resolveStoreScope() },
    )
    if ('ok' in result) {
      revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    }
    // Collapse the core-only validationError variant — the sheet only ever
    // sees {ok}|{conflict}|{error}.
    if ('validationError' in result) return { error: result.validationError }
    return result
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}

// ---------------------------------------------------------------------------
// updateKaruteDetailSummary (edit-layer W2 summary half — the 詳細記録 pencil)
// ---------------------------------------------------------------------------

/** Cookie web wrapper — records.write gate + business-scoped client +
 *  resolved identity, then the core (which owns the spine emit). The
 *  authoritative GET supplies customer_id AND the before-text — never the
 *  client (same Greptile-#616 rationale as updateKaruteDetailEntry). */
export async function updateKaruteDetailSummary(
  recordId: string,
  input: { content: string },
): Promise<UpdateKaruteDetailSummaryResult> {
  try {
    await requireCapability('records.write')
    const synqed = await getSynqedClient()
    const actorStaffId = await getCurrentUserStaffId()
    const { actorId, businessId } = await resolveWebAuditContext()
    // readKaruteMetaRaw — see updateKaruteDetailEntry's note.
    const record = await readKaruteMetaRaw(synqed, recordId)
    const result = await updateKaruteDetailSummaryWithClient(
      synqed,
      recordId,
      { content: input.content, actorStaffId },
      { actorId, businessId, source: 'web', requestId: crypto.randomUUID() },
      record?.customer_id ?? null,
      record?.edited_summary ?? record?.ai_summary ?? null,
      { recordStoreId: record?.store_id ?? null, scope: await resolveStoreScope() },
    )
    if ('ok' in result) {
      revalidatePath('/[locale]/(app)/karute/[id]', 'page')
    }
    // Collapse the core-only validationError variant — the sheet only ever
    // sees {ok}|{error}.
    if ('validationError' in result) return { error: result.validationError }
    return result
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}

// ---------------------------------------------------------------------------
// listEntryEditHistory (edit-layer W2 history sheet — 編集済み chip → the
// per-entry attribution panel; PR-B's trail read out loud)
// ---------------------------------------------------------------------------

/** Cookie web wrapper — customers.view gate (same class gate as the detail
 *  screen read, screens/karute/[id]/route.ts:51). businessId scopes a REAL
 *  read (the roster join) here, not just the audit line, so it's resolved
 *  directly via getBusinessId() — a failure fails the whole read, same as
 *  resolveWebBusinessId's own doc comment prescribes for that case. */
export async function listEntryEditHistory(
  recordId: string,
): Promise<{ edits: EntryEditHistoryRow[]; truncated: boolean } | { error: string }> {
  try {
    await requireCapability('customers.view')
    const synqed = await getSynqedClient()
    const businessId = await getBusinessId()
    return await listEntryEditHistoryWithClient(synqed, businessId, recordId)
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}

/** The カルテ tab search-reveal's ONE row shape (PR-1b 検索リビール). */
export interface KaruteRevealCandidate {
  id: string
  name: string
  code: string
  registeredDate: string
}

/**
 * カルテ tab search-reveal (PR-1b 正直ヘッダー + 検索リビール): the mock's
 * approved そっと1行だけ — when a search term matches a customer who has NO
 * karute yet in the active store, this returns that ONE customer so the list
 * can show a single muted row + カルテを作成 CTA instead of hiding them
 * entirely. Never more than one — the first qualifying candidate wins.
 *
 * Store scoping (⚖ Liam 2026-09-16, P3 cross-branch search — supersedes the
 * PR-1b adversarial-round ruling below for the search half):
 *   - the SEARCH itself is now ALWAYS business-wide, same as list-all.ts's
 *     own search (list-all.ts's storeFilter formula) — a branch-restricted
 *     staff can find another store's customer here too, matching the "find
 *     any company customer" rule.
 *   - the zero-karute CHECK is ALWAYS scoped to the active store, regardless
 *     of whether the search itself was business-wide — a customer with
 *     karute at another branch still has none HERE, so they still reveal.
 *   - customers.enrichment() is BUSINESS-WIDE by declaration and is BANNED
 *     for this check; only a direct store-scoped karuteRecords.list qualifies.
 * A `degraded` scope needs no special case here: since Round 2 (2026-09-24,
 * D-S16-4) resolveStoreScope shapes it as `allowedStoreIds: []` with a null
 * storeId, which the clamp-with-no-store guard below answers with no
 * candidate — never an unscoped search.
 */
export async function revealNoKaruteCustomer(
  query: string,
): Promise<{ candidate: KaruteRevealCandidate | null } | { error: string }> {
  try {
    await requireCapability('customers.view')
    const q = query.trim()
    if (!q) return { candidate: null }

    const scope = await resolveStoreScope()
    const enforceStore = scope.allowedStoreIds != null
    // Defensive, mirrors list-all.ts's own "clamped ⇒ storeId non-null"
    // backstop: a clamp with no resolvable store must never fall through to
    // an unscoped search.
    if (enforceStore && !scope.storeId) return { candidate: null }

    const synqed = await getSynqedClient()
    // Business-wide (P3): search no longer clamps on enforceStore — see the
    // doc comment above.
    const res = await synqed.customers.list({ search: q, store_id: undefined, page_size: 5 })
    for (const c of res.customers) {
      const karute = await synqed.karuteRecords.list({
        customer_id: c.id,
        store_id: scope.storeId ?? undefined,
        page_size: 1,
      })
      if ((karute.total ?? 0) === 0) {
        const code =
          typeof c.karute_number === 'number' && c.karute_number > 0
            ? `#${String(c.karute_number).padStart(5, '0')}`
            : '#00000'
        return {
          candidate: { id: c.id, name: c.name, code, registeredDate: c.created_at },
        }
      }
    }
    return { candidate: null }
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}

/** One date-chunk of the カルテ list, projected into render-ready rows.
 *  Mirrors {@link KaruteWindow} but carries `items` (the shared
 *  buildSessionsListScreen projection) instead of raw rows — the client has
 *  none of the staff/customer maps the projection needs, so the boundary that
 *  crosses the wire is the SAME item shape the page already renders. */
export type KaruteWindowPage = {
  items: KaruteListItem[]
  windowStart: string
  freshStoreTotal: number
  freshDiscardedCount: number
  /** D10 (PR-C, self-lighting): see {@link KaruteWindow.freshSharedCount} —
   *  `undefined` until core ships `shared_count`, never defaulted to 0. */
  freshSharedCount?: number
  hasMore: boolean
}

/**
 * カルテ tab 日付チャンク読み込み (PR-2a): load one more date-window of the
 * list — the さらに表示 button's server half, and PR-2b's 月ジャンプ fetch.
 *
 * `olderThan` is the previous window's `windowStart` (YYYY-MM-DD, JST); the
 * walk resumes strictly older than it. `month` ('YYYY-MM') is part of the
 * signature FROM PR-2a — PR-2b is what starts sending it. `loadedCount` is the
 * caller's RAW accumulated row count (never the post-filter 表示中 count) and
 * feeds the ONE hasMore formula (karuteHasMore) plus the epoch-sweep decision.
 *
 * Scope = the cookie-bound web lens (resolveStoreScope), exactly like the page
 * read it continues; the facade twin (/api/app/v1/karute/window) mirrors it
 * with resolveStoreForRequest. The fan-out is deliberately the SAME one
 * page.tsx does — staff roster, customer list, synqed staff — because the row
 * projection needs all three (会員番号 is assigned by position over the WHOLE
 * customer list, so a subset read would renumber every row). Ceiling: one tap
 * costs one page-equivalent fan-out; the alternative was a second, divergent
 * projection path.
 */
export async function loadKaruteWindow(input: {
  olderThan?: string
  month?: string
  loadedCount?: number
  /** D10 (PR-C): the manager's 共有 list mode — see loadKaruteWindowRows. */
  sharedOnly?: boolean
}): Promise<KaruteWindowPage | { error: string }> {
  try {
    await requireCapability('customers.view')

    // LENS PARITY with the facade route's QuerySchema (Greptile PR #779 P1): a
    // server action is callable with arbitrary input too, so an impossible
    // calendar value is refused HERE as well rather than rolling over into a
    // window the caller never asked for (`2026-02-30` → 2026-03-02) or
    // throwing an Invalid Date out of the walk. Same ONE pair of validators
    // both surfaces use, so the two can never drift.
    if (input.olderThan !== undefined && !isValidKaruteYmd(input.olderThan)) {
      return { error: 'olderThan must be a real calendar date (YYYY-MM-DD)' }
    }
    if (input.month !== undefined && !isValidKaruteMonth(input.month)) {
      return { error: 'month must be a real calendar month (YYYY-MM)' }
    }

    // F1 fix (PR-C fix round 1, ⚖ "the wire must not tell a colleague a
    // share happened"): ONE capability read, reused below for BOTH the
    // sharedOnly refusal and the builder's row-level isShared gate — never
    // two reads that could drift. A sharedOnly request from a non-holder is
    // refused HONESTLY (never silently served as the full unfiltered list —
    // that would let anyone with customers.view discover who has a share by
    // comparing row counts).
    const holdsViewShared = await can('recordings.viewShared')
    if (input.sharedOnly && !holdsViewShared) {
      return { error: 'forbidden' }
    }

    const [synqed, scope, businessId] = await Promise.all([
      getSynqedClient(),
      resolveStoreScope(),
      getBusinessId(),
    ])
    const activeStore = scope.storeId
    const clamped = scope.allowedStoreIds != null

    const [staffList, allCustomersList, currentStaffId, window, synqedStaff] =
      await Promise.all([
        getStaffList(),
        clamped
          ? listAllCustomersCached(businessId, {
              store_id: activeStore,
              enforceStore: true,
              sort_by: 'created_at',
              sort_order: 'asc',
            })
          : listAllCustomersCached(businessId, { sort_by: 'created_at', sort_order: 'asc' }),
        getCurrentUserStaffId(),
        loadKaruteWindowRows(synqed, {
          storeId: activeStore,
          // Same clamp the customer list above carries — see the page.
          enforceStore: clamped,
          olderThan: input.olderThan,
          month: input.month,
          loadedCount: input.loadedCount,
          sharedOnly: input.sharedOnly,
        }),
        synqed.staff.list({ page_size: 200 }),
      ])

    const storeStaffIds = reachesNoStore(scope)
      ? new Set<string>()
      : await storeStaffIdSet(staffList, activeStore)
    const screen = buildSessionsListScreen({
      staffList,
      storeStaffIds,
      allCustomersList,
      currentStaffId,
      synqedKaruteRows: window.rows,
      synqedStaff,
      // Status-line numbers are the PAGE's job (it owns the 今月 probe); this
      // append only carries rows. freshStoreTotal rides the response field.
      monthCount: 0,
      total: window.freshStoreTotal,
      discardedCount: window.freshDiscardedCount,
      // F1 fix (PR-C fix round 1): REQUIRED — gates isShared per row.
      viewerHoldsViewShared: holdsViewShared,
    })

    return {
      items: screen.items,
      windowStart: window.windowStart,
      freshStoreTotal: window.freshStoreTotal,
      freshDiscardedCount: window.freshDiscardedCount,
      // F1 fix (PR-C fix round 1): the default walk's さらに表示 responses
      // used to carry this to EVERY viewer — now undefined for a non-holder,
      // never `?? 0`.
      freshSharedCount: holdsViewShared ? window.freshSharedCount : undefined,
      hasMore: window.hasMore,
    }
  } catch (err) {
    return { error: (await coreFailureLine(err, '[karute]')) ?? (err instanceof Error ? err.message : 'Unknown error') }
  }
}
