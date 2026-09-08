'use server'

// Client handoff points for the server-side recording→karute pipeline
// (Liam ask 2026-07-19). The recorder flow calls:
//   1. enqueueRecordingJob after the audio upload lands — returns immediately
//      AND kicks the worker on this deployment so processing starts in
//      seconds (the minutely cron is the sweep for anything the kick misses).
//   2. getRecordingJobStatus to poll — DONE carries the karute_record_id to
//      navigate to; FAILED means the app still holds the local audio, so
//      retry = enqueue again (core re-arms a FAILED job).
// The old in-tab pipeline stays until the recorder UI swaps over; both end in
// the same idempotent by-recording-session save, so mixing paths can't
// duplicate a record.

import { headers } from 'next/headers'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'
import { resolveStoreScope, viewerScopeForActs } from '@/lib/auth/store-scope'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { isOwnRecordingKey } from '@/lib/recording/key-grammar'
import {
  enqueueFromSessionWithClient,
  type EnqueueFromSessionInput,
  type EnqueueFromSessionResult,
} from '@/lib/recording/enqueue-from-session'
import type { RecordingJobPayload } from '@/lib/jobs/process-recording'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

export interface EnqueueRecordingJobInput {
  recordingSessionId: string
  customerId: string
  /** Path in the `recordings` bucket the client uploaded to. */
  audioPath: string
  appointmentId?: string | null
  locale?: string
  durationSeconds?: number
  /** Coaching label chosen at stop (packet 22 B4) — carried so the worker's
   *  save writes the SAME outcome the in-tab autosave would. Absent for the
   *  cohorts that never reach the server path (walk-ins, review takes). */
  outcome?: SessionOutcome
}

export async function enqueueRecordingJob(
  input: EnqueueRecordingJobInput,
): Promise<{ ok: true; jobId: string; status: string } | { error: string }> {
  try {
    // Same gate as the interactive save's entry: recording = records.write.
    await requireCapability('records.write')
    if (!input.recordingSessionId || !input.customerId || !input.audioPath) {
      return { error: 'recordingSessionId, customerId and audioPath are required' }
    }

    const [synqed, businessId, profileStaffId, scope] = await Promise.all([
      getSynqedClient(),
      getBusinessId(),
      getCurrentUserStaffId(),
      resolveStoreScope(),
    ])
    // Tenancy gate — the cookie-path twin of the facade route's check. audioPath
    // is a client-supplied storage key the worker later READS via a service-role
    // client (no RLS — and ⚖ never deletes, capture pipeline PR4: the take's
    // finalized object is the evidence behind the karute and stays); it MUST be
    // EXACTLY a key minted for this caller's business, matched positively
    // against the shared grammar (a bare prefix check also took a traversal
    // body, a query suffix, or a string-shaped non-string — a server action's
    // argument is caller-supplied JSON, so the `string` annotation proves
    // nothing at runtime). A hand-crafted RPC pointing at another tenant's
    // object (or a guessable `rec_*` key) is refused before any job is queued.
    // The worker re-checks the same invariant as the last defense.
    if (!isOwnRecordingKey(input.audioPath, businessId)) {
      return { error: 'recording not found in this business' }
    }
    // The worker runs without a session — attribution is captured NOW, at
    // enqueue, from the signed-in recorder (same rule as the interactive save).
    const staffId = profileStaffId
      ? await resolveSynqedStaffId(profileStaffId).catch(() => profileStaffId)
      : null
    if (!staffId) return { error: 'No staff identity for the signed-in user.' }

    const payload: RecordingJobPayload = {
      customer_id: input.customerId,
      staff_id: staffId,
      appointment_id: input.appointmentId ?? null,
      store_id: scope.storeId,
      audio_path: input.audioPath,
      locale: input.locale ?? 'ja',
      duration_seconds: input.durationSeconds,
      outcome: input.outcome,
    }
    const job = await synqed.recordingJobs.enqueue({
      recording_session_id: input.recordingSessionId,
      payload: payload as unknown as Record<string, unknown>,
    })

    // Kick the worker on this deployment (fire-and-forget) so the job starts
    // now instead of at the next minute tick. The cron remains the safety net.
    void kickWorker()

    return { ok: true, jobId: job.id, status: job.status }
  } catch (err) {
    console.error('[enqueueRecordingJob] failed:', err)
    return { error: 'Failed to enqueue the recording job.' }
  }
}

