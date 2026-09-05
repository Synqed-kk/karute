// The checks the MINT and the FINALIZE must answer the SAME way (capture
// pipeline PR2 fix round 4).
//
// THE RULE THIS FILE SERVES: one audio object ↔ one recording row, bound to
// its recorder BEFORE any bytes exist. The mint is where the binding happens
// (it reserves the key on the recorder's own row); finalize only verifies that
// the row it is handed reserved exactly this key.
//
// It lives here because that binding now spans TWO bodies, and a second
// spelling of "is this row the caller's" on either side is exactly how a
// tenant fence gets forgotten on one of them — the same reason staged-audio.ts
// holds the one delete path for both of its callers.
//
// NO 'use server': everything here takes the tenant it is scoped to as an
// argument, so as client-invokable actions these would take any tenant's word
// for who the caller is.

import type { Recording } from '@synqed-kk/client'
import { isOwnRecordingKey } from '@/lib/recording/key-grammar'

/** Core's HTTP status, duck-typed — the same structural check the rest of this
 *  family uses rather than an instanceof across module instances. */
export function statusOf(err: unknown): number | undefined {
  return err && typeof err === 'object' && 'status' in err
    ? ((err as { status?: unknown }).status as number | undefined)
    : undefined
}

/** Storage's "no such object" — for the mint, the key is free; for finalize,
 *  the ordinary "the PUT has not landed yet" case. storage-js carries the
 *  HTTP status in `status` (number) and the server body's `statusCode`
 *  (string). The storage server (storage-api v1.71, acceptance spec
 *  rest-extended.test.ts:169-174) answers a MISSING OBJECT with HTTP 400 and
 *  body statusCode '404', message 'Object not found' (codes.ts NoSuchKey);
 *  other routes answer a plain 404. Neither status alone is the object
 *  question: 'Bucket not found' and a missing ROUTE are 404-shaped too and
 *  must stay 'unknown' (fix round 12, fresh-eyes #8, P3, extended 9/5 — a
 *  message regex used to stand in for the status and would have matched
 *  those too). So the answer is "404 by either field AND the server's own
 *  NoSuchKey message" — see both call sites, which treat the difference as
 *  the whole question. */
export function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  const notFound = e.status === 404 || e.statusCode === '404' || e.statusCode === 404
  return notFound && e.message === 'Object not found'
}

/** The alarm this fix lacked on 9/5: a storage answer that is neither a
 *  proven miss nor a proven hit must be VISIBLE in the function logs, because
 *  it turns every mint/finalize into a 502 and nothing else says why. House
 *  style = audit.ts's `audit_sink_error` line (one JSON object, ids/status
 *  only — never the key, never a body). The raw `message` is deliberately NOT
 *  logged (Greptile, fix round 2): storage's own route errors embed the
 *  requested path (`Route GET:/object/info/<bucket>/<key> not found`), which
 *  is the business + take id — logged only as a normalized `messageKind`,
 *  by exact comparison, never the text. */
export function warnStorageUnknown(where: string, error: unknown): void {
  const e = (error && typeof error === 'object' ? error : {}) as { status?: unknown; statusCode?: unknown }
  console.warn(JSON.stringify({ evt: 'storage_probe_unknown', where, status: e.status, statusCode: e.statusCode, messageKind: storageMessageKind(error) }))
}

/** The NORMALIZED message, by exact comparison — the only form of storage's
 *  `message` that may ever be logged (see warnStorageUnknown above for why the
 *  text itself never is). One home, because the mint's `sign_upload_refused`
 *  line answers the same question about the same errors. */
export function storageMessageKind(error: unknown): 'bucket_not_found' | 'object_not_found' | 'other' {
  const message = (error && typeof error === 'object' ? error : {}) as { message?: unknown }
  return message.message === 'Bucket not found'
    ? 'bucket_not_found'
    : message.message === 'Object not found'
      ? 'object_not_found'
      : 'other'
}

/** Statuses the JOB PIPELINE owns. NEITHER door writes `status` on one of
 *  these: a COMPLETED take that a late drain re-reserves or re-finalizes must
 *  not go back to UPLOADING and re-enter 要対応. */
export function isJobOwnedStatus(status: string): boolean {
  return status === 'PROCESSING' || status === 'COMPLETED' || status === 'FAILED'
}

/**
 * Has this take already been finalized once?
 *
 * The MINT leaves the row pointing at the key with no duration (it cannot know
 * one), so the pointer alone can no longer mean "finalized". The duration IS
 * the finalize's own mark — plus a status the recorder has left behind, so a
 * row still sitting at RECORDING is never mistaken for a finished one.
 *
 * Lifted out of finalize-take.ts (player fix round 1) so the READ side can ask
 * the same question the WRITE side asks, in the same words. That is this
 * module's whole job: a second spelling of a binding check on one side is how
 * the two doors drift apart.
 */
export function finalizedBefore(row: {
  duration_seconds: number | null
  status: string
}): boolean {
  return row.duration_seconds !== null && row.status !== 'RECORDING'
}

/** The three fields the question needs. `status` is a plain `string`, not core's
 *  RecordingStatus union: the READ side carries it degraded on purpose (a baked
 *  shell must render a status it has never heard of), and a real `Recording`
 *  satisfies this shape anyway. */
export interface HeldTakeRow {
  audio_storage_path: string | null
  duration_seconds: number | null
  status: string
}

/**
 * DOES THE SERVER ACTUALLY HOLD THIS TAKE'S AUDIO? (player fix round 1.)
 *
 * A key on the row is NOT an answer, and reading it as one is the bug this
 * exists to close. Sessions are BORN RESERVED — session-mint.ts writes
 * `{ audio_storage_path, status: 'UPLOADING' }` when the row is created, and
 * mint-take-url.ts writes the same on a legacy row, both BEFORE a single byte
 * exists. The object lands later (secure-at-stop, or a drain days later), and
 * on a device that walked out of signal it may never land at all.
 *
 * So the pointer means "this row has claimed this key", and only two things
 * mean the bytes are really there:
 *   · `finalizedBefore` — finalize-take.ts is the ONLY writer that proves the
 *     object (storage.info) before it stamps a duration, so that stamp is the
 *     server's own receipt; or
 *   · `isJobOwnedStatus` — the legacy worker path, whose rows always have an
 *     object because the job read it.
 *
 * The key fence stays inside, and stays TAKE-only: a `stg/` staged discard
 * copy, a segment fragment and another tenant's key are all false however the
 * duration and status read.
 */
export function serverHoldsTakeRow<T extends HeldTakeRow>(
  row: T,
  businessId: string,
): row is T & { audio_storage_path: string } {
  return (
    isOwnRecordingKey(row.audio_storage_path, businessId) &&
    (finalizedBefore(row) || isJobOwnedStatus(row.status))
  )
}

/**
 * May this actor bind this session row?
 *
 * Core's GET is BUSINESS-scoped only, so BOTH halves are checked here: the
 * tenant (belt — the client is already business-scoped) and the recorder. A
 * staffer may bind their OWN session; only an owner (recordings.viewAll) may
 * bind a colleague's. Returns the refusal itself rather than a boolean, so the
 * two doors answer a foreign row with the identical error object.
 */
export function assertRecorderOwnsRow(
  row: Pick<Recording, 'business_id' | 'staff_id'>,
  actor: { staffId: string | null; businessId: string; canViewAll: boolean },
): { error: 'forbidden' } | null {
  if (row.business_id !== actor.businessId) return { error: 'forbidden' }
  if (row.staff_id !== actor.staffId && !actor.canViewAll) return { error: 'forbidden' }
  return null
}
