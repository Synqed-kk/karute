/** @jest-environment jsdom */
// PR-B part 2 — the 担当未定 sheet (picker vs read-only by capability) and the
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
jest.mock('@/actions/appointments', () => ({ updateAppointment: (...a: unknown[]) => mockUpdate(...a) }))
const toastSuccess = jest.fn()
const toastError = jest.fn()
jest.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }))
jest.mock('@synqed-kk/ui', () => {
  const Box = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open === false ? null : <div>{children}</div>
  return {
    Sheet: Box, SheetContent: Box, SheetHeader: Box, SheetTitle: Box, SheetDescription: Box,
    Dialog: Box, DialogContent: Box, DialogTitle: Box, DialogDescription: Box,
  }
})
jest.mock('@/components/reservation/AppointmentCard', () => ({
  AppointmentCard: ({ view }: { view: { id: string } }) => <div data-testid="card">{view.id}</div>,
}))
jest.mock('@/components/reservation/TimeAxis', () => ({ TimeAxis: () => null, CurrentTimeIndicator: () => null }))

import { UnassignedBookingSheet } from '@/components/appointments/UnassignedBookingSheet'
import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import type { ReservationView } from '@/lib/adapters/reservation-view'

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

  it('without bookings.manage → the two read-only lines and nothing else', () => {
    render(<UnassignedBookingSheet booking={booking} canAssign={false} staff={STAFF} isMobile={false} onClose={jest.fn()} />)
    expect(screen.getByText('unassignedStaff.sheetSubtitleReadOnly')).toBeTruthy()
    expect(screen.getByText('unassignedStaff.recordBlockedReadOnly')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText('Mika')).toBeNull()
  })

  it('a tap commits: updateAppointment(id, { staffProfileId }), the assigned toast with the name, close + refresh', async () => {
    mockUpdate.mockResolvedValue({ success: true })
    const onClose = jest.fn()
    render(<UnassignedBookingSheet booking={booking} canAssign staff={STAFF} isMobile onClose={onClose} />)
    fireEvent.click(screen.getByText('Ren'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith('appt-1', { staffProfileId: 'p2' })
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
