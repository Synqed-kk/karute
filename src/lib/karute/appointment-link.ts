import type { Appointment, SynqedClient } from '@synqed-kk/client'
import { jstDayOf } from '@/lib/date/jst'

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
  const given = givenLinkOf(write)
  if (given) return given
  if (movesCustomer(existing, write)) return null
  return existing.appointment_id ?? null
}

/** The ONE 「given」 test: the write NAMES a booking (S4). */
function givenLinkOf(write: { appointment_id?: string | null }): string | null {
  return write.appointment_id || null
}

/** The ONE re-point test: the write moves the record to another customer (E-1). */
function movesCustomer(
  existing: { customer_id?: string | null },
  write: { customer_id?: string | null },
): boolean {
  return (write.customer_id ?? null) !== (existing.customer_id ?? null)
}

/**
 * A2 (S69 fix round 4, commit 24): the link KEY of a converge's update body —
 * sent only when THIS save changes the link. The SDK's update is a PUT
 * (karute.js:59-62) but core leaves a MISSING field untouched and CLEARS on
 * null (the S4 bug), so a converge that changes nothing about the link must
 * not send the snapshot back: a link an interleaved save wrote after the
 * snapshot would be clobbered.
 *   - the write names a booking        → that booking
 *   - else the auto-link found one     → the auto-linked booking
 *   - else the customer moves (E-1)    → null (a re-point clears, as before)
 *   - else                             → {} — the key is omitted; whatever
 *                                        link the row holds NOW stays
 * Spread into the update body (the same conditional-spread shape `entries`
 * uses). keepLinkUnlessGiven still computes the EFFECTIVE link.
 */
export function linkUpdateOf(
  existing: { customer_id?: string | null },
  write: { customer_id?: string | null; appointment_id?: string | null },
  autoLinked: { appointmentId: string | null } | null | undefined,
): { appointment_id?: string | null } {
  const given = givenLinkOf(write)
  if (given) return { appointment_id: given }
  if (autoLinked?.appointmentId) return { appointment_id: autoLinked.appointmentId }
  if (movesCustomer(existing, write)) return { appointment_id: null }
  return {}
}

/**
 * A3 (S69 fix round 4, commit 25): the job worker's converge FILLS AN EMPTY
 * LINK ONLY. A queued job is stale by the time it converges (R-O4): staff may
 * have re-picked the booking, or re-pointed the record to another customer,
 * since the enqueue.
 *   - the record already carries a link → kept (the key is not sent)
 *   - else the payload's booking, when the record is still the payload's
 *     customer
 *   - else nothing given → the caller auto-links for the RECORD's customer
 * `existing.customer_id` = the record's OWN customer, strict — never a
 * fallback (SF-5, S70 fix round 5): a record with no customer is nobody's,
 * so it takes nobody's booking. Pure; the 「given」 and re-point tests are
 * the ones keepLinkUnlessGiven uses.
 */
export function fillOnlyLinkOf(
  existing: { customer_id?: string | null; appointment_id?: string | null },
  payload: { customer_id?: string | null; appointment_id?: string | null },
): { kept: true; appointmentId: string } | { kept: false; given: string | null } {
  const linked = existing.appointment_id ?? null
  if (linked !== null) return { kept: true, appointmentId: linked }
  return { kept: false, given: movesCustomer(existing, payload) ? null : givenLinkOf(payload) }
}

/** A2 revision / A4: a value the write RETURNED wins over the computed one
 *  (karute.d.ts:14-15 — create and update return the full record); only an
 *  ABSENT field (undefined) falls back — never `??`, a returned null is the
 *  truth (a record with no link reports no link). */
export function returnedOr<T>(returned: T | undefined, computed: T): T {
  return returned !== undefined ? returned : computed
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
 *     still has to pass 4–6 and the window. A5 (S69 fix round 4): a read
 *     that fills the page, or whose `total` exceeds the rows, is not the
 *     whole day → 'ambiguous'. A11: the cancellation check runs FIRST; a
 *     non-cancelled booking whose start will not parse COUNTS toward the
 *     day, and alone it is never linked → 'ambiguous'.
 *   and the session's START falls inside the booking's own window widened by
 *   the booking's OWN duration on each side (no constant — ⚖ NO HARDCODED
 *   DURATIONS; a booking with no length links nothing).
 * The booking's SCHEDULED status is not evidence of attendance — the karute
 * is; the link is a karute→booking pointer that turns 未記録 into 記録済 on
 * the 予約 tab and changes no count (packs/reconcile.ts reads it, writes
 * nothing).
 *
 * NEVER THROWS: a read that fails — or a SESSION start that will not parse
 * (A11) — links nothing and says so ('skipped:read_failed', S-3), the save
 * goes on; 'none' is answered ONLY when the reads succeeded and nothing
 * qualified.
 */
