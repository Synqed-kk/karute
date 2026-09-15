// "I want management to hear this one" — the ONE server body behind the
// recorder's own 共有 toggle on ONE recording (⚖ Liam 2026-09-13 sharing law;
// 2026-09-14 design D6/D7). Two doors, one body — the same idiom as
// discardRecordingWithClient and mintPlaybackUrlWithClient: the web action
// (src/actions/recording-share.ts) and the facade route
// (…/recordings/share) both call setRecordingSharedWithClient, so a share
// can never mean something different on the two doors, and one toggle files
// exactly one audit row.
//
// THE LAW (memory project_karute_recording_integrity.md; ⚖ Liam 2026-09-13):
// the recorder ALONE shares ONE recording — not the owner, not a viewAll
// holder, not the owner's hand (a share is the staffer's own consent; nobody
// consents on her behalf). A share is REVERSIBLE, one tap back: no confirm,
// no sheet. Every share/unshare writes a log row. Core's own lock stays the
// SECOND lock (D7) and its refusal is surfaced, never hidden.
//
// STEPS, mirroring the playback mint's own order (playback-url.ts) —
// fence → own-check → idempotent guard → write → audit:
//   1. the karute names the resource (tenancy fence, same as every read door).
//   2. the karute's recording_session_id names the row.
//   3. the row itself, read to know its CURRENT shared_at (idempotency) and
//      its store (the audit row's storeId).
//   4. THE OWN CHECK (D2) — the record's OWN staffer, full stop. No viewAll
//      leg, no owner-hand leg: this predicate is deliberately NOT
//      canViewTranscript, which would let a viewAll holder or a shared-with
//      reader flip a colleague's consent.
//   5. IDEMPOTENT: already in the requested state → return unchanged, write
//      nothing, audit nothing (a no-op is not an event).
//   6. THE WRITE, through the D13 typed wrapper (share-columns.ts) — core's
//      own lock is the SECOND lock (D7) and can refuse even an own-record
//      write (the row's staff_id and the karute's staff_id can disagree —
//      the appointment-staff take-mint fallback). A 403 here surfaces as
//      `forbidden`, never a silent no-op and never widened.
//   7. ONE audit row per successful write — `recording.share` or
//      `recording.unshare`, ids only (⚖ 8/17 doc law).
//
// NO 'use server' directive, deliberately — same rule as playback-url.ts /
// discard.ts: `actor` is the identity the CALLER resolved and vouches for.

