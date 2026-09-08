// Recording-session cleanup — NO LONGER ON THE DELIBERATE-DISCARD PATH.
//
// ⚖ A2-1 (P5-A fix round 1) UNWIRED THIS FROM 破棄. The open question the
// previous version of this header raised has been answered by deciding it
// rather than by testing core: the written reason lands in core's discard
// ledger keyed on `recording_session_id`, and this function HARD-DELETES that
// row. Whether core cascaded the reason away or refused the delete, the app was
// firing a fire-and-forget destroy at the very key its flagship deliverable
// depends on, ~200 ms after writing it, with no signal either way. So the
// deliberate-discard call sites are gone (RecordPageView has none left; the
// cleanup-wiring suite asserts that by census).
//
// WHAT REPLACED IT: the orphan problem this was built for — a discarded
// session sitting in 録音履歴 as an unclearable 失敗 in 要対応 for seven days —
// is now solved by NAMING the row instead of destroying it. A session carrying
// a STAFF discard renders as a grayed, inert 破棄済み row off the same ledger
// (lib/recordings/inbox.ts, item A2-3) and is never counted in 要対応. That is
// also the ⚖ 8/20 doctrine-correct treatment, so the stopgap framing is retired
// with it. Preview QA's two stuck test takes read correctly under this rule.
//
// STILL LIVE, and still needed, for the SYSTEM/abandoned paths: the recordings
// server action and the facade route both call in here (below), and those
// remove rows for sessions no human ever decided about. Nothing in this
// function changed THEN — only who calls it. (Capture pipeline PR4 has since
// added the audio gates below, which is the only other change it has taken.)
//
// P5-B (PACKET-P5-DISCARD-2026-08-25.md item B-1) still owns the rest: a
// discarded take's CONTENT is destroyed exactly as before, and keeping it is
// the core work in that packet's §3.
//
// ONE choke point, two doors (the discard.ts / session-mint pattern): the web
// server action (src/actions/recordings.ts) and the facade route
// (src/app/api/app/v1/recordings/session/[id]/route.ts) both call in here;
// `actor` is the only thing that differs and is ALWAYS resolved by the caller.
// FACADE_AUDIT_MAP['recordings.session.delete'] is therefore a deliberate
// 'skip' citing this function — one cleanup, exactly one audit row.
//
// NO 'use server' directive, deliberately — same rule as discard.ts: `actor`
// is the authenticated identity the caller vouches for, so this must never be
// reachable as a client-invokable action where a caller could supply its own.

import { audit } from '@/lib/audit'
import { objectExists } from '@/lib/recording/mint-take-url'
import type { newSynqedClient } from '@/lib/synqed/client'

export interface SessionCleanupActor {
  /** The AUTHENTICATED staff identity, resolved by the caller and NEVER read
   *  from a request body. Same id space recordings.create stamps on staff_id
   *  (auth user id on both surfaces). */
  staffId: string | null
  businessId: string | null
  source: 'web' | 'facade'
  requestId?: string
}

export type SessionCleanupResult = { ok: true } | { error: string }

/**
 * Remove the recording_sessions row a deliberate discard just orphaned.
 *
 * OWNERSHIP IS CHECKED HERE, app-side, because core's
 * `DELETE /recordings/:id` is BUSINESS-scoped only — it will happily delete a
 * colleague's session row for any caller in the same tenant. Every other
 * recordings surface self-scopes the same way, so this one does too: read the
 * row, compare staff_id to the signed-in staffer, refuse otherwise. A refusal
 * is silent-and-safe (`{ error }`), never a delete.
 *
 * NEVER SEVERS A SAVED RECORD (fix round 4). "Deliberate discard" and "no
 * karute exists" are NOT the same statement, and the gap between them is live
 * on the WEB arm today: saveKaruteRecordInline COMMITS the record
 * (actions/karute.ts:443) and can still error afterwards, which sends the run
 * to failAutosaveToReview → ReviewScreen carrying the SAME recordingSessionId.
 * A 破棄 there would reach this function for a session that already HAS a
 * record, and core's delete nulls karute_records.recording_session_id (Prisma
 * SetNull) — the karute survives but loses its provenance and drops out of
 * 録音履歴 entirely. So the record probe below is a hard gate at the CHOKE
 * POINT, covering both doors and every future call site rather than each
 * caller remembering it.
 *
 * FAILURE-TOLERANT BY CONTRACT: every non-success path returns `{ error }`
 * rather than throwing, and both callers fire-and-forget. A cleanup that fails
 * costs one stale 失敗 row for up to seven days — never a blocked discard.
 * Unknowns always resolve toward KEEPING the row: a probe that cannot answer
 * is never read as "no record".
 */
