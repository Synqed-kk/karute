/**
 * @jest-environment jsdom
 *
 * Repeat no-show chip (無断欠席{n}回) on the reservation-page mobile agenda
 * row — same threshold (>= 2, isRepeatNoShow) + styling + i18n key as the
 * existing chip on the customer list (CustomerCardMobile). Renders only at
 * 2+ prior no-shows; a single no-show is not a flagged pattern.
 * next-intl mocked key-echo style (matches the suite's convention).
 */
import { render, screen } from '@testing-library/react'

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
  startTimeHm: '15:00',
  durationMin: 60,
  customerName: '今井 ももこ',
  customerInitials: '今',
  karuteNumber: '#00090',
  service: 'フェイシャル',
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

describe('mobile agenda row — repeat no-show chip', () => {
  it('does not render at noShowCount 0', () => {
    render(<ReservationMobileAgenda reservations={[reservation({ noShowCount: 0 })]} />)
    expect(screen.queryByText(/row\.noShowChip/)).toBeNull()
  })

  it('does not render at noShowCount 1 (single no-show is not a pattern)', () => {
    render(<ReservationMobileAgenda reservations={[reservation({ noShowCount: 1 })]} />)
    expect(screen.queryByText(/row\.noShowChip/)).toBeNull()
  })

  it('renders at noShowCount 2 with the derived count', () => {
    render(<ReservationMobileAgenda reservations={[reservation({ noShowCount: 2 })]} />)
    expect(screen.getByText('row.noShowChip:{"count":2}')).toBeTruthy()
  })
})
