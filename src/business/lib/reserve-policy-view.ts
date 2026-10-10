// Reserve 受付's two view rules, shared by the server props (settings-props.ts) and the client screen
// (SettingsScreen.tsx) so each has ONE definition (S67 F2): pure and import-free, so a 'use client' file may
// value-import it (foundation.test.ts keeps the practice door itself out of the client bundle).

type LateInputs = { cutoff_minutes: number; cancel_free_until_hours: number; cancel_late_pct: number }

/** §9 R5 + R5b — a NOTE, never a refusal: a booking taken after the free deadline is late from the start.
 *  Only when that costs something (R5b): with no late-cancel fee nothing is late in a way that matters, so
 *  core's defaults (cutoff 0, free 24 h, fee 0 %) show no note. */
export function lateFromBooking(p: LateInputs): boolean {
  return p.cancel_late_pct > 0 && p.cutoff_minutes < p.cancel_free_until_hours * 60
}

const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
/** §9 R11/R11b — 「最終変更: <date>」 from core's `updated_at`, the date in JST. undefined when there is no stamp, or
 *  one that is not a date (S67 F8): no line, never a thrown RangeError taking the page down. */
export function policyAuditLine(updatedAt: string | null): string | undefined {
  if (updatedAt === null) return undefined
  const at = new Date(updatedAt)
  return Number.isNaN(at.getTime()) ? undefined : `最終変更: ${fmtDay.format(at)}`
}
