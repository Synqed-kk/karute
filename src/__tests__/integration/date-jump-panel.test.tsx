/** @jest-environment jsdom */
/**
 * 予約 date-jump panel, rendered inside the real AppointmentsView.
 *
 * The panel is only worth anything wired up, so this drives the CONTAINER: the
 * chip that opens it, the arrows, the year-of-months level, and — the one that
 * matters most — that tapping a day navigates WITHOUT changing the page's
 * 日/週/月 mode. That assertion is repeated for all three modes on purpose: a
 * hardcoded 'day' passes any single-mode test and silently throws staff out of
 * the week view every time they jump a date.
 *
 * @synqed-kk/ui is stubbed the way every other suite in this repo stubs it,
 * but with two real components rather than passthrough divs: the header's date
 * chip (which must carry the marker the pressed state and aria-expanded hang
 * off) and MonthGrid's day buttons (which are what a "day tap" means).
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))

const push = jest.fn()
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/appointments',
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
jest.mock('@/components/appointments/NewBookingDialog', () => ({ NewBookingDialog: () => null }))
jest.mock('@/components/appointments/BookingActionSheetWrapper', () => ({
  BookingActionSheetWrapper: () => null,
}))
jest.mock('@/components/appointments/CancelBookingSheet', () => ({ CancelBookingSheet: () => null }))

jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement: h } = require('react') as typeof import('react')
  type Cell = { id: string; date: Date; count: number }
  return {
    ReservationPageHeader: (props: {
      dateDisplayCompact?: React.ReactNode
      onPickDate?: () => void
      onToday?: () => void
    }) =>
      h(
        'div',
        null,
        h(
          'button',
          { type: 'button', 'data-testid': 'date-chip', onClick: props.onPickDate },
          props.dateDisplayCompact,
          h('svg', { key: 'chev' }),
        ),
        h('button', { type: 'button', 'data-testid': 'bar-today', onClick: props.onToday }, 'bar'),
      ),
    MonthGrid: (props: { cells: Cell[]; onPickDay?: (d: Date) => void }) =>
      h(
        'div',
        { 'data-testid': 'month-grid' },
        props.cells.map((c) =>
          h(
            'button',
            {
              key: c.id,
              type: 'button',
              'data-day': c.id,
              onClick: () => props.onPickDay?.(c.date),
            },
            String(c.count),
          ),
        ),
      ),
    DayWeekMonthToggle: () => null,
    WeekDayCard: () => null,
  }
})

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'
import type { DayWeekMonthView } from '@synqed-kk/ui'

// 2026-09-14 (月) — the day Liam's screenshots are from; JST midnight.
const SELECTED_ISO = new Date('2026-09-14T00:00:00+09:00').toISOString()

function monthCells(monthKey: string, count = 4): MonthCellDTOType[] {
  return [
    {
      id: `${monthKey}-01`,
      dateIso: new Date(`${monthKey}-01T00:00:00+09:00`).toISOString(),
      inMonth: true,
      isToday: false,
      count,
      density: 'medium',
    },
  ]
}

function renderView({
  view = 'day' as DayWeekMonthView,
  loadMonthCells = jest.fn(async (key: string) => monthCells(key)),
}: {
  view?: DayWeekMonthView
  loadMonthCells?: (key: string) => Promise<MonthCellDTOType[]>
} = {}) {
  render(
    <AppointmentsView
      staff={[]}
      activeStaffId={null}
      authProfileId={null}
      customers={[]}
      locale="ja"
      orgSettings={null}
      initialView={view}
      selectedDateIso={SELECTED_ISO}
      weekData={null}
      weekStartIso={null}
      monthData={null}
      monthStartIso={null}
      reservationViews={[]}
      reservationStaff={[]}
      colorRosterIds={[]}
      businessHours={{ start: 10, end: 19 }}
      staffFilter="all"
      menus={[]}
      loadMonthCells={loadMonthCells}
    />,
  )
  return { loadMonthCells }
}

const chip = () => screen.getByTestId('date-chip')
const panel = () => screen.queryByRole('dialog')
const openPanel = async () => {
  fireEvent.click(chip())
  await screen.findByRole('dialog')
}
/** The month the panel is showing = the pane the loader was last asked for. */
const title = () => within(screen.getByRole('dialog')).getByRole('button', { expanded: false })

beforeEach(() => {
  push.mockClear()
})

