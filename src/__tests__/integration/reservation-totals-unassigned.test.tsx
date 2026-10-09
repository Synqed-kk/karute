/**
 * @jest-environment jsdom
 *
 * ReservationTotals (the web day-totals fallback): a booking with no staff
 * (担当未定) is never a recording target, so a past completed unrecorded
 * staff-less row must not raise the 未録音 total. A staffed one does.
 * next-intl mocked key-echo style (matches agenda-unassigned-row.test.tsx).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

import { ReservationTotals } from '@/components/reservation/ReservationTotals'
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

describe('ReservationTotals — 担当未定 never 未録音', () => {
  it('a completed, unrecorded staffId null row does not raise the 未録音 total', () => {
    render(<ReservationTotals reservations={[reservation({ staffId: null, staffName: '' })]} />)
    expect(screen.queryByText(/^totals\.unrecorded/)).toBeNull()
  })

  it('the same row with a staffId counts as 未録音 (1)', () => {
    render(<ReservationTotals reservations={[reservation()]} />)
    expect(screen.getByText('totals.unrecorded:{"n":1}')).toBeTruthy()
  })
})
