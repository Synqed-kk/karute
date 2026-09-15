/** @jest-environment jsdom */
/**
 * PKT-1b-WIRE / PKT-1b-MONTH — what the 予約 page's WEEK and MONTH branches
 * actually render, and what they hand over. (The file keeps its week name: the
 * month branch landed later and shares every stub, and splitting it would have
 * meant a second copy of the whole harness.)
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
const uiProps: Record<string, Record<string, unknown>> = {}
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  return new Proxy(
    {},
    {
      get:
        (_target, name: string) =>
        ({ children, ...rest }: Record<string, unknown> = {}) => {
          uiProps[name] = rest
          return createElement('div', { 'data-ui': name }, children as React.ReactNode)
        },
    },
  )
})
jest.mock('@/components/reservation/ReservationGrid', () => ({ ReservationGrid: () => null }))
jest.mock('@/components/karute/spike-lifted/reservation/ReservationMobileAgenda', () => ({
  ReservationMobileAgenda: () => null,
}))
jest.mock('@/components/karute/spike-lifted/reservation/ReservationStaffFilter', () => ({
  ReservationStaffFilter: ({ prependSlot }: { prependSlot?: React.ReactNode }) => prependSlot ?? null,
}))
jest.mock('@/components/reservation/ReservationTotals', () => ({ ReservationTotals: () => null }))
const panelProps: Record<string, unknown> = {}
jest.mock('@/components/appointments/DateJumpPanel', () => ({
  DateJumpPanel: (props: Record<string, unknown>) => {
    Object.assign(panelProps, props)
    return null
  },
}))
// B4 — the switch registry, live-editable. A test flips ONE field and renders;
// no module reload, because this view is full of real React hooks and a second
// React instance is a worse test than no test.
// Lazy on purpose: jest hoists every `jest.mock` above the imports, so the
// copy is taken the first time a component actually reads a switch.
let mockSwitchState: Record<string, boolean> | null = null
function mockSwitches(): Record<string, boolean> {
  if (!mockSwitchState) {
    mockSwitchState = {
      ...(jest.requireActual('@/lib/appointments/booking-switches') as {
        BOOKING_SWITCHES: Record<string, boolean>
      }).BOOKING_SWITCHES,
    }
  }
  return mockSwitchState
}
/** The values as the app SHIPS them — read through the real registry, so
 *  「the card is ON」 is proven by the constant and not by this harness. */
const mockShipped = (): Record<string, boolean> =>
  (jest.requireActual('@/lib/appointments/booking-switches') as {
    BOOKING_SWITCHES: Record<string, boolean>
  }).BOOKING_SWITCHES
jest.mock('@/lib/appointments/booking-switches', () => ({
  get BOOKING_SWITCHES() {
    return mockSwitches()
  },
}))
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
  pending?: boolean
  failed?: boolean
  onPickDay: (iso: string) => void
}
let weekRowsProps: WeekRowsProps | null = null
jest.mock('@/components/appointments/WeekRows', () => ({
  WeekRows: (props: WeekRowsProps) => {
    weekRowsProps = props
    return <div data-testid="week-rows" />
  },
  VALUE_TONE_CLASS: {},
  DENSITY_DOT_CLASS: {},
}))

type MonthPageProps = {
  cells: MonthCell[]
  selectedDateIso: string
  todayIso?: string
  weekdayLabels: string[]
  typeSlot: string
  locale: string
  pending?: boolean
  failed?: boolean
  onPickDay: (iso: string) => void
  onPickOtherMonthDay: (iso: string) => void
}
let monthPageProps: MonthPageProps | null = null
jest.mock('@/components/appointments/MonthPage', () => ({
  MonthPage: (props: MonthPageProps) => {
    monthPageProps = props
    return <div data-testid="month-page" />
  },
}))

type SelectedDayCardProps = {
  dateIso: string
  rows: unknown[]
  dayTotals: WeekDayRowData | null
  soloMode: boolean
  locale: string
  pending?: boolean
  onOpenDay: (iso: string) => void
}
let cardProps: SelectedDayCardProps | null = null
jest.mock('@/components/appointments/SelectedDayCard', () => ({
  SelectedDayCard: (props: SelectedDayCardProps) => {
    cardProps = props
    return <div data-testid="selected-day-card" />
  },
}))

import { act, render } from '@testing-library/react'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { firstDayOfMonthKey, shiftMonthKey } from '@/lib/appointments/date-jump'
import type { MonthCell, WeekDayRowData } from '@/lib/adapters/reservation'

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

