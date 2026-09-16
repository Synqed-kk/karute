// 予約 screen in the thin bundle (design-parity P-B) — retires its 準備中
// placeholder. Fetches the screen-shaped DTO through the DataPort (the URL's
// date/view/staff params pass through, so date-nav and the staff filter work
// exactly as on web: the view mutates the URL, the changed path refetches)
// and renders the REAL AppointmentsView.
//
// Booking mutations (create / cancel / no-show / restore) route through the
// actions port; they are wired to facade endpoints in the P-B mutations PR.

import { useCallback, useEffect, useMemo } from 'react'
import type { MonthCell } from '@/lib/adapters/reservation'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import {
  AppointmentsScreenDTO,
  type AppointmentsScreenDTOType,
} from '@/lib/app-api/appointments-screen-dto'
import { jstStartOfToday, ymdInJst } from '@/lib/date/jst'
import { getDataPort } from '@/lib/ports/data-port'
import { warmBriefsForToday } from '../data/brief-warm'
import { warmRecordForBookings } from '../data/screen-prefetch'
import {
  appointmentsScreenPath,
  cancelNeighbourWarm,
  warmAppointmentNeighbours,
} from '../data/screen-neighbours'
import { readMonthNumbers, rememberMonthNumbers } from '../data/calendar-numbers-store'
import { monthKeyInJst } from '@/lib/appointments/date-jump'
import { getThinLocale } from '../locale'
import { useSearchParams } from '../ports/nav.vite'
import { cacheDto, dtoCache, fetchedAtByPath, STALE_MS, ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): AppointmentsScreenDTOType =>
  AppointmentsScreenDTO.parse(raw)

/** The wire's month cells → what the grid renders. ONE mapping, because the
 *  page's own month and the pop-down's seed must never disagree about a cell.
 *  ⚖ PKT-2b — every field straight off the wire: monthCellsToDTO (route.ts)
 *  already merges the real numbers in, and this mapping was once the one place
 *  still throwing them away. */
function toMonthCells(cells: NonNullable<AppointmentsScreenDTOType['monthData']>): MonthCell[] {
  return cells.map((c) => ({
    id: c.id,
    date: new Date(c.dateIso),
    inMonth: c.inMonth,
    isToday: c.isToday,
    count: c.count,
    density: c.density,
    closed: c.closed,
    newCount: c.newCount,
    newCountKnown: c.newCountKnown,
  }))
}

