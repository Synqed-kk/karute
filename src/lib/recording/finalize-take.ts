// "This take is complete" — the ONE server body that turns an uploaded object
// into a fact on the core recording row (capture pipeline PR2, design R4/R8,
// ⚖ v2 items 2, 11, 13).
//
// WHY IT EXISTS. Today the app NEVER writes `audio_storage_path`: the audio's
// only durable link to its session is the job payload, so a take that is never
// enqueued (破棄, a kill, 録音を使用 never tapped) has no server-side record
// that its audio exists at all. Finalize is the moment the audio becomes SAFE,
// and it happens at stop — before any 結果 dialog, before consent, before the
// karute exists.
//
// WHAT IT NO LONGER DOES (fix round 4). It does not mint rows and it does not
// choose which row an object belongs to. THE MINT BINDS, FINALIZE VERIFIES:
// mint-take-url.ts reserves the key on the recorder's own row before a byte can
// exist, so the only thing left to prove here is that the row handed to us
// reserved exactly this key. A key no row reserved is `not_reserved` — the
// refusal that stops a same-tenant staffer attaching a colleague's audio to a
// row of their own.
//
// AND WHAT THAT NOW RESTS ON (fix round 10). Every session created by this app
// version is BORN RESERVED: startRecordingSession composes the take's key and
// creates the row with it in one call (src/actions/recordings.ts), so a row is
// never unbound and the reservation cannot be raced away between two takes. The
// check here is unchanged — this row reserved exactly this key, or nothing
// happens — it simply now holds against concurrency by construction rather than
// by the mint's re-read.
//
// NO 'use server' directive, deliberately — same rule as discard.ts and
// session-cleanup.ts: `actor` is the authenticated identity the CALLER
// resolved and vouches for. As a server action a caller could supply its own.
//
// ONE choke point, two doors: the web action (src/actions/recordings.ts) and
// the facade route (…/recordings/finalize). Both resolve the actor their own
// way and share this body, so the phone and the web page cannot drift into
// different finalize semantics. FACADE_AUDIT_MAP['recordings.finalize'] is
// therefore a deliberate 'skip' citing this function — one finalize, at most
// one audit row.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import { composeTakeKey, parseRecordingKey } from '@/lib/recording/key-grammar'
import { FinalizeTakeSchema } from '@/lib/app-api/record-schemas'
import {
  assertRecorderOwnsRow,
  isJobOwnedStatus,
  isStorageNotFound,
  statusOf,
} from '@/lib/recording/take-binding'

type Core = Pick<SynqedClient, 'recordings'>

export interface FinalizeTakeActor {
  /** The AUTHENTICATED staff identity, resolved by the caller and NEVER read
   *  from a request body. Same id space recordings.create stamps on staff_id
   *  (auth user id on both surfaces — getCurrentUserStaffId / resolveSelfStaffId). */
  staffId: string | null
  /** The caller's verified tenant — the prefix the composed key must carry. */
  businessId: string
  /** Holds `recordings.viewAll` (owner-only). Lets a manager finalize a take
   *  recorded on another staffer's session; everyone else is own-session only. */
  canViewAll: boolean
  source: 'web' | 'facade'
  requestId?: string
}

export interface FinalizeTakeInput {
  takeId: string
  mimeType: string
  durationSeconds: number
  byteLength: number
  /** REQUIRED (fix round 4). The row the MINT reserved this take's key on — no
   *  key reaches storage without one, so a finalize that cannot name its row is
   *  a finalize for a take this server never bound. */
  recordingSessionId: string
}

/**
 * `already: true` means this call wrote NOTHING because the take was finalized
 * before — an exact retry. A settled success, and it emits no second audit row
 * for one act.
 *
 * `not_reserved` and `superseded` are TERMINAL for the client (no retry helps):
 * the first says this row never reserved this key, the second that the row has
 * moved on to other audio and this object is now unreferenced.
 */
export type FinalizeTakeResult =
  | { ok: true; recordingSessionId: string; already?: true }
  | {
      error:
        | 'bad_input'
        | 'forbidden'
        | 'not_found'
        | 'not_reserved'
        | 'superseded'
        | 'object_missing'
        | 'size_mismatch'
        | 'failed'
    }

/**
 * Does the object this take claims actually exist, and is it the size claimed?
 *
 * `info()` (storage-js 2.99) is the CHEAPEST honest read: one GET
 * /object/info/<bucket>/<key> for the ONE key, carrying `size`. `list('', {
 * search })` would page the bucket ROOT — the sweep's whole world, ~thousands
 * of objects — to answer a single-object question, and `createSignedUrl` mints
 * a credential as a side effect of asking.
 *
 * Returns the byte verdict rather than throwing: a missing object is the
 * ordinary "the PUT has not landed yet" case the drain retries.
 */