function monthCell(id: string, over: Partial<MonthCell> = {}): MonthCell {
  return {
    id,
    date: new Date(`${id}T00:00:00+09:00`),
    inMonth: true,
    isToday: false,
    count: 0,
    density: 'empty',
    closed: false,
    ...over,
  }
}

/** The props that put the view on its 月 branch. */
const MONTH_VIEW = {
  initialView: 'month' as const,
  weekData: null,
  weekStartIso: null,
  monthData: [monthCell('2026-09-15', { count: 3, density: 'medium' }), monthCell('2026-09-16')],
  monthStartIso: '2026-08-31T15:00:00.000Z',
}

/** Re-render the SAME tree with new server props — the second half of a
 *  navigation, which is the only thing that can clear a held tap. */
let rerender: ((ui: React.ReactElement) => void) | null = null
function rerenderWith(over: Record<string, unknown> = {}) {
  rerender!(viewWith(over))
}

function renderView(over: Record<string, unknown> = {}) {
  const r = render(viewWith(over))
  rerender = r.rerender
  return r
}

function viewWith(over: Record<string, unknown> = {}) {
  return (
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
    />
  )
}

beforeEach(() => {
  weekRowsProps = null
  monthPageProps = null
  cardProps = null
  rerender = null
  Object.assign(mockSwitches(), mockShipped())
  pushed.length = 0
  for (const k of Object.keys(uiProps)) delete uiProps[k]
  for (const k of Object.keys(panelProps)) delete panelProps[k]
})

/** The header's ‹ / › / 今日 handlers, as the package receives them. */
const header = () =>
  uiProps.ReservationPageHeader as unknown as {
    onPrev: () => void
    onNext: () => void
    onToday: () => void
  }

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

describe('every move keeps the 担当 filter (W-E, spec §1/§6)', () => {
  // The 自分 / 全スタッフ / 担当 filter feeds every number on every surface —
  // it is applied AT THE FETCH (staff_id on appointments.list). Dropping it on
  // a ‹ press does not look broken: the week simply shows the whole salon's
  // numbers under a 担当 pill that still reads as selected. Nothing on screen
  // says the scope changed.
  const STAFF = 'staff-profile-7'

  it('‹ / › / 今日 all carry it', () => {
    renderView({ staffFilter: STAFF })
    header().onPrev()
    header().onNext()
    header().onToday()
    expect(pushed).toHaveLength(3)
    for (const href of pushed) expect(href).toContain(`staff=${STAFF}`)
  })

  it('the 日/週/月 switch carries it', () => {
    renderView({ staffFilter: STAFF })
    ;(uiProps.DayWeekMonthToggle.onChange as (v: string) => void)('month')
    expect(pushed[0]).toContain(`staff=${STAFF}`)
    expect(pushed[0]).toContain('view=month')
  })

  it('a week-row tap carries it', () => {
    renderView({ staffFilter: STAFF })
    weekRowsProps!.onPickDay('2026-09-17')
    expect(pushed[0]).toContain(`staff=${STAFF}`)
    expect(pushed[0]).toContain('date=2026-09-17')
  })

  it("'self' is a real scope and survives too", () => {
    renderView({ staffFilter: 'self' })
    header().onPrev()
    expect(pushed[0]).toContain('staff=self')
  })

  it("the default 'all' is NOT spelled into the URL — parseStaffParam already defaults to it", () => {
    renderView({ staffFilter: 'all' })
    header().onPrev()
    expect(pushed[0]).not.toContain('staff=')
  })

  // A6 — the same rule at MONTH level: ‹ / › step whole months there, and a
  // 担当 that fell off a month move would leave the whole salon's numbers under
  // a pill that still reads as selected.
  it('every 月 move carries it too — the arrows and a cell tap', () => {
    renderView({ ...MONTH_VIEW, staffFilter: STAFF })
    header().onPrev()
    header().onNext()
    header().onToday()
    monthPageProps!.onPickDay('2026-09-17')
    expect(pushed).toHaveLength(4)
    for (const href of pushed) expect(href).toContain(`staff=${STAFF}`)
    expect(pushed[0]).toContain('view=month')
    expect(pushed[3]).toContain('date=2026-09-17')
  })
})

