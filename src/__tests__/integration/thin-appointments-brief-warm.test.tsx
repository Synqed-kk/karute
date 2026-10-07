/**
 * @jest-environment jsdom
 *
 * 予約 screen wiring for the pre-session-brief warmer (perf packet 28): once
 * the DTO settles for TODAY — compared as JST calendar days, using the REAL
 * server shape for selectedDateIso (a JST-midnight instant's .toISOString(),
 * not a bare YYYY-MM-DD — a hand-typed bare string previously masked the
 * today-guard being dead code) — warmBriefsForToday fires with
 * {customerId, appointmentId} pairs for the active (non-cancelled,
 * non-no-show) reservationViews. Any other date must never call it.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
// Screen internals are pinned elsewhere — this suite pins only the brief-warm
// wiring (same isolation precedent as thin-appointments-dim.test.tsx).
// ⚖ FIX ROUND 4 (R1b) — the stand-in also hands the assign props to the REAL
// BookingActionSheetWrapper for the first staff-less row, with the same three
// lines AppointmentsView uses (canAssign ?? false, assignStaff = staff, the
// map), so the DTO → thin screen → wrapper path is pinned end to end.
const mockViewProps = jest.fn()
// The wrapper's own seams, stubbed as in unassigned-staff-sheet-grid.test.tsx
// (the ui package ships ESM; the sheet's action / router / toast never fire here).
jest.mock('@synqed-kk/ui', () => {
  const Box = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open === false ? null : <div>{children}</div>
  return {
    Sheet: Box, SheetContent: Box, SheetHeader: Box, SheetTitle: Box, SheetDescription: Box,
    Dialog: Box, DialogContent: Box, DialogTitle: Box, DialogDescription: Box,
    BookingActionSheet: () => null,
  }
})
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('@/actions/appointments', () => ({ assignAppointmentStaff: jest.fn() }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: (props: {
    canAssign?: boolean
    staff?: { id: string; name: string }[]
    assignStaffIdsByBooking?: Record<string, string[]>
    reservationViews?: { id: string; staffId: string | null }[]
  }) => {
    mockViewProps(props)
    const { BookingActionSheetWrapper } = jest.requireActual('@/components/appointments/BookingActionSheetWrapper')
    const staffless = props.reservationViews?.find((v) => !v.staffId) ?? null
    return (
      <div data-testid="appointments-view">
        VIEW
        {staffless ? (
          <BookingActionSheetWrapper
            selected={staffless}
            onClose={() => {}}
            forceMobile
            canAssign={props.canAssign ?? false}
            assignStaff={props.staff}
            assignStaffIdsByBooking={props.assignStaffIdsByBooking}
          />
        ) : null}
      </div>
    )
  },
}))
jest.mock('../../../thin/data/brief-warm', () => ({
  warmBriefsForToday: jest.fn(),
}))
// ⚖ PR-B X5 — the record warm is spied (the rest of screen-prefetch stays
// real) so the staff-less test below can pin what it is asked to warm.
jest.mock('../../../thin/data/screen-prefetch', () => ({
  ...jest.requireActual('../../../thin/data/screen-prefetch'),
  warmRecordForBookings: jest.fn(),
}))
// AppointmentsScreen → screen-prefetch.ts now statically imports
// global-recorder.ts (blind-round fix, recorder guard) — same two
// 'use server'/take-store seam stubs thin-foreground-revalidate.test.tsx
// mocks; this file never touches globalRecorder itself.
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
}))

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { warmBriefsForToday } from '../../../thin/data/brief-warm'
import { warmRecordForBookings } from '../../../thin/data/screen-prefetch'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'

const baseDto = {
  view: 'day' as const,
  staffFilter: 'all',
  staff: [],
  activeStaffId: null,
  authProfileId: null,
  customers: [],
  reservationStaff: [],
  businessHours: { start: 9, end: 20 },
  weekData: null,
  weekStartIso: null,
  monthData: null,
}

function reservation(clientId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `r-${clientId}`,
    staffId: 's1',
    staffName: 'staff',
    startTimeHm: '10:00',
    durationMin: 60,
    customerName: 'customer',
    customerInitials: 'C',
    karuteNumber: null,
    service: 'cut',
    displayStatus: 'booked',
    isCancelled: false,
    isNoShow: false,
    statusReason: null,
    statusSetByName: null,
    statusSetAt: null,
    staffColorKey: 'blue',
    clientId,
    karuteRecordId: null,
    isFirstTimeVisit: false,
    pack: null,
    needsRenewal: false,
    noShowCount: 0,
    ...overrides,
  }
}

// Real server shape (src/app/api/app/v1/screens/appointments/route.ts):
// selectedDate.toISOString() where selectedDate is JST midnight of `ymd`.
const jstMidnightIso = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`).toISOString()

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

function mountWithDto(dto: unknown, path: string) {
  history.replaceState({}, '', path)
  setDataPort({
    apiFetch: jest.fn().mockResolvedValue(jsonResponse(dto)),
  } as unknown as Parameters<typeof setDataPort>[0])
  return render(<AppointmentsScreen />)
}

beforeEach(() => {
  // Pins "now" for the screen's ymdInJst(new Date()) side of the compare.
  jest.useFakeTimers().setSystemTime(new Date('2026-07-23T12:00:00+09:00'))
  dtoCache.clear()
  jest.mocked(warmBriefsForToday).mockClear()
  jest.mocked(warmRecordForBookings).mockClear()
})

afterEach(() => {
  jest.useRealTimers()
})

it("today's settle warms exactly the active bookings, excluding cancelled/no-show", async () => {
  const dto = {
    ...baseDto,
    selectedDateIso: jstMidnightIso('2026-07-23'),
    reservationViews: [
      reservation('c1'),
      reservation('c2'),
      reservation('c3', { isCancelled: true }),
      reservation('c4', { isNoShow: true }),
    ],
  }
  mountWithDto(dto, '/appointments?date=2026-07-23')
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  expect(warmBriefsForToday).toHaveBeenCalledTimes(1)
  expect(warmBriefsForToday).toHaveBeenCalledWith([
    { customerId: 'c1', appointmentId: 'r-c1' },
    { customerId: 'c2', appointmentId: 'r-c2' },
  ])
})

it('a non-today settle never calls the warmer', async () => {
  const dto = {
    ...baseDto,
    selectedDateIso: jstMidnightIso('2026-07-24'),
    reservationViews: [reservation('c1')],
  }
  mountWithDto(dto, '/appointments?date=2026-07-24')
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  expect(warmBriefsForToday).not.toHaveBeenCalled()
})

// ⚖ PR-B X5 — a 担当未定 booking (staffId null) has no record screen to warm:
// its record lookup returns null, and a warm must never pre-fetch a
// substitute. Neither the brief warm nor the record warm is handed its id.
it('a staff-less booking is skipped by both warms; the staffed ones still warm', async () => {
  const dto = {
    ...baseDto,
    selectedDateIso: jstMidnightIso('2026-07-23'),
    reservationViews: [
      reservation('c1', { startTimeHm: '10:00' }),
      reservation('c2', { staffId: null, startTimeHm: '11:00' }),
      reservation('c3', { startTimeHm: '12:00' }),
    ],
  }
  mountWithDto(dto, '/appointments?date=2026-07-23')
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  expect(warmBriefsForToday).toHaveBeenCalledTimes(1)
  expect(warmBriefsForToday).toHaveBeenCalledWith([
    { customerId: 'c1', appointmentId: 'r-c1' },
    { customerId: 'c3', appointmentId: 'r-c3' },
  ])
  expect(warmBriefsForToday).not.toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ appointmentId: 'r-c2' })]),
  )
  expect(warmRecordForBookings).toHaveBeenCalledTimes(1)
  expect(warmRecordForBookings).toHaveBeenCalledWith(['r-c1', 'r-c3'])
  expect(warmRecordForBookings).not.toHaveBeenCalledWith(expect.arrayContaining(['r-c2']))
})

// Fix round 3 (B1-4): staff-less = a FALSY staffId, the wrapper's own rule —
// a row with staffId '' is never handed to either warm.
it("a staffId '' booking is skipped by both warms (falsy = staff-less)", async () => {
  const dto = {
    ...baseDto,
    selectedDateIso: jstMidnightIso('2026-07-23'),
    reservationViews: [
      reservation('c1', { startTimeHm: '10:00' }),
      reservation('c2', { staffId: '', startTimeHm: '11:00' }),
    ],
  }
  mountWithDto(dto, '/appointments?date=2026-07-23')
  await waitFor(() => expect(screen.getByTestId('appointments-view')).toBeTruthy())

  expect(warmBriefsForToday).toHaveBeenCalledTimes(1)
  expect(warmBriefsForToday).toHaveBeenCalledWith([{ customerId: 'c1', appointmentId: 'r-c1' }])
  expect(warmRecordForBookings).toHaveBeenCalledTimes(1)
  expect(warmRecordForBookings).toHaveBeenCalledWith(['r-c1'])
  expect(warmRecordForBookings).not.toHaveBeenCalledWith(expect.arrayContaining(['r-c2']))
})

// ⚖ FIX ROUND 4 (R1b) — the phone DTO's two assign fields reach the sheet:
// canAssign + the per-booking ids → the picker rows; an old DTO without them
// → read-only (fail closed).
// The real wrapper (the stand-in above) reads matchMedia on mount — jsdom has
// none — so every test in this file gets the same inert one.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  })
})

describe('thin screen: the assign DTO fields reach the 担当未定 picker', () => {
  const staffed = {
    ...baseDto,
    staff: [
      { id: 'p1', name: 'Mika', avatarInitials: 'M' },
      { id: 'p2', name: 'Ren', avatarInitials: 'R' },
    ],
  }
  const views = [reservation('c1', { startTimeHm: '10:00' }), reservation('c2', { staffId: null, startTimeHm: '11:00' })]

  it('canAssign true + { r-c2: [p1, p2] } → the view gets both fields and the picker rows render', async () => {
    const dto = {
      ...staffed,
      selectedDateIso: jstMidnightIso('2026-07-23'),
      reservationViews: views,
      canAssign: true,
      assignStaffIdsByBooking: { 'r-c2': ['p1', 'p2'] },
    }
    mountWithDto(dto, '/appointments?date=2026-07-23')
    await waitFor(() => expect(screen.getByText('Ren')).toBeTruthy())
    expect(mockViewProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ canAssign: true, assignStaffIdsByBooking: { 'r-c2': ['p1', 'p2'] } }),
    )
    expect(screen.getByText('Mika')).toBeTruthy()
    expect(screen.getByText('pickerTitle')).toBeTruthy()
  })

  it('an old DTO without the fields → canAssign false, {} → the read-only lines, no picker rows', async () => {
    const dto = { ...staffed, selectedDateIso: jstMidnightIso('2026-07-23'), reservationViews: views }
    mountWithDto(dto, '/appointments?date=2026-07-23')
    await waitFor(() => expect(screen.getByText('recordBlockedReadOnly')).toBeTruthy())
    expect(mockViewProps).toHaveBeenLastCalledWith(expect.objectContaining({ canAssign: false, assignStaffIdsByBooking: {} }))
    expect(screen.queryByText('Ren')).toBeNull()
  })
})
