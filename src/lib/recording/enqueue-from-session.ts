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
// ⚖ AND IT IS WHERE THE DURATION GETS STAMPED (D8' amendment, 2026-09-06).
// Core fences `PUT /v1/recordings/:id` behind a HUMAN actor, so the nightly
// assembler — a 03:07 cron with no actor — rebuilds the take's OBJECT and can
// never write a length for it. This door is the first place after that rescue
// where a real staffer's bearer is in hand, so the estimate is computed and
// written here, once, while the row's duration is still null. It is
// best-effort by design: a failed stamp must never cost the staffer the save
// they actually asked for.
//
// NO 'use server': every function takes the tenant it is scoped to as an
// argument, so as client-invokable actions these would take any caller's word
// for who they are — the same rule take-binding.ts and mint-take-url.ts state.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { assertRecorderOwnsRow, statusOf } from '@/lib/recording/take-binding'
import { parseRecordingKey } from '@/lib/recording/key-grammar'
import { objectExists } from '@/lib/recording/mint-take-url'
import { createServiceClient } from '@/lib/supabase/service'
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
   *  outranks everything · `no_audio` the server does not hold this take's
   *  finalized object (the honest answer, and the one the row's own chip should
   *  already have prevented the staffer from reaching) · `not_returning` the
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
 *   4. the key fence, then the one storage call that PROVES the object.
 * A job queued against an object that is not in the bucket costs the worker a
 * fetch, three retries and a FAILED row — and leaves the staffer's row at 失敗
 * with no better story than before.
 *
 * ⚠ PR-B REBASE: `EnqueueFromSessionActor extends FinalizeTakeActor`, and PR-B
 * makes `allowedStoreIds: readonly string[] | null` REQUIRED on that shape, so
 * BOTH callers below will fail to compile — deliberately. RESOLVE the reach
 * exactly as the finalize callers do (web: viewerScopeForActs, only when
 * holdsOwnerKeys; facade: store-clamp's viewerAllowedStoreIds). Typing
 * `allowedStoreIds: null` to silence the error would read as UNCLAMPED under
 * D7's null rule and silently widen the owner's hand on a store-stamped row.
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
  try {
    const discards = await synqed.recordingDiscards.list({
      recording_session_id: input.recordingSessionId,
      source: 'STAFF',
      page_size: 1,
    })
    if ((discards?.events?.length ?? 0) > 0) return { error: 'discarded' }
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
  // nightly assembler just rescued has an object and no duration, because core
  // fences that write behind a human actor. Asking the row would refuse the
  // exact save this door exists for. One storage call answers it properly.
  // 'unknown' is not "no": a blip must leave the staffer able to tap again,
  // never tell them their recording is gone.
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

  // ⚖ THE DURATION, STAMPED HERE OR NOWHERE (D8'). Only while the row's is
  // null — a stamped row already has a length nobody may overwrite — and only
  // ever an ESTIMATE, from the segments the recorder actually flushed.
  const durationSeconds =
    row.duration_seconds ?? (await stampEstimatedDuration(synqed, actor, row.id, audioPath, parsed.ext))

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
    duration_seconds: durationSeconds ?? undefined,
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

/**
 * ⚖ THE FLUSH-WINDOW ESTIMATE, duplicated from src/lib/recording/assembler.ts
 * (PR-A); collapse to one import at rebase. PR-A is on a sibling branch, so
 * this PR must stand alone rather than depend on it.
 *
 * One segment per TAKE_FLUSH_MS (global-recorder.ts), so the prefix's length
 * IS the recording's length to within one flush — the same rough figure the
 * recovery banner and the inbox already show for an unfinished take. Bytes and
 * bitrate were rejected upstream: opus is VBR.
 */
const SEGMENT_NOMINAL_MS = 5_000

/** The longest run of seqs starting at 0. A gap ENDS it: what the object holds
 *  (and what the assembler could seal) is the contiguous prefix, never the
 *  count of leaves lying around after a hole. */
export function longestPrefix(seqs: readonly number[]): number {
  const present = new Set(seqs)
  let n = 0
  while (present.has(n)) n++
  return n
}

/** How many pages of a take's segment folder are walked. 100 × 100 = 10,000
 *  segments ≈ 14 hours of audio at one flush per 5 s — far past the recorder's
 *  own limits, so the cap can only ever bite on a folder something else went
 *  wrong in. */
const MAX_SEGMENT_PAGES = 100
const SEGMENT_PAGE = 100

/**
 * Write the estimated length onto the row — ONCE, and never at the cost of the
 * save.
 *
 * The whole function is best-effort by ruling: the staffer tapped 保存する, and
 * a storage hiccup or a core blip on a DERIVED number must not turn that into
 * a refusal. A failure logs ids only (⚖ 8/17 doc law — never the key, never a
 * body) and the job runs with no duration, exactly as it would have before
 * this stamp existed. Returns the value it wrote, or null.
 */
async function stampEstimatedDuration(
  synqed: Pick<SynqedClient, 'recordings'>,
  actor: { businessId: string },
  recordingId: string,
  takeKey: string,
  ext: string,
): Promise<number | null> {
  try {
    // The folder IS the take key without its extension — composeSegmentKey
    // builds `seg/app_<biz>_<take>/<seq>.<ext>` from the same two pieces, and
    // the caller already proved the pointer's shape.
    const folder = `seg/${takeKey.slice(0, takeKey.lastIndexOf('.'))}`
    const storage = createServiceClient().storage.from('recordings')
    const seqs: number[] = []
    for (let page = 0; page < MAX_SEGMENT_PAGES; page++) {
      const { data, error } = await storage.list(folder, {
        limit: SEGMENT_PAGE,
        offset: page * SEGMENT_PAGE,
        sortBy: { column: 'name', order: 'asc' },
      })
      // A failed page also answers data null, and reading that as "the folder
      // ended here" would stamp a length short of the audio. Give up on the
      // stamp instead — a null duration is honest, a short one is not.
      if (error) throw error
      if (!data || data.length === 0) break
      for (const f of data) {
        if (f.name.endsWith(`.${ext}`)) seqs.push(Number(f.name.slice(0, -(ext.length + 1))))
      }
      if (data.length < SEGMENT_PAGE) break
    }

    const prefix = longestPrefix(seqs)
    if (prefix === 0) return null
    const durationSeconds = Math.round((prefix * SEGMENT_NOMINAL_MS) / 1000)
    // The ACTOR-bearing client the caller passed: core admits this write from
    // the recorder themself and from the owner's hand, and from no cron.
    await synqed.recordings.update(recordingId, { duration_seconds: durationSeconds })
    return durationSeconds
  } catch (err) {
    console.warn(
      JSON.stringify({
        evt: 'duration_stamp_failed',
        businessId: actor.businessId,
        recordingId,
        err: String(err),
      }),
    )
    return null
  }
}
