// SAVE FROM WHAT THE SERVER ALREADY HAS (build 23 slice ③).
//
// The two existing enqueue doors (src/actions/recording-jobs.ts and the
// /recordings/job facade route) are handed an audio path by the CLIENT, because
// on their path the client is the thing that just uploaded it. This door has no
// such client: the audio reached the server without the device — the nightly
// assembler sealed a stranded take, or the phone finalized at stop and then
// died — so the only honest source for the path is the ROW.
//
// That is the whole reason this is a third door rather than a flag on the
// second: `audio_path` here is DERIVED, never accepted. The wire carries a
// recording session id and a customer id, and nothing a caller sends can point
// this job at an object. Everything after that is the twins' own shape.
//
// NO 'use server': every function takes the tenant it is scoped to as an
// argument, so as client-invokable actions these would take any caller's word
// for who they are — the same rule take-binding.ts and mint-take-url.ts state.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { assertRecorderOwnsRow, serverHoldsTakeRow, statusOf } from '@/lib/recording/take-binding'
import { objectExists } from '@/lib/recording/mint-take-url'
import { isReturningCustomerServerSide } from '@/lib/karute/revisit-guard'
import type { FinalizeTakeActor } from '@/lib/recording/finalize-take'
import type { RecordingJobPayload } from '@/lib/jobs/process-recording'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

type Core = Pick<SynqedClient, 'recordings' | 'recordingJobs' | 'customers' | 'packs' | 'karuteRecords'>

/**
 * WHO is asking, plus the two ids only the DOOR can resolve.
 *
 * The identity half is `FinalizeTakeActor` itself, not a copy: this door asks
 * the take doors' own ownership question (assertRecorderOwnsRow), so it must
 * ask it with the take doors' own actor shape or the two drift.
 */
export interface EnqueueFromSessionActor extends FinalizeTakeActor {
  /** The SYNQED staff id the JOB is attributed to — a different id space from
   *  `staffId` above (which is the auth user id core stamps on the session's
   *  staff_id). Resolved by the caller exactly as the two existing enqueue
   *  doors resolve it: resolveSynqedStaffId on web, resolveSynqedStaffIdForBusiness
   *  on the facade. */
  jobStaffId: string
  /** The caller's own store scope — resolveStoreScope() on web,
   *  resolveStoreForRequest() on the facade. Same field, same source, same
   *  value as the twins put in their payload. */
  storeId: string | null
}

export interface EnqueueFromSessionInput {
  recordingSessionId: string
  customerId: string
  appointmentId?: string | null
  locale?: string
  outcome?: SessionOutcome
}

export type EnqueueFromSessionResult =
  | { ok: true; jobId: string; status: string }
  /** `not_found` the session id is not this business's · `forbidden` it is not
   *  this actor's to act on · `no_audio` the server does not hold this take's
   *  finalized object (the honest answer, and the one the row's own chip should
   *  already have prevented the staffer from reaching) · `not_returning` the
   *  revisit label cannot be true for this customer · `upstream` a moment in
   *  time — storage or core did not answer; the tap can be repeated. */
  | { error: 'not_found' | 'forbidden' | 'no_audio' | 'not_returning' | 'upstream' }

/**
 * Enqueue the normal worker job against the audio the SERVER holds for this
 * session.
 *
 * The order of refusals is deliberate: identity first (cheapest, and it settles
 * the caller), then the row's own claim that a take is there, then the one
 * storage call that PROVES it. A job queued against an object that is not in
 * the bucket costs the worker a fetch, three retries and a FAILED row — and
 * leaves the staffer's row at 失敗 with no better story than before.
 */
export async function enqueueFromSessionWithClient(
  synqed: Core,
  actor: EnqueueFromSessionActor,
  input: EnqueueFromSessionInput,
): Promise<EnqueueFromSessionResult> {
  // Nothing to attribute a recording to, so nothing may be queued. Ahead of
  // the read because it costs nothing and settles the caller.
  if (!actor.staffId) return { error: 'forbidden' }

  let row: Recording
  try {
    row = await synqed.recordings.get(input.recordingSessionId)
  } catch (err) {
    if (statusOf(err) === 404) return { error: 'not_found' }
    console.warn('[enqueueFromSession] session read failed:', err)
    return { error: 'upstream' }
  }

  // Core's GET is BUSINESS-scoped only, so the tenant and the recorder are both
  // checked here — the SAME predicate, in the same words, that lets someone
  // finalize or re-point a colleague's take: own session, or the owner's hand.
  const denied = assertRecorderOwnsRow(row, actor)
  if (denied) return denied

  // THE PATH COMES FROM HERE AND NOWHERE ELSE. serverHoldsTakeRow is also the
  // key fence: a `stg/` staged copy, a segment leaf and another tenant's key
  // are all false however the row's duration and status read.
  if (!serverHoldsTakeRow(row, actor.businessId)) return { error: 'no_audio' }
  const audioPath = row.audio_storage_path

  // …and serverHoldsTakeRow is a HEURISTIC, which its own docblock says out
  // loud. One storage call turns it into a proof before anything is queued.
  // 'unknown' is not "no": a storage blip must leave the staffer able to tap
  // again, not tell them their recording is gone.
  const exists = await objectExists(audioPath)
  if (exists === 'unknown') return { error: 'upstream' }
  if (!exists) return { error: 'no_audio' }

  // Revisit eligibility BEFORE anything is persisted — the same rule, and the
  // same reasoning, as the /recordings/job facade route: processJob writes the
  // outcome only after Deepgram and OpenAI have run, so a throw there re-spends
  // both on every retry. It lives in this shared body rather than at the doors
  // so both of them are covered by construction.
  if (input.outcome?.status === 'revisit') {
    const eligibility = await isReturningCustomerServerSide(synqed, input.customerId, {
      recordingSessionId: input.recordingSessionId,
    })
    if (eligibility === 'not_returning') return { error: 'not_returning' }
    if (eligibility === 'unknown') return { error: 'upstream' }
  }

  // The SAME payload the two existing doors build, field for field — one
  // worker, one shape. The only line that differs is `audio_path`, and it is
  // the line this door exists for.
  const payload: RecordingJobPayload = {
    customer_id: input.customerId,
    staff_id: actor.jobStaffId,
    appointment_id: input.appointmentId ?? null,
    store_id: actor.storeId,
    audio_path: audioPath,
    locale: input.locale ?? 'ja',
    duration_seconds: row.duration_seconds ?? undefined,
    outcome: input.outcome,
  }

  try {
    // Idempotent per recording session — core re-arms rather than minting a
    // second job — so a double tap converges on the one run.
    const job = await synqed.recordingJobs.enqueue({
      recording_session_id: input.recordingSessionId,
      payload: payload as unknown as Record<string, unknown>,
    })
    return { ok: true, jobId: job.id, status: job.status }
  } catch (err) {
    console.error('[enqueueFromSession] enqueue failed:', err)
    return { error: 'upstream' }
  }
}
