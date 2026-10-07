/** @jest-environment jsdom */
// Greptile P1 on #1142: two 担当未定 bookings in the same slot must both be
// visible in the desktop 担当未定 lane — packed side by side (different
// sub-row offsets), never one card over the other. Staffed lanes unchanged.
import React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}))
jest.mock('@/components/reservation/TimeAxis', () => ({ TimeAxis: () => null, CurrentTimeIndicator: () => null }))

import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import type { ReservationView } from '@/lib/adapters/reservation-view'

const view = (over: Partial<ReservationView>): ReservationView => ({
  id: 'appt',
  staffId: null,
  staffName: '',
  startTimeHm: '11:00',
  durationMin: 60,
  customerName: '客',
  customerInitials: '客',
  karuteNumber: null,
  service: 'フェイシャル',
  displayStatus: 'booked',
  isCancelled: false,
  isNoShow: false,
  statusReason: null,
  statusSetByName: null,
  statusSetAt: null,
  staffColorKey: 'neutral',
  clientId: 'cust',
  karuteRecordId: null,
  isFirstTimeVisit: false,
  pack: null,
  needsRenewal: false,
  noShowCount: 0,
  ...over,
} as ReservationView)

const cardOf = (name: string) => screen.getByText(name).closest('div.absolute') as HTMLElement
const lanes = [{ id: 'p1', name: 'Mika', role: '', takesBookings: true, initials: 'MI' }]
const hours = { start: 9, end: 20 } as never

describe('ReservationGrid 担当未定 lane packing', () => {
  it('two same-slot 担当未定 bookings both render, at different offsets, sharing the lane', () => {
    render(
      <ReservationGrid
        staff={lanes}
        businessHours={hours}
        reservations={[view({ id: 'u1', customerName: '佐藤' }), view({ id: 'u2', customerName: '鈴木' })]}
      />,
    )
    const a = cardOf('佐藤')
    const b = cardOf('鈴木')
    expect(a.style.left).toBe(b.style.left) // same time
    expect(a.style.top).not.toBe(b.style.top) // different sub-row
    expect([a.style.top, b.style.top]).toEqual(['4px', '44px'])
    expect([a.style.height, b.style.height]).toEqual(['38px', '38px'])
  })

  it('a staffed lane is unchanged: two same-slot staffed bookings keep the full band', () => {
    render(
      <ReservationGrid
        staff={lanes}
        businessHours={hours}
        reservations={[
          view({ id: 's1', staffId: 'p1', customerName: '田中' }),
          view({ id: 's2', staffId: 'p1', customerName: '高橋' }),
        ]}
      />,
    )
    for (const n of ['田中', '高橋']) {
      expect(cardOf(n).style.top).toBe('4px')
      expect(cardOf(n).style.height).toBe('80px')
    }
  })

  it('a lone 担当未定 booking keeps the full band', () => {
    render(<ReservationGrid staff={lanes} businessHours={hours} reservations={[view({ id: 'u3', customerName: '伊藤' })]} />)
    expect(cardOf('伊藤').style.top).toBe('4px')
    expect(cardOf('伊藤').style.height).toBe('80px')
  })
})
