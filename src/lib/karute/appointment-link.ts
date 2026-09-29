import type { Appointment, SynqedClient } from '@synqed-kk/client'

export type AppointmentLinkReason = 'appointment_not_found' | 'appointment_out_of_scope' | 'appointment_unreadable'

export type AppointmentRead =
  | { appointment: Appointment; state: 'ok' }
  | { appointment: null; state: 'not_found' | 'unreadable' }

/** SynqedError's HTTP status, duck-typed (same idiom as store-clamp.ts): a
 *  VALUE import of the SDK class would make jest load the ESM-only package,
 *  and instanceof is fragile across module instances. A network TypeError has
 *  no status at all. */
function upstreamStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/**
 * The booking read BOTH karute save doors (web resolveKaruteStoreId, facade
 * resolveSaveStore) depend on. A save whose booking cannot be used is never
 * refused and never stamped NULL-store: core's 404 means the id is a lie (drop
 * the link), any other failure is retried ONCE and then reported unreadable
 * (keep the link, the client had the booking on screen). Splitting 404 from a
 * blip here, in one place, is what lets the doors keep a karute on a core blip
 * without leaking whether a booking in another store exists.
 */
export async function readAppointmentForSave(
  appointments: Pick<SynqedClient['appointments'], 'get'>,
  id: string,
): Promise<AppointmentRead> {
  try {
    return { appointment: await appointments.get(id), state: 'ok' }
  } catch (err) {
    if (upstreamStatus(err) === 404) return { appointment: null, state: 'not_found' }
  }
  try {
    return { appointment: await appointments.get(id), state: 'ok' }
  } catch (err) {
    return { appointment: null, state: upstreamStatus(err) === 404 ? 'not_found' : 'unreadable' }
  }
}

/**
 * S4 (PR-O, O1 + V4): a later save never CLEARS a booking link.
 *
 * Both converges — createOrUpdateKaruteRecord (karute.core.ts; the facade and
 * the two web save doors) and the job worker's upsertKaruteRecord
 * (process-recording.ts) — used to write the later payload's appointment_id
 * straight through, so a second write that carried no booking (a relaunch
 * auto-finish, a retried autosave, a re-run job) put null over the first
 * save's link and the 予約 tab went back to 未記録.
 *
 * `write.customer_id` is the customer the record will carry AFTER this write
 * (the facade converge moves it; the worker's update never does, so it passes
 * the existing record's own customer). The rule, NARROWED per V4:
 *   - the write names a booking               → that booking (a re-stamp wins)
 *   - the write moves the record to another
 *     customer (保存先を変更, E-1)             → the write's booking, even null:
 *     customer + booking move together, exactly as before — the old
 *     customer's booking never rides along
 *   - otherwise (same customer, no booking)    → the existing link stays
 *
 * Pure, so both converges share ONE spelling.
 */
export function keepLinkUnlessGiven(
  existing: { customer_id?: string | null; appointment_id?: string | null },
  write: { customer_id?: string | null; appointment_id?: string | null },
): string | null {
  if (write.appointment_id) return write.appointment_id
  if ((write.customer_id ?? null) !== (existing.customer_id ?? null)) return null
  return existing.appointment_id ?? null
}