function AppointmentsScreenInner({ dto }: { dto: AppointmentsScreenDTOType }) {
  // Perf packet 28: warm the pre-session-brief cache for today's active
  // bookings while staff are still on 予約, so 録音's brief is already cached
  // by the time they open it. Only today — compared as JST CALENDAR days
  // (selectedDateIso is a JST-midnight instant, e.g.
  // "2026-07-23T15:00:00.000Z" for 7/24 JST; a bare string compare never
  // matches) — and only once per settle: repeat settles hit brief-warm's own
  // dedupe for free.
  useEffect(() => {
    if (ymdInJst(new Date(dto.selectedDateIso)) !== ymdInJst(new Date())) return
    const bookings = dto.reservationViews
      .filter((r) => !r.isCancelled && !r.isNoShow)
      .map((r) => ({ customerId: r.clientId, appointmentId: r.id }))
    warmBriefsForToday(bookings)

    // Perf packet 35 (PR-H2): warm the 録音 screen's DTO for the next ~2
    // upcoming bookings too, same today-only guard. Booking-tap → 録音 is the
    // single most common cross-screen jump this app has, and the in-session
    // booking is precisely the one staff tap 録音 on next — time-passed
    // bookings are already excluded server-side via computeDisplayStatus, so
    // excluding only 'completed' here keeps in_session/booked/new. Do NOT
    // rely on server order of reservationViews (unverified) — this sort is
    // load-bearing. startTimeHm is zero-padded 24h "HH:mm" (en-GB 2-digit,
    // JST), so a plain lexicographic sort is a correct time sort.
    // Already-recorded bookings (karuteRecordId set) don't get a slot
    // (Greptile #605 P1): their sheet still OFFERS 録音/新規カルテ, but the
    // near-certain tap is カルテを見る → /karute/<id>, a route this warm never
    // covers — with only RECORD_WARM_CAP slots, an unrecorded booking is
    // always the better bet. A mid-take in-session booking stays eligible:
    // its karute record doesn't exist until processing completes.
    const upcoming = dto.reservationViews
      .filter(
        (r) =>
          !r.isCancelled &&
          !r.isNoShow &&
          r.displayStatus !== 'completed' &&
          r.karuteRecordId === null,
      )
      .sort((a, b) => a.startTimeHm.localeCompare(b.startTimeHm))
      .map((r) => r.id)
    warmRecordForBookings(upcoming)
  }, [dto])

  // ⚖ THE NEIGHBOURS (Liam 9/16: 「everything kind of just loads in a little
  // late and slow」). Once THIS view has landed — never before, the screen on
  // screen owns the network until it has painted — queue the reads the finger
  // can reach next: one unit either way, the segment's other two doors, and
  // the pop-down's month. Declared AFTER the brief warms above so it is
  // scheduled behind them, and the first fetch waits a frame on top of that.
  useEffect(() => {
    warmAppointmentNeighbours({
      view: dto.view,
      selectedDate: new Date(dto.selectedDateIso),
      today: jstStartOfToday(),
      // The same rule `navigateTo` writes the URL with: 'all' is the default
      // and is left OUT, so the warmed key is the key the page will read.
      staff: dto.staffFilter !== 'all' ? dto.staffFilter : null,
      locale: getThinLocale(),
    })
    return cancelNeighbourWarm
  }, [dto])

  // MonthCell wants a real Date; the DTO ships dateIso (JSON-safe).
  const monthData = useMemo<MonthCell[] | null>(
    () => (dto.monthData ? toMonthCells(dto.monthData) : null),
    [dto.monthData],
  )
  /** THE POP-DOWN'S FIRST PAINT. The panel opens on the month the page is on;
   *  these are that month's cells if this session has already read them, or the
   *  ones the device kept from the last launch (numbers only — see
   *  calendar-numbers-store.ts). The panel marks every seed STALE on open and
   *  re-reads through `loadMonthCells` regardless (the 52ecd1c2a rule), so this
   *  changes WHEN the counts appear, never whether they are checked.
   *  Null in 月 mode: the page's own cells are the seed there, and they are
   *  fresher than either of these. */
  //
  // ⚠ NOT memoized on the DTO. The cache fills from the neighbour warm AFTER
  // this screen has rendered, and neither `dto.monthData` nor
  // `dto.selectedDateIso` changes when it does — a memo keyed on them held the
  // null it was born with, and the panel opened empty and filled in a frame
  // later (measured: filled at 82 ms instead of on the first painted frame).
  // The cost of not memoizing is one Map lookup, and ~42 small objects only
  // when there IS a month to hand over.
  const popdownMonth: MonthCell[] | null = (() => {
    if (dto.monthData) return null
    const path = appointmentsScreenPath({
      date: `${monthKeyInJst(new Date(dto.selectedDateIso))}-01`,
      view: 'month',
      staff: null,
      locale: getThinLocale(),
    })
    const cached = (dtoCache.get(path) as AppointmentsScreenDTOType | undefined)?.monthData
    const cells = cached ?? readMonthNumbers(path)
    return cells ? toMonthCells(cells) : null
  })()

  // The date-jump panel's PHONE month door. The shell has no server actions,
  // so months come from the screen GET with view=month and any day of the
  // month wanted — the same route this screen already reads, so no new
  // endpoint and no new audit action. NO staff param: the 月 counts are
  // store-wide (the filter touches reservationViews only, see
  // lib/appointments/screen.ts), and sending one would quietly shrink them.
  // getDataPort(), not the context accessor: this is the same singleton
  // ScreenBoundary's own DTO fetch reads (ScreenBoundary.tsx:216), so the
  // month door and the screen it belongs to can never resolve to two
  // different ports.
  const loadMonthCells = useCallback(
    async (monthKey: string) => {
      // ONE spelling of this URL (screen-neighbours.ts) — the path IS the
      // cache key, so a month warmed for the pop-down and a month read by the
      // 月 page have to agree on it or neither ever finds the other's answer.
      const path = appointmentsScreenPath({
        date: `${monthKey}-01`,
        view: 'month',
        // NO staff param: the 月 counts are store-wide (screen.ts filters only
        // reservationViews), and sending one would quietly shrink them.
        staff: null,
        locale: getThinLocale(),
      })
      // A month this session already read, recently enough that the boundary's
      // own foreground rule would not re-ask for it either — hand it straight
      // over, so the panel OPENS FILLED instead of filling in afterwards.
      // Nothing about the 52ecd1c2a rule changes: every open still re-validates
      // through this door, and an answer older than the app's own freshness
      // window goes back to the network exactly as before.
      const cached = dtoCache.get(path) as AppointmentsScreenDTOType | undefined
      if (cached?.monthData && Date.now() - (fetchedAtByPath.get(path) ?? 0) < STALE_MS) {
        return cached.monthData
      }
      const res = await getDataPort().apiFetch(path)
      if (!res.ok) throw new Error(`date-jump month read failed: ${res.status}`)
      const monthDto = AppointmentsScreenDTO.parse(await res.json())
      // Never silently empty: no monthData means the read did not answer the
      // question, which the panel must show as failed, not as a free month.
      if (!monthDto.monthData) throw new Error('date-jump month read returned no monthData')
      // …and the answer is worth keeping: a 月 page opened right after is then
      // a cache hit, the next open of the panel is instant, and the NEXT LAUNCH
      // opens the panel filled instead of empty.
      cacheDto(path, monthDto)
      rememberMonthNumbers(path, monthDto.monthData)
      return monthDto.monthData
    },
    [],
  )

  return (
    <AppointmentsView
      staff={dto.staff}
      activeStaffId={dto.activeStaffId}
      authProfileId={dto.authProfileId}
      customers={dto.customers}
      locale={getThinLocale()}
      // Unread by the view (businessHours/ticket gating are server-derived
      // into the DTO) — deliberately not carried over the facade.
      orgSettings={null}
      initialView={dto.view}
      selectedDateIso={dto.selectedDateIso}
      weekData={dto.weekData}
      weekStartIso={dto.weekStartIso}
      // On 日/週 the page has no month of its own, so the pop-down's seed rides
      // this prop (the view uses it for nothing else outside 月 mode).
      monthData={monthData ?? popdownMonth}
      // Straight off the wire, like every other field on this door. It was
      // hardcoded null here while screen.ts set it and the route serialised it
      // — the phone was the one door that threw the answer away.
      monthStartIso={dto.monthStartIso}
      // 先月同期間比, straight off the wire like every other field on this door.
      // Schema-defaulted, so a server that predates it degrades to null — the
      // clause is simply absent, never a 0.
      monthCompareDelta={dto.monthCompareDelta}
      // The day line's numbers and the 未設定 discriminator, straight off the
      // wire — the same two props the web page hands this same view
      // (PKT-1b-WIRE W-B/W-C). Both carry a schema default, so a server that
      // predates them degrades to null / false rather than undefined.
      dayTotals={dto.dayTotals}
      soloMode={dto.soloMode}
      // R1-2 (D5): a window the server could not read to exhaustion. THIS door
      // is the only one that can carry it — the web page throws before it
      // renders — and until now a truncated 週 reached the phone as a calm,
      // empty 「データがありません」 page instead of the failed line.
      truncated={dto.truncated}
      // Server-derived, DTO-validated color keys; the view's strict union is
      // a superset of the string the schema accepts (record-screen precedent).
      reservationViews={dto.reservationViews as ReservationView[]}
      reservationStaff={dto.reservationStaff}
      colorRosterIds={dto.colorRosterIds}
      businessHours={dto.businessHours}
      staffFilter={dto.staffFilter}
      menus={dto.menus}
      loadMonthCells={loadMonthCells}
    />
  )
}

