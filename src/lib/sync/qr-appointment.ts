// The appointment write payloads for a QuickReserve reservation, used by the
// karute QR sync (src/app/api/sync/quickreserve/route.ts).
//
// THE INVARIANT (privacy-critical): customer_id appears in BOTH the create AND
// the update payload. The sync dedups appointments by (staff_id, start_time),
// so when a slot is REBOOKED BY A DIFFERENT CUSTOMER — e.g. 中川's 12:00 with a
// therapist became 崎本's — the existing row is UPDATED in place. The old code
// updated only title/notes/duration and left the stale customer_id, so 崎本's
// VIP施術 + reservation memo rendered under 中川's name (a cross-customer data
// leak). Re-linking customer_id on every update makes a rebooked slot follow the
// new customer. Pure + dependency-free so the invariant is unit-tested directly.

export interface QrMappedReservation {
  startTime: string
  endTime: string
  durationMinutes: number
  treatmentName: string
}

export interface QrAppointmentWrite {
  /** UpdateAppointmentInput-shaped. Carries staff_id + starts_at/ends_at so a
   *  reservation matched by its QR id that has MOVED relocates its OWN row to the
   *  new staff/time, instead of being left at the old slot (or hijacking the new
   *  slot's occupant). customer_id re-links a rebooked slot (the privacy fix). */
  update: {
    customer_id: string
    staff_id: string
    starts_at: string
    ends_at: string
    title: string
    notes: string
    duration_minutes: number
  }
  /** CreateAppointmentInput-shaped. source=QUICKRESERVE tags the row as sync-owned
   *  (existing rows predate this and are MANUAL — the sync identifies QR rows by
   *  the `QR #<id>` notes prefix, see qr-notes.ts). */
  create: {
    customer_id: string
    staff_id: string
    starts_at: string
    ends_at: string
    duration_minutes: number
    title: string
    notes: string
    source: 'QUICKRESERVE'
  }
}

export function qrAppointmentWrite(
  customerId: string,
  staffId: string,
  mapped: QrMappedReservation,
  notes: string,
): QrAppointmentWrite {
  const update = {
    customer_id: customerId,
    staff_id: staffId,
    starts_at: mapped.startTime,
    ends_at: mapped.endTime,
    title: mapped.treatmentName,
    notes,
    duration_minutes: mapped.durationMinutes,
  }
  return {
    update,
    create: { ...update, source: 'QUICKRESERVE' as const },
  }
}
