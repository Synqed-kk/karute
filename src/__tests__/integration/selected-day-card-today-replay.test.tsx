/** @jest-environment jsdom */
import { Profiler, useEffect, useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import ja from '../../../messages/ja.json'
import { appointmentsToMonthCells, capacityRowFields, type WeekDayRowData } from '@/lib/adapters/reservation'
import { computeMonthRange } from '@/lib/date/calendar-range'
import { jstWallTimeToDate } from '@/lib/date/jst'

// The shell port notifies synchronously, even when the URL did not change.
// Its search subscriber then sets the same string. Keep React's useTransition
// entirely real: the pending pulse must come from AppointmentsView itself.
const mockListeners = new Set<() => void>()
const mockPush = jest.fn((href: string) => {
  history.pushState({}, '', href)
  mockListeners.forEach((listener) => listener())
})
function useMockSearchParams() {
  const [search, setSearch] = useState(location.search)
  useEffect(() => {
    const listener = () => setSearch(location.search)
    mockListeners.add(listener)
    return () => { mockListeners.delete(listener) }
  }, [])
  return new URLSearchParams(search)
}
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/appointments',
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => useMockSearchParams(),
}))
jest.mock('next-intl', () => ({
  useLocale: () => 'ja',
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string | number>) => {
    let value: unknown = ja
    for (const part of `${namespace}.${key}`.split('.')) {
      value = (value as Record<string, unknown>)?.[part]
    }
    let text = typeof value === 'string' ? value : key
    for (const [name, replacement] of Object.entries(values ?? {})) {
      text = text.split(`{${name}}`).join(String(replacement))
    }
    return text
  },
}))
jest.mock('@synqed-kk/ui', () => ({
  ReservationPageHeader: ({ onToday }: { onToday: () => void }) => (
    <button type="button" onClick={onToday}>{ja.reservation.today}</button>
  ),
  DayWeekMonthToggle: () => null,
  MonthGrid: () => null,
}))
jest.mock('@/hooks/use-global-recorder', () => ({ useGlobalRecorder: () => ({ state: 'idle' }) }))
jest.mock('@/lib/notifications/hooks', () => ({ useUnreadCount: () => 0 }))
jest.mock('@/components/notifications/NotificationsPanel', () => ({ NotificationsPanel: () => null }))
jest.mock('@/components/reservation/ReservationGrid', () => ({ ReservationGrid: () => null }))
jest.mock('@/components/karute/spike-lifted/reservation/ReservationMobileAgenda', () => ({
  ReservationMobileAgenda: () => null,
}))
jest.mock('@/components/karute/spike-lifted/reservation/ReservationStaffFilter', () => ({
  ReservationStaffFilter: () => null,
}))
jest.mock('@/components/reservation/ReservationTotals', () => ({ ReservationTotals: () => null }))
jest.mock('@/components/appointments/DateJumpPanel', () => ({ DateJumpPanel: () => null }))
jest.mock('@/components/appointments/NewBookingDialog', () => ({ NewBookingDialog: () => null }))
jest.mock('@/components/appointments/BookingActionSheetWrapper', () => ({ BookingActionSheetWrapper: () => null }))
jest.mock('@/components/appointments/CancelBookingSheet', () => ({ CancelBookingSheet: () => null }))

import { AppointmentsView } from '@/components/appointments/AppointmentsView'