async function objectVerdict(
  key: string,
  byteLength: number,
): Promise<'ok' | 'missing' | 'size_mismatch' | 'size_unknown' | 'unknown'> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from('recordings').info(key)
  // A 500, a timeout, a bad credential: storage did not ANSWER the question.
  // Reading that as 'missing' would tell the client its audio is gone and stop
  // the retry — the one wrong thing to say when we simply do not know.
  if (error) return isStorageNotFound(error) ? 'missing' : 'unknown'
  if (!data) return 'missing'
  if (typeof data.size !== 'number') return 'size_unknown'
  return data.size === byteLength ? 'ok' : 'size_mismatch'
}

/**
 * Has this take already been finalized once?
 *
 * The MINT leaves the row pointing at the key with no duration (it cannot know
 * one), so the pointer alone can no longer mean "finalized". The duration IS
 * the finalize's own mark — plus a status the recorder has left behind, so a
 * row still sitting at RECORDING is never mistaken for a finished one.
 */
function finalizedBefore(row: Recording): boolean {
  return row.duration_seconds !== null && row.status !== 'RECORDING'
}

/**
 * Write the take's duration and status onto the row that reserved its key.
 *
 * ORDER IS THE FENCE. The key is composed from the caller's take id and
 * container and re-parsed against the grammar (composeTakeKey) BEFORE the
 * service-role storage client is touched; the row's OWNERSHIP and its
 * RESERVATION are both proved before the object is even looked up, so an
 * unauthorized caller never learns whether a key exists. The BYTE check comes
 * before any audit row too (fix round 7) — no branch files a record of audio
 * the bucket does not hold. Nothing here deletes, and nothing here mints.
 *
 * PROCESSING is deliberately never WRITTEN: that status means "a job is
 * running" and belongs to enqueue (PR3/PR4). Finalize says UPLOADING — the
 * audio is on the server, nothing is processing it yet — and a row a job
 * already owns keeps its own status: it gets the duration alone.
 */
