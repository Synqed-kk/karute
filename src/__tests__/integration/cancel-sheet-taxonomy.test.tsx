/**
 * @jest-environment jsdom
 *
 * CancelBookingSheet — the 2026-07-10 taxonomy fix's render contract:
 *   1. Cancel side: the three OPTIONAL reason chips render (advance /
 *      same-day / salon-initiated), none preselected.
 *   2. No-show side: NO chips; the first-time/repeat line is DERIVED from
 *      booking.noShowCount (0 → neutral first-time note, n≥1 → prior-count
 *      warning). The old 初回 chip must be gone.
 *   3. Cancelled mode: the stored reason renders for BOTH terminal kinds,
 *      including legacy no-show chip codes on pre-fix rows.
 * next-intl mocked key-echo style (matches the suite's convention).
 */
import { fireEvent, render, screen } from '@testing-library/react'

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
jest.mock('@/actions/appointments', () => ({
  cancelAppointment: jest.fn(async () => ({ success: true })),
  markNoShowAppointment: jest.fn(async () => ({ success: true })),
  restoreAppointment: jest.fn(async () => ({ success: true })),
  getBurnablePackSummary: jest.fn(async () => null),
}))

import { CancelBookingSheet } from '@/components/appointments/CancelBookingSheet'
import type { ReservationView } from '@/lib/adapters/reservation-view'

const booking = (over: Partial<ReservationView> = {}): ReservationView => ({
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
  ...over,
})

const openNoShowSection = () => {
  fireEvent.click(screen.getByText('noShowSectionLabel'))
}

describe('cancel sheet — taxonomy fix', () => {
  it('cancel side renders the three optional reason chips, none preselected', () => {
    render(<CancelBookingSheet booking={booking()} mode="confirm" onClose={() => {}} />)
    expect(screen.getByText('reasonOptional')).toBeTruthy()
    for (const code of [
      'cancelReasons.cancel-advance-contact',
      'cancelReasons.cancel-same-day-contact',
      'cancelReasons.cancel-salon-initiated',
    ]) {
      expect(screen.getByText(code)).toBeTruthy()
    }
  })

  it('no-show section has NO reason chips and shows the neutral first-time note at count 0', () => {
    render(<CancelBookingSheet booking={booking({ noShowCount: 0 })} mode="confirm" onClose={() => {}} />)
    openNoShowSection()
    expect(screen.getByText('noShowFirstTime')).toBeTruthy()
    expect(screen.queryByText(/noShowPriorCount/)).toBeNull()
    // The legacy chips must not exist anywhere in the confirm sheet.
    expect(screen.queryByText('noShowReasons.same-day-contacted')).toBeNull()
    expect(screen.queryByText('noShowReasons.first-time-no-show')).toBeNull()
    expect(screen.queryByText('noShowReasons.no-show-no-contact')).toBeNull()
  })

  it('no-show section warns with the derived prior count at count ≥ 1', () => {
    render(<CancelBookingSheet booking={booking({ noShowCount: 3 })} mode="confirm" onClose={() => {}} />)
    openNoShowSection()
    expect(screen.getByText('noShowPriorCount:{"n":3}')).toBeTruthy()
    expect(screen.queryByText('noShowFirstTime')).toBeNull()
  })

  it('cancelled mode renders the stored reason for a CANCELLED row (new chips)', () => {
    render(
      <CancelBookingSheet
        booking={booking({ isCancelled: true, statusReason: 'cancel-same-day-contact' })}
        mode="cancelled"
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/cancelReasons\.cancel-same-day-contact/)).toBeTruthy()
  })

  it('cancelled mode still labels LEGACY no-show codes on pre-fix rows', () => {
    render(
      <CancelBookingSheet
        booking={booking({ isNoShow: true, statusReason: 'same-day-contacted' })}
        mode="cancelled"
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/noShowReasons\.same-day-contacted/)).toBeTruthy()
  })
})
