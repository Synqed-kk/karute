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
import { warmBriefsForToday } from '../data/brief-warm'
import { useSearchParams } from '../ports/nav.vite'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): AppointmentsScreenDTOType =>
  AppointmentsScreenDTO.parse(raw)

// Device-local date, not toISOString (UTC would mislabel late-night JST as
// the previous day) — same construction as global-pipeline.ts's sessionDate.
function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function AppointmentsScreenInner({ dto }: { dto: AppointmentsScreenDTOType }) {
  // Perf packet 28: warm the pre-session-brief cache for today's active
  // bookings while staff are still on 予約, so 録音's brief is already cached
  // by the time they open it. Only today (Liam: dashboard is cold-start-only,
  // so 予約 is the trigger that covers the real flow) and only once per
  // settle — repeat settles hit brief-warm's own dedupe for free.
  useEffect(() => {
    if (dto.selectedDateIso !== todayIso()) return
    const ids = [
      ...new Set(
        dto.reservationViews
          .filter((r) => !r.isCancelled && !r.isNoShow)
          .map((r) => r.clientId),
      ),
    ]
    warmBriefsForToday(ids)
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
      locale="ja"
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
  qs.set('locale', 'ja')
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
