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
