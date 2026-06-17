// The existing-appointment index + match ladder for the karute QR sync.
//
// Pulled out of the sync route as a PURE function so the risky part — deciding
// which existing appointment a QuickReserve reservation maps to — is unit-tested
// directly, without mocking the whole route. This is what lets a MOVED booking
// (#327563 6/10 → 6/17) patch its OWN row instead of hijacking whoever currently
// holds the new slot (the 崎本/中川 cross-customer leak).

import type { Appointment } from '@synqed-kk/client'
import { parseQrId } from './qr-notes'

/** Stable dedup key for the (staff, start-instant) fallback. Normalizes the
 *  timestamp to epoch ms so ISO formatting differences don't break matching. */
export function staffTimeKey(staffId: string, startsAt: string): string {
  return `${staffId}|${new Date(startsAt).getTime()}`
}

export interface QrExistingIndexes {
  /** QR reservation id (from notes) → existing row. The PRIMARY key: survives a
   *  move/rebook across days. */
  byQrId: Map<string, Appointment>
  /** (staff, start) → existing row. Fallback for rows synced before id-keying,
   *  or whose notes lost the `QR #<id>` prefix. */
  byStaffTime: Map<string, Appointment>
}

/**
 * Index the whole-window existing-appointment snapshot. On the duplicate-QR-id
 * case (a move that left an orphan — two rows share one QR id) keep the LATER
 * starts_at, i.e. the live/moved row, so a re-key patches the right one.
 */
export function buildQrExistingIndexes(existing: Appointment[]): QrExistingIndexes {
  const byQrId = new Map<string, Appointment>()
  const byStaffTime = new Map<string, Appointment>()
  for (const a of existing) {
    byStaffTime.set(staffTimeKey(a.staff_id, a.starts_at), a)
    const id = parseQrId(a.notes)
    if (id) {
      const prev = byQrId.get(id)
      if (!prev || new Date(a.starts_at).getTime() > new Date(prev.starts_at).getTime()) {
        byQrId.set(id, a)
      }
    }
  }
  return { byQrId, byStaffTime }
}

/**
 * Match ladder for one reservation: (1) by QR id — primary, survives a move;
 * (2) by (staff, time) — fallback; (3) null → caller creates.
 */
export function matchQrReservation(
  ix: QrExistingIndexes,
  qrId: string,
  staffId: string,
  startTime: string,
): Appointment | null {
  return ix.byQrId.get(qrId) ?? ix.byStaffTime.get(staffTimeKey(staffId, startTime)) ?? null
}

/** Remove a matched row from both indexes so it can't be matched twice in a run
 *  (and the cancel-sweep's "not seen" set stays exact). Evicts BOTH the incoming
 *  reservation's qrId AND the matched row's OWN qrId: when the match came via the
 *  (staff,time) fallback those differ, and leaving the row's own qrId in byQrId
 *  would let a LATER reservation with that id re-match the same row and overwrite
 *  the first customer's appointment (the Greptile fallback-then-primary bug). */
export function dropMatched(ix: QrExistingIndexes, qrId: string, matched: Appointment): void {
  ix.byQrId.delete(qrId)
  const ownId = parseQrId(matched.notes)
  if (ownId && ownId !== qrId) ix.byQrId.delete(ownId)
  ix.byStaffTime.delete(staffTimeKey(matched.staff_id, matched.starts_at))
}