describe('opening and closing', () => {
  it('the chip opens the panel and says so with aria-expanded', async () => {
    renderView()
    await waitFor(() => expect(chip()).toHaveAttribute('aria-expanded', 'false'))
    expect(panel()).toBeNull()

    await openPanel()
    expect(chip()).toHaveAttribute('aria-expanded', 'true')
    // Not a modal: the page behind it stays reachable by assistive tech.
    expect(panel()).toHaveAttribute('aria-modal', 'false')
  })

  it('the chip closes it again, and so does Escape and a pointerdown outside', async () => {
    renderView()
    await openPanel()
    fireEvent.click(chip())
    await waitFor(() => expect(chip()).toHaveAttribute('aria-expanded', 'false'))

    await openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(chip()).toHaveAttribute('aria-expanded', 'false'))

    await openPanel()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(chip()).toHaveAttribute('aria-expanded', 'false'))
  })

  it('an Escape mid-IME-composition belongs to the input method, not the panel', async () => {
    renderView()
    await openPanel()
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(chip()).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('walking the calendar', () => {
  it('the arrows move one month, and the loader is asked for it', async () => {
    const loadMonthCells = jest.fn(async (key: string) => monthCells(key))
    renderView({ loadMonthCells })
    await openPanel()
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-09'))
    // Neighbours prefetch once the visible month lands.
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-10'))
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-08'))

    const dialog = screen.getByRole('dialog')
    loadMonthCells.mockClear()
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    // The slide commits on its timer; then the new visible month's neighbour
    // (2026-11) is the one that still needs fetching.
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-11'))

    loadMonthCells.mockClear()
    fireEvent.click(within(dialog).getByRole('button', { name: 'prev' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'prev' }))
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-07'))
  })

  it('the title opens the year of months, and a chip lands on the grid at that month', async () => {
    const loadMonthCells = jest.fn(async (key: string) => monthCells(key))
    renderView({ loadMonthCells })
    await openPanel()
    const dialog = screen.getByRole('dialog')

    expect(title()).toHaveTextContent('2026年9月')
    fireEvent.click(title())
    // Level 2: the year, and twelve month chips.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { expanded: true })).toHaveTextContent('2026年'),
    )
    expect(within(dialog).getAllByRole('button', { pressed: false }).length).toBe(11)
    expect(within(dialog).getAllByRole('button', { pressed: true })).toHaveLength(1)

    loadMonthCells.mockClear()
    fireEvent.click(within(dialog).getByRole('button', { name: '12月' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年12月'))
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-12'))
    // Nothing navigated — level 2 moves the calendar, not the page.
    expect(push).not.toHaveBeenCalled()
  })
})

describe('picking a day KEEPS the page mode', () => {
  it.each([
    ['day' as DayWeekMonthView],
    ['week' as DayWeekMonthView],
    ['month' as DayWeekMonthView],
  ])('%s stays %s', async (view) => {
    renderView({ view })
    await openPanel()
    await waitFor(() => expect(screen.getAllByTestId('month-grid')).toHaveLength(3))

    // The centre pane is the second of the three (prev, current, next).
    const centre = screen.getAllByTestId('month-grid')[1]
    fireEvent.click(within(centre).getAllByRole('button')[0])

    await waitFor(() => expect(push).toHaveBeenCalled())
    const url = push.mock.calls[0][0] as string
    expect(url).toContain(`view=${view}`)
    expect(url).toContain('date=2026-09-01')
    // And the panel is gone — one tap is the whole decision.
    await waitFor(() => expect(panel()).toBeNull())
  })

  it('今日 in the footer goes to today in the SAME mode', async () => {
    renderView({ view: 'week' })
    await openPanel()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'today' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(push.mock.calls[0][0]).toContain('view=week')
  })
})

describe('pending is not empty, and a failure says so', () => {
  it('shows the loading line while a month is in flight, then clears it', async () => {
    let release: (cells: MonthCellDTOType[]) => void = () => {}
    const loadMonthCells = jest.fn(
      () => new Promise<MonthCellDTOType[]>((resolve) => (release = resolve)),
    )
    renderView({ loadMonthCells })
    await openPanel()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('status')).toHaveTextContent('dateJump.loading')
    // The day numbers are already there — a pending month is never blank, and
    // it is never a grid of zero-count cells either: the status line above is
    // what separates "not loaded yet" from "nothing booked".
    const panes = within(dialog).getAllByTestId('month-grid')
    expect(panes).toHaveLength(3)
    expect(within(panes[1]).getAllByRole('button').length).toBeGreaterThan(0)

    await act(async () => {
      release(monthCells('2026-09'))
    })
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(''))
  })

  it('shows the failed line when the month read rejects, and days still navigate', async () => {
    const loadMonthCells = jest.fn(async () => {
      throw new Error('upstream down')
    })
    renderView({ loadMonthCells })
    await openPanel()

    const dialog = screen.getByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent('dateJump.failed'),
    )
    // Navigation needs no counts.
    const cells = within(dialog).getAllByTestId('month-grid')
    fireEvent.click(within(cells[1]).getAllByRole('button')[0])
    await waitFor(() => expect(push).toHaveBeenCalled())
  })
})

/**
 * R1 — the blind round's HIGH finding. Open the panel and tap › before the
 * prefetch answers (on a phone that is most of the time: each month read
 * re-runs the whole appointments screen assembly) and the month you land on
 * used to sit at 「予約状況を読み込み中」 forever — the effect's cleanup threw
 * the request away, and `pending` reads as "someone is already on it".
 */
describe('a month read in flight when you turn the page still lands', () => {
  /** A loader whose promises the test resolves by hand, one month at a time. */
  function deferredLoader() {
    const pendingByMonth = new Map<
      string,
      { resolve: (c: MonthCellDTOType[]) => void; reject: (e: Error) => void }
    >()
    const calls: string[] = []
    const load = jest.fn(
      (key: string) =>
        new Promise<MonthCellDTOType[]>((resolve, reject) => {
          calls.push(key)
          pendingByMonth.set(key, { resolve, reject })
        }),
    )
    return { load, calls, pendingByMonth }
  }

  it('resolving after a › tap fills the month in, and revisiting it shows the dots', async () => {
    const { load, calls, pendingByMonth } = deferredLoader()
    renderView({ loadMonthCells: load })
    await openPanel()
    await waitFor(() => expect(calls).toContain('2026-09'))

    // September lands; its neighbours go out and stay unresolved.
    await act(async () => {
      pendingByMonth.get('2026-09')!.resolve(monthCells('2026-09'))
    })
    await waitFor(() => expect(calls).toContain('2026-10'))

    // Turn the page onto the month whose read is still in flight.
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年10月'))

    // The answer arrives AFTER the move — it must still land.
    await act(async () => {
      pendingByMonth.get('2026-10')!.resolve(monthCells('2026-10', 7))
    })
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(''))

    // …and walking back and forth shows real counts, with no second request.
    const before = load.mock.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: 'prev' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年9月'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年10月'))
    const centre = within(dialog).getAllByTestId('month-grid')[1]
    expect(within(centre).getAllByRole('button')[0]).toHaveTextContent('7')
    // Already answered and already cached — no duplicate read for that month.
    expect(load.mock.calls.filter((c) => c[0] === '2026-10')).toHaveLength(1)
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(before)
  })

  it('a rejection after a › tap shows the failed line, and a revisit re-requests it', async () => {
    const { load, calls, pendingByMonth } = deferredLoader()
    renderView({ loadMonthCells: load })
    await openPanel()
    await act(async () => {
      pendingByMonth.get('2026-09')!.resolve(monthCells('2026-09'))
    })
    await waitFor(() => expect(calls).toContain('2026-10'))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年10月'))

    await act(async () => {
      pendingByMonth.get('2026-10')!.reject(new Error('core down'))
    })
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent('dateJump.failed'),
    )

    // Leave and come back: a failed month is asked for again.
    const asked = () => load.mock.calls.filter((c) => c[0] === '2026-10').length
    expect(asked()).toBe(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'prev' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年9月'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await waitFor(() => expect(asked()).toBe(2))
  })

  it('never fires two reads for the same month at once', async () => {
    const { load, pendingByMonth } = deferredLoader()
    renderView({ loadMonthCells: load })
    await openPanel()
    const dialog = screen.getByRole('dialog')
    // Walk out and back while every read is still open.
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年10月'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'prev' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年9月'))
    await act(async () => {})
    for (const key of pendingByMonth.keys()) {
      expect(load.mock.calls.filter((c) => c[0] === key)).toHaveLength(1)
    }
  })
})

