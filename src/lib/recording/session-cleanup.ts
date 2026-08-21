// Deliberate-discard session cleanup (Build F1 fix round 3) — INTERIM.
//
// ⚠ THIS IS A STOPGAP AND IS MEANT TO BE DELETED. The doctrine-correct
// treatment (⚖ 8/20: discards are KEPT IN FULL, rendered as grayed 破棄済み
// rows off the core discard ledger) is P5's build, and it cannot ship yet —
// its receipt requires a written reason (RecordDiscardInput / discard.ts's
// DISCARD_CATEGORIES) and the reason dialog does not exist. P5 REPLACES this
// file's wiring: when the kept-discard rows land, delete the cleanup call
// sites and this module with them.
//
// WHY IT EXISTS AT ALL: a deliberate 破棄 leaves an orphan recording_sessions
// row — the take is destroyed client-side and no karute is ever written — and
// the 録音履歴 inbox then renders that orphan as 失敗 and counts it in 要対応
// for seven days, with no action that can clear it. Preview QA (Dev Salon,
// live) caught two discarded test takes stuck exactly that way. In the field
// every routine discard would add a false alarm nobody can clear, and a badge
// that cannot reach zero stops meaning anything. Nothing real is lost by
// removing the row: today's 破棄 already destroys the audio and saves nothing.
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
    detail: { customer_id: row.customer_id ?? null, had_audio_path: !!row.audio_storage_path },
    requestId: actor.requestId,
    source: actor.source,
  })
  return { ok: true }
}