export async function finalizeTakeWithClient(
  synqed: Core,
  actor: FinalizeTakeActor,
  rawInput: FinalizeTakeInput,
): Promise<FinalizeTakeResult> {
  // THE parse, for BOTH doors. The web action is a server action, so its
  // argument is caller-supplied JSON however it is typed — parsing here (not
  // at each door) is what makes the two doors refuse the same bodies, and it
  // is the FIRST line so no unvalidated number or id gets any further.
  const parsed = FinalizeTakeSchema.safeParse(rawInput)
  if (!parsed.success) return { error: 'bad_input' }
  const input = parsed.data

  // Nothing to attribute a recording to, so nothing may be written. Ahead of
  // the key work because it costs nothing and settles the caller.
  if (!actor.staffId) return { error: 'forbidden' }

  try {
    // INSIDE the try (fix round 7): composeTakeKey throws when its own output
    // fails the grammar — a drift bug between composer and parser, never caller
    // input. It is reached from a request body all the same, and outside the
    // try that throw escaped this function as a 500 on both doors instead of
    // the settled { error } this door promises never to break.
    const composed = composeTakeKey(actor.businessId, input.takeId, input.mimeType)
    if (composed === null) return { error: 'bad_input' }
    const key = composed.key

    let row: Recording
    try {
      row = await synqed.recordings.get(input.recordingSessionId)
    } catch (err) {
      if (statusOf(err) === 404) return { error: 'not_found' }
      throw err
    }
    // Core's GET is BUSINESS-scoped only, so the tenant and the recorder are
    // both re-checked here — the same predicate the mint reserved under.
    const denied = assertRecorderOwnsRow(row, actor)
    if (denied) return denied

    // THE RESERVATION CHECK — the fence this whole round exists for. A key the
    // row does not already hold is a key the mint never bound to it, and no
    // amount of ownership on the ROW makes a colleague's OBJECT this take's.
    const pointer = row.audio_storage_path
    // A job already claimed OTHER audio for this row. Cannot happen while every
    // key is reserved at its mint — but if it ever does, the object we were
    // handed is now unreferenced, and that must be TRACEABLE rather than a
    // silent {ok, already} nobody would ever look at again.
    let superseded = false
    // The reservation is this call's own — but "already finalized" is largely
    // NOT decided here (fix round 9, Greptile): a pre-PR2 row can carry a
    // duration with its pointer set and STILL have no object behind it (a mint
    // whose PUT never landed), and answering `already: true` for that says
    // "safe" about audio that is not in the bucket. The object check below is
    // the proof for every status but one (fix round 12, just below): this
    // only decides whether THIS row's reservation is exact, missing, or moved on.
    const alreadyFinalized = pointer === key && finalizedBefore(row)
    if (pointer !== key) {
      if (pointer === null || !isJobOwnedStatus(row.status)) {
        // The row never reserved this key. TERMINAL: the take was bound to
        // another row (or never minted at all), and no retry changes that.
        return { error: 'not_reserved' }
      }
      superseded = true
    }

    // FIX ROUND 12 (fresh-eyes #8, P2 — the round 9 / round 11 reconciliation).
    // COMPLETED is the one status the WORKER owns end to end, and it USED to
    // delete the object right after transcription (process-recording.ts) — a
    // missing object on a COMPLETED row was that deletion doing its job, never
    // a lost PUT. Answering object_missing there would have the client retry
    // forever on audio that already transcribed safely, so COMPLETED is the
    // one terminal state allowed to settle as `already: true` before the
    // object is even looked up. Every other status — including PROCESSING and
    // FAILED, which the worker has not finished with — still proves the
    // object first below (round 9's rule, unchanged).
    //
    // ⚖ PR4 MAKES THIS MOOT, AND IT IS KEPT ANYWAY (packet rider). Nothing
    // deletes recording audio any more, so a COMPLETED row's object is there
    // and the probe below would answer `ok` — the short-circuit now only saves
    // that one storage call. Keeping it costs nothing and it is still the
    // correct answer for every row COMPLETED by the OLD worker, whose object
    // really is gone. NOT WIDENED: still COMPLETED, still exact-retry only.
    if (alreadyFinalized && row.status === 'COMPLETED') {
      return { ok: true, recordingSessionId: row.id, already: true }
    }

    // ⚖ NO OBJECT PROBE ON A CALLER-NAMED KEY (packet rider, from the PR2/PR3
    // review loops). `key` is composed from the CLIENT's takeId, and a
    // SUPERSEDED row does NOT point at it — so probing it would answer "does
    // this object exist" for a key this row never reserved. Any staffer holding
    // one job-owned row of their own could then walk take ids and read
    // existence off the object_missing / capture_unlinked split: an oracle over
    // a colleague's takes. So storage is asked ONLY where pointer === key, i.e.
    // only about the object this row itself reserved.
    const verdict = superseded ? null : await objectVerdict(key, input.byteLength)
    // The take says it is complete; the bucket says there is nothing there.
    // Refusing keeps a duration for a non-existent object off the core row —
    // true for an exact retry too: a row that LOOKS finalized with nothing in
    // the bucket is not "already safe", it is the same object_missing anyone
    // else would get.
    if (verdict === 'missing') return { error: 'object_missing' }
    if (verdict === 'size_mismatch') return { error: 'size_mismatch' }
    // Storage could not answer. Retryable, and nothing is written meanwhile.
    if (verdict === 'unknown') return { error: 'failed' }

    // The object is proven present and correctly sized. NOW an exact retry can
    // safely settle as `already: true` — nothing left to write, no second audit
    // row for one act.
    if (alreadyFinalized) return { ok: true, recordingSessionId: row.id, already: true }

    if (superseded) {
      // The object we were handed is now unreferenced, and this row is the only
      // thread back to it.
      //
      // WHAT IT CAN NO LONGER CLAIM: fix round 7 filed this AFTER the byte check
      // so an unlinked row could never be "a client-written record of a
      // non-event". That proof needed the probe the rider above just removed, so
      // the row says what it actually knows — `size_verified: false`, the same
      // honesty flag emitFinalized carries when the listing gives no size. What
      // it does assert is exactly what happened: a finalize arrived for a take
      // this row had moved on from. The audio's own proof is its finalize
      // against the row that DOES hold it.
      //
      // Its OWN action (fix round 6, I2): nothing was saved here, so this must
      // never file under capture_finalized ("audio saved") — that name is
      // reserved for a call that actually wrote a pointer or a duration.
      // NO DEDUPE here (fix round 8, accepted): unlike finalizedBefore's
      // `already` short-circuit above, a superseded row has no "already
      // reported" state to check, so every retry of a stale finalize files its
      // own capture_unlinked row. The bound on how many is the CLIENT's own
      // retry count, not a dedupe in this function.
      return emitCaptureUnlinked(
        actor,
        row.id,
        input,
        composed.ext,
        parseRecordingKey(pointer, actor.businessId)?.takeId ?? null,
        { size_verified: false },
      )
    }

    const durationSeconds = Math.floor(input.durationSeconds)
    // The POINTER is not written here — the mint wrote it and the comparison
    // above just proved it is this exact key. What finalize adds is what the
    // mint could not know: how long the take ran, and that it is now complete.
    // ⚖ v2 item 13: iOS fMP4 reports duration 0, so the player needs the
    // recorder's own measurement written here.
    // Status and duration belong to a running or finished job, never to us —
    // writing UPLOADING over PROCESSING would put a live take back into 要対応
    // mid-transcription, so a job-owned row gets the duration alone.
    await synqed.recordings.update(
      row.id,
      isJobOwnedStatus(row.status)
        ? { duration_seconds: durationSeconds }
        : { duration_seconds: durationSeconds, status: 'UPLOADING' },
    )

    return emitFinalized(
      actor,
      row.id,
      input,
      composed.ext,
      // Honest about what was actually proved: the listing did not carry a
      // size, so the byte match is unverified for this row.
      { size_verified: verdict === 'ok' },
      { ok: true, recordingSessionId: row.id },
    )
  } catch (err) {
    console.warn('[finalize-take] failed:', err)
    return { error: 'failed' }
  }
}

