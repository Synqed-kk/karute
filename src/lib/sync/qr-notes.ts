// Canonical parser for the QuickReserve back-reference the karute QR sync stamps
// into appointment.notes. Until synqed-core lets us write external_refs, the QR
// reservation id lives ONLY in notes, as the exact prefix `QR #<id> | <memo>`,
// and the sync keys appointments off it — matching a moved/rebooked reservation
// to its OWN row instead of hijacking whoever currently holds the slot. Single-
// sourced here so the keyer, the cancel-sweep, and the memo display can never
// disagree on the format.

/**
 * The notes prefix: `QR #<digits> | `. Anchored to the string start and
 * digits-only, so a hand-typed memo that merely contains "QR #…" mid-string, or
 * a non-numeric token, never reads as a QR id. The id is captured in group 1.
 *
 * NOTE: keying off this is a back-reference, NOT a cancel authority — a manual
 * walk-in memo could be typed to start `QR #123 | `. The cancel-sweep gates on
 * appointment.source in addition to this prefix (see the sync route).
 */
export const QR_NOTES_PREFIX_RE = /^\s*QR\s*#(\d+)\s*\|\s*/

/** The QR reservation id from an appointment's notes, or null if not QR-keyed. */
export function parseQrId(notes: string | null | undefined): string | null {
  if (!notes) return null
  const m = notes.match(QR_NOTES_PREFIX_RE)
  return m ? m[1] : null
}

/** Whether an appointment's notes carry the `QR #<id> | ` back-reference. */
export function isQrOwned(notes: string | null | undefined): boolean {
  return parseQrId(notes) !== null
}

/** The human memo with the `QR #<id> | ` prefix stripped (for display / AI brief). */
export function stripQrPrefix(notes: string | null | undefined): string {
  if (!notes) return ''
  return notes.replace(QR_NOTES_PREFIX_RE, '').trim()
}
