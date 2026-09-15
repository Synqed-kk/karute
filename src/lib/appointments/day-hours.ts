// ⚖ PKT-1c-C — the ONE read behind the closed-day booking door.
//
// The 予約 screens already resolve a day's hours through resolveDayHours off
// four inputs (the store's own weekly_hours, its 臨時休業 dates, the
// business-wide blob, and which of that blob's weekdays a human really saved).
// The WRITE path has to ask the same question about exactly ONE day, so this is
// that same fetch shape (src/actions/appointments-window.ts:109-146) narrowed to
// a single date — never a window, never a second resolver.
//
// DEGRADED-ALLOWED, on purpose: a store-policy read we could not make says
// NOTHING about whether the day is closed, and refusing every booking because a
// policy read hiccuped would be a new outage the app invented — the front desk
// could not take a booking that core itself would happily accept. So a failed
// read logs and falls through to the business-wide blob, which is exactly the
// behaviour of this tip today (nothing refuses a closed day at all). Same call
// as appointments-window.ts's `stores.get` sibling: "failing the whole thing
// over it would be the louder lie." The closed day still renders 休 on the
// screens; only the refusal steps aside.

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

  try {
    const [policy, closed] = await Promise.all([
      synqed.storePolicies.get(storeId),
      // `to` is EXCLUSIVE (the SDK's own contract, dist/store-policies.d.ts), so
      // one day is [ymd, ymd+1). JST has no DST — one day is exactly 86,400,000 ms.
      synqed.storePolicies.listClosedDays(storeId, { from: ymd, to: ymdInJst(nextDay) }),
    ])
    return {
      weeklyHours: policy?.weekly_hours ?? null,
      closedDates: new Set(closed.closed_days.map((d) => d.date)),
      orgSaved: new Set<WeekdayKey>(orgSaved ?? []),
    }
  } catch (err) {
    console.error('[booking-day-hours] store hours read degraded:', err)
    return orgOnlyDayHours(orgSaved)
  }
}
