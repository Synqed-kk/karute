/** @jest-environment jsdom */
/**
 * PKT-1b-WIRE — what the 予約 page's WEEK branch actually renders, and what it
 * hands it.
 *
 * Until this PR the week branch mapped @synqed-kk/ui's `WeekDayCard` over the
 * rows: seven cards in a responsive grid, nothing like the approved mock, and
 * blind to every number 1a put on the wire (`capacityDefensible`, `closed`,
 * `cancelledCount`, …). The swap to the app-local `WeekRows` is a one-line JSX
 * expression, so nothing but a render-level pin catches a revert.
 *
 * Mock set copied from management-flag-wiring.test.tsx — every dependency but
 * the one under test is stubbed, so this stays a narrow wiring pin rather than
 * a second full-container harness.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
const pushed: string[] = []
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href)
    },
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => '/ja/appointments',
}))
jest.mock('@/hooks/use-global-recorder', () => ({ useGlobalRecorder: () => ({ state: 'idle' }) }))
jest.mock('@/lib/notifications/hooks', () => ({ useUnreadCount: () => 0 }))
jest.mock('@/components/notifications/NotificationsPanel', () => ({ NotificationsPanel: () => null }))
// @synqed-kk/ui ships ESM-only and isn't transformable in this suite (the same
// stub every record-* test in this repo uses). A passthrough div means a
// WeekDayCard regression would still RENDER — which is why the assertions
// below pin WeekRows' own props rather than counting DOM nodes.
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  return new Proxy({}, { get: () => passthrough })
})
jest.mock('@/components/reservation/ReservationGrid', () => ({ ReservationGrid: () => null }))
jest.mock('@/components/karute/spike-lifted/reservation/ReservationMobileAgenda', () => ({
  ReservationMobileAgenda: () => null,
}))
jest.mock('@/components/karute/spike-lifted/reservation/ReservationStaffFilter', () => ({
  ReservationStaffFilter: ({ prependSlot }: { prependSlot?: React.ReactNode }) => prependSlot ?? null,
}))
jest.mock('@/components/reservation/ReservationTotals', () => ({ ReservationTotals: () => null }))
jest.mock('@/components/appointments/DateJumpPanel', () => ({ DateJumpPanel: () => null }))
jest.mock('@/components/appointments/NewBookingDialog', () => ({ NewBookingDialog: () => null }))
jest.mock('@/components/appointments/BookingActionSheetWrapper', () => ({
  BookingActionSheetWrapper: () => null,
}))
jest.mock('@/components/appointments/CancelBookingSheet', () => ({ CancelBookingSheet: () => null }))

type WeekRowsProps = {
  rows: WeekDayRowData[]
  weekStartIso: string
  selectedDateIso: string
  todayIso?: string
  soloMode: boolean
  typeSlot: string
  locale: string
  onPickDay: (iso: string) => void
}
let weekRowsProps: WeekRowsProps | null = null
jest.mock('@/components/appointments/WeekRows', () => ({
  WeekRows: (props: WeekRowsProps) => {
    weekRowsProps = props
    return <div data-testid="week-rows" />
  },
  VALUE_TONE_CLASS: {},
}))

import { render } from '@testing-library/react'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import type { WeekDayRowData } from '@/lib/adapters/reservation'

const WEEK_START = new Date('2026-09-15T00:00:00+09:00')

function weekRow(dayOffset: number): WeekDayRowData {
  const d = new Date(WEEK_START)
  d.setDate(d.getDate() + dayOffset)
  const iso = `2026-09-${String(15 + dayOffset).padStart(2, '0')}`
  return {
    dateNumber: 15 + dayOffset,
    monthNumber: 9,
    weekdayLabel: '火',
    isToday: false,
    count: 3,
    bookedMinutes: 180,
    availableMinutes: 480,
    newCustomerCount: 1,
    remindersPending: 0,
    consentPending: 0,
    unconfirmed: 0,
    visibleBookings: [],
    hiddenCount: 0,
    dateIso: iso,
    capacityDefensible: false,
    hoursSaved: false,
    closed: false,
    cancelledCount: 0,
    noShowDayCount: 0,
    returningCount: 0,
  }
}

const WEEK = Array.from({ length: 7 }, (_, i) => weekRow(i))

function renderView(over: Record<string, unknown> = {}) {
  return render(
    <AppointmentsView
      staff={[]}
      activeStaffId={null}
      authProfileId={null}
      customers={[]}
      locale="ja"
      orgSettings={null}
      initialView="week"
      selectedDateIso={WEEK_START.toISOString()}
      weekData={WEEK}
      weekStartIso={WEEK_START.toISOString()}
      monthData={null}
      monthStartIso={null}
      dayTotals={null}
      soloMode
      reservationViews={[]}
      reservationStaff={[]}
      colorRosterIds={[]}
      businessHours={{ start: 10, end: 19 }}
      staffFilter="all"
      menus={[]}
      loadMonthCells={async () => []}
      {...over}
    />,
  )
}

beforeEach(() => {
  weekRowsProps = null
  pushed.length = 0
})

describe('the WEEK branch renders WeekRows (W-A)', () => {
  it('hands it the seven adapter rows, the week start and the selected day', () => {
    const { getByTestId } = renderView()
    getByTestId('week-rows')
    expect(weekRowsProps!.rows).toHaveLength(7)
    expect(weekRowsProps!.rows[0].dateIso).toBe('2026-09-15')
    expect(weekRowsProps!.weekStartIso).toBe(WEEK_START.toISOString())
    expect(weekRowsProps!.selectedDateIso).toBe('2026-09-15')
    expect(weekRowsProps!.locale).toBe('ja')
  })

  it('passes soloMode straight through — the view resolves no capability itself', () => {
    renderView()
    expect(weekRowsProps!.soloMode).toBe(true)
    renderView({ soloMode: false })
    expect(weekRowsProps!.soloMode).toBe(false)
  })

  it("typeSlot is 'off' — today's newCustomerCount is the QR flag and must not print (W-D, spec §8)", () => {
    renderView()
    expect(weekRowsProps!.typeSlot).toBe('off')
  })

  it('a row tap opens that row’s DAY page', () => {
    renderView()
    weekRowsProps!.onPickDay('2026-09-17')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toContain('view=day')
    expect(pushed[0]).toContain('date=2026-09-17')
  })

  it('todayIso is a JST calendar day, never a raw ISO instant', () => {
    renderView()
    expect(weekRowsProps!.todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