/**
 * 保存する on a 録音履歴 row whose audio is on the SERVER (build 23 slice ③).
 *
 * The web twin of POST /api/app/v1/recordings/job/from-session. It takes NO
 * audio path — the shared body derives it from the row — so unlike its
 * enqueueRecordingJob sibling above there is no client-supplied key to fence
 * here at all. Attribution and store scope are resolved from the cookie
 * session exactly as the sibling resolves them.
 */
export async function enqueueRecordingJobFromSession(
  input: EnqueueFromSessionInput,
): Promise<EnqueueFromSessionResult> {
  try {
    // Same gate as every other act a 録音履歴 row offers: records.write.
    await requireCapability('records.write')
    if (!input?.recordingSessionId || !input.customerId) {
      return { error: 'not_found' }
    }

    const [synqed, businessId, profileStaffId, scope, capabilities] = await Promise.all([
      getSynqedClient(),
      getBusinessId(),
      getCurrentUserStaffId(),
      resolveStoreScope(),
      getMyCapabilities(),
    ])
    // The worker runs without a session, so attribution is captured NOW — the
    // same rule, from the same resolver, as the sibling above.
    const jobStaffId = profileStaffId
      ? await resolveSynqedStaffId(profileStaffId).catch(() => profileStaffId)
      : null
    if (!jobStaffId) return { error: 'forbidden' }

    // ③ THE OWNER'S HAND REACHES ONLY WHERE THE PERSON CAN SEE (PR-B's rule,
    // resolved here exactly as finalizeTake's web caller resolves it — one
    // spelling of the act scope, viewerScopeForActs). Only when the pair is
    // held: a recorder saving her OWN session never reaches the store leg, so
    // an assignment blip must not cost her the recording. `null` here would
    // read as UNCLAMPED under the D7 null rule, so it is never typed — it is
    // what the resolver answers for a caller who genuinely has no restriction.
    const pairHeld = holdsOwnerKeys(capabilities)
    const allowedStoreIds = pairHeld ? await viewerScopeForActs() : null

    const result = await enqueueFromSessionWithClient(
      synqed,
      {
        staffId: profileStaffId,
        businessId,
        holdsOwnerKeys: pairHeld,
        allowedStoreIds,
        source: 'web',
        jobStaffId,
        storeId: scope.storeId,
      },
      input,
    )
    // Kick the worker on this deployment so the job starts now rather than at
    // the next minute tick — the cron stays the safety net (sibling's rule).
    if ('ok' in result) void kickWorker()
    return result
  } catch (err) {
    console.error('[enqueueRecordingJobFromSession] failed:', err)
    return { error: 'upstream' }
  }
}

export interface RecordingJobStatusView {
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
  karuteRecordId: string | null
  attempts: number
  maxAttempts: number
  /** Present only on FAILED — the client maps CONSENT_REQUIRED to its dialog. */
  lastError: string | null
}

export async function getRecordingJobStatus(
  recordingSessionId: string,
): Promise<RecordingJobStatusView | { error: string }> {
  try {
    const synqed = await getSynqedClient()
    const job = await synqed.recordingJobs.getByRecordingSession(recordingSessionId)
    return {
      status: job.status,
      karuteRecordId: job.karute_record_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      lastError: job.status === 'FAILED' ? job.last_error : null,
    }
  } catch {
    return { error: 'Job not found' }
  }
}

/** Same-deployment worker kick. Best-effort: any failure just means the
 *  minutely cron picks the job up instead. */
async function kickWorker(): Promise<void> {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) return
    const h = await headers()
    const host = h.get('host')
    if (!host) return
    const proto = host.startsWith('localhost') ? 'http' : 'https'
    await fetch(`${proto}://${host}/api/jobs/process`, {
      method: 'POST',
      headers: { 'x-worker-key': secret },
    })
  } catch {
    /* cron sweeps */
  }
}
