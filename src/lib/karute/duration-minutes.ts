/** Recording seconds → whole minutes for karute_records.duration_minutes.
 *  Trust-boundary guard shared by every writer (web actions, facade POST,
 *  recording-job worker): duration arrives as client-supplied JSON, so a
 *  negative / NaN / Infinity value must persist as null, never as garbage
 *  minutes (Greptile P1 on #646). Sub-30s takes round to 0 — the list
 *  renderers already hide a 0 duration. */
export function durationMinutesFromSeconds(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round(seconds / 60)
}