/**
 * The take's ONE audit row for a finalize that actually landed a pointer or a
 * duration write. ⚖ 8/17 doc law — IDS, NUMBERS AND FLAGS ONLY. No key, no
 * path, no customer: the storage key embeds the take id, which the ids below
 * already carry honestly.
 *
 * `extra` carries `size_verified` — was the byte match actually proved, or
 * did the listing just not carry a size? (Fix round 6, I2: the superseded
 * branch below no longer calls this — nothing was saved there, so it files
 * its own action, emitCaptureUnlinked, instead.)
 *
 * It EMITS AND RETURNS the caller's own result (the emitSave idiom,
 * src/actions/karute.ts#createOrUpdateKaruteRecord) so this fact leaves the
 * choke point through an emit BY CONSTRUCTION — the return can never grow a
 * path that skips the row.
 */
function emitFinalized(
  actor: FinalizeTakeActor,
  recordingSessionId: string,
  input: { takeId: string; byteLength: number; durationSeconds: number },
  ext: string,
  extra: Record<string, unknown>,
  result: FinalizeTakeResult,
): FinalizeTakeResult {
  audit({
    category: 'recording',
    action: 'recording.capture_finalized',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    targetType: 'recording',
    targetId: recordingSessionId,
    severity: 'notice',
    detail: {
      recording_session_id: recordingSessionId,
      take_id: input.takeId,
      bytes: input.byteLength,
      duration_seconds: Math.floor(input.durationSeconds),
      ext,
      ...extra,
    },
    requestId: actor.requestId,
    source: actor.source,
  })
  return result
}

/**
 * The superseded branch's OWN row (fix round 6, I2). `capture_finalized`
 * means "audio saved" — this branch saves nothing (the row it was handed had
 * already moved on to other audio before this take's finalize landed), so it
 * must never file under that name. This traces the only thing that DID
 * happen: the object this call was handed is now unreferenced, and
 * `row_take_id` is the one thread back to the take the row points at instead.
 *
 * Reached only AFTER objectVerdict has proved the object is really there at the
 * claimed size (fix round 7): `bytes` here is the CALLER's number, and an
 * unlinked row for an object that never existed would be a client-authored
 * record of nothing.
 *
 * ⚖ 8/17 doc law — IDS, NUMBERS AND FLAGS ONLY. No `duration_seconds`: this
 * call wrote no duration, so stating one here would claim a measurement that
 * never landed. `size_verified` (fix round 9) is the same flag emitFinalized
 * carries — was the byte match actually proved, or did the listing just not
 * carry a size?
 *
 * EMITS AND RETURNS, same emitSave idiom as emitFinalized above.
 */
function emitCaptureUnlinked(
  actor: FinalizeTakeActor,
  recordingSessionId: string,
  input: { takeId: string; byteLength: number },
  ext: string,
  rowTakeId: string | null,
  extra: Record<string, unknown>,
): FinalizeTakeResult {
  audit({
    category: 'recording',
    action: 'recording.capture_unlinked',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    targetType: 'recording',
    targetId: recordingSessionId,
    severity: 'notice',
    detail: {
      recording_session_id: recordingSessionId,
      take_id: input.takeId,
      row_take_id: rowTakeId,
      bytes: input.byteLength,
      ext,
      ...extra,
    },
    requestId: actor.requestId,
    source: actor.source,
  })
  return { error: 'superseded' }
}