/** SF-6 (S67 fix round 2, commit 16): `skipped:no_session_start` = the save
 *  had no session start to judge by (a job queued before the enqueue doors
 *  stamped one, or a stamp the door could not read) — NOT evaluated, never
 *  the same word as `none` ("no booking qualifies"). */
export type AutoAppointmentLink = 'auto_linked' | 'ambiguous' | 'none' | 'skipped:no_session_start' | 'skipped:read_failed'
const LINKABLE_STATUSES = new Set(['SCHEDULED', 'IN_PROGRESS'])
/** A5 (S69 fix round 4, commit 26): the page size the day's-bookings read asks
 *  for — ONE definition, read again by the full-page check below. */
const DAY_BOOKINGS_PAGE_SIZE = 50

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
    // S-1 (S68 fix round 3) + A11 (S69 fix round 4): the ONE JST-day read
    // (jstDayOf). The SESSION's own start is the one date whose failure to
    // parse means the auto-link cannot be evaluated: it lands in the catch
    // below → skipped:read_failed.
    const day = jstDayOf(startIso)
    if (!day) throw new RangeError(`session start will not parse: ${startIso}`)
    const res = await synqed.appointments.list({
      customer_id: input.customerId,
      store_id: input.storeId ?? undefined,
      from: new Date(`${day}T00:00:00+09:00`).toISOString(),
      to: new Date(`${day}T23:59:59.999+09:00`).toISOString(),
      page_size: DAY_BOOKINGS_PAGE_SIZE,
    })
    // A5 (S69 fix round 4, commit 26): page 1 is the whole day only when it is
    // not full — more bookings than one page (core's `total`, types.d.ts:650,
    // or a full page when `total` is absent) is never judged from page 1:
    // 'ambiguous', no link (a wrong link is worse than no link).
    const rows = res.appointments ?? []
    if ((typeof res.total === 'number' && res.total > rows.length) || rows.length >= DAY_BOOKINGS_PAGE_SIZE) {
      return { link: 'ambiguous', appointmentId: null }
    }
    // Condition 7 counts every NOT-CANCELLED booking of the day, whatever its
    // status (B-1); the status check (4) runs on the one booking after.
    // A11 / NIT-a (S69 fix round 4): the cancellation check runs FIRST (a
    // cancelled booking's date is never read — `cancelled_at` / status
    // CANCELLED); a NON-cancelled booking whose start will not parse COUNTS
    // toward the day, never excluded (excluding it could turn two bookings
    // into a wrong link) — and alone it is never linked: its window cannot be
    // judged → 'ambiguous'.
    const sameDay = rows.filter((a) => {
      if (a.customer_id !== input.customerId || (a.store_id ?? null) !== input.storeId) return false
      if (a.cancelled_at || a.status === 'CANCELLED') return false
      const bookingDay = jstDayOf(a.starts_at)
      return bookingDay === null || bookingDay === day
    })
    if (sameDay.length > 1) return { link: 'ambiguous', appointmentId: null }
    const booking = sameDay[0]
    if (booking && jstDayOf(booking.starts_at) === null) return { link: 'ambiguous', appointmentId: null }
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
  } catch (err) {
    // S-3 (S68 fix round 3): a failed read (the session row, the day's
    // bookings, the karute list) or an unreadable date is NOT evaluated —
    // never the word 'none' ("no booking qualifies"). Logged once.
    console.warn(
      JSON.stringify({
        evt: 'auto_link_skipped',
        reason: 'read_failed',
        recordingSessionId: input.recordingSessionId,
        cause: err instanceof Error ? err.message : String(err),
      }),
    )
    return { link: 'skipped:read_failed', appointmentId: null }
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
 *  `skipped:no_session_start`, SF-6, and `skipped:read_failed`, S-3: not
 *  evaluated), plus a given
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
  return !givenLinkOf(write) && linked !== null
}
