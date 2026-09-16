import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { startTiming } from '@/lib/perf/timing'
import { createClient } from '@/lib/supabase/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { customerLensFor, resolveStoreScope, storeStaffIdSet } from '@/lib/auth/store-scope'
import { reachesNoStore } from '@/lib/auth/store-gate'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { getOrgSettings } from '@/actions/org-settings'
import { getMonthCells } from '@/actions/appointments'
import { getCachedDayAgenda } from '@/lib/appointments/day-agenda-cached'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getCachedMenuOptions, scopeMenuOptions } from '@/lib/menus/cached'
import { getAppointmentWindow } from '@/actions/appointments-window'
import { BOOKING_SWITCHES } from '@/lib/appointments/booking-switches'
import { monthCompareWindow } from '@/lib/appointments/month-compare'
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
  jstEndOfDay,
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
  // ONE clock for this render: the compare window below and the screen build
  // further down both read it, and two `new Date()` calls either side of a
  // midnight would compare one month against a different elapsed window.
  const now = new Date()
  const weekRange = view === 'week' ? computeWeekRange(selectedDate) : null
  const monthRange = view === 'month' ? computeMonthRange(selectedDate) : null
  // 先月同期間比's extra read (spec §8). Null = no clause, hence no read: a
  // future month has nothing elapsed to compare, and while the switch is off
  // nothing renders it either — so neither case pays for a fetch.
  const compareWindow =
    monthRange && BOOKING_SWITCHES.monthCompare
      ? monthCompareWindow(monthRange.monthStart, now)
      : null

  // Resolved BEFORE the wave because the customer read is now an ARGUMENT of
  // it (⚖ Liam 2026-08-17: a clamped actor's booking picker must not offer
  // another branch's customers). React-cache'd and already resolved by the
  // layout this request, so this is a memo hit, not a serialized roundtrip.
  const storeScope = await t.phase('storeScope', () => resolveStoreScope())
  // Clamped → the single active-store lens (server-filtered, so the combobox's
  // client-side search is store-clamped by construction). viewAll, floating
  // and degraded stay business-wide: reads ignore `degraded` by the shipped
  // F-A convention — the fail-closed blindness the menu clamp below applies is
  // a WRITE-offer posture, not the read plane's. `null` = clamped with no store
  // to name: an EMPTY combobox, never the business-wide one (customerLensFor).
  const customerLens = customerLensFor(storeScope)

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
    weekWindow,
    monthWindow,
    dayWindow,
    prevMonthWindow,
    menuOptions,
  ] = await Promise.all([
    t.phase('auth.getUser', () => supabase.auth.getUser()),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('orgSettings', () => getOrgSettings()),
    t.phase('customerList', async () =>
      customerLens === null ? [] : getCachedCustomerList(customerLens),
    ),
    // The agenda is the ONE consumer that wants cancelled rows — rendered as
    // thin greyed キャンセル済み tombstones in their original slot. Every other
    // getAppointmentsByDate caller keeps the hidden-by-default contract.
    // 60s web-only cache; appointment/karute mutations updateTag('dashboard')
    // so web edits repaint immediately (envelope in day-agenda-cached.ts).
    t.phase('day.appointments', () => getCachedDayAgenda(selectedDateStr)),
    t.phase('businessId', () => getBusinessId().catch(() => null)),
    // The window reads THROW (unlike the old getAppointmentsInRange, which
    // caught everything into []): a core outage must surface as an error, never
    // as a calm empty week. They also carry the 担当/自分 filter, the terminal
    // partitions and each day's resolved opening hours.
    t.phase('range.week', () =>
      weekRange
        ? getAppointmentWindow(
            weekRange.rangeFrom.toISOString(),
            weekRange.rangeTo.toISOString(),
            staffFilter,
          )
        : Promise.resolve(null),
    ),
    t.phase('range.month', () =>
      monthRange
        ? getAppointmentWindow(
            monthRange.rangeFrom.toISOString(),
            monthRange.rangeTo.toISOString(),
            staffFilter,
          )
        : Promise.resolve(null),
    ),
    // Day view has no bigger window to read the day line's numbers out of, so
    // it reads its own single JST day (selectedDate is already JST midnight).
    t.phase('range.day', () =>
      view === 'day'
        ? getAppointmentWindow(
            selectedDate.toISOString(),
            jstEndOfDay(selectedDate).toISOString(),
            staffFilter,
          )
        : Promise.resolve(null),
    ),
    // The previous month's compared span — the same action, the same store
    // clamp and the same 担当 filter as the month read above, so the two sides
    // of the comparison can never be scoped differently. In this wave, so it
    // costs no waterfall, and WITHOUT the hours read: this span is a count,
    // and the page's hours facts come from the displayed window below.
    //
    // The ONLY read on this page that is allowed to fail quietly. Every other
    // one throws, because an empty week must never be indistinguishable from
    // an unread one — but this is an optional annotation whose absent state is
    // exactly `null`, so a half-down core costs the reader one clause instead
    // of the whole 予約 screen.
    t.phase('range.prevMonth', () =>
      compareWindow
        ? getAppointmentWindow(
            compareWindow.fromIso,
            compareWindow.toIso,
            staffFilter,
            false,
          ).catch((err) => {
            console.error('[appointments] 先月同期間比 read degraded:', err)
            return null
          })
        : Promise.resolve(null),
    ),
    // 60s cached active-menu union for the booking picker. Degraded the same
    // way the facade route degrades it — a menus outage must not 500 the
    // agenda; the dialog keeps today's free-text service field. Degraded is
    // allowed, silent is not: once PR-4b ships, a dead read is
    // pixel-identical to "this shop has no menus" — the log line below is the
    // only thing separating an outage from an empty catalog.
    t.phase('menus', () =>
      getCachedMenuOptions().catch((err) => {
        console.error('[appointments] menus read degraded:', err)
        return []
      }),
    ),
  ])

  // Store-isolate the picker (⚖ Liam 2026-08-17): the cached union is
  // business-wide and actor-blind by design, so the clamp lands here, on the
  // scope resolved above. A degraded assignment lookup vouches for no store
  // → 全店舗 rows only, the same fail-closed posture as the write clamp.
  const menus = scopeMenuOptions(
    menuOptions,
    storeScope.degraded ? [] : storeScope.allowedStoreIds,
  )

  const authProfileId = user?.id ?? null
  const storeStaffIds = await t.phase('storeStaffIds', () =>
    // Empty picker for an actor who reaches no store — see the customers page.
    reachesNoStore(storeScope)
      ? Promise.resolve(new Set<string>())
      : storeStaffIdSet(staffList, storeScope.storeId),
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
    now,
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
    weekRangeAppts: null,
    monthRangeAppts: null,
    weekWindow,
    monthWindow,
    dayWindow,
    prevMonthWindow,
    // Exactly one window is read per view, and it carries that window's days.
    hoursFacts: new Map(
      (weekWindow ?? monthWindow ?? dayWindow)?.hoursFacts ?? [],
    ),
    enrichment,
    packUsage,
  })

  // A truncated window must never render as a calm, empty week/month — that is
  // indistinguishable from an honest zero. The route-group boundary
  // (error.tsx) shows the retry screen, exactly as a failed window read
  // already does above (getAppointmentWindow throws).
  // Greptile G4 — the thin door renders the inline failed line instead —
  // AppointmentsScreen.tsx:137-141 (R1-2/D5); the two doors differ on
  // purpose: the web has no inline failed surface for 日/月.
  if (screen.truncated) {
    throw new Error('appointments: window truncated — read incomplete')
  }

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
        monthCompareDelta={screen.monthCompareDelta}
        // The day line's numbers and the 未設定 discriminator — both resolved
        // in buildAppointmentsScreen so the WEB door and the PHONE door hand
        // the shared view identical props (PKT-1b-WIRE W-B/W-C).
        dayTotals={screen.dayTotals}
        soloMode={screen.soloMode}
        reservationViews={screen.reservationViews}
        reservationStaff={screen.reservationStaff}
        colorRosterIds={screen.colorRosterIds}
        businessHours={screen.businessHours}
        staffFilter={staffFilter}
        menus={menus}
        // The date-jump panel's WEB month door. The facade GET the phone uses
        // is Bearer-only (lib/app-api/identity.ts), so this cookie session
        // reads months through the action instead — same range fetch, same
        // density rule, same store clamp.
        loadMonthCells={getMonthCells}
      />
    </>
  )
}
