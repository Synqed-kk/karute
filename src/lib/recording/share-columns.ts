// @synqed-kk/client 1.34 predates core #83's shared_at/shared_by_staff_id
// columns (schema.prisma:477-478) — the JSON on the wire already carries them
// (core recording.service.ts's toPublic), but the installed SDK's TypeScript
// types do not (types.d.ts:673-701). This is a trust-boundary read of that
// JSON, never a cast: `row` arrives as `unknown` and only a genuine non-empty,
// Date.parse-able string counts as a shared_at. DELETE this file at client
// 1.35, once the SDK's own types carry the columns.

import type { SynqedClient, UpdateRecordingInput } from '@synqed-kk/client'

/**
 * Reads `shared_at` off a recording row the caller already fetched. Returns
 * the ISO string ONLY when `row` is an object whose `shared_at` is a
 * non-empty string that `Date.parse` can read; anything else (not an object,
 * missing, null, a number, an empty or garbage string) is `null` — the same
 * "unreadable/unknown closes" posture the rest of this door's ACL takes.
 */
export function readSharedAt(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null
  const value = (row as Record<string, unknown>).shared_at
  if (typeof value !== 'string' || value.length === 0) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

/** What a share/unshare write sends core, through the wrapper below. The two
 *  fields always travel together — nobody stamps a shared_by_staff_id with no
 *  shared_at, or vice versa (D6 step 7). */
export type RecordingShareWrite = {
  shared_at: string | null
  shared_by_staff_id: string | null
}

/**
 * Writes shared_at/shared_by_staff_id through the untyped SDK 1.34 client.
 * SDK 1.34's UpdateRecordingInput predates the columns; core validates them
 * (validations/recording.ts:23-24) and the SDK sends the body untouched
 * (dist/recordings.js update()). DELETE at 1.35.
 */
export function updateRecordingShare(
  synqed: Pick<SynqedClient, 'recordings'>,
  id: string,
  write: RecordingShareWrite,
): Promise<unknown> {
  return synqed.recordings.update(id, write as unknown as UpdateRecordingInput)
}