import type { SynqedClient } from '@synqed-kk/client'
import { audit, type AuditEvent } from '@/lib/audit'
import { readDoorStoreId } from '@/lib/auth/recording-acl'
import { readSharedAt, updateRecordingShare } from '@/lib/recording/share-columns'
import { lookupProfileIdForSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'

type Core = Pick<SynqedClient, 'karuteRecords' | 'recordings'>

export interface ShareActor {
  /** WHO IS ASKING — the authenticated auth-user id, same split as
   *  PlaybackActor (playback-url.ts): the audit row's actor. */
  actorId: string
  /** The ROSTER-PROVEN staff identity the own-check compares — resolved by
   *  the caller, never read from a request body. */
  staffId: string | null
  businessId: string
  source: 'web' | 'facade'
  requestId?: string
}

/**
 * `not_found`    = there is no such karute for this tenant.
 * `no_recording` = there IS a karute, but nothing to share hangs off it (no
 *                  session, or the row is gone).
 * `forbidden`    = not this caller's recording to share (not the record's own
 *                  staffer), OR core's own lock refused the write (D7) — the
 *                  two locks can disagree, and the answer is the same either
 *                  way: this is not yours to change.
 * `upstream`     = we could not look, or could not write. Never folded into
 *                  `no_recording`/`forbidden` — a blip is not a refusal.
 */
export type SetRecordingSharedResult =
  | { ok: true; shared: boolean; sharedAt: string | null; changed: boolean }
  | { error: 'not_found' | 'no_recording' | 'forbidden' | 'upstream' }

function upstreamStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/** The one emit primitive this file calls — a private helper, same shape as
 *  auditLockout/emitDeletionAudit: `action` is a real function PARAMETER
 *  typed as the exact literal union (CP4's one sanctioned way to author a
 *  runtime-chosen action; a ternary INSIDE the audit() call is banned —
 *  audit-actions-taxonomy.test.ts). Unconditional on its one path, so it
 *  dominates its own (implicit) return trivially. */
function emitShareAudit(
  action: 'recording.share' | 'recording.unshare',
  actor: ShareActor,
  storeId: string | undefined,
  targetId: string,
  detail: AuditEvent['detail'],
): void {
  audit({
    category: 'recording',
    action,
    actorId: actor.actorId,
    actorType: 'staff',
    businessId: actor.businessId,
    storeId,
    targetType: 'recording',
    targetId,
    severity: 'notice',
    breakGlass: false,
    detail,
    requestId: actor.requestId,
    source: actor.source,
  })
}

export async function setRecordingSharedWithClient(
  synqed: Core,
  actor: ShareActor,
  input: { karuteId: string; shared: boolean },
): Promise<SetRecordingSharedResult> {
  // 1. The karute names the resource, and proves the tenancy (packet-03
  //    disc. #5, same as every other read/write door in this file family).
  let karute: {
    staff_id?: string | null
    store_id?: string | null
    recording_session_id?: string | null
    customer_id?: string | null
  }
  try {
    karute = await synqed.karuteRecords.get(input.karuteId)
  } catch (err) {
    return { error: upstreamStatus(err) === 404 ? 'not_found' : 'upstream' }
  }

  const sessionId = karute.recording_session_id || null
  if (!sessionId) return { error: 'no_recording' }

  // 2. The row carries the current shared_at (idempotency) and its own store.
  let row: { id: string; store_id?: string | null }
  try {
    row = await synqed.recordings.get(sessionId)
  } catch (err) {
    return { error: upstreamStatus(err) === 404 ? 'no_recording' : 'upstream' }
  }

  // 3. THE OWNER TRANSLATION — the exact line playback-url.ts uses (⚖ 8/22
  //    recorder-lock fix): the karute's staff id sometimes carries a
  //    synqed-core staff CARD id rather than a profile id.
  const ownerStaffId = karute.staff_id
    ? ((await lookupProfileIdForSynqedStaffIdForBusiness(karute.staff_id, actor.businessId)) ?? karute.staff_id)
    : null

  // 4. THE OWN CHECK (D2) — the record's OWN staffer, full stop. NO viewAll
  //    leg, NO owner-hand leg: an ownerless karute (ownerStaffId null) has no
  //    one who could consent, so it is forbidden here too — the read side's
  //    "no owner = shared" branch does not apply to the WRITE.
  if (actor.staffId == null || actor.staffId !== ownerStaffId) {
    return { error: 'forbidden' }
  }

  // 5. IDEMPOTENT — already in the requested state. No write, no audit: a
  //    no-op is not an event to log.
  const currentSharedAt = readSharedAt(row)
  if ((currentSharedAt != null) === input.shared) {
    return { ok: true, shared: input.shared, sharedAt: currentSharedAt, changed: false }
  }

  // 6. THE WRITE, through the D13 typed wrapper. Core is the SECOND lock
  //    (D7) and can refuse even this own-record write — the row's staff_id
  //    and the karute's staff_id can disagree (the appointment-staff
  //    take-mint fallback, session-mint.ts). Surfaced honestly, never hidden:
  //    a warn line names ids only (⚖ 8/17 doc law), never the reason.
  const newSharedAt = input.shared ? new Date().toISOString() : null
  try {
    await updateRecordingShare(synqed, row.id, {
      shared_at: newSharedAt,
      shared_by_staff_id: input.shared ? actor.staffId : null,
    })
  } catch (err) {
    const status = upstreamStatus(err)
    if (status === 403) {
      console.warn(
        JSON.stringify({
          evt: 'recording_share_core_refused',
          business_id: actor.businessId,
          karute_id: input.karuteId,
          recording_session_id: row.id,
        }),
      )
      return { error: 'forbidden' }
    }
    return { error: status === 404 ? 'no_recording' : 'upstream' }
  }

  // 7. ONE audit row per successful write — ids only (⚖ 8/17 doc law).
  emitShareAudit(
    input.shared ? 'recording.share' : 'recording.unshare',
    actor,
    readDoorStoreId(karute, row) ?? undefined,
    row.id,
    {
      karute_id: input.karuteId,
      ...(ownerStaffId ? { staff_id: ownerStaffId } : {}),
      ...(karute.customer_id ? { customer_id: karute.customer_id } : {}),
    },
  )

  return { ok: true, shared: input.shared, sharedAt: newSharedAt, changed: true }
}
