// @synqed-kk/client 1.34 predates core #83's shared_at/shared_by_staff_id
// columns (schema.prisma:477-478) — the JSON on the wire already carries them
// (core recording.service.ts's toPublic), but the installed SDK's TypeScript
// types do not (types.d.ts:673-701). This is a trust-boundary read of that
// JSON, never a cast: `row` arrives as `unknown` and only a genuine non-empty,
// Date.parse-able string counts as a shared_at. DELETE this file at client
// 1.35, once the SDK's own types carry the columns.

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
