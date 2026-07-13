/**
 * @jest-environment jsdom
 *
 * Wiring coverage for the 予約 agenda row gestures (booking-page touch bug,
 * 2026-07-13): the row spreads useLongPress's handlers, so a tap opens the
 * action sheet, a 450ms hold opens the cancel sheet, and a DRAG — a scroll
 * attempt on a day that fits one screen, where no pointercancel ever comes —
 * opens neither.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ReservationView } from '@/lib/adapters/reservation-view'

// useTranslations(ns) -> (key) => key, so labels equal their key.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// jsdom has no PointerEvent, so fireEvent.pointer* falls back to a bare Event
// and clientX/Y silently vanish — the drag tests would pass NaN through the
// tolerance math and prove nothing. MouseEvent carries coordinates.
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    // @ts-expect-error — test-only polyfill
    window.PointerEvent = class PointerEvent extends MouseEvent {}
  }
})

import { ReservationMobileAgenda } from '@/components/karute/spike-lifted/reservation/ReservationMobileAgenda'

const booking: ReservationView = {
  id: 'appt-1',
  staffId: 'staff-1',
  staffName: '原田 かなみ',
  startTimeHm: '18:00',
  durationMin: 60,
  customerName: '魚谷真佐美',
  customerInitials: '魚',
  karuteNumber: '#00529',
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
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

function renderRow() {
  const onSelect = jest.fn()
  const onLongPress = jest.fn()
  render(
    <ReservationMobileAgenda
      reservations={[booking]}
      onSelect={onSelect}
      onLongPress={onLongPress}
    />,
  )
  const row = screen.getByRole('button', { name: /魚谷真佐美/ })
  return { row, onSelect, onLongPress }
}

describe('予約 agenda row gestures', () => {
  it('tap → onSelect (action sheet)', () => {
    const { row, onSelect, onLongPress } = renderRow()
    fireEvent.pointerDown(row, { clientX: 50, clientY: 100 })
    act(() => {
      jest.advanceTimersByTime(150)
    })
    fireEvent.pointerUp(row)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('450ms hold → onLongPress (cancel sheet), no onSelect', () => {
    const { row, onSelect, onLongPress } = renderRow()
    fireEvent.pointerDown(row, { clientX: 50, clientY: 100 })
    act(() => {
      jest.advanceTimersByTime(450)
    })
    fireEvent.pointerUp(row)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('drag then lift (scroll attempt, no pointercancel) → neither sheet', () => {
    const { row, onSelect, onLongPress } = renderRow()
    fireEvent.pointerDown(row, { clientX: 50, clientY: 100 })
    fireEvent.pointerMove(row, { clientX: 50, clientY: 140 })
    act(() => {
      jest.advanceTimersByTime(200)
    })
    fireEvent.pointerUp(row)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('drag and keep holding past the threshold → still no cancel sheet', () => {
    const { row, onSelect, onLongPress } = renderRow()
    fireEvent.pointerDown(row, { clientX: 50, clientY: 100 })
    fireEvent.pointerMove(row, { clientX: 50, clientY: 140 })
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    fireEvent.pointerUp(row)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('row is unselectable — iOS long-press text selection is off', () => {
    const { row } = renderRow()
    expect(row.className).toContain('select-none')
  })
})