/**
 * R2 — the counts must not live as long as the page. Book a customer into next
 * month, reopen the panel: the panel used to issue ZERO reads and show the old
 * number. It now re-reads on every open while the cached dots stay visible.
 */
describe('reopening re-reads the months, showing the old counts meanwhile', () => {
  const closePanel = async () => {
    fireEvent.click(chip())
    await waitFor(() => expect(panel()).toBeNull())
  }

  it('asks for the visible month again on every open', async () => {
    const loadMonthCells = jest.fn(async (key: string) => monthCells(key))
    renderView({ loadMonthCells })
    await openPanel()
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-08'))
    const firstRound = loadMonthCells.mock.calls.filter((c) => c[0] === '2026-09').length
    expect(firstRound).toBe(1)

    await closePanel()
    await openPanel()
    await waitFor(() =>
      expect(loadMonthCells.mock.calls.filter((c) => c[0] === '2026-09')).toHaveLength(2),
    )
  })

  it('shows the cached dots during the refresh — no loading line, no blank grid', async () => {
    let release: (cells: MonthCellDTOType[]) => void = () => {}
    const loadMonthCells = jest.fn((key: string) =>
      key === '2026-09' && release !== undefined
        ? new Promise<MonthCellDTOType[]>((resolve) => {
            release = resolve
          })
        : Promise.resolve(monthCells(key)),
    )
    renderView({ loadMonthCells })
    await openPanel()
    await act(async () => {
      release(monthCells('2026-09', 4))
    })
    let dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(''))

    await closePanel()
    await openPanel()
    dialog = screen.getByRole('dialog')
    // The re-read is in flight (its promise is held), and the panel is showing
    // the counts it already had — not a loading line over bare day numbers.
    await waitFor(() =>
      expect(loadMonthCells.mock.calls.filter((c) => c[0] === '2026-09')).toHaveLength(2),
    )
    expect(within(dialog).getByRole('status')).toHaveTextContent('')
    const centre = within(dialog).getAllByTestId('month-grid')[1]
    expect(within(centre).getAllByRole('button')[0]).toHaveTextContent('4')

    // …and the fresh answer replaces them.
    await act(async () => {
      release(monthCells('2026-09', 9))
    })
    await waitFor(() => {
      const pane = within(screen.getByRole('dialog')).getAllByTestId('month-grid')[1]
      expect(within(pane).getAllByRole('button')[0]).toHaveTextContent('9')
    })
  })
})