describe('the MONTH branch renders MonthPage (A1-A3)', () => {
  it('hands it the cells, the selected day, today and the 月 weekday labels', () => {
    const { getByTestId } = renderView(MONTH_VIEW)
    getByTestId('month-page')
    expect(monthPageProps!.cells).toHaveLength(2)
    expect(monthPageProps!.selectedDateIso).toBe('2026-09-15')
    expect(monthPageProps!.todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(monthPageProps!.weekdayLabels).toHaveLength(7)
    // PKT-2 owns the 新規/再来 producer; until then the line is 予約 alone.
    expect(monthPageProps!.typeSlot).toBe('off')
  })

  // B1/B4 — this used to open the day page. The month page is a place you
  // READ now: the tap selects, the card answers, the day is one more tap away.
  it('a cell tap SELECTS that day and STAYS on the month (B1)', () => {
    renderView(MONTH_VIEW)
    monthPageProps!.onPickDay('2026-09-17')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toContain('date=2026-09-17')
    expect(pushed[0]).toContain('view=month')
    expect(pushed[0]).not.toContain('view=day')
  })

  it('the ring moves on the FINGER — the tapped day is the selection before the server answers (B3)', () => {
    renderView(MONTH_VIEW)
    expect(monthPageProps!.selectedDateIso).toBe('2026-09-15')
    act(() => monthPageProps!.onPickDay('2026-09-17'))
    // No new props have arrived — the URL push is all that happened — and the
    // ring is already on the tapped day.
    expect(monthPageProps!.selectedDateIso).toBe('2026-09-17')
  })

  it('an ARROW after a tap wins: the held day never outlives the page it was tapped from', () => {
    renderView(MONTH_VIEW)
    act(() => monthPageProps!.onPickDay('2026-09-17'))
    expect(monthPageProps!.selectedDateIso).toBe('2026-09-17')
    // The page moves somewhere else entirely (a month arrow lands on the 1st).
    act(() => header().onNext())
    expect(monthPageProps!.selectedDateIso).toBe('2026-09-17')
    // …and the moment the server's answer is a DIFFERENT day, the real
    // selection takes over again rather than the stale tap.
    rerenderWith({ ...MONTH_VIEW, selectedDateIso: '2026-10-01T00:00:00+09:00' })
    expect(monthPageProps!.selectedDateIso).toBe('2026-10-01')
  })

  it('the CHIP follows the ring in 月 mode — one day named, not two (§v11b)', () => {
    renderView(MONTH_VIEW)
    const chipText = () =>
      (
        (uiProps.ReservationPageHeader as Record<string, unknown>).dateDisplayCompact as {
          props: { children: string }
        }
      ).props.children
    const before = chipText()
    act(() => monthPageProps!.onPickDay('2026-09-17'))
    const chipAfter = (uiProps.ReservationPageHeader as Record<string, unknown>)
      .dateDisplayCompact as { props: { children: string } }
    // The card carries no date header of its own, so a chip that lagged the
    // ring would leave the selected day unnamed for the whole round trip.
    expect(chipAfter.props.children).toContain('17')
    expect(chipAfter.props.children).not.toBe(before)
  })

  it('日/週 chips never run ahead of the server', () => {
    renderView()
    const before = (uiProps.ReservationPageHeader as Record<string, unknown>)
      .dateDisplayCompact as { props: { children: string } }
    act(() => weekRowsProps!.onPickDay('2026-09-17'))
    const after = (uiProps.ReservationPageHeader as Record<string, unknown>)
      .dateDisplayCompact as { props: { children: string } }
    expect(after.props.children).toBe(before.props.children)
  })

  it('the card gets the tapped day and its pending flag while the answer is in flight', () => {
    renderView(MONTH_VIEW)
    expect(cardProps!.pending).toBe(false)
    act(() => monthPageProps!.onPickDay('2026-09-17'))
    expect(cardProps!.dateIso).toBe('2026-09-17')
    expect(cardProps!.pending).toBe(true)
  })

  it('the card carries the SAME payload the page already holds — no second read (B1)', () => {
    renderView({ ...MONTH_VIEW, dayTotals: weekRow(0), reservationViews: [] })
    expect(cardProps!.dayTotals).not.toBeNull()
    expect(cardProps!.rows).toEqual([])
    expect(cardProps!.soloMode).toBe(true)
  })

  it('the card door opens the day page, keeping ?staff= (B2)', () => {
    renderView({ ...MONTH_VIEW, staffFilter: 'staff-9' })
    cardProps!.onOpenDay('2026-09-17')
    expect(pushed[0]).toContain('view=day')
    expect(pushed[0]).toContain('date=2026-09-17')
    expect(pushed[0]).toContain('staff=staff-9')
  })

  it('a FAILED month renders no card — the page says the read failed, once (B2)', () => {
    renderView({ ...MONTH_VIEW, monthData: null, truncated: true })
    expect(cardProps).toBeNull()
  })

  // B4 — the switch is honest when OFF: there is no card for the selection to
  // fill, so the tap keeps doing what it did before this piece and opens the
  // day. What it must never do is nothing.
  it('SWITCH OFF: no card, and a cell tap opens the DAY page again (B4)', () => {
    mockSwitches().selectedDayCard = false
    renderView(MONTH_VIEW)
    expect(cardProps).toBeNull()
    monthPageProps!.onPickDay('2026-09-17')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toContain('view=day')
    expect(pushed[0]).toContain('date=2026-09-17')
  })

  it('SHIPPED: the card really is on — proven through the registry, not a mock value', () => {
    expect(mockShipped().selectedDayCard).toBe(true)
    renderView(MONTH_VIEW)
    expect(cardProps).not.toBeNull()
  })

  it('a FILLER tap moves the page to THAT month, never to a day page (R1-2)', () => {
    renderView(MONTH_VIEW)
    monthPageProps!.onPickOtherMonthDay('2026-10-01')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toContain('view=month')
    expect(pushed[0]).toContain('date=2026-10-01')
  })

  it('the month line s pending state is the router transition, like the week s', () => {
    renderView(MONTH_VIEW)
    expect(typeof monthPageProps!.pending).toBe('boolean')
  })
})

/**
 * R2-1 (LENS-1 #1, HIGH) — ‹ / › used to step 月 mode via raw `setMonth`,
 * which overflows from a 31st: 8/31 › landed on 10/1 (September skipped
 * whole), 3/31 ‹ didn't move at all. The fix steps by MONTH KEY through the
 * same date-jump helpers `onPickMonth` already uses (see R1-1 below) and
 * lands on the 1st — or on TODAY when the target IS the current month.
 *
 * The six fixed cases below run a year behind whatever year this suite
 * happens to run on, so none of them can ever collide with the real current
 * month (same trick R1-1 uses below via `todayIso()`). The "current month"
 * case gets its own test, built FROM the real today.
 */
describe('the month arrows step by MONTH KEY, never a raw Date (R2-1)', () => {
  let Y: string

  beforeAll(() => {
    const probe = renderView(MONTH_VIEW)
    Y = String(Number(monthPageProps!.todayIso!.slice(0, 4)) - 1)
    probe.unmount()
  })

  it.each([
    ['01-31', 'next', '02-01'],
    ['03-31', 'prev', '02-01'],
    ['08-31', 'next', '09-01'],
    ['10-31', 'next', '11-01'],
    ['09-15', 'next', '10-01'],
    ['09-15', 'prev', '08-01'],
  ])('%s %s lands on %s in TZ=Asia/Tokyo — the 1st, never a skipped/short month', (md, dir, expectedMd) => {
    renderView({ ...MONTH_VIEW, selectedDateIso: `${Y}-${md}` })
    if (dir === 'next') header().onNext()
    else header().onPrev()
    expect(pushed[0]).toContain('view=month')
    expect(pushed[0]).toContain(`date=${Y}-${expectedMd}`)
  })

  it('lands on TODAY, not the 1st, when the target month IS the current one — same rule the chip uses', () => {
    const probe = renderView(MONTH_VIEW)
    const todayIso = monthPageProps!.todayIso!
    probe.unmount()
    const prevMonthFirst = firstDayOfMonthKey(shiftMonthKey(todayIso.slice(0, 7), -1))
    renderView({ ...MONTH_VIEW, selectedDateIso: prevMonthFirst.toISOString() })
    header().onNext()
    expect(pushed[0]).toContain(`date=${todayIso}`)
  })
})

/**
 * R1-1 (D-2) — the month CHIP's landing, the half of §v11 point 1 that 4a left
 * out. The decision lives here, not in the panel: the panel says "a month was
 * picked", the view decides which DAY of it the page lands on.
 */
describe('a month pick LANDS that month on the 月 page (R1-1)', () => {
  const pickMonth = () => panelProps.onPickMonth as ((y: number, m: number) => void) | undefined
  const todayIso = () => monthPageProps!.todayIso!

  it('an ordinary month lands on its 1st, in 月 view', () => {
    renderView(MONTH_VIEW)
    // A year behind today's, so it can never BE the current month whatever day
    // this suite runs on.
    const [y, m] = todayIso().split('-')
    pickMonth()!(Number(y) - 1, Number(m))
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toContain('view=month')
    expect(pushed[0]).toContain(`date=${Number(y) - 1}-${m}-01`)
  })

  it('the CURRENT month lands on TODAY — 「今月」 through the chip and 今日 agree', () => {
    renderView(MONTH_VIEW)
    const [y, m] = todayIso().split('-')
    pickMonth()!(Number(y), Number(m))
    expect(pushed[0]).toContain(`date=${todayIso()}`)
  })

  it('it carries the 担当 scope, like every other move (spec §1/§6)', () => {
    renderView({ ...MONTH_VIEW, staffFilter: 'staff-3' })
    const [y, m] = todayIso().split('-')
    pickMonth()!(Number(y) - 1, Number(m))
    expect(pushed[0]).toContain('staff=staff-3')
  })

  it('日/週 pass NO callback — there the chip is not a month lander', () => {
    renderView()
    expect(pickMonth()).toBeUndefined()
    expect(panelProps.defaultLevel).toBe(1)
  })
})

describe('a cut-off MONTH says so too (A5b, LENS-1 L1-5)', () => {
  // The 月 branch used to fall through to 「データがありません」 on a truncated
  // read: thirty days painted as calm and empty when the truth is that the
  // window was cut off. The phone is the only door that can reach it (the web
  // page throws to its error boundary).
  const noDataText = 'empty.noData'

  it('truncated → MonthPage in its failed state, and no 「データがありません」', () => {
    const { queryByText, getByTestId } = renderView({
      ...MONTH_VIEW,
      truncated: true,
      monthData: null,
    })
    getByTestId('month-page')
    expect(monthPageProps!.failed).toBe(true)
    expect(queryByText(noDataText)).toBeNull()
  })

  it('truncated with cells still on the wire is STILL failed — the read is incomplete', () => {
    renderView({ ...MONTH_VIEW, truncated: true })
    expect(monthPageProps!.failed).toBe(true)
  })

  it('a month that answered renders its cells, never the failed line', () => {
    renderView(MONTH_VIEW)
    expect(monthPageProps!.failed).toBe(false)
    expect(monthPageProps!.cells).toHaveLength(2)
  })

  it('a null month with no truncation flag also says so', () => {
    renderView({ ...MONTH_VIEW, monthData: null })
    expect(monthPageProps!.failed).toBe(true)
  })
})

describe('the week’s pending state is the router transition (W-A)', () => {
  it('WeekRows receives a pending flag', () => {
    renderView()
    // useTransition's isPending is false at rest — what matters is that the
    // prop is WIRED (a boolean), not left undefined.
    expect(typeof weekRowsProps!.pending).toBe('boolean')
  })
})

describe('a cut-off read SAYS so, never 「データがありません」 (R1-2, D5)', () => {
  // `truncated` means the window could not be read to exhaustion, so screen.ts
  // nulls weekData. That used to land on the view's 「データがありません」 else —
  // a calm, empty week that reads as "no bookings this week" when the truth is
  // "we could not finish reading". The WEB page never reaches here (it throws
  // to the route error boundary); the THIN screen passes dto.truncated, and on
  // that door this was the live state.
  //
  // WeekRows' own failed rendering — the 取得できませんでした line, no rows — is
  // pinned in week-rows.test.tsx ('failed renders only the failure line, no
  // rows'). This file owns the seam: what the VIEW decides and hands over.
  const noDataText = 'empty.noData' // next-intl is stubbed key→key here

  it('truncated → WeekRows in its failed state, and no 「データがありません」', () => {
    const { queryByText, getByTestId } = renderView({ truncated: true, weekData: null })
    getByTestId('week-rows')
    expect(weekRowsProps!.failed).toBe(true)
    expect(queryByText(noDataText)).toBeNull()
  })

  it('truncated with rows still on the wire is STILL failed — the read is incomplete', () => {
    renderView({ truncated: true })
    expect(weekRowsProps!.failed).toBe(true)
  })

  it('a week that answered renders its rows, never the failed line', () => {
    renderView()
    expect(weekRowsProps!.failed).toBe(false)
    expect(weekRowsProps!.rows).toHaveLength(7)
  })

  it('an EMPTY week ([] — the read answered, nothing booked) is not a failure', () => {
    const { queryByText } = renderView({ weekData: [] })
    expect(weekRowsProps!.failed).toBe(false)
    expect(weekRowsProps!.rows).toEqual([])
    expect(queryByText(noDataText)).toBeNull()
  })

  it('a null week with no truncation flag also says so, rather than showing a calm empty page', () => {
    renderView({ weekData: null })
    expect(weekRowsProps!.failed).toBe(true)
  })
})
