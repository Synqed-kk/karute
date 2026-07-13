'use server'

import { getCurrentUserStaffId } from '@/lib/staff'
import { requireCapability } from '@/lib/auth/require-permission'
import { getSynqedClient } from '@/lib/synqed/client'

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

    // Same staff_id resolution as saveKaruteRecord: attribute to whoever is
    // RECORDING (the signed-in staff), falling back to the appointment's staff
    // only when the account has no staff identity of its own.
    let staffId: string | null = await getCurrentUserStaffId()
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
  } catch (err) {
    console.error('[startRecordingSession] failed:', err)
    return null
  }
}
