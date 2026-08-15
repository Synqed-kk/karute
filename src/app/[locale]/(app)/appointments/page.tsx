import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { startTiming } from '@/lib/perf/timing'
import { createClient } from '@/lib/supabase/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { resolveStoreScope, storeStaffIdSet } from '@/lib/auth/store-scope'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { getOrgSettings } from '@/actions/org-settings'
import { getAppointmentsInRange } from '@/actions/appointments'
import { getCachedDayAgenda } from '@/lib/appointments/day-agenda-cached'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getCachedMenuOptions } from '@/lib/menus/cached'
import { enrichCustomers } from '@/lib/customers/list-enrich'
import { listAllPackUsage } from '@/lib/packs/store'
import { getBusinessId } from '@/lib/staff'
import {
  buildAppointmentsScreen,
  parseDateParam,
  parseStaffParam,
  parseViewParam,
} from '@/lib/appointments/screen'
import { ymdInJst } from '@/lib/date/jst'
import {
  computeWeekRange,
  computeMonthRange,
} from '@/lib/date/calendar-range'

// Param parsing + the whole Stage-2 derivation live in
// @/lib/appointments/screen (design-parity P-B) — shared verbatim with the
// facade screen GET so the web page and the binary render from ONE
// implementation. This file keeps only the cookie-session fan-out.

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ date?: string; view?: string; staff?: string }>
}) {
  const { locale } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const selectedDate = parseDateParam(sp.date)
  const view = parseViewParam(sp.view)
  const staffFilter = parseStaffParam(sp.staff)
  // YYYY-MM-DD of the date being viewed, in JST (Vercel server is UTC, so
  // getFullYear/getMonth on a raw Date would emit the UTC calendar day —
  // wrong for half the JST clock).
  const selectedDateStr = ymdInJst(selectedDate)

  // ─────────────────────────────────────────────────────────────
  // STAGE 1 — fan out everything that doesn't depend on the
  // dayAppointments result. Previously getBusinessId() and the
  // week/month range fetch ran SEQUENTIALLY after this block,
  // adding a 500-1000ms waterfall on every navigation. Neither
  // has a dependency on the items below, so both live here now.
  //
  // Week/month range pre-compute moves into Stage 1 too — its
  // date math depends only on `selectedDate` + `view`, both
  // derived synchronously from URL params above.
  // ─────────────────────────────────────────────────────────────
  // Per-phase server timing — 予約 had no timer, so the date-arrow cost
  // (measured 1.0–1.8s per press from the browser, 2026-07-30) was never split
  // into its parts. One [perf] line per request in the Vercel logs.
  const t = startTiming(`appointments view=${view}`)
  const weekRange = view === 'week' ? computeWeekRange(selectedDate) : null
  const monthRange = view === 'month' ? computeMonthRange(selectedDate) : null

  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    orgSettings,
    customers,
    dayAppointments,
    businessId,
    weekRangeAppts,
    monthRangeAppts,
    storeScope,
    menuOptions,
  ] = await Promise.all([
    t.phase('auth.getUser', () => supabase.auth.getUser()),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('orgSettings', () => getOrgSettings()),
    t.phase('customerList', () => getCachedCustomerList()),
    // The agenda is the ONE consumer that wants cancelled rows — rendered as
    // thin greyed キャンセル済み tombstones in their original slot. Every other
    // getAppointmentsByDate caller keeps the hidden-by-default contract.
    // 60s web-only cache; appointment/karute mutations updateTag('dashboard')
    // so web edits repaint immediately (envelope in day-agenda-cached.ts).
    t.phase('day.appointments', () => getCachedDayAgenda(selectedDateStr)),
    t.phase('businessId', () => getBusinessId().catch(() => null)),
    t.phase('range.week', () =>
      weekRange
        ? getAppointmentsInRange(
            weekRange.rangeFrom.toISOString(),
            weekRange.rangeTo.toISOString(),
          )
        : Promise.resolve(null),
    ),
    t.phase('range.month', () =>
      monthRange
        ? getAppointmentsInRange(
            monthRange.rangeFrom.toISOString(),
            monthRange.rangeTo.toISOString(),
          )
        : Promise.resolve(null),
    ),
    t.phase('storeScope', () => resolveStoreScope()),
    // 60s cached active-menu union for the booking picker. Degraded the same
    // way the facade route degrades it — a menus outage must not 500 the
    // agenda; the dialog keeps today's free-text service field.
    t.phase('menus', () => getCachedMenuOptions().catch(() => [])),
  ])

  // PR-4b threads this into AppointmentsView/NewBookingDialog. Fetched here in
  // 4a so the page assembly and the shared 60s cache are exercised server-side
  // first, on the same wave as every other picker source (plan §9 4a/4b split).
  void menuOptions

  const authProfileId = user?.id ?? null
  const storeStaffIds = await t.phase('storeStaffIds', () =>
    storeStaffIdSet(staffList, storeScope.storeId),
  )

  // ─────────────────────────────────────────────────────────────
  // STAGE 2 — only enrichCustomers, since it genuinely depends on
  // dayAppointments (it needs the client_ids of today's bookings)
  // AND businessId. Both came back in Stage 1.
  // ─────────────────────────────────────────────────────────────
  const clientIdsForDay = Array.from(
    new Set(dayAppointments.map((a) => a.client_id)),
  )
  // Pack usage loads in parallel — the 残3/10 pill on each agenda row. Empty
  // map until the ticket_packs migration applies (graceful). 回数券 off (org
  // setting, wave 1) → skip the read; the pills just don't render.
  const ticketsEnabled = orgSettings?.ticket_packs_enabled ?? true
  const [enrichment, packUsage] = await Promise.all([
    t.phase('enrichCustomers', () =>
      businessId && clientIdsForDay.length
        ? enrichCustomers(businessId, clientIdsForDay)
        : Promise.resolve(new Map()),
    ),
    t.phase('packUsage', () =>
      ticketsEnabled
        ? listAllPackUsage()
        : Promise.resolve(new Map() as Awaited<ReturnType<typeof listAllPackUsage>>),
    ),
  ])
  t.end()

  const screen = buildAppointmentsScreen({
    locale,
    now: new Date(),
    selectedDate,
    staffFilter,
    staffList,
    activeStaffId,
    storeStaffIds,
    orgSettings,
    customers,
    dayAppointments,
    weekRange,
    monthRange,
    weekRangeAppts,
    monthRangeAppts,
    enrichment,
    packUsage,
  })

  return (
    <>
      {/* SWR delivery: this screen may have been served from the
          router cache — stamp when the SERVER built it so a stale
          copy refreshes itself behind the paint. */}
      <QuietRefresh renderedAt={renderStamp()} />
      <AppointmentsView
        staff={screen.staff}
        activeStaffId={screen.visibleActiveStaffId ?? screen.staff[0]?.id ?? null}
        authProfileId={authProfileId}
        customers={customers}
        locale={locale}
        orgSettings={orgSettings}
        initialAppointments={dayAppointments}
        initialView={view}
        selectedDateIso={selectedDate.toISOString()}
        weekData={screen.weekData}
        weekStartIso={screen.weekStartIso}
        monthData={screen.monthData}
        monthStartIso={screen.monthStartIso}
        reservationViews={screen.reservationViews}
        reservationStaff={screen.reservationStaff}
        businessHours={screen.businessHours}
        staffFilter={staffFilter}
      />
    </>
  )
}
