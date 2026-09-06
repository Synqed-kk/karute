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
// ⚖ AND IT STAMPS NO DURATION, EVER (ADDENDUM 9.2 H3, 2026-09-07). The
// D8' amendment had this door write the flush-window estimate, because the
// 03:07 cron has no actor and core fences `PUT /v1/recordings/:id` behind a
// human one. The side key (amendment 9) makes that wrong: a rescued take's
// phone can still come back, and `finalizedBefore` reads TRUE the moment any
// duration is on the row — so a stamped estimate would send the returning
// device's finalize down the `already` exit, leaving a 15-second length on a
// 45-minute recording, a scrubber that lies and NO capture_finalized row for
// the real arrival. So a rescued row's duration stays null until the phone
// itself writes the true one. The job's own status is what playback's fence
// reads; the inbox's length column is blank until then, and that is the
// named, honest ceiling.
//
// NO 'use server': every function takes the tenant it is scoped to as an
// argument, so as client-invokable actions these would take any caller's word
// for who they are — the same rule take-binding.ts and mint-take-url.ts state.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { assertRecorderOwnsRow, statusOf } from '@/lib/recording/take-binding'
import { parseRecordingKey } from '@/lib/recording/key-grammar'
import { resolveTakeAudio } from '@/lib/recording/take-audio'
import { isReturningCustomerServerSide } from '@/lib/karute/revisit-guard'
import type { FinalizeTakeActor } from '@/lib/recording/finalize-take'
import type { RecordingJobPayload } from '@/lib/jobs/process-recording'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

type Core = Pick<
  SynqedClient,
  'recordings' | 'recordingJobs' | 'customers' | 'packs' | 'karuteRecords' | 'recordingDiscards'
>

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
   *  this actor's to act on · `discarded` a staff member deliberately threw
   *  this recording away and wrote why — TERMINAL, and the one refusal that
   *  outranks everything · `no_audio` the server holds this take at NEITHER key
   *  — not the phone's object, not the rescue (the honest answer, and the one
   *  the row's own chip should already have prevented the staffer from
   *  reaching) · `not_returning` the
   *  revisit label cannot be true for this customer · `upstream` a moment in
   *  time — storage or core did not answer; the tap can be repeated. */
  | { error: 'not_found' | 'forbidden' | 'discarded' | 'no_audio' | 'not_returning' | 'upstream' }

