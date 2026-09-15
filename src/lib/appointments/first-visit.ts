// ⚖ PKT-2 — THE 新規 RULE, one home.
//
// Liam 2026-09-15 16:0x: 「count how many new customers are in the booking on
// that day by just scrolling through the 予約 tab」. So the number is not a
// property of a customer record — it is the people whose FIRST VISIT falls on
// that day, decided by the same rule the day list already prints its 新規 tag
// from (src/lib/appointments/screen.ts + src/lib/adapters/reservation-view.ts).
// One rule, one home: a second formula is how the list and the number start
// disagreeing in front of a staff member.
//
// What this REPLACES: `newCustomerCount` used to be the count of that day's
// bookings whose customer carried the QuickReserve `is_existing_customer ===
// false` import flag — a different source, about a different question, and it
// never printed (typeSlot was 'off' everywhere). That producer is deleted.

import type { Appointment } from '@synqed-kk/client'
import { ymdInJst } from '@/lib/date/jst'
import { firstVisitFromBooking, holdsPackFromTitle } from '@/lib/customers/first-visit'
import { isCountedBooking } from './by-date'

/** Everything the rule needs that is not on the booking row itself. Both
 *  doors resolve it the same way (the web page + the facade GET), from reads
 *  that are already store-clamped. */
export interface FirstVisitInputs {
  /** The window's clients, from the SAME enrichment map the day list folds —
   *  `firstVisitIso` is the reconciled earliest visit (MIN of karute
   *  session_date + past-appointment start_time), null when unknown. */
  enrichment: ReadonlyMap<string, { firstVisitIso: string | null }>
  /** The 回数券 ledger (listAllPackUsage). A holder is an established
   *  returning customer and is NEVER 新規 — the exact exclusion the day list's
   *  tag applies. Only `.has` is read. */
  packUsage: ReadonlyMap<string, unknown>
}

export interface FirstVisitCtx extends FirstVisitInputs {
  /** clientId → the EARLIEST counted booking day inside the fetched window.
   *  The fallback for a customer with no reconciled history at all. */
  earliestCountedDay: ReadonlyMap<string, string>
}

/** The JST calendar day an ISO instant OR a bare YYYY-MM-DD falls on. Both
 *  shapes come back from core's enrichment aggregate, and both have to land on
 *  the same day the booking buckets to. */
function jstDay(iso: string): string {
  return ymdInJst(new Date(iso))
}

/** ⚖ Is THIS booking the customer's first visit, on THIS JST day?
 *
 *  Rule order is the day list's order, deliberately — see the parity test:
 *  (5) a BLOCK row, a terminal row or a row with no customer is never anyone's
 *      visit (the ONE counted predicate, never a second copy of it);
 *  (4) a 回数券 holder is never 新規 (ledger first, course title as the
 *      un-imported fallback) — this outranks everything below, exactly as the
 *      `&& !holdsTicketPack` at the end of the list's own tag does;
 *  (1) the reservation system outranks inference (Liam 2026-07-03): a 新規〜
 *      course IS a first visit, and any OTHER named course says returning —
 *      our own missing history proves nothing;
 *  (2) else the reconciled first visit, when we have one;
 *  (3) else the earliest counted booking inside the fetched window. */
export function isFirstVisitOn(row: Appointment, day: string, ctx: FirstVisitCtx): boolean {
  if (!isCountedBooking(row)) return false
  const clientId = row.customer_id
  if (clientId == null) return false
  if (ymdInJst(new Date(row.starts_at)) !== day) return false

  if (ctx.packUsage.has(clientId) || holdsPackFromTitle(row.title)) return false

  const fromBooking = firstVisitFromBooking(row.title)
  if (fromBooking !== null) return fromBooking

  const firstIso = ctx.enrichment.get(clientId)?.firstVisitIso
  if (firstIso != null) return jstDay(firstIso) === day

  return ctx.earliestCountedDay.get(clientId) === day
}

/** The 新規 number for every day of one fetched window, keyed by JST
 *  YYYY-MM-DD. Days with no 新規 are absent — every caller reads `?? 0`.
 *
 *  `counted` is the WHOLE window, always: rule (3) needs the window to find a
 *  customer's earliest day, so handing this one day's rows would make that
 *  fallback say "today" for everybody. The week rows, the month cells and the
 *  selected day's own totals therefore read ONE map per window — they cannot
 *  come out with different answers for the same day.
 *
 *  Counts PEOPLE: two bookings on one day are one 新規, and a person has ONE
 *  first visit, so when a window contradicts itself (a 新規-titled course after
 *  an earlier plain booking by the same customer) the EARLIEST day wins rather
 *  than both days claiming them. */
export function newCountByDay(
  counted: readonly Appointment[],
  inputs: FirstVisitInputs,
): Map<string, number> {
  const earliestCountedDay = new Map<string, string>()
  for (const a of counted) {
    if (!isCountedBooking(a) || a.customer_id == null) continue
    const day = ymdInJst(new Date(a.starts_at))
    const prev = earliestCountedDay.get(a.customer_id)
    // YYYY-MM-DD compares lexicographically exactly as it compares by date.
    if (prev === undefined || day < prev) earliestCountedDay.set(a.customer_id, day)
  }

  const ctx: FirstVisitCtx = { ...inputs, earliestCountedDay }
  const newDayByClient = new Map<string, string>()
  for (const a of counted) {
    if (a.customer_id == null) continue
    const day = ymdInJst(new Date(a.starts_at))
    if (!isFirstVisitOn(a, day, ctx)) continue
    const prev = newDayByClient.get(a.customer_id)
    if (prev === undefined || day < prev) newDayByClient.set(a.customer_id, day)
  }

  const counts = new Map<string, number>()
  for (const day of newDayByClient.values()) {
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
}
