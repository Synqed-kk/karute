/** Recording seconds → whole minutes for karute_records.duration_minutes.
 *  Trust-boundary guard shared by every writer (web actions, facade POST,
 *  recording-job worker): duration arrives as client-supplied JSON, so a
 *  negative / NaN / Infinity value must persist as null, never as garbage
 *  minutes. A real take always persists at least 1分 — a sub-30s recording
 *  rounding to 0 would render as the same 「—」 as no duration at all. */
export function durationMinutesFromSeconds(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  return Math.max(1, Math.round(seconds / 60))
}
