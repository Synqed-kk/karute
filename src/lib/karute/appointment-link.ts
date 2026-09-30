import type { Appointment, SynqedClient } from '@synqed-kk/client'
import { ymdInJst } from '@/lib/date/jst'

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

/**
 * S7 (PR-O commit 4; O2 + V5 + F1; RULING-S67-PRO-STOP2 R-O10): the
 * UNAMBIGUOUS booking is linked at save — ONE function, called by the facade
 * save (through createOrUpdateKaruteRecord) and the job worker's upsert, and
 * only when the save names NO booking and the record carries none.
 *
 * The guardrail — every condition must hold, anything else links nothing:
 *   1 the booking is the SAME customer's
 *   2 in the SAME store as the karute
 *   3 on the recording session's JST day
 *   4 status SCHEDULED | IN_PROGRESS (the SDK has no CONFIRMED)
 *   5 not cancelled (cancelled_at unset, status not CANCELLED)
 *   6 no OTHER karute already points at it
 *   7 EXACTLY ONE booking that day — two or more → 'ambiguous'. Counted
 *     BEFORE the status check (S67 fix round 2, B-1): every booking of the
 *     customer in that store on that day that is not cancelled counts —
 *     COMPLETED, NO_SHOW, SCHEDULED, IN_PROGRESS alike. A real visit already
 *     checked out plus the next booking is TWO bookings, never a link to the
 *     next one (a wrong link is worse than no link). The one booking then
 *     still has to pass 4–6 and the window.
 *   and the session's START falls inside the booking's own window widened by
 *   the booking's OWN duration on each side (no constant — ⚖ NO HARDCODED
 *   DURATIONS; a booking with no length links nothing).
 * The booking's SCHEDULED status is not evidence of attendance — the karute
 * is; the link is a karute→booking pointer that turns 未記録 into 記録済 on
 * the 予約 tab and changes no count (packs/reconcile.ts reads it, writes
 * nothing).
 *
 * NEVER THROWS: a read that fails links nothing ('none'), the save goes on.
 */
/** SF-6 (S67 fix round 2, commit 16): `skipped:no_session_start` = the save
 *  had no session start to judge by (a job queued before the enqueue doors
 *  stamped one, or a stamp the door could not read) — NOT evaluated, never
 *  the same word as `none` ("no booking qualifies"). */
export type AutoAppointmentLink = 'auto_linked' | 'ambiguous' | 'none' | 'skipped:no_session_start'
const LINKABLE_STATUSES = new Set(['SCHEDULED', 'IN_PROGRESS'])

