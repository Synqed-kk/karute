'use server'

import type { SynqedClient } from '@synqed-kk/client'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { resolveWebAuditContext } from '@/lib/audit-web'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { deleteRecordingSessionWithClient } from '@/lib/recording/session-cleanup'
import {
  finalizeTakeWithClient,
  type FinalizeTakeInput,
  type FinalizeTakeResult,
} from '@/lib/recording/finalize-take'

/**
 * Mints a `recording_sessions` row (synqed-core, server-generated uuid) the
 * moment a recording starts, so the eventual karute save can attach
 * recording_session_id — the id core's createKaruteRecord dedupes an
 * idempotent retry against (PR #38). A client-invented id would FK-violate;
 * this id MUST come from synqed.recordings.create().
 *
 * Called from GlobalRecorder.start() IN PARALLEL with getUserMedia — recording
 * must never be blocked or delayed by this network call. On ANY failure
 * (no staff identity, capability denied, SDK throw) returns null: the save
 * simply proceeds without recording_session_id, exactly like before this
 * feature existed (no dedupe for that save — accepted graceful degradation).
 */
export async function startRecordingSession(input: {
  customerId?: string | null
  appointmentId?: string | null
}): Promise<{ id: string } | null> {
  try {
    // Recording a session = records.write — same gate saveKaruteRecord uses
    // (owner / manager / senior / practitioner — not frontdesk).
    await requireCapability('records.write')

    const synqed = await getSynqedClient()

    // Recorder-first attribution (the signed-in staff), appointment-staff
    // fallback only when the account has no staff identity of its own.
    const staffId = await getCurrentUserStaffId()
    return await startRecordingSessionWithClient(synqed, { ...input, selfStaffId: staffId })
  } catch (err) {
    console.error('[startRecordingSession] failed:', err)
    return null
  }
}

/**
 * Recording-session mint core — EXPLICIT business-scoped client + a resolved
 * self staff id, no cookie (packet 08 §Build 3). Shared by the web action
 * (cookie → getCurrentUserStaffId) and the facade route (Bearer → selfStaffId).
 * Recorder-first attribution with the appointment-staff fallback; a null on any
 * unresolvable staff preserves the web action's fail-OPEN contract (capture
 * proceeds without dedupe — never blocked on the mint). Throws only on a genuine
 * SDK failure, which the callers swallow to null.
 */
export async function startRecordingSessionWithClient(
  synqed: Pick<SynqedClient, 'appointments' | 'recordings'>,
  input: {
    customerId?: string | null
    appointmentId?: string | null
    selfStaffId: string | null
  },
): Promise<{ id: string } | null> {
  let staffId: string | null = input.selfStaffId
  if (!staffId && input.appointmentId) {
    const appt = await synqed.appointments.get(input.appointmentId).catch(() => null)
    staffId = appt?.staff_id ?? null
  }
  if (!staffId) return null

  // No store_id: saveKaruteRecord's create() call doesn't send one either.
  const recording = await synqed.recordings.create({
    staff_id: staffId,
    customer_id: input.customerId ?? null,
    appointment_id: input.appointmentId ?? null,
  })
  return { id: recording.id }
}

/**
 * Web door for "this take is complete" — the cookie twin of
 * POST /api/app/v1/recordings/finalize. Both call the ONE choke point
 * (lib/recording/finalize-take.ts), which owns the tenant fence, the ownership
 * check, the idempotency and the single audit row.
 *
 * Every identity the core needs is resolved HERE, from the cookie session:
 * a caller cannot name its own business, staff, store or reach.
 *
 * NEVER THROWS. Finalize runs on the stop path, and a thrown finalize would
 * put an error dialog between the staffer and a take whose audio is already
 * on the server. Every failure is a settled `{ error }` the caller can retry.
 */
export async function finalizeTake(input: FinalizeTakeInput): Promise<FinalizeTakeResult> {
  try {
    // Same gate as the mint and the session start — recording = records.write.
    await requireCapability('records.write')
    const [businessId, staffId, capabilities, scope] = await Promise.all([
      getBusinessId(),
      getCurrentUserStaffId(),
      getMyCapabilities(),
      resolveStoreScope(),
    ])
    return await finalizeTakeWithClient(
      newSynqedClient(businessId),
      {
        staffId,
        businessId,
        storeId: scope.storeId,
        canViewAll: capabilities.has('recordings.viewAll'),
        source: 'web',
      },
      input,
    )
  } catch (err) {
    console.warn('[finalizeTake] failed:', err)
    return { error: 'failed' }
  }
}

/**
 * The mint's undo — see lib/recording/session-cleanup.ts for why this exists
 * and when it gets deleted. Web door; the facade twin is
 * /api/app/v1/recordings/session/[id]. Fire-and-forget by contract: callers
 * never await it into the discard UX.
 */
export async function deleteRecordingSession(
  recordingSessionId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    // Same gate the mint carries — only a recorder discards a recording.
    await requireCapability('records.write')
    const [synqed, staffId, ctx] = await Promise.all([
      getSynqedClient(),
      getCurrentUserStaffId(),
      resolveWebAuditContext(),
    ])
    return await deleteRecordingSessionWithClient(
      synqed,
      { staffId, businessId: ctx.businessId, source: 'web' },
      recordingSessionId,
    )
  } catch (err) {
    // Never blocks the discard — the row just stays until the 7-day window
    // rolls past it.
    console.warn('[deleteRecordingSession] failed:', err)
    return { error: 'failed' }
  }
}
