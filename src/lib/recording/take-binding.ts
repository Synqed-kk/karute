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

/** Core's HTTP status, duck-typed — the same structural check the rest of this
 *  family uses rather than an instanceof across module instances. */
export function statusOf(err: unknown): number | undefined {
  return err && typeof err === 'object' && 'status' in err
    ? ((err as { status?: unknown }).status as number | undefined)
    : undefined
}

/** Storage's "no such object" — for the mint, the key is free; for finalize,
 *  the ordinary "the PUT has not landed yet" case. storage-js answers a
 *  missing key with 404, and 404 ALONE (fix round 12, fresh-eyes #8, P3): a
 *  message regex used to stand in for the status, and "not found" also
 *  matches storage's own "Bucket not found" — a bucket-config problem, not a
 *  missing object — which would have been read as the ordinary retryable
 *  case instead of the operational failure it actually is. A storage failure
 *  that is NOT a 404 must never be read as "no object" — see both call
 *  sites, which treat the difference as the whole question. */
export function isStorageNotFound(error: unknown): boolean {
  return statusOf(error) === 404
}

/** Statuses the JOB PIPELINE owns. NEITHER door writes `status` on one of
 *  these: a COMPLETED take that a late drain re-reserves or re-finalizes must
 *  not go back to UPLOADING and re-enter 要対応. */
export function isJobOwnedStatus(status: string): boolean {
  return status === 'PROCESSING' || status === 'COMPLETED' || status === 'FAILED'
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
