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
import { getOrgSettings } from '@/actions/org-settings'
import {
  emptyAppointmentWindow,
  fetchAppointmentWindow,
  type AppointmentWindow,
} from '@/lib/appointments/by-date'
import { resolveFetchStaffId } from '@/lib/appointments/screen'
import {
  jstWindowDays,
  resolveWindowHours,
  type DayHoursFact,
  type WeekdayKey,
} from '@/lib/operating-hours'

/** Serializable twin of the maps the builder wants (a server action's return
 *  value crosses a serialization boundary, so Maps travel as entry arrays). */
export type AppointmentWindowPayload = AppointmentWindow & {
  coreStaffByProfileId: [string, string][]
  hoursFacts: [string, DayHoursFact][]
}

export async function getAppointmentWindow(
  fromIso: string,
  toIso: string,
  staffFilter: string,
  activeStaffId: string | null,
): Promise<AppointmentWindowPayload> {
  const [synqed, scope, orgSettings] = await Promise.all([
    getSynqedClient(),
    // Same clamp the day agenda and the old range action use: the RBAC-resolved
    // store, never the raw cookie, so a store-restricted staff's week/month
    // numbers can never include another branch.
    resolveStoreScope(),
    getOrgSettings(),
  ])
  const storeId = scope.storeId ?? undefined

  // ONE roster read, and only when a filter is actually on: appointments.staff_id
  // is a CORE staff id while the URL/viewer carry PROFILE ids.
  const coreStaffByProfileId = new Map<string, string>()
  if (staffFilter !== 'all') {
    const { staff } = await synqed.staff.list({ page_size: 200 })
    for (const s of staff) {
      if (s.user_id) coreStaffByProfileId.set(s.user_id, s.id)
    }
  }
  const { staffId, unknown } = resolveFetchStaffId(
    staffFilter,
    activeStaffId,
    coreStaffByProfileId,
  )

  const span = jstWindowDays(fromIso, toIso)

  const [window, policy, closed] = await Promise.all([
    // A filter naming somebody the roster cannot place gets ZERO rows, not the
    // whole salon's week.
    unknown
      ? Promise.resolve(emptyAppointmentWindow())
      : fetchAppointmentWindow(synqed, fromIso, toIso, { storeId, staffId }),
    // No catch on purpose. `storePolicies.get` answers the PLATFORM DEFAULTS for
    // a store with no row of its own (`source: 'default'` —
    // @synqed-kk/client dist/store-policies.d.ts), so "no policy row" is a
    // normal 200, never an error to swallow. Anything that does throw here is a
    // real outage and must reach the page.
    storeId ? synqed.storePolicies.get(storeId) : Promise.resolve(null),
    storeId
      ? synqed.storePolicies.listClosedDays(storeId, {
          from: span.fromYmd,
          to: span.toExclusiveYmd, // exclusive, per the SDK's own contract
        })
      : Promise.resolve({ closed_days: [] as { date: string }[] }),
  ])

  const hoursFacts = resolveWindowHours(span.days, {
    weeklyHours: policy?.weekly_hours ?? null,
    closedDates: new Set(closed.closed_days.map((d) => d.date)),
    orgHours: orgSettings?.operating_hours,
    orgSaved: new Set<WeekdayKey>(orgSettings?.operating_hours_saved ?? []),
  })

  return {
    ...window,
    coreStaffByProfileId: [...coreStaffByProfileId],
    hoursFacts: [...hoursFacts],
  }
}
