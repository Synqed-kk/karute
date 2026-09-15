// ⚖ PKT-1c-C — the ONE read behind the closed-day booking door.
//
// The 予約 screens already resolve a day's hours through resolveDayHours off
// four inputs (the store's own weekly_hours, its 臨時休業 dates, the
// business-wide blob, and which of that blob's weekdays a human really saved).
// The WRITE path has to ask the same question about exactly ONE day, so this is
// that same fetch shape (src/actions/appointments-window.ts:109-146) narrowed to
// a single date — never a window, never a second resolver.
//
// ⚖ R1-10 — and the fact this door refuses on IS shown: BOOKING_SWITCHES
// .closedDays goes ON with this branch, so the week row and the day numbers
// line paint 休 from the same resolver answer. (Do not read that as "a closed
// day always renders 休 somewhere": isClosedRow gates on closed AND zero
// bookings, by the lead's ruling, and the month grid has no 休 cell on this
// tip at all.) Refusing on a fact no screen shows would be the worse gap.
//
// DEGRADED-ALLOWED, on purpose: a store-policy read we could not make says
// NOTHING about whether the day is closed, and REFUSING a booking over a read
// we could not make would be an outage the app invented on the write path —
// the front desk could not take a booking that core itself would happily
// accept.
//
// ⚖ R1-6, the honest trade, stated because it is NOT what the neighbour does:
// the 予約 SCREEN's own storePolicies read (appointments-window.ts:115-120)
// deliberately does not catch — "Anything that does throw here is a real
// outage and must reach the page." (Its `stores.get` sibling, the
// business-type read, is the one that catches, and that is a different
// question.) So under a storePolicies outage the two layers make OPPOSITE
// calls on purpose: the screen fails LOUD, because a page of wrong numbers is
// a lie; this door fails OPEN, because a refusal is an action taken against
// the staffer on evidence we do not have. What that costs is real and is
// accepted: during such an outage the screen is erroring, so the staffer is
// not being shown 休 either — nothing here is silently contradicting a screen.
//
// ⚖ R1-6 — the two reads settle INDEPENDENTLY. They answer different
// questions (the weekly 定休日 and the ad-hoc 臨時休業 dates), so one failing
// must not throw away the other's good answer: a blipped closed-dates read
// used to reopen a store's whole weekly 定休日 with it.

import type { SynqedClient } from '@synqed-kk/client'
import { ymdInJst } from '@/lib/date/jst'
import type { WeekdayKey } from '@/lib/operating-hours'
import type { BookingDayHours } from '@/lib/appointments'

/** Only the two READ verbs — nothing here may write a store policy. */
type StorePolicyReader = {
  storePolicies: Pick<SynqedClient['storePolicies'], 'get' | 'listClosedDays'>
}

/** The store said nothing about this day. Never closed on its own: the org blob
 *  below still gets its say, and a day nobody saved anywhere stays open. */
export function orgOnlyDayHours(orgSaved: readonly WeekdayKey[] | undefined): BookingDayHours {
  return {
    weeklyHours: null,
    closedDates: new Set<string>(),
    orgSaved: new Set<WeekdayKey>(orgSaved ?? []),
  }
}

/**
 * The store's own hours facts for the ONE JST day `date` falls on.
 *
 * `storeId` is the booking's store as its door already clamped it (the web
 * action's cookie clamp / the facade's store-id header clamp) — never guessed,
 * and never another store's: both reads are keyed by that id, so a
 * store-restricted staffer can only ever trigger their own store's policy.
 * No store in hand → no store to ask → the org blob alone.
 */
export async function fetchBookingDayHours(
  synqed: StorePolicyReader,
  storeId: string | null | undefined,
  date: Date,
  orgSaved: readonly WeekdayKey[] | undefined,
): Promise<BookingDayHours> {
  // ⚖ R1-3 — an Invalid Date never reaches ymdInJst: partsInJst →
  // Intl.DateTimeFormat.formatToParts throws RangeError on one, and a throw on
  // the booking write path is a 500 where the contract says a plain refusal.
  // Both doors refuse an unparseable start before they ever get here
  // (validateAppointmentInput); this is the belt for a future third caller,
  // and it also keeps a junk range off the wire.
  if (!storeId || Number.isNaN(date.getTime())) return orgOnlyDayHours(orgSaved)

  const ymd = ymdInJst(date)
  const nextDay = new Date(date.getTime() + 86_400_000)

  // The async wrappers are not decoration: they turn a SYNCHRONOUS throw (a
  // client whose storePolicies namespace is missing) into a rejection, so it
  // degrades like every other failed read instead of escaping as an error the
  // staffer reads as "booking failed".
  const [policy, closed] = await Promise.allSettled([
    (async () => synqed.storePolicies.get(storeId))(),
    // `to` is EXCLUSIVE (the SDK's own contract, dist/store-policies.d.ts), so
    // one day is [ymd, ymd+1). JST has no DST — one day is exactly 86,400,000 ms.
    (async () =>
      synqed.storePolicies.listClosedDays(storeId, { from: ymd, to: ymdInJst(nextDay) }))(),
  ])

  if (policy.status === 'rejected') logDegraded('weekly hours', storeId, ymd, policy.reason)
  if (closed.status === 'rejected') logDegraded('closed dates', storeId, ymd, closed.reason)

  return {
    weeklyHours: policy.status === 'fulfilled' ? (policy.value?.weekly_hours ?? null) : null,
    closedDates: new Set(
      closed.status === 'fulfilled' ? closed.value.closed_days.map((d) => d.date) : [],
    ),
    orgSaved: new Set<WeekdayKey>(orgSaved ?? []),
  }
}

/** ⚖ R1-6 — a booking was accepted on a day the app could not check, so the
 *  line has to say WHICH store and WHICH day or the accepted booking can never
 *  be found afterwards. Ids and the error's class only — never a name, never
 *  the policy body. */
function logDegraded(what: string, storeId: string, ymd: string, err: unknown): void {
  console.error(
    `[booking-day-hours] ${what} read degraded — store ${storeId}, ${ymd} JST:`,
    err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  )
}