export function AppointmentsScreen() {
  // Pass the URL's view state through to the screen GET — the URL stays the
  // single source of truth (web parity: the server reads the same params).
  const search = useSearchParams()
  const path = appointmentsScreenPath({
    date: search.get('date'),
    view: search.get('view'),
    staff: search.get('staff'),
    locale: getThinLocale(),
  })
  const { state, retry, fetching } = useScreenDto(path, parse)
  // A 月 read this screen made itself is worth keeping for the next launch, on
  // exactly the same terms as one the pop-down's own door made: numbers only.
  useEffect(() => {
    if (state.status === 'ready' && state.path === path) {
      rememberMonthNumbers(path, state.dto.monthData ?? null)
    }
  }, [state, path])
  // Dim ONLY a cross-path fetch — date/view/filter nav where the rendered
  // dto is still the OLD day and misreading it as the new one is the real
  // hazard. A SAME-path background revalidate (the packet-24 cache's
  // revisit refresh, or a post-mutation refresh) must keep the screen fully
  // interactive: dimming it froze every 予約 revisit for the whole network
  // round trip (Liam field report 7/23).
  const crossPathPending = fetching && state.status === 'ready' && state.path !== path
  // G3 (Greptile round 1, FIX-932-G1) — a month-cell tap changes `?date=` but
  // never `?view=`, so it IS a cross-path fetch by this reckoning too: without
  // this the wrapper below washed out the whole 月 page and blocked a second
  // cell tap for the round trip — exactly what PIECE 4b already removed on
  // the web (R1-6). The month page's own machinery (the card's shims,
  // latest-finger-wins) is the pending treatment there; 日/週 still leave on
  // a tap, so they keep the dim + block.
  // G5 (Greptile round 2, FIX-932-G5) — the exemption above read only the
  // URL's `view`, so a 日/週 → 月 switch (URL already `view=month`, dto still
  // the old day/week screen mid cross-path fetch) skipped the dim: the OLD
  // day/week controls stayed live and undimmed, and a tap on them pushed a
  // day/week URL that superseded the month move the user just asked for. The
  // exemption is for a month-to-month move (a cell tap, the arrows, the
  // pop-down inside 月) — a move INTO 月 from 日/週 must keep the dim, because
  // the controls on screen are still the old view's. Needs the DISPLAYED
  // dto's own view (`AppointmentsScreenDTO.view`), so the check moves inside
  // the render callback where `dto` is in scope.
  const view = search.get('view') ?? 'day'
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => {
        const dim = crossPathPending && !(view === 'month' && dto.view === 'month')
        return (
          // Web-parity pending treatment for in-place date/view/filter nav:
          // the page dims + blocks input during its server roundtrip
          // (isPending); in the shell pushState commits synchronously so that
          // transition never shows — this dim covers the cross-path DTO
          // refetch instead, and the pointer-events block stops a second 翌日
          // tap from re-pushing the same stale-derived date mid-fetch.
          <div
            className={`transition-opacity duration-150 ${
              dim ? 'pointer-events-none opacity-50' : ''
            }`}
            aria-busy={crossPathPending}
          >
            <AppointmentsScreenInner dto={dto} />
          </div>
        )
      }}
    </ScreenStates>
  )
}
