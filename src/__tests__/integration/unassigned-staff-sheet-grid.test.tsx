/** @jest-environment jsdom */
// PR-B part 1 — the read-only 担当未定 sheet and the
// desktop grid's 担当未定 lane (present only on a day with a staff-less booking).
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, string>) =>
    `${ns}.${key}${vals ? JSON.stringify(vals) : ''}`,
}))
const refresh = jest.fn()
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))
const mockUpdate = jest.fn()
jest.mock('@/actions/appointments', () => ({ assignAppointmentStaff: (...a: unknown[]) => mockUpdate(...a) }))
const toastSuccess = jest.fn()
const toastError = jest.fn()
jest.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }))
jest.mock('@synqed-kk/ui', () => {
  const Box = ({ children, open, onOpenChange }: { children?: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) =>
    open === false ? null : (
      <div>
        {onOpenChange ? <span data-testid="sheet-close" onClick={() => onOpenChange(false)} /> : null}
        {children}
      </div>
    )
  return {
    Sheet: Box, SheetContent: Box, SheetHeader: Box, SheetTitle: Box, SheetDescription: Box,
    Dialog: Box, DialogContent: Box, DialogTitle: Box, DialogDescription: Box,
    BookingActionSheet: ({ open, onStartRecording }: { open?: boolean; onStartRecording?: () => void }) =>
      open ? (
        <div data-testid="ui-booking-sheet">
          <button type="button" onClick={onStartRecording}>record</button>
        </div>
      ) : null,
  }
})
jest.mock('@/components/reservation/AppointmentCard', () => ({
  AppointmentCard: ({ view }: { view: { id: string } }) => <div data-testid="card">{view.id}</div>,
}))
jest.mock('@/components/reservation/TimeAxis', () => ({ TimeAxis: () => null, CurrentTimeIndicator: () => null }))

import { UnassignedBookingSheet } from '@/components/appointments/UnassignedBookingSheet'
import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { BookingActionSheetWrapper } from '@/components/appointments/BookingActionSheetWrapper'

const booking = { id: 'appt-1', customerName: '佐藤', staffId: null } as unknown as ReservationView
const STAFF = [{ id: 'p1', name: 'Mika' }, { id: 'p2', name: 'Ren' }]

afterEach(() => {
  cleanup()
  jest.clearAllMocks()
})

describe('UnassignedBookingSheet', () => {
  it('bookings.manage → the picker: title, lead, one row per store staff; no record row', () => {
    render(<UnassignedBookingSheet booking={booking} canAssign staff={STAFF} isMobile onClose={jest.fn()} />)
    expect(screen.getByText('unassignedStaff.pickerTitle')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.pickerLead')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.sheetSubtitle')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Mika', 'Ren'])
    expect(screen.queryByText('unassignedStaff.recordBlockedReadOnly')).toBeNull()
  })

  it('the read-only sheet → the two read-only lines and nothing else', () => {
    render(<UnassignedBookingSheet booking={booking} canAssign={false} staff={STAFF} isMobile={false} onClose={jest.fn()} />)
    expect(screen.getByText('unassignedStaff.sheetSubtitleReadOnly')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.recordBlockedReadOnly')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText('Mika')).toBeNull()
  })

  it('a tap commits: assignAppointmentStaff(id, staffProfileId), the assigned toast with the name, close + refresh', async () => {
    mockUpdate.mockResolvedValue({ success: true })
    const onClose = jest.fn()
    render(<UnassignedBookingSheet booking={booking} canAssign staff={STAFF} isMobile onClose={onClose} />)
    fireEvent.click(screen.getByText('Ren'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith('appt-1', 'p2')
    expect(toastSuccess).toHaveBeenCalledWith('unassignedStaff.assigned{"staff":"Ren"}')
    expect(refresh).toHaveBeenCalled()
  })

  it('a refusal → common.somethingWentWrong, the sheet stays open', async () => {
    mockUpdate.mockResolvedValue({ error: 'This staff member cannot take this booking.' })
    const onClose = jest.fn()
    render(<UnassignedBookingSheet booking={booking} canAssign staff={STAFF} isMobile onClose={onClose} />)
    fireEvent.click(screen.getByText('Mika'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('common.somethingWentWrong'))
    expect(onClose).not.toHaveBeenCalled()
  })

  // ⚖ FIX ROUND 3 item 10 (B2-2) — someone else assigned it first.
  it('an already-staffed answer → no error toast, no success toast, the sheet closes and refreshes', async () => {
    const { BOOKING_ALREADY_STAFFED } = jest.requireActual('@/lib/appointments/assign-refusal')
    mockUpdate.mockResolvedValue({ error: BOOKING_ALREADY_STAFFED })
    const onClose = jest.fn()
    render(<UnassignedBookingSheet booking={booking} canAssign staff={STAFF} isMobile onClose={onClose} />)
    fireEvent.click(screen.getByText('Mika'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(refresh).toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('ReservationGrid 担当未定 lane', () => {
  const lanes = [{ id: 'p1', name: 'Mika', role: '', takesBookings: true, initials: 'MI' }]
  const hours = { start: 9, end: 20 } as never
  // startTimeHm + durationMin: the 担当未定 lane packs by each booking's own span.
  const view = (id: string, staffId: string | null) =>
    ({ id, staffId, startTimeHm: '10:00', durationMin: 60 }) as unknown as ReservationView

  it('absent on a day where every booking has a staff', () => {
    render(<ReservationGrid staff={lanes} reservations={[view('a', 'p1')]} businessHours={hours} />)
    expect(screen.queryByText('unassignedStaff.mark')).toBeNull()
  })

  it('one extra lane, LAST, holding exactly the staff-less bookings', () => {
    const { container } = render(
      <ReservationGrid staff={lanes} reservations={[view('a', 'p1'), view('b', null), view('c', null)]} businessHours={hours} />,
    )
    expect(screen.getAllByText('unassignedStaff.mark')).toHaveLength(1)
    const names = Array.from(container.querySelectorAll('.truncate.text-sm.font-medium')).map((n) => n.textContent)
    expect(names).toEqual(['Mika', 'unassignedStaff.mark'])
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['a', 'b', 'c'])
  })
})

describe('UnassignedBookingSheet — fix round 1', () => {
  it('a REJECTED request re-enables the rows, toasts, and the sheet still closes', async () => {
    mockUpdate.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const onClose = jest.fn()
    render(<UnassignedBookingSheet booking={booking} canAssign staff={STAFF} isMobile onClose={onClose} />)
    fireEvent.click(screen.getByText('Ren'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('common.somethingWentWrong'))
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('sheet-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an empty picker (nobody at the booking\'s store) → the read-only lines, no rows, no crash', () => {
    render(<UnassignedBookingSheet booking={booking} canAssign staff={[]} isMobile onClose={jest.fn()} />)
    expect(screen.getByText('unassignedStaff.sheetSubtitleReadOnly')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('BookingActionSheetWrapper — a staff-less booking never reaches a record row', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  })

  it('staffId null → the 担当未定 sheet opens; the ui sheet stays closed; no record row', () => {
    render(<BookingActionSheetWrapper selected={booking} onClose={jest.fn()} forceMobile />)
    expect(screen.getByText('佐藤reservation.card.customerSuffix')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.sheetSubtitleReadOnly')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.recordBlockedReadOnly')).toBeTruthy()
    expect(screen.queryByTestId('ui-booking-sheet')).toBeNull()
    expect(screen.queryByText('record')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  // ⚖ PR-B (h) — the wrapper decides on a FALSY staffId, so a staffId that
  // arrives undefined or '' (a future producer, a wire quirk) still lands on
  // the read-only sheet and can never reach the ui sheet's 録音開始.
  it.each([
    ['undefined', undefined],
    ["''", ''],
  ])('staffId %s → the read-only 担当未定 sheet; no ui sheet, no record row', (_label, staffId) => {
    const odd = { id: 'appt-9', customerName: '佐藤', staffId } as unknown as ReservationView
    render(<BookingActionSheetWrapper selected={odd} onClose={jest.fn()} forceMobile />)
    expect(screen.getByText('unassignedStaff.sheetSubtitleReadOnly')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.recordBlockedReadOnly')).toBeTruthy()
    expect(screen.queryByTestId('ui-booking-sheet')).toBeNull()
    expect(screen.queryByText('record')).toBeNull()
  })

  it('a staffed booking → the ui sheet as before (record row); the 担当未定 sheet stays closed', () => {
    const staffed = { id: 'appt-2', customerName: '鈴木', staffId: 'p1', isFirstTimeVisit: false } as unknown as ReservationView
    render(<BookingActionSheetWrapper selected={staffed} onClose={jest.fn()} forceMobile />)
    expect(screen.getByTestId('ui-booking-sheet')).toBeTruthy()
    expect(screen.getByText('record')).toBeTruthy()
    expect(screen.queryByText('unassignedStaff.sheetSubtitleReadOnly')).toBeNull()
  })
})
