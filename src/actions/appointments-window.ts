'use server'

// The 予約 week/month/day WINDOW read for the web page.
//
// It replaces `getAppointmentsInRange` on this surface for three reasons the
// old action could not serve:
//
//  1. It PARTITIONS (counted / cancelled / no-show) and reports `truncated`,
//     so the screen can show キャンセル counts and can refuse to print a number
//     it could not read in full.
//  2. It applies the 担当/自分 filter AT THE FETCH, which is what finally makes
//     the filter reach the week and month numbers instead of only the day list.
//  3. It THROWS. `getAppointmentsInRange` catches everything into `[]`, so a
//     core outage painted as an empty, perfectly calm week — the one lie a
//     booking screen must never tell (⚖ STRESS-D2 C2). The page has no catch
//     around this call, so a failed read surfaces as an error.

import { getSynqedClient } from '@/lib/synqed/client'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { reachesNoStore } from '@/lib/auth/store-gate'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import {
  emptyAppointmentWindow,
  fetchAppointmentWindow,
  fetchCoreStaffByProfileId,
  type AppointmentWindow,
} from '@/lib/appointments/by-date'
import { resolveFetchStaffId } from '@/lib/appointments/screen'
import { coreBusinessType } from '@/lib/welcome/business-types'
import {
  jstWindowDays,
  resolveWindowHours,
  type DayHoursFact,
  type WeekdayKey,
} from '@/lib/operating-hours'

/** Serializable twin of the map the caller wants (a server action's return
 *  value crosses a serialization boundary, so Maps travel as entry arrays).
 *
 *  The profile→core roster map stays INSIDE: nobody consumed it, and under the
 *  store-isolation law a branch's staff must not receive other stores' ids at
 *  all (the same rule screen.ts:124-131 states for colorRosterIds). */
export type AppointmentWindowPayload = AppointmentWindow & {
  hoursFacts: [string, DayHoursFact][]
  /** ⚖ R1-9 — the 担当 filter named somebody the roster could not place, so
   *  the window below is empty BY CONSTRUCTION. The screen needs to know, or
   *  it reads those zero rows as a real day and divides them by one lane. */
  staffFilterUnknown: boolean
  /** THIS STORE's vertical — the per-store column when core carries it, else
   *  the business-wide setting. It decides only one thing: whether a day is
   *  class-bound, in which case one booking row is many people and no
   *  percentage is honest. Null = unknown, which reads as not class-bound. */
  businessType: string | null
  /** ⚖ G2 (Greptile round 1 #934) — the store row read FAILED (never "there
   *  was no store id to read"); `businessType` above already fell to the
   *  org-wide setting the same way a genuine no-override store would, so the
   *  screen must read THIS flag, not `businessType`, to know the org type is
   *  a guess for this store and must not decide its lane kind. */
  storeRowDegraded: boolean
}

