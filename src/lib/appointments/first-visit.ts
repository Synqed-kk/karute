// ⚖ PKT-2 / R1-1 — THE 新規 RULE, one home, and it is THE LIST'S.
//
// Liam 2026-09-15 16:0x: 「count how many new customers are in the booking on
// that day by just scrolling through the 予約 tab」. So the number is not a
// second opinion about a customer — it IS the day list's own 新規 tag, counted
// by person. R1 collapses the two: the tag (src/lib/appointments/screen.ts)
// and the number (below) call ONE predicate, so they cannot come out different
// in front of a staff member.
//
// What R1 DELETED, and why. The number used to read `enrichment.firstVisitIso`
// and, failing that, the customer's EARLIEST counted booking inside the fetched
// window. Neither signal is one the list reads, and both broke the thing Liam
// asked for:
//   · the window fallback made one Wednesday come out 1 in day view and 0 in
//     week view — the window IS the answer there, and the two views fetch
//     different windows;
//   · `firstVisitIso` counted a QR-migrated regular (is_existing_customer,
//     visit_count 7, history never synced) as 新規 while the list beside it
//     said 予約済 — the exact bug the list's own guard was written against.
// The customer-level signals decide, so day view = week view = month cell for
// the same day, by construction: there is no window memo left to disagree
// about.
//
// THE CHIP AND THE NUMBER. The visible 新規 chip yields to the session status
// (computeDisplayStatus returns 進行中/完了 once a booking has started), so it
// disappears at the booking's start time. That is a STATUS display and does not
// change who is new: the number counts the PERSON — the tag the row carries
// before the session status hides the chip — which is why an afternoon still
// reports the first-timer who came at 10:00.

import type { Appointment } from '@synqed-kk/client'
import { ymdInJst } from '@/lib/date/jst'
import { firstVisitFromBooking, holdsPackFromTitle } from '@/lib/customers/first-visit'
import { isReturningCustomer } from '@/lib/customers/status-signals'
import { isCountedBooking } from './by-date'

/** QuickReserve's own signals off the cached customer row — the import flag,
 *  the lifetime visit count, the 回数券 flag. Absent = we hold no cached row
 *  for this person and the signals are simply unknown (the list reads them the
 *  same way: `cc?.isExistingCustomer`). */
export interface CachedCustomerSignals {
  isExistingCustomer?: boolean
  visitCount?: number
  hasTicketPack?: boolean
}

/** The reconciled history we hold for one person (enrichCustomers). */
export interface HistorySignals {
  totalKarute: number
  pastAppointmentCount: number
}

/** Everything the rule reads that is not on the booking row. Both doors
 *  resolve it the same way, from reads that are already store-clamped. */
export interface NewCustomerInputs {
  /** Cached customer rows by id. */
  customers: ReadonlyMap<string, CachedCustomerSignals>
  /** Reconciled history by id. An id ABSENT means no history read covered this
   *  person, and the list reads that as NOT 新規 (`?? false`, see
   *  reservation-view.ts) — so the number does too. Never "everyone is new". */
  enrichment: ReadonlyMap<string, HistorySignals>
  /** The 回数券 ledger (listAllPackUsage). Only `.has` is read. `null` = the
   *  read FAILED (⚖ G2, Greptile round 1 #951) — treated here as NO LEDGER
   *  SIGNAL for this tag: the cached `hasTicketPack` flag still counts, and
   *  the list keeps rendering (never a 502 over the ledger). The NUMBER's own
   *  withholding on a failed ledger lives in screen.ts's `newCountKnown`, not
   *  here — this function has no way to tell "known" from "unknown" for the
   *  screen as a whole, only what one person's own signals say. */
  packUsage: ReadonlyMap<string, unknown> | null
}

/** The verdict the day's COURSE NAMES force, per customer (Liam 2026-07-03:
 *  the reservation system outranks our inference — a 新規〜 course IS a first
 *  visit, and any OTHER named course says returning, because an import that
 *  carries no history proves nothing).
 *
 *  Per CUSTOMER and over the rows of ONE day, which is the day list's own loop
 *  and now this function: what a person's 10:00 「カット」 proves about them is
 *  still true at 14:00. Titleless rows leave the verdict unset and fall through
 *  to the history signals. */