const DATE = '2026-09-19'
const URL = `/appointments?view=month&date=${DATE}`
const selectedDate = jstWallTimeToDate(DATE, '00:00')
const { monthStart, monthEnd } = computeMonthRange(selectedDate)
const cells = appointmentsToMonthCells([], monthStart, monthEnd, selectedDate)
const totals: WeekDayRowData = {
  dateIso: DATE,
  dateNumber: 19,
  monthNumber: 9,
  weekdayLabel: new Intl.DateTimeFormat('ja', { weekday: 'short', timeZone: 'Asia/Tokyo' }).format(selectedDate),
  isToday: true,
  count: 0,
  bookedMinutes: 0,
  availableMinutes: 0,
  newCustomerCount: 0,
  remindersPending: 0,
  consentPending: 0,
  unconfirmed: 0,
  visibleBookings: [],
  hiddenCount: 0,
  capacityDefensible: false,
  hoursSaved: false,
  closed: false,
  cancelledCount: 0,
  noShowDayCount: 0,
  returningCount: 0,
  ...capacityRowFields(undefined),
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-09-19T03:00:00Z'))
  history.replaceState({}, '', URL)
  mockPush.mockClear()
})
afterEach(() => {
  jest.useRealTimers()
})

it('keeps the selected-day content visible after same-URL Today and a re-tap of the ring, using real transitions', () => {
  const trace: { pending: boolean; fading: boolean }[] = []
  const { container } = render(
    <Profiler id="today-replay" onRender={() => {
      const card = document.querySelector('[data-selected-day-card]')
      if (!card) return
      trace.push({
        pending: card.closest('[aria-busy]')?.getAttribute('aria-busy') === 'true',
        fading: card.querySelector('[data-sel-fade]')?.classList.contains('opacity-0') ?? false,
      })
    }}>
      <AppointmentsView
        staff={[]}
        activeStaffId={null}
        authProfileId={null}
        customers={[]}
        locale="ja"
        orgSettings={null}
        initialView="month"
        selectedDateIso={selectedDate.toISOString()}
        weekData={null}
        weekStartIso={null}
        monthData={cells}
        monthStartIso={monthStart.toISOString()}
        dayTotals={totals}
        soloMode={false}
        reservationViews={[]}
        reservationStaff={[]}
        businessHours={{ start: 10, end: 19 }}
        staffFilter="all"
        loadMonthCells={jest.fn(async () => [])}
      />
    </Profiler>,
  )
  const card = container.querySelector<HTMLElement>('[data-selected-day-card]')!
  const initialContent = card.textContent
  const ring = () => container.querySelector<HTMLElement>('[data-month-cell][aria-pressed="true"]')!
  const assertVisible = () => {
    const fade = card.querySelector<HTMLElement>('[data-sel-fade]')!
    expect(fade).toHaveClass('opacity-100')
    expect(fade).not.toHaveClass('opacity-0')
    expect(fade).not.toHaveAttribute('inert')
    expect(card.textContent).toBe(initialContent)
    expect(within(card).getByText(ja.reservation.weekRows.noBookings)).toBeVisible()
    expect(within(card).getByRole('button')).toBeVisible()
    expect(card.querySelector('[data-day-line]')).not.toBeEmptyDOMElement()
    expect(card.querySelectorAll('.reservation-shim')).toHaveLength(0)
    expect(ring()).toHaveAttribute('aria-current', 'date')
  }
  assertVisible()
  expect(mockListeners.size).toBeGreaterThan(0)
  const notified = jest.fn()
  mockListeners.add(notified)
  try {
    for (const button of [screen.getByRole('button', { name: ja.reservation.today }), ring()]) {
      trace.length = 0
      const pushesBefore = mockPush.mock.calls.length
      fireEvent.click(button)
      expect(mockPush).toHaveBeenCalledTimes(pushesBefore + 1)
      expect(mockPush).toHaveBeenLastCalledWith(URL)
      expect(notified).toHaveBeenCalledTimes(pushesBefore + 1)
      expect(location.pathname + location.search).toBe(URL)
      // This pin must actually exercise the transient pending/fade path;
      // a no-op router or a useTransition stub cannot silently pass it.
      expect(trace.some((tick) => tick.pending)).toBe(true)
      expect(trace.some((tick) => tick.fading)).toBe(true)
      expect(trace.at(-1)?.pending).toBe(false)
      act(() => { jest.advanceTimersByTime(500) })
      assertVisible()
    }
  } finally {
    mockListeners.delete(notified)
  }
})
