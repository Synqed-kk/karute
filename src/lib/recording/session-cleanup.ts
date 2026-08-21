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
 * FAILURE-TOLERANT BY CONTRACT: every non-success path returns `{ error }`
 * rather than throwing, and both callers fire-and-forget. A cleanup that fails
 * costs one stale 失敗 row for up to seven days — never a blocked discard.
 */
export async function deleteRecordingSessionWithClient(
  synqed: Pick<ReturnType<typeof newSynqedClient>, 'recordings'>,
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