export async function getAppointmentWindow(
  fromIso: string,
  toIso: string,
  staffFilter: string,
  /** `false` = the bare window: the rows, and no store hours / 臨時休業 read
   *  for this span at all. 先月同期間比's previous month wants a COUNT, and the
   *  page takes its hours facts from the displayed window — so with the flag
   *  left on, every 月 page view paid for two core calls and an hours
   *  resolution over ~30 days that were thrown away on the next line. The
   *  store clamp, the 担当 filter and the rows are identical either way; this
   *  only says whether to ask about opening hours. */
  withHours = true,
): Promise<AppointmentWindowPayload> {
  const [synqed, scope, orgSettings, activeStaffId] = await Promise.all([
    getSynqedClient(),
    // Same clamp the day agenda and the old range action use: the RBAC-resolved
    // store, never the raw cookie, so a store-restricted staff's week/month
    // numbers can never include another branch.
    resolveStoreScope(),
    getOrgSettings(),
    // 'use server' means this function IS a POST endpoint, so every argument is
    // caller-controlled. The VIEWER's own id is never an argument: the house
    // rule at src/lib/staff.ts:255-257 says read it here, never from client
    // input. React-cache'd, and resolveStoreScope above already resolved it in
    // this request, so it costs nothing. (staffFilter stays an argument — it is
    // the 担当 chip, and it can only narrow rows this caller may already read.)
    getCurrentUserStaffId(),
  ])
  const storeId = scope.storeId ?? undefined

  // ONE roster read, and only when a filter is actually on: appointments.staff_id
  // is a CORE staff id while the URL/viewer carry PROFILE ids.
  const coreStaffByProfileId =
    staffFilter === 'all'
      ? new Map<string, string>()
      : await fetchCoreStaffByProfileId(synqed)
  const { staffId, unknown } = resolveFetchStaffId(
    staffFilter,
    activeStaffId,
    coreStaffByProfileId,
  )

  const span = jstWindowDays(fromIso, toIso)
  // ⚖ S7 — the FETCH starts one JST day EARLY (C1's window-edge leak).
  //
  // A booking that began at 23:00 the night before the range still occupies
  // minutes of day 1, and the capacity model has to see it or day 1 reads as
  // emptier than it is. Core filters by the row's own instant, so a window
  // that begins at day 1's midnight simply never returns it.
  //
  // Nothing else moves: 件, 予約時間 and the visible chips stay bucketed by
  // START day, so the extra day's rows land in a bucket outside the range and
  // are never read there — only the capacity model's intersection index looks
  // at them. `span` above is deliberately the VISIBLE range: the hours facts
  // and the 臨時休業 read still describe exactly the days on screen.
  //
  // JST has no DST, so one day is exactly 86,400,000 ms and this lands on the
  // previous JST midnight for any JST-midnight start — which is what every
  // caller passes (computeWeekRange / computeMonthRange / parseDateParam).
  const fetchFromIso = new Date(Date.parse(fromIso) - 86_400_000).toISOString()

  const [window, policy, closed, store] = await Promise.all([
    // A filter naming somebody the roster cannot place gets ZERO rows, not the
    // whole salon's week — and neither does an actor who reaches NO store
    // (`storeId` is undefined for them, which core reads as "every store";
    // ⚖ Liam 2026-09-16, census: week/month window, FO).
    unknown || reachesNoStore(scope)
      ? Promise.resolve(emptyAppointmentWindow())
      : fetchAppointmentWindow(synqed, fetchFromIso, toIso, { storeId, staffId }),
    // No catch on purpose. `storePolicies.get` answers the PLATFORM DEFAULTS for
    // a store with no row of its own (`source: 'default'` —
    // @synqed-kk/client dist/store-policies.d.ts), so "no policy row" is a
    // normal 200, never an error to swallow. Anything that does throw here is a
    // real outage and must reach the page.
    withHours && storeId ? synqed.storePolicies.get(storeId) : Promise.resolve(null),
    withHours && storeId
      ? synqed.storePolicies.listClosedDays(storeId, {
          from: span.fromYmd,
          to: span.toExclusiveYmd, // exclusive, per the SDK's own contract
        })
      : Promise.resolve({ closed_days: [] as { date: string }[] }),
    // The store's own row, for its vertical. Degraded-allowed and CAUGHT on
    // purpose, unlike its neighbours: a store row we cannot read tells us
    // nothing about whether this shop runs classes, and the org-wide setting
    // below already answers that question for every store that has not
    // overridden it. Failing the whole week's numbers over it would be the
    // louder lie.
    //
    // ⚖ G2 — the catch returns `undefined`, NEVER `null`: `null` stays "no
    // store id to read" (the branch below never even calls this), so
    // `store === undefined` is the one honest way to tell a FAILED read
    // apart from a genuine no-row. `businessType` below still falls to the
    // org setting either way (unchanged) — `storeRowDegraded`, derived from
    // this sentinel, is what now tells the screen the org type is a guess it
    // must not use to decide this store's lane kind.
    storeId
      ? synqed.stores.get(storeId).catch((err) => {
          console.error(
            '[appointments-window] store row read degraded — capacity withheld, not guessed:',
            err,
          )
          return undefined
        })
      : Promise.resolve(null),
  ])

  const hoursFacts = withHours
    ? resolveWindowHours(span.days, {
        weeklyHours: policy?.weekly_hours ?? null,
        closedDates: new Set(closed.closed_days.map((d) => d.date)),
        orgHours: orgSettings?.operating_hours,
        orgSaved: new Set<WeekdayKey>(orgSettings?.operating_hours_saved ?? []),
      })
    : new Map<string, DayHoursFact>()

  return {
    ...window,
    staffFilterUnknown: unknown,
    hoursFacts: [...hoursFacts],
    // Per-store first (a chain can run a yoga studio next to a hair salon),
    // the business-wide setting second. Empty string is the org default and
    // means nothing was chosen.
    businessType:
      (store ? coreBusinessType(store) : null) ||
      (orgSettings?.business_type || null),
    storeRowDegraded: store === undefined,
  }
}