/**
 * R3 — the blind round counted ~110 invisible day buttons in the tab order,
 * seventy of them belonging to months clipped out of view, and level 1 keeping
 * all of them focusable under aria-hidden while level 2 was open (the
 * aria-hidden-focus violation). `inert` is what actually removes a subtree.
 */
describe('only what is on screen is reachable by keyboard', () => {
  /** jsdom does not implement inert's focus behaviour, so count the way a
   *  browser would: focusable elements with no inert ancestor. */
  const reachable = () =>
    Array.from(
      screen.getByRole('dialog').querySelectorAll<HTMLElement>('button, [tabindex]'),
    ).filter((el) => !el.closest('[inert]'))

  it('the previous and next month panes are out of the tab order', async () => {
    renderView()
    await openPanel()
    await waitFor(() => expect(screen.getAllByTestId('month-grid')).toHaveLength(3))

    const panes = screen.getAllByTestId('month-grid')
    expect(panes[0].closest('[inert]')).not.toBeNull() // previous month
    expect(panes[1].closest('[inert]')).toBeNull() // the month on screen
    expect(panes[2].closest('[inert]')).not.toBeNull() // next month

    // Every day button that IS reachable belongs to the centre pane.
    const days = reachable().filter((el) => el.hasAttribute('data-day'))
    expect(days.length).toBeGreaterThan(0)
    expect(days.every((el) => panes[1].contains(el))).toBe(true)
  })

  it('level 1 leaves the tab order while the month chips are up, and comes back', async () => {
    renderView()
    await openPanel()
    const dialog = screen.getByRole('dialog')
    const grid = () => within(dialog).getAllByTestId('month-grid')[1]
    const chips = () => within(dialog).queryAllByRole('button', { pressed: false })

    expect(grid().closest('[inert]')).toBeNull()
    expect(reachable().some((el) => el.hasAttribute('data-day'))).toBe(true)

    fireEvent.click(title())
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { expanded: true })).toHaveTextContent('2026年'),
    )
    // The grid, its legend and 今日 are all gone from the tab order…
    expect(grid().closest('[inert]')).not.toBeNull()
    expect(reachable().some((el) => el.hasAttribute('data-day'))).toBe(false)
    // …and the twelve month chips are the reachable controls instead.
    expect(chips().every((el) => !el.closest('[inert]'))).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { expanded: true }))
    await waitFor(() => expect(grid().closest('[inert]')).toBeNull())
    expect(reachable().some((el) => el.hasAttribute('data-day'))).toBe(true)
  })
})

describe('the hidden native date input is gone', () => {
  it('AppointmentsView no longer renders one — the chip is the only door to a date', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const src = readFileSync('src/components/appointments/AppointmentsView.tsx', 'utf8')
    expect(src).not.toMatch(/type="date"/)
    expect(src).not.toMatch(/\.showPicker\b/)
    expect(src).not.toMatch(/datePickerRef/)
  })

  it('renders no date input in the DOM either', () => {
    renderView()
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })
})
