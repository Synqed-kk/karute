/**
 * @jest-environment jsdom
 *
 * Burn-on-cancel (Liam 2026-07-10) — sheet render contract:
 *   1. The burn checkbox exists ONLY while 当日連絡あり is selected AND the
 *      customer holds a burnable pack.
 *   2. Switching to any other chip (or deselecting) REMOVES the checkbox —
 *      a hidden checked state can never ride along on a non-same-day cancel
 *      (the server enforces the same pairing; this pins the UI half).
 *   3. No pack → no checkbox even with 当日連絡あり selected.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}))

const getBurnablePackSummary = jest.fn(
  async (): Promise<{ packId: string; remaining: number } | null> => ({
    packId: 'pack-1',
    remaining: 7,
  }),
)
jest.mock('@/actions/appointments', () => ({
  cancelAppointment: jest.fn(async () => ({ success: true })),
  markNoShowAppointment: jest.fn(async () => ({ success: true })),
  restoreAppointment: jest.fn(async () => ({ success: true })),
  getBurnablePackSummary: () => getBurnablePackSummary(),
}))

import { CancelBookingSheet } from '@/components/appointments/CancelBookingSheet'
import type { ReservationView } from '@/lib/adapters/reservation-view'

const booking = (): ReservationView => ({
  id: 'appt-1',
  staffId: 'staff-1',
  staffName: '原田 かなみ',
  startTimeHm: '15:00',
  durationMin: 60,
  customerName: '今井 ももこ',
  customerInitials: '今',
  karuteNumber: '#00090',
  service: '',
  displayStatus: 'booked',
  isCancelled: false,
  isNoShow: false,
  statusReason: null,
  statusSetByName: null,
  statusSetAt: null,
  staffColorKey: 'neutral',
  clientId: 'cust-1',
  karuteRecordId: null,
  isFirstTimeVisit: false,
  pack: null,
  needsRenewal: false,
  noShowCount: 0,
})

const sameDayChip = () => screen.getByText('cancelReasons.cancel-same-day-contact')
const burnBox = () => screen.queryByText('burnPack:{"n":7}')

describe('cancel sheet — burn on same-day-contact', () => {
  beforeEach(() => jest.clearAllMocks())

  it('checkbox appears only after selecting 当日連絡あり (pack exists)', async () => {
    render(<CancelBookingSheet booking={booking()} mode="confirm" onClose={() => {}} />)
    expect(burnBox()).toBeNull()
    fireEvent.click(sameDayChip())
    await waitFor(() => expect(burnBox()).toBeTruthy())
    expect(getBurnablePackSummary).toHaveBeenCalledTimes(1)
  })

  it('switching to another chip removes the checkbox (and its state)', async () => {
    render(<CancelBookingSheet booking={booking()} mode="confirm" onClose={() => {}} />)
    fireEvent.click(sameDayChip())
    await waitFor(() => expect(burnBox()).toBeTruthy())
    fireEvent.click(screen.getByText('cancelReasons.cancel-advance-contact'))
    expect(burnBox()).toBeNull()
  })

  it('deselecting 当日連絡あり (tap again) removes the checkbox', async () => {
    render(<CancelBookingSheet booking={booking()} mode="confirm" onClose={() => {}} />)
    fireEvent.click(sameDayChip())
    await waitFor(() => expect(burnBox()).toBeTruthy())
    fireEvent.click(sameDayChip())
    expect(burnBox()).toBeNull()
  })

  it('no burnable pack → no checkbox even with 当日連絡あり selected', async () => {
    getBurnablePackSummary.mockResolvedValueOnce(null)
    render(<CancelBookingSheet booking={booking()} mode="confirm" onClose={() => {}} />)
    fireEvent.click(sameDayChip())
    // Give the (null) fetch a tick to settle, then assert absence.
    await waitFor(() => expect(getBurnablePackSummary).toHaveBeenCalled())
    expect(burnBox()).toBeNull()
  })
})
