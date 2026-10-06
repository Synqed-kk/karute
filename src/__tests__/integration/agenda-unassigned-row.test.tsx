/**
 * @jest-environment jsdom
 *
 * 担当未定 on the phone 予約 agenda row (ReservationMobileAgenda): a booking
 * with no staff is never a recording target, so a PAST staff-less row must not
 * carry the amber 未録音 ("you forgot to record") pill — it shows the 担当未定
 * mark only. A staffed past unrecorded row keeps the pill.
 * next-intl mocked key-echo style (matches agenda-noshow-chip.test.tsx).
 */
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

import { ReservationMobileAgenda } from '@/components/karute/spike-lifted/reservation/ReservationMobileAgenda'
import type { ReservationView } from '@/lib/adapters/reservation-view'

const reservation = (over: Partial<ReservationView> = {}): ReservationView => ({
  id: 'appt-1',
  staffId: 'staff-1',
  staffName: '原田 かなみ',
  startTimeHm: '09:00',
  durationMin: 60,
  customerName: '今井 ももこ',
  customerInitials: '今',
  karuteNumber: '#00090',
  service: 'フェイシャル',
  displayStatus: 'completed',
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

describe('mobile agenda row — 担当未定', () => {
  it('a staffId null row renders the 担当未定 mark and no 担当 line', () => {
    render(
      <ReservationMobileAgenda
        reservations={[reservation({ staffId: null, staffName: '', displayStatus: 'booked' })]}
      />,
    )
    expect(screen.getByText('mark')).toBeTruthy()
    expect(screen.queryByText(/^tantou/)).toBeNull()
  })

  it('a staffed row renders no 担当未定 mark', () => {
    render(<ReservationMobileAgenda reservations={[reservation({ displayStatus: 'booked' })]} />)
    expect(screen.queryByText('mark')).toBeNull()
  })

  it('a past staff-less row shows no 未録音 pill (it cannot be recorded)', () => {
    render(
      <ReservationMobileAgenda
        reservations={[reservation({ staffId: null, staffName: '' })]}
      />,
    )
    expect(screen.queryByText('unrecorded')).toBeNull()
  })

  it('the same past staff-less row, expanded, still shows no 未録音 pill', () => {
    render(
      <ReservationMobileAgenda
        reservations={[reservation({ staffId: null, staffName: '' })]}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('unrecorded')).toBeNull()
  })

  it('a past staffed unrecorded row keeps the 未録音 pill', () => {
    render(<ReservationMobileAgenda reservations={[reservation()]} />)
    expect(screen.getByText('unrecorded')).toBeTruthy()
  })
})
