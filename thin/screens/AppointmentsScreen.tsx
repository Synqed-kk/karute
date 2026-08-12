// 予約 screen in the thin bundle (design-parity P-B) — retires its 準備中
// placeholder. Fetches the screen-shaped DTO through the DataPort (the URL's
// date/view/staff params pass through, so date-nav and the staff filter work
// exactly as on web: the view mutates the URL, the changed path refetches)
// and renders the REAL AppointmentsView.
//
// Booking mutations (create / cancel / no-show / restore) route through the
// actions port; they are wired to facade endpoints in the P-B mutations PR.

import { useEffect, useMemo } from 'react'
import type { MonthGridCell } from '@synqed-kk/ui'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import {
  AppointmentsScreenDTO,
  type AppointmentsScreenDTOType,
} from '@/lib/app-api/appointments-screen-dto'
import { ymdInJst } from '@/lib/date/jst'
import { warmBriefsForToday } from '../data/brief-warm'
import { warmRecordForBookings } from '../data/screen-prefetch'
import { getThinLocale } from '../locale'
import { useSearchParams } from '../ports/nav.vite'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): AppointmentsScreenDTOType =>
  AppointmentsScreenDTO.parse(raw)

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

  // MonthGridCell wants a real Date; the DTO ships dateIso (JSON-safe).
  const monthData = useMemo<MonthGridCell[] | null>(
    () =>
      dto.monthData?.map((c) => ({
        id: c.id,
        date: new Date(c.dateIso),
        inMonth: c.inMonth,
        isToday: c.isToday,
        count: c.count,
        density: c.density,
      })) ?? null,
    [dto.monthData],
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
      monthData={monthData}
      monthStartIso={null}
      // Server-derived, DTO-validated color keys; the view's strict union is
      // a superset of the string the schema accepts (record-screen precedent).
      reservationViews={dto.reservationViews as ReservationView[]}
      reservationStaff={dto.reservationStaff}
      businessHours={dto.businessHours}
      staffFilter={dto.staffFilter}
    />
  )
}

export function AppointmentsScreen() {
  // Pass the URL's view state through to the screen GET — the URL stays the
  // single source of truth (web parity: the server reads the same params).
  const search = useSearchParams()
  const qs = new URLSearchParams()
  for (const key of ['date', 'view', 'staff'] as const) {
    const v = search.get(key)
    if (v) qs.set(key, v)
  }
  qs.set('locale', getThinLocale())
  const path = `/api/app/v1/screens/appointments?${qs.toString()}`
  const { state, retry, fetching } = useScreenDto(path, parse)
  // Dim ONLY a cross-path fetch — date/view/filter nav where the rendered
  // dto is still the OLD day and misreading it as the new one is the real
  // hazard. A SAME-path background revalidate (the packet-24 cache's
  // revisit refresh, or a post-mutation refresh) must keep the screen fully
  // interactive: dimming it froze every 予約 revisit for the whole network
  // round trip (Liam field report 7/23).
  const crossPathPending = fetching && state.status === 'ready' && state.path !== path
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        // Web-parity pending treatment for in-place date/view/filter nav: the
        // page dims + blocks input during its server roundtrip (isPending);
        // in the shell pushState commits synchronously so that transition
        // never shows — this dim covers the cross-path DTO refetch instead,
        // and the pointer-events block stops a second 翌日 tap from
        // re-pushing the same stale-derived date mid-fetch.
        <div
          className={`transition-opacity duration-150 ${
            crossPathPending ? 'pointer-events-none opacity-50' : ''
          }`}
          aria-busy={crossPathPending}
        >
          <AppointmentsScreenInner dto={dto} />
        </div>
      )}
    </ScreenStates>
  )
}