export function titleVerdictByClient(
  rows: readonly { clientId: string; title: string | null | undefined }[],
): Map<string, boolean> {
  const verdict = new Map<string, boolean>()
  for (const r of rows) {
    const fromBooking = firstVisitFromBooking(r.title)
    if (fromBooking !== null) verdict.set(r.clientId, fromBooking)
  }
  return verdict
}

/** ⚖ THE 新規 TAG for one person on one day — the value the day list prints its
 *  chip from and the value the number counts, out of one function.
 *
 *  The order is the list's, conjunct for conjunct:
 *  (a) a 回数券 LEDGER entry → never 新規 (the list's trailing
 *      `&& !holdsTicketPack`; the course-title arm of that exclusion is
 *      row-level and stays with the caller, one shared regex either way);
 *  (b) the day's course names, whenever they say anything;
 *  (c) else the person's own history, through the ONE resolver every customer
 *      surface reads — `isReturningCustomer`, inverted;
 *  (d) no history read for this person → NOT 新規.
 *
 *  `titleVerdict` is what makes this "for day": it is built from that day's
 *  rows. Nothing else here is window- or day-dependent, which is the whole
 *  point — the same person, the same day, the same answer on every surface. */
export function isNewCustomerForDay(
  clientId: string,
  titleVerdict: ReadonlyMap<string, boolean>,
  inputs: NewCustomerInputs,
): boolean {
  if (inputs.packUsage?.has(clientId)) return false

  const forced = titleVerdict.get(clientId)
  if (forced !== undefined) return forced

  const history = inputs.enrichment.get(clientId)
  if (history === undefined) return false

  const cached = inputs.customers.get(clientId)
  return !isReturningCustomer({
    joinDateIso: null,
    lastVisitIso: null,
    isExistingCustomer: cached?.isExistingCustomer,
    visitCount: cached?.visitCount,
    // The QR flag OR a real ticket_packs ledger entry — a manually-registered
    // pack holder is returning even before QR knows about them.
    hasTicketPack: (cached?.hasTicketPack ?? false) || (inputs.packUsage?.has(clientId) ?? false),
    karuteCount: history.totalKarute,
    pastAppointmentCount: history.pastAppointmentCount,
  })
}

/** The 新規 number for every JST day of one fetched window, keyed YYYY-MM-DD.
 *  Days with no 新規 are absent — every caller reads `?? 0`.
 *
 *  PEOPLE, not rows: two bookings by one person on one day are ONE 新規,
 *  because one person is what a staffer counts scrolling that day's list.
 *
 *  And ONE DAY AT A TIME. The tag is a fact about the PERSON, so a first-timer
 *  who books Monday and Wednesday carries the chip on both days and this
 *  reports 1 on both — the same two numbers the staffer counts by eye. That is
 *  also what makes the day view, the week row and the month cell for one date
 *  agree: no day's answer depends on which window it was read in. */
export function newCountByDay(
  counted: readonly Appointment[],
  inputs: NewCustomerInputs,
): Map<string, number> {
  const rowsByDay = new Map<string, { clientId: string; title: string | null | undefined }[]>()
  for (const a of counted) {
    if (!isCountedBooking(a) || a.customer_id == null) continue
    const day = ymdInJst(new Date(a.starts_at))
    let rows = rowsByDay.get(day)
    if (rows === undefined) rowsByDay.set(day, (rows = []))
    rows.push({ clientId: a.customer_id, title: a.title })
  }

  const counts = new Map<string, number>()
  for (const [day, rows] of rowsByDay) {
    const verdict = titleVerdictByClient(rows)
    const people = new Set<string>()
    for (const r of rows) {
      // The row-level half of the 回数券 exclusion — a course title naming a
      // 回数券, for customers with no ledger entry yet. The agenda adapter
      // applies the identical `!holdsPackFromTitle(title)` to its own rows.
      if (holdsPackFromTitle(r.title)) continue
      if (isNewCustomerForDay(r.clientId, verdict, inputs)) people.add(r.clientId)
    }
    if (people.size > 0) counts.set(day, people.size)
  }
  return counts
}
