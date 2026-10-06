/** @jest-environment jsdom */
// PR-B part 2 — the 担当未定 sheet (picker vs read-only by capability) and the
// desktop grid's 担当未定 lane (present only on a day with a staff-less booking).
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, string>) =>
    `${ns}.${key}${vals ? JSON.stringify(vals) : ''}`,
}))
const refresh = jest.fn()
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))
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

afterEach(() => {
  cleanup()
  jest.clearAllMocks()
})

describe('UnassignedBookingSheet', () => {
  it('without bookings.manage → the two read-only lines and nothing else', () => {
    render(<UnassignedBookingSheet booking={booking} isMobile={false} onClose={jest.fn()} />)
    expect(screen.getByText('unassignedStaff.sheetSubtitleReadOnly')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.recordBlockedReadOnly')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('ReservationGrid 担当未定 lane', () => {
  const lanes = [{ id: 'p1', name: 'Mika', role: '', takesBookings: true, initials: 'MI' }]
  const hours = { start: 9, end: 20 } as never
  const view = (id: string, staffId: string | null) => ({ id, staffId }) as unknown as ReservationView

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

  it('a staffed booking → the ui sheet as before (record row); the 担当未定 sheet stays closed', () => {
    const staffed = { id: 'appt-2', customerName: '鈴木', staffId: 'p1', isFirstTimeVisit: false } as unknown as ReservationView
    render(<BookingActionSheetWrapper selected={staffed} onClose={jest.fn()} forceMobile />)
    expect(screen.getByTestId('ui-booking-sheet')).toBeTruthy()
    expect(screen.getByText('record')).toBeTruthy()
    expect(screen.queryByText('unassignedStaff.sheetSubtitleReadOnly')).toBeNull()
  })
})
