// 予約 screen in the thin bundle (design-parity P-B) — retires its 準備中
// placeholder. Fetches the screen-shaped DTO through the DataPort (the URL's
// date/view/staff params pass through, so date-nav and the staff filter work
// exactly as on web: the view mutates the URL, the changed path refetches)
// and renders the REAL AppointmentsView.
//
// Booking mutations (create / cancel / no-show / restore) route through the
// actions port; they are wired to facade endpoints in the P-B mutations PR.

import { useMemo } from 'react'
import type { MonthGridCell } from '@synqed-kk/ui'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import {
  AppointmentsScreenDTO,
  type AppointmentsScreenDTOType,
} from '@/lib/app-api/appointments-screen-dto'
import { useSearchParams } from '../ports/nav.vite'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): AppointmentsScreenDTOType =>
  AppointmentsScreenDTO.parse(raw)

function AppointmentsScreenInner({ dto }: { dto: AppointmentsScreenDTOType }) {
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
  const { state, retry } = useScreenDto(
    `/api/app/v1/screens/appointments?${qs.toString()}`,
    parse,
  )
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => <AppointmentsScreenInner dto={dto} />}
    </ScreenStates>
  )
}