/**
 * Enqueue the normal worker job against the audio the SERVER holds for this
 * session.
 *
 * The order of refusals is deliberate, and it is load-bearing:
 *   1. identity — cheapest, and it settles the caller;
 *   2. OWNERSHIP, before any storage question. A 404-vs-403 split decided after
 *      a probe would tell a caller whether a COLLEAGUE's take object is in the
 *      bucket. The tests assert storage was never touched on a refusal, so the
 *      order cannot quietly move (fix round 1, R4);
 *   3. the DISCARD ledger — a deliberate discard outranks everything;
 *   4. the key fence, then the storage calls that PROVE where the audio is.
 * A job queued against an object that is not in the bucket costs the worker a
 * fetch, three retries and a FAILED row — and leaves the staffer's row at 失敗
 * with no better story than before.
 *
 * ⚖ THE STORE REACH, RESOLVED (PR-B, merged 2026-09-06).
 * `EnqueueFromSessionActor extends FinalizeTakeActor`, whose `allowedStoreIds`
 * is REQUIRED, so both callers resolve it the way the finalize callers do and
 * the compiler is what says they must: web reads viewerScopeForActs, the
 * facade reads store-clamp's viewerAllowedStoreIds, each ONLY when the owner's
 * keys are held (an own-session save never reaches the store leg). Typing
 * `allowedStoreIds: null` at a caller to satisfy the type would read as
 * UNCLAMPED under D7's null rule and silently widen the owner's hand over a
 * store-stamped row — which is why neither caller does.
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

  // ⚖ A DELIBERATE DISCARD OUTRANKS EVERYTHING (fix round 1, R9a; A2-3).
  //
  // Asked HERE rather than read off the display row's `discardedByStaff`,
  // because that flag is documented to fail OPEN twice over: the ledger read
  // degrades to an empty set on any error, and it is capped at 20 pages. A
  // discard leaves the audio exactly where it was (⚖ audio is never deleted,
  // and an ordinary discard keeps the TAKE key), so a blind pass would let this
  // door write a karute from a recording a staff member threw away with a
  // written reason — the G9 outcome the fold's first branch exists to make
  // structurally impossible. One bounded read, on a rare act, with a real
  // session filter.
  //
  // A THROW REFUSES. "We could not check" is never "not discarded" here.
  //
  // ⚖ AND THE FENCE CHECKS, IT NEVER COUNTS (fix round 2, R1). The rows that
  // come back are re-read in code, for the reason recording-discard-transcript
  // .ts's `hasStaffDiscard` states in its own docblock about this same call: a
  // fence does not trust the query filter it asked for. If core ever stopped
  // honouring `recording_session_id` — a rename on an SDK bump, a proxy that
  // strips an unknown param — a bare count would turn ONE reasoned discard
  // anywhere in the business into a 409 on EVERY server save in that salon,
  // silently and green, because a fake that implements the filter cannot see
  // it. That count refused too much; it never wrote anything unlawful.
  //
  // ⚖ AND THE CHECK'S POLARITY IS THE OPPOSITE OF ITS SIBLING'S, SO IT NEEDS
  // ITS OWN GUARD (fix round 3, R1). `hasStaffDiscard` next door requires a
  // discard to EXIST before it writes, so a field core stopped sending makes
  // that door refuse. This one requires a discard to be ABSENT before it
  // saves, so the SAME missing field would let the save through — over a
  // recording a staff member threw away with a written reason, which is the
  // one outcome this fence exists to prevent. A row whose
  // `recording_session_id` or `source` is not a string is not an answer about
  // anything, so it takes the `upstream` exit the throw arm takes and the
  // staffer can tap again: "we could not read it" is never "not discarded"
  // either. It cannot fire while the SDK's shape holds (RecordingDiscardEvent
  // has both fields required today), which is what makes it cheap to keep.
  try {
    const discards = await synqed.recordingDiscards.list({
      recording_session_id: input.recordingSessionId,
      source: 'STAFF',
      page_size: 1,
    })
    const events = discards?.events ?? []
    const unreadable = events.some(
      (e) => typeof e?.recording_session_id !== 'string' || typeof e?.source !== 'string',
    )
    if (unreadable) return { error: 'upstream' }
    const hit = events.some(
      (e) => e?.source === 'STAFF' && e.recording_session_id === input.recordingSessionId,
    )
    if (hit) return { error: 'discarded' }
  } catch (err) {
    console.warn('[enqueueFromSession] discard ledger unreadable:', err)
    return { error: 'upstream' }
  }

  // THE PATH COMES FROM HERE AND NOWHERE ELSE, and this is also the key fence:
  // a `stg/` staged copy, a segment leaf and another tenant's key all fail to
  // parse as this business's take.
  const audioPath = row.audio_storage_path
  const parsed = parseRecordingKey(audioPath, actor.businessId)
  if (!audioPath || parsed?.kind !== 'take') return { error: 'no_audio' }

  // ⚖ STORAGE IS THE GATE, NOT THE ROW (D8'). `serverHoldsTakeRow` would be the
  // familiar question here, but it reads the row's DURATION — and a take the
  // nightly assembler just rescued has audio and no duration, because core
  // fences that write behind a human actor. Asking the row would refuse the
  // exact save this door exists for.
  //
  // ⚖ AND THE AUDIO MAY BE AT EITHER OF TWO KEYS (amendment 9, Liam "b"): the
  // phone's own object, or the rescue the nightly job sealed beside it. ONE
  // resolver answers that for every reader in the repo, in one precedence —
  // the phone's copy first, because it is the whole take and the rescue is by
  // construction a prefix. It is asked with the PARSED take, so this door
  // still keeps its own fence and cannot be pointed at a foreign key.
  // 'unknown' is not "no": a blip must leave the staffer able to tap again,
  // never tell them their recording is gone.
  const resolved = await resolveTakeAudio(actor.businessId, parsed.takeId, parsed.ext)
  if (resolved === 'unknown') return { error: 'upstream' }
  if (resolved === 'absent') return { error: 'no_audio' }

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
  // worker, one shape. The only line that differs is `audio_path`: it is
  // whichever key the resolver just proved, which is the line this door exists
  // for. A `rsc/` key passes the worker's own re-check because that fence asks
  // isOwnAudioKey — the SERVER-DERIVED spelling — while every client-named
  // door stays 'take'-only (ADDENDUM 9.1 H1).
  //
  // `duration_seconds` is whatever the ROW already carries and nothing else:
  // null for a rescued take, and it stays null until the phone comes back and
  // finalizes (H3 above). The worker treats it as it always has.
  const payload: RecordingJobPayload = {
    customer_id: input.customerId,
    staff_id: actor.jobStaffId,
    appointment_id: input.appointmentId ?? null,
    store_id: actor.storeId,
    audio_path: resolved.key,
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