export async function deleteRecordingSessionWithClient(
  synqed: Pick<ReturnType<typeof newSynqedClient>, 'recordings' | 'karuteRecords'>,
  actor: SessionCleanupActor,
  recordingSessionId: string,
): Promise<SessionCleanupResult> {
  if (!actor.staffId || !actor.businessId) return { error: 'forbidden' }
  if (!recordingSessionId) return { error: 'validation' }

  let row: Awaited<ReturnType<typeof synqed.recordings.get>>
  try {
    row = await synqed.recordings.get(recordingSessionId)
  } catch (err) {
    // Already gone (404) or unreadable — either way there is nothing to clean
    // and nothing to claim. Same structural status check the rest of the
    // family uses, kept only for the log line's honesty.
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    if (status !== 404) {
      console.warn(`[session-cleanup] could not read ${recordingSessionId} (${String(status)}):`, err)
    }
    return { error: status === 404 ? 'not_found' : 'read_failed' }
  }

  if (!row || row.staff_id !== actor.staffId) {
    // Another staffer's session. Refuse loudly in the log and touch nothing —
    // this is the check core's business-scoped route does not do for us.
    console.warn(
      `[session-cleanup] refused ${recordingSessionId}: not owned by ${actor.staffId}`,
    )
    return { error: 'not_owned' }
  }

  // THE PROVENANCE GATE. A record for this session means the discard is not
  // undoing an orphan — it is about to sever a saved karute from the recording
  // it came from. Refuse, silently and without an audit row: nothing was
  // removed, so there is nothing to log. getByRecordingSession is the cheapest
  // real surface for the question (one lookup, no page) and is the SAME probe
  // the karute upsert uses for it (actions/karute.ts) — structural 404 check
  // included, so a partial test mock of the client can't break the detection.
  try {
    await synqed.karuteRecords.getByRecordingSession(recordingSessionId)
    console.warn(
      `[session-cleanup] refused ${recordingSessionId}: a karute record exists for it`,
    )
    return { error: 'has_record' }
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: unknown }).status
        : undefined
    // ONLY a 404 proves "no record". Anything else is an unknown, and deleting
    // on an unknown is exactly the severing this gate exists to prevent.
    if (status !== 404) {
      console.warn(
        `[session-cleanup] record probe failed for ${recordingSessionId} (${String(status)}):`,
        err,
      )
      return { error: 'read_failed' }
    }
  }

  // ⚖ A ROW THAT POINTS AT AUDIO IS NEVER REMOVED (capture pipeline PR4).
  // `audio_storage_path` is the ONLY way back to the take's finalized object —
  // core exposes no lookup by key — so deleting this row would leave the
  // recording in the bucket with nothing naming it: audio that is not deleted
  // but can never be found again, which is the same loss wearing a different
  // hat. A refusal here costs one grayed 破棄済み row, which the inbox renders
  // correctly (item A2-3).
  //
  // BUT THE POINTER CANNOT ANSWER THAT QUESTION (fix round 1). Since PR2 fix
  // round 10 a session is BORN RESERVED — created with the take's key already
  // on it, before one byte exists — so `if (row.audio_storage_path)` refused
  // every row a current recorder ever made and quietly turned this whole
  // cleanup into a no-op for the SYSTEM/abandoned paths it still serves. Two
  // facts answer it honestly instead, and both keep the row on an unknown:
  //
  //  ① the STATUS has left RECORDING. UPLOADING/PROCESSING/COMPLETED/FAILED all
  //    mean something happened to this take after the row was minted, and this
  //    function is not the place to decide it did not. A row with no status at
  //    all is the same unknown, and is kept for the same reason.
  if (row.status !== 'RECORDING') {
    console.warn(
      `[session-cleanup] refused ${recordingSessionId}: status is ${String(row.status)}, not RECORDING`,
    )
    return { error: 'has_audio' }
  }
  //  ② storage actually HOLDS the reserved object — the only proof that bytes
  //    exist. `objectExists` is the same probe the mint's own reservation runs
  //    (one home, one spelling); 'unknown' is a probe that could not answer, so
  //    the row stays and the caller is owed the retry.
  if (row.audio_storage_path) {
    let exists: boolean | 'unknown'
    try {
      exists = await objectExists(row.audio_storage_path)
    } catch (err) {
      console.warn(`[session-cleanup] object probe failed for ${recordingSessionId}:`, err)
      return { error: 'read_failed' }
    }
    if (exists === 'unknown') return { error: 'read_failed' }
    if (exists) {
      console.warn(
        `[session-cleanup] refused ${recordingSessionId}: the reserved object holds bytes`,
      )
      return { error: 'has_audio' }
    }
  }

  try {
    await synqed.recordings.delete(recordingSessionId)
  } catch (err) {
    console.warn(`[session-cleanup] delete failed for ${recordingSessionId}:`, err)
    return { error: 'delete_failed' }
  }

  // ⚖ Liam 8/16: removal actions log. IDS AND FLAGS ONLY — a recording session
  // row carries no content, and none of it goes in `detail` regardless.
  audit({
    category: 'recording',
    action: 'recording.session_cleanup',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    targetType: 'recording',
    targetId: recordingSessionId,
    severity: 'notice',
    detail: {
      customer_id: row.customer_id ?? null,
      had_audio_path: !!row.audio_storage_path,
      // Ids-and-flags-safe (no PII): lets the 監査ログ subtitle carry how
      // long the take ran, since the session row itself is hard-deleted.
      duration_seconds: row.duration_seconds ?? null,
    },
    requestId: actor.requestId,
    source: actor.source,
  })
  return { ok: true }
}