export async function resolveAutoAppointmentLink(
  synqed: Pick<SynqedClient, 'appointments' | 'recordings' | 'karuteRecords'>,
  input: {
    customerId: string
    storeId: string | null
    recordingSessionId: string
    /** The session's START (its row's created_at). `undefined` = read the row
     *  here (the facade save); a string/null = the caller already has it — the
     *  worker takes it off the job payload, because the worker never reads
     *  the session row (recording-adopted-row-retry-o3 pins that). */
    sessionStartedAt?: string | null
  },
): Promise<{ link: AutoAppointmentLink; appointmentId: string | null }> {
  const none = { link: 'none' as const, appointmentId: null }
  try {
    const startIso =
      input.sessionStartedAt === undefined
        ? (await synqed.recordings.get(input.recordingSessionId))?.created_at
        : input.sessionStartedAt
    if (!startIso) {
      // SF-6: logged once per save — the only trace of an auto-link that
      // could not be evaluated.
      console.warn(
        JSON.stringify({ evt: 'auto_link_skipped', reason: 'no_session_start', recordingSessionId: input.recordingSessionId }),
      )
      return { link: 'skipped:no_session_start', appointmentId: null }
    }
    // S-1 (S68 fix round 3): the ONE JST-day spelling (ymdInJst), as every
    // other consumer in this PR. An unreadable timestamp throws here (RangeError)
    // and lands in the catch below.
    const day = ymdInJst(new Date(startIso))
    const res = await synqed.appointments.list({
      customer_id: input.customerId,
      store_id: input.storeId ?? undefined,
      from: new Date(`${day}T00:00:00+09:00`).toISOString(),
      to: new Date(`${day}T23:59:59.999+09:00`).toISOString(),
      page_size: 50,
    })
    // Condition 7 counts every NOT-CANCELLED booking of the day, whatever its
    // status (B-1); the status check (4) runs on the one booking after.
    const sameDay = (res.appointments ?? []).filter(
      (a) =>
        a.customer_id === input.customerId &&
        (a.store_id ?? null) === input.storeId &&
        ymdInJst(new Date(a.starts_at)) === day &&
        !a.cancelled_at && a.status !== 'CANCELLED',
    )
    if (sameDay.length > 1) return { link: 'ambiguous', appointmentId: null }
    const booking = sameDay[0]
    if (!booking || !LINKABLE_STATUSES.has(booking.status)) return none

    const startsMs = Date.parse(booking.starts_at)
    const endsMs = Date.parse(booking.ends_at)
    const ownMs =
      Number.isFinite(endsMs) && endsMs > startsMs
        ? endsMs - startsMs
        : (booking.duration_minutes ?? 0) * 60_000
    if (!(ownMs > 0)) return none
    const sessionMs = Date.parse(startIso)
    if (sessionMs < startsMs - ownMs || sessionMs > startsMs + 2 * ownMs) return none

    // No OTHER karute may already point at this booking (this session's own
    // record, on a converge, is not "other").
    const linked = await synqed.karuteRecords.list({ appointment_id: booking.id, page_size: 5 })
    const other = (linked.karute_records ?? []).some(
      (k) => k.appointment_id === booking.id && k.recording_session_id !== input.recordingSessionId,
    )
    if (other) return none
    return { link: 'auto_linked', appointmentId: booking.id }
  } catch {
    return none
  }
}

/** SF-2 (S67 fix round 2, commit 12): the 施術メニュー a NEW karute takes
 *  from the booking the auto-link chose — ONE function for both creates (the
 *  facade's, inside createOrUpdateKaruteRecord, and the worker's upsert), so
 *  the same booking gives the same menu at either door. It reads the booking
 *  by id exactly as the worker always did for its linked booking; best-effort:
 *  an unreadable booking leaves the menu null (the カルテ list shows its
 *  honest '—'). A NAMED booking's menu stays each door's own fill, unchanged. */
export async function menuOfAutoLinked(
  appointments: Pick<SynqedClient['appointments'], 'get'>,
  autoLinked: { appointmentId: string | null } | null,
): Promise<string | null> {
  if (!autoLinked?.appointmentId) return null
  try {
    const booking = await appointments.get(autoLinked.appointmentId)
    return (booking as { title?: string | null } | null)?.title ?? null
  } catch {
    return null
  }
}

/** R-O9 (i): the ONE expression for `appointment_link` — both writers'
 *  karute.save rows and the facade save's reply take the value here, so they
 *  can never drift. It keeps its meaning on main: what the AUTO-link did.
 *  The closed set: `kept | auto_linked | ambiguous | none` (+
 *  `skipped:no_session_start`, SF-6: not evaluated), plus a given
 *  booking's degraded reason (appointment_not_found · appointment_out_of_scope
 *  · appointment_unreadable). null = the booking was given by the payload (or
 *  no auto-link ran at all: a save with no session, the web doors).
 *    - a given booking that degraded → why
 *    - `kept` (S67 fix round 2, commit 15, SF-5) → the save named no booking
 *      and an existing link stayed through the converge (never `none` while
 *      the record is linked)
 *    - otherwise the auto-link's answer when it ran; otherwise null. */
export type AppointmentLinkValue = AppointmentLinkReason | AutoAppointmentLink | 'kept' | null
export function appointmentLinkOf(
  linkReason: AppointmentLinkReason | null,
  autoLink: AutoAppointmentLink | null | undefined,
  kept = false,
): AppointmentLinkValue {
  return linkReason ?? (kept ? 'kept' : (autoLink ?? null))
}

/** SF-5: an existing link KEPT through a converge = the write named no
 *  booking and the record still carries one (keepLinkUnlessGiven's answer).
 *  One spelling for both converges. */
export function isKeptLink(write: { appointment_id?: string | null }, linked: string | null): boolean {
  return !write.appointment_id && linked !== null
}
