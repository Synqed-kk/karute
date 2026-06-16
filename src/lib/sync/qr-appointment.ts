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
  /** UpdateAppointmentInput-shaped — re-links customer_id (the fix). */
  update: {
    customer_id: string
    title: string
    notes: string
    duration_minutes: number
  }
  /** CreateAppointmentInput-shaped. */
  create: {
    customer_id: string
    staff_id: string
    starts_at: string
    ends_at: string
    duration_minutes: number
    title: string
    notes: string
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
    title: mapped.treatmentName,
    notes,
    duration_minutes: mapped.durationMinutes,
  }
  return {
    update,
    create: {
      ...update,
      staff_id: staffId,
      starts_at: mapped.startTime,
      ends_at: mapped.endTime,
    },
  }
}
