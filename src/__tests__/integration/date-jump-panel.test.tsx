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
// G2 (FIX-932-G1) — AppointmentsView now reads next/navigation's
// useSearchParams to spend a tapped-day hold the moment the browser leaves
// its target. This suite never exercises that hold, so a static empty
// params object is enough to keep the real component from throwing.
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
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

/** t13/t14's render seam: one entry per MonthGrid render, identified by the
 *  `cells` array it was handed. A month's cells are identity-stable by design
 *  (the cache's own array, or the skeleton built once per month), so the array
 *  IS the month — which lets a test say "one new grid, and neither of the two
 *  already on screen drew again" without a counter inside the component. */
const mockGridRenders: unknown[] = []

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
    MonthGrid: (props: { cells: Cell[]; onPickDay?: (d: Date) => void }) => {
      mockGridRenders.push(props.cells)
      return h(
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
      )
    },
    DayWeekMonthToggle: () => null,
    WeekDayCard: () => null,
  }
})

import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { makeSpring } from '@/lib/motion/spring'
import { jstStartOfToday, ymdInJst } from '@/lib/date/jst'
import type { MonthCellDTOType } from '@/lib/app-api/appointments-screen-dto'
import { capacityRowFields } from '@/lib/adapters/reservation'
import type { DayWeekMonthView } from '@synqed-kk/ui'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

// 2026-09-14 (月) — the day Liam's screenshots are from; JST midnight.
const SELECTED_ISO = new Date('2026-09-14T00:00:00+09:00').toISOString()

/** A month of the panel's own year (the selected date's, 2026) that is NEVER
 *  the current one — so a landing day of 「the 1st」 is the only right answer.
 *  This suite runs on the real clock: 8月 would be today's month for a whole
 *  month of the year, and the assertion would read as a bug in the code. */
const OTHER_MONTH = ymdInJst(jstStartOfToday()).startsWith('2026-08') ? 7 : 8

function monthCells(monthKey: string, count = 4): MonthCellDTOType[] {
  return [
    {
      id: `${monthKey}-01`,
      dateIso: new Date(`${monthKey}-01T00:00:00+09:00`).toISOString(),
      inMonth: true,
      isToday: false,
      count,
      density: 'medium',
      // The jump panel's months carry no capacity — it reads counts only.
      ...capacityRowFields(undefined),
      closed: false,
    },
  ]
}

function renderView({
  view = 'day' as DayWeekMonthView,
  loadMonthCells = jest.fn(async (key: string) => monthCells(key)),
  strict = false,
  staffFilter = 'all',
}: {
  view?: DayWeekMonthView
  loadMonthCells?: (key: string) => Promise<MonthCellDTOType[]>
  /** Wrap in <StrictMode>, i.e. what `next dev` and the shell's `vite dev`
   *  actually run: mount → unmount → remount, effects double-invoked. */
  strict?: boolean
  /** The 担当 scope the page is under — it must survive every move the panel
   *  makes, the month chip's landing included (spec §1/§6). */
  staffFilter?: string
} = {}) {
  const tree = (
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
      dayTotals={null}
      soloMode={false}
      reservationViews={[]}
      reservationStaff={[]}
      colorRosterIds={[]}
      businessHours={{ start: 10, end: 19 }}
      staffFilter={staffFilter}
      menus={[]}
      loadMonthCells={loadMonthCells}
    />
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { loadMonthCells }
}

/** jsdom ships no PointerEvent, so fireEvent.pointerDown/Move arrive with
 *  pointerId and clientX/Y undefined — which silently sends the panel's axis
 *  lock down the wrong branch. Build the event and hang the properties on it.
 *
 *  `timeStamp` is the one property that cannot ride in on Object.assign: it is
 *  a readonly accessor on Event.prototype, so the assignment is silently
 *  dropped, and jsdom seeds it from the REAL clock — which jest's fake timers
 *  do NOT fake. The panel derives a flick's px/s by dividing travel by the gap
 *  between two stamps (`onPointerMove`), so any test that asserts on velocity
 *  is otherwise measuring how busy the machine was between two synchronous
 *  fireEvent calls. Pass a stamp and the flick has a stated speed.
 *
 *  ⚠ NEVER STAMP 0. React's SyntheticEvent reads the native stamp as
 *  `event.timeStamp || Date.now()`, so a zero silently becomes the wall clock
 *  — the very thing the stamp is here to remove, and it fails open (the gap
 *  goes hugely negative and the panel's `Math.max(1, …)` floor hides it). */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  el: Element,
  init: { pointerId: number; clientX: number; clientY: number; timeStamp?: number },
) {
  const { timeStamp, ...props } = init
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, props)
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  fireEvent(el, event)
}

const chip = () => screen.getByTestId('date-chip')
const panel = () => screen.queryByRole('dialog')
const openPanel = async () => {
  fireEvent.click(chip())
  await screen.findByRole('dialog')
}
/** The month the panel is showing = the pane the loader was last asked for. */
const title = () => within(screen.getByRole('dialog')).getByRole('button', { expanded: false })
/** R6-2 — the two FAR months are drawn one animation frame after the commit
 *  that put them on screen (the open no longer pays for three grids in the
 *  frame it animates in). A test that reaches for the CENTRE pane by index has
 *  to let that frame land first, or index 1 is the next month — or nothing. */
/** The month the panel is ON, whatever else is drawn: the far panes are the
 *  absolutely-positioned ones, the pane in flow is the centre. Index 1 only
 *  means "centre" while all three are on the page. */
const centreGrid = (root: HTMLElement) =>
  within(root)
    .getAllByTestId('month-grid')
    .find((grid) => !grid.parentElement!.className.includes('absolute'))!
const allPanes = async (root: HTMLElement) => {
  await waitFor(() => expect(within(root).getAllByTestId('month-grid')).toHaveLength(3), {
    timeout: 3000,
  })
  return within(root).getAllByTestId('month-grid')
}

beforeEach(() => {
  push.mockClear()
  mockGridRenders.length = 0
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

  it('Escape hands focus back to the chip', async () => {
    renderView()
    await openPanel()
    // Focus starts inside the panel, not on the chip.
    expect(document.activeElement).not.toBe(chip())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(chip()).toHaveAttribute('aria-expanded', 'false'))
    // The panel is what the keyboard was inside of — dismissing it must not
    // drop the caret at the top of the document.
    expect(document.activeElement).toBe(chip())
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
    const chevron = title().querySelector('svg')!
    expect(chevron.style.transform).toBe('none')
    // …on the mock's curve. Without the utility it inherits Tailwind's default
    // ease-in-out, which has almost no motion in its first third — the chevron
    // loiters before it turns (measured: 2.5 % of the rotation 7 ms into the
    // 160 ms, where the mock's curve is at ~17 %).
    expect(chevron.getAttribute('class')).toContain('ease-[cubic-bezier(0.23,1,0.32,1)]')
    // Same reason one level down: the 1⇄2 crossfade is the mock's plain `ease`
    // (R4). Cosmetic, and exactly the kind of class that disappears unnoticed.
    const levels = dialog.querySelectorAll('[class*="transition-[opacity,filter]"]')
    expect(levels).toHaveLength(2)
    levels.forEach((el) => expect(el.getAttribute('class')).toContain('ease-[ease]'))

    fireEvent.click(title())
    // Level 2: the year, and twelve month chips.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { expanded: true })).toHaveTextContent('2026年'),
    )
    // The chevron turns over with the level — the approved visual, and the one
    // piece of the title's state a mutation could delete unnoticed.
    expect(
      within(dialog).getByRole('button', { expanded: true }).querySelector('svg')!.style.transform,
    ).toBe('rotate(180deg)')
    expect(within(dialog).getAllByRole('button', { pressed: false }).length).toBe(11)
    expect(within(dialog).getAllByRole('button', { pressed: true })).toHaveLength(1)

    loadMonthCells.mockClear()
    fireEvent.click(within(dialog).getByRole('button', { name: '12月' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年12月'))
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-12'))
    // Nothing navigated — level 2 moves the calendar, not the page.
    expect(push).not.toHaveBeenCalled()
  })

  /**
   * ⚖ §v11b (packet A4) — in 月 mode the chip must NOT open a day grid over a
   * day grid: the 月 page and this panel looked identical, which is the
   * complaint the whole round came out of. One prop, `defaultLevel`; the
   * panel's own levels, grid and month machinery are untouched.
   */
  it('月 mode opens the panel ON the month chips; 日 mode still opens the day grid', async () => {
    renderView({ view: 'month' })
    await openPanel()
    const dialog = screen.getByRole('dialog')

    // The year row, twelve chips, and no day grid: the day level is `inert` +
    // aria-hidden at level 2, so ByRole cannot see a single day button.
    expect(within(dialog).getByRole('button', { expanded: true })).toHaveTextContent('2026年')
    expect(within(dialog).getAllByRole('button', { pressed: false })).toHaveLength(11)
    expect(within(dialog).getAllByRole('button', { pressed: true })).toHaveLength(1)
    // No DAY is reachable: the mocked grids stay mounted for the slide, but at
    // level 2 they are inert + aria-hidden, so nothing with a day behind it is
    // in the accessibility tree (or the tab order).
    expect(
      within(dialog)
        .getAllByRole('button')
        .filter((b) => b.hasAttribute('data-day')),
    ).toHaveLength(0)
  })

  it('日 mode is unchanged — the chip still opens the day grid', async () => {
    renderView({ view: 'day' })
    await openPanel()
    const dialog = screen.getByRole('dialog')
    expect(title()).toHaveTextContent('2026年9月')
    expect(within(dialog).getAllByTestId('month-grid').length).toBeGreaterThan(0)
  })

  /**
   * R1-1 (D-2) — the other half of §v11 point 1, which 4a shipped without: in
   * 月 mode the twelve chips are the whole reason the panel opens at level 2,
   * so picking one LANDS that month on the page (MOCK 1263-1272's mGrid
   * handler) instead of dropping into a day grid nobody asked for. The panel
   * learns ONE optional callback; with no callback (日/週) its own behaviour is
   * byte-for-byte what it was — pinned by the level-2 test above, which still
   * expects a 12月 chip to move the calendar and navigate nothing.
   */
  it('月 mode: a month chip lands THAT month on the page and closes the panel', async () => {
    // The panel's chips are the SELECTED date's year (2026). Never assert on a
    // chip that could be the current month: the landing day would then be today
    // rather than the 1st, and this suite runs on the real clock.
    const pick = OTHER_MONTH
    renderView({ view: 'month', staffFilter: 'staff-7' })
    await openPanel()
    const dialog = screen.getByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: `${pick}月` }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    const url = push.mock.calls[0][0] as string
    // The month page, the 1st of the month picked — and the 担当 scope the page
    // was under, which every other move already carries (spec §1/§6).
    expect(url).toContain('view=month')
    expect(url).toContain(`date=2026-${String(pick).padStart(2, '0')}-01`)
    expect(url).toContain('staff=staff-7')
    // One tap is the whole decision.
    await waitFor(() => expect(panel()).toBeNull())
  })

  it('日 mode passes NO month callback — a chip still just moves the calendar', async () => {
    const loadMonthCells = jest.fn(async (key: string) => monthCells(key))
    renderView({ view: 'day', loadMonthCells })
    await openPanel()
    const dialog = screen.getByRole('dialog')

    fireEvent.click(title())
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { expanded: true })).toHaveTextContent('2026年'),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: `${OTHER_MONTH}月` }))

    // Level 1, that month, still open, nothing navigated.
    await waitFor(() => expect(title()).toHaveTextContent(`2026年${OTHER_MONTH}月`))
    expect(within(dialog).getAllByTestId('month-grid').length).toBeGreaterThan(0)
    expect(push).not.toHaveBeenCalled()
    expect(panel()).not.toBeNull()
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
    if (view === 'month') {
      // ⚖ §v11b (A4) + R1-1 (D-2): 月 mode opens ON the month chips, and since
      // R1-1 a chip LANDS its month on the page — so the way to a day grid in
      // 月 mode is the title, which toggles the level back down. The mode rule
      // below is unchanged; only the route to a day is.
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { expanded: true }))
    }
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
    const panes = await allPanes(dialog)
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
    // R4 — degraded is allowed, silent is not: the cause reaches the console.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    renderView({ loadMonthCells })
    await openPanel()

    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(warn).toHaveBeenCalledWith(
      '[date-jump] month read failed',
      expect.objectContaining({ month: '2026-09', error: expect.any(Error) }),
    )
    warn.mockRestore()
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent('dateJump.failed'),
    )
    // R5-3 — and what that key actually SAYS. This suite's next-intl mock
    // renders keys, so the assertion above proves the panel reaches the failed
    // line and these two prove the line itself: 「…でした」 alone tells staff
    // it went wrong and nothing about what to do, while every other read this
    // app degrades on carries the retry tail. Byte-exact against the week
    // rows' own failed string — one app, one sentence for one failure.
    expect(ja.reservation.dateJump.failed).toBe(
      '予約状況を取得できませんでした。もう一度お試しください。',
    )
    expect(en.reservation.dateJump.failed).toBe("Couldn't load bookings. Please try again.")
    // Navigation needs no counts.
    const cells = await allPanes(dialog)
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
    const centre = (await allPanes(dialog))[1]
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
    await allPanes(dialog)
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

/**
 * R5 / R7a — prefers-reduced-motion. jsdom ships no matchMedia, so the panel's
 * reduced branch had zero coverage: a mutant that hard-returned `false` from
 * the hook survived the whole suite.
 */
describe('prefers-reduced-motion: reduce', () => {
  /** Stub matchMedia so the hook can answer, and hand back a cleanup. */
  function stubMotion(matches: boolean) {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    return () => {
      window.matchMedia = original
    }
  }

  it('drops the press scale from every button in the panel', async () => {
    const restore = stubMotion(true)
    try {
      renderView()
      await openPanel()
      const dialog = screen.getByRole('dialog')
      const pressables = within(dialog).getAllByRole('button')
      expect(pressables.length).toBeGreaterThan(0)
      expect(pressables.some((b) => b.className.includes('active:scale'))).toBe(false)
    } finally {
      restore()
    }
  })

  it('opens with no transform at all — fades only', async () => {
    const restore = stubMotion(true)
    try {
      renderView()
      await openPanel()
      // Not 'scaleY(0.96) translateY(-4px)' on the first frame and not a
      // transform transition after it: under reduce there is nothing to move.
      expect(screen.getByRole('dialog').style.transform).toBe('none')
    } finally {
      restore()
    }
  })

  it('commits a month with a 0 ms timer instead of sliding', async () => {
    const restore = stubMotion(true)
    jest.useFakeTimers()
    try {
      renderView()
      fireEvent.click(chip())
      await act(async () => {
        jest.advanceTimersByTime(0)
      })
      const dialog = screen.getByRole('dialog')
      expect(title()).toHaveTextContent('2026年9月')

      fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
      // Zero, not the 220 ms slide — the month is simply there.
      await act(async () => {
        jest.advanceTimersByTime(0)
      })
      expect(title()).toHaveTextContent('2026年10月')
    } finally {
      jest.useRealTimers()
      restore()
    }
  })

  it('keeps the press scale when no preference is expressed', async () => {
    const restore = stubMotion(false)
    try {
      renderView()
      await openPanel()
      const dialog = screen.getByRole('dialog')
      expect(
        within(dialog)
          .getAllByRole('button')
          .some((b) => b.className.includes('active:scale-[0.97]')),
      ).toBe(true)
    } finally {
      restore()
    }
  })
})

/**
 * R6 — the stress lens fired five › clicks in a single tick (no paint frame,
 * no timer tick between them) and the panel landed on 12月: two of the five
 * deltas were lost to a race between the commit timer and a deferred restart.
 * Taps are queued now, so no tap a staff member made can be dropped.
 */
describe('a tap storm on the arrows lands every month asked for', () => {
  const openWithFakeTimers = async () => {
    fireEvent.click(chip())
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    return screen.getByRole('dialog')
  }

  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('five › taps in one tick end five months on, not three', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    expect(title()).toHaveTextContent('2026年9月')

    const next = within(dialog).getByRole('button', { name: 'next' })
    for (let i = 0; i < 5; i += 1) fireEvent.click(next)

    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    // 2026-09 + 5
    expect(title()).toHaveTextContent('2027年2月')
  })

  it('five ‹ taps in one tick end five months back', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    const prev = within(dialog).getByRole('button', { name: 'prev' })
    for (let i = 0; i < 5; i += 1) fireEvent.click(prev)

    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    expect(title()).toHaveTextContent('2026年4月')
  })

  it('taps that cancel each other out leave the month where it started', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    const next = within(dialog).getByRole('button', { name: 'next' })
    const prev = within(dialog).getByRole('button', { name: 'prev' })
    fireEvent.click(next)
    fireEvent.click(next)
    fireEvent.click(prev)
    fireEvent.click(prev)

    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    expect(title()).toHaveTextContent('2026年9月')
  })
})

/**
 * R9 — the blocker the delta-verify found inside R1's own fix. React 19's
 * StrictMode mounts, runs effects, unmounts (cleanup) and remounts; an unmount
 * guard set once at declaration and only ever cleared latches false for the
 * component's life, and every month read is then discarded — bit for bit the
 * symptom R1 exists to kill. Dev-only (React does not double-invoke in a
 * production build), which is exactly where the first browser pass happens:
 * `next dev` defaults to strict, and thin/main.tsx wraps the shell in it.
 */
describe('under StrictMode (what next dev and vite dev actually run)', () => {
  it('a month read still lands: the dots render and the status line is empty', async () => {
    const loadMonthCells = jest.fn(async (key: string) => monthCells(key, 7))
    renderView({ loadMonthCells, strict: true })
    await openPanel()

    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(''))
    const centre = (await allPanes(dialog))[1]
    expect(within(centre).getAllByRole('button')[0]).toHaveTextContent('7')
    // And the neighbours were prefetched, which only happens once the visible
    // month's read has actually been applied.
    await waitFor(() => expect(loadMonthCells).toHaveBeenCalledWith('2026-10'))
    expect(loadMonthCells).toHaveBeenCalledWith('2026-08')
  })

  it('a failed read still reaches the failed line', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const loadMonthCells = jest.fn(async () => {
      throw new Error('core down')
    })
    renderView({ loadMonthCells, strict: true })
    await openPanel()
    const dialog = screen.getByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent('dateJump.failed'),
    )
    warn.mockRestore()
  })
})

/**
 * R10 — the wrong-date navigation the delta-verify drove out. Tapping a day
 * while a month slide was in flight committed the slide on POINTERDOWN, so the
 * panes re-keyed between pointerdown and click: she tapped 9/1 and landed on
 * 10/1 (or, if the node she touched had been unmounted, nothing happened at
 * all). A tap is not a drag — only a gesture that claims the x-axis commits.
 */
describe('a day tap during a month slide goes to the day that was tapped', () => {
  const centrePane = () => centreGrid(screen.getByRole('dialog'))

  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const openWithFakeTimers = async () => {
    fireEvent.click(chip())
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    return screen.getByRole('dialog')
  }

  it('navigates to THAT cell, not the same square of the next month', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    // A slide is in flight and has not committed yet.
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    const cell = within(centrePane()).getAllByRole('button')[0]
    expect(cell).toHaveAttribute('data-day', '2026-09-01')

    // The finger goes down on the cell the staff member can see…
    pointer('pointerdown', cell, { pointerId: 1, clientX: 40, clientY: 40 })
    // …and the grid under it must not have changed by the time the tap lands.
    expect(within(centrePane()).getAllByRole('button')[0]).toHaveAttribute(
      'data-day',
      '2026-09-01',
    )
    fireEvent.click(within(centrePane()).getAllByRole('button')[0])

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(push.mock.calls[0][0]).toContain('date=2026-09-01')
  })

  it('a real drag still commits the slide in flight before it takes over', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    expect(title()).toHaveTextContent('2026年9月')

    const grid = screen.getByRole('dialog').querySelector<HTMLElement>('.touch-none')!
    // jsdom ships no pointer capture, and capture is the whole of the device
    // safety here: it retargets the CLICK to the grid, so a drag that started
    // on a day cell cannot navigate to the month that just landed under it.
    const setPointerCapture = jest.fn()
    Object.assign(grid, { setPointerCapture })
    pointer('pointerdown', grid, { pointerId: 2, clientX: 200, clientY: 100 })
    // Past the axis-lock threshold, horizontally: this IS a drag.
    pointer('pointermove', grid, { pointerId: 2, clientX: 160, clientY: 102 })
    // The month that was sliding has landed, so the drag starts from rest.
    expect(title()).toHaveTextContent('2026年10月')
    expect(setPointerCapture).toHaveBeenCalledWith(2)
    pointer('pointerup', grid, { pointerId: 2, clientX: 160, clientY: 102 })
    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
  })

  it('a tap leaves the in-flight slide to its own timer', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    // A pointerdown that never becomes a drag changes nothing on its own…
    pointer('pointerdown', centrePane(), { pointerId: 3, clientX: 40, clientY: 40 })
    expect(title()).toHaveTextContent('2026年9月')
    pointer('pointerup', centrePane(), { pointerId: 3, clientX: 40, clientY: 40 })
    // …and the slide still lands where it was going.
    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    expect(title()).toHaveTextContent('2026年10月')
  })
})

/**
 * R11 — the delta-verify's F2/F3, one root: a commit timer nobody owns. Tap ›,
 * tap the month title 60 ms later, and the year chips opened and then closed
 * themselves while the staff member was reading them (the commit dispatches
 * shiftMonth, and setMonth resets the level to the grid). Same timer moved the
 * panel off the month it had just reopened on.
 */
describe('a slide in flight cannot move the panel behind your back', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const openWithFakeTimers = async () => {
    fireEvent.click(chip())
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    return screen.getByRole('dialog')
  }
  const atLevelTwo = (dialog: HTMLElement) =>
    within(dialog).queryByRole('button', { expanded: true }) !== null

  it('the year chips stay open when › was tapped a moment before', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    fireEvent.click(title())
    expect(atLevelTwo(dialog)).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    // Still up, and nothing yanked it away.
    expect(atLevelTwo(dialog)).toBe(true)

    // Back to the grid: the month that was in flight LANDED, it was not lost.
    fireEvent.click(within(dialog).getByRole('button', { expanded: true }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年10月'))
  })

  it('the chips show the landed month year, across a year boundary', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    // Jump to December, then tap › so the month in flight is January 2027.
    fireEvent.click(title())
    fireEvent.click(within(dialog).getByRole('button', { name: '12月' }))
    await waitFor(() => expect(title()).toHaveTextContent('2026年12月'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    fireEvent.click(title())

    expect(within(dialog).getByRole('button', { expanded: true })).toHaveTextContent('2027年')
    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    expect(within(dialog).getByRole('button', { expanded: true })).toHaveTextContent('2027年')
  })

  it('reopening mid-slide opens on the page month and stays there', async () => {
    renderView()
    const dialog = await openWithFakeTimers()
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))

    // Close and reopen inside the slide's own 220 ms.
    fireEvent.click(chip())
    fireEvent.click(chip())
    await act(async () => {
      jest.advanceTimersByTime(0)
    })
    expect(title()).toHaveTextContent('2026年9月')

    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    // No stray commit walked it forward.
    expect(title()).toHaveTextContent('2026年9月')
  })
})

/**
 * #921 — the motion itself, on the mechanism that replaced the CSS transitions.
 *
 * Liam on the Vercel preview: "looks nothing like the mock… no animation." The
 * panel OPEN snapped in the PRODUCTION build only: it mounted closed and
 * flipped open one rAF later, and a single rAF promises "before the next
 * paint", not "after one". Production's faster JS collapsed both commits into
 * one frame, the browser never painted the closed state, and the transition had
 * no delta to run on. The spring writes every frame itself, and the closed
 * style is written synchronously in the mounting commit — which is what t1
 * pins, on the exact frame the browser would otherwise have missed.
 *
 * Frames are jest's: fake timers drive jsdom's rAF (verified), and the spring
 * resolves requestAnimationFrame per call so it is the FAKED one it schedules
 * on.
 */
describe('the panel moves like the mock', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const frames = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms)
    })
  }
  const openNow = () => {
    fireEvent.click(chip())
    return screen.getByRole('dialog')
  }
  /** Open, let the open spring ARRIVE, and let the frame after it draw the two
   *  far months (R6-2). Two advances, not one: each commit the spring causes is
   *  flushed at the end of its own act(), so the effect that schedules the
   *  drawing frame is only registered once the first advance has returned. */
  const openSettled = async () => {
    const dialog = openNow()
    await frames(1000)
    await frames(50)
    return dialog
  }

  it('t1 — opening writes the CLOSED style before a single frame runs', async () => {
    renderView()
    const dialog = openNow()
    // Not one rAF has been allowed to fire, and the panel is already in the
    // DOM carrying the closed state. This is the frame production was missing.
    expect(dialog.style.opacity).toBe('0')
    expect(dialog.style.transform).toContain('scaleY(0.96')
    expect(dialog.style.transform).toContain('translateY(-4')
    // The month read the open fired settles AFTER the assertions above, so its
    // dispatch landed outside act() — one console.error per run, and the kind
    // of noise that hides a real warning later. Flushed here, wrapped, the way
    // the deferred tests in this file wrap their own settles. No frame is
    // advanced: the closed style is still the only picture this test saw.
    await act(async () => {})
  })

  it('t1b — and then rises to rest over frames, not in one', async () => {
    renderView()
    const dialog = openNow()
    const samples: number[] = []
    for (let i = 0; i < 12; i += 1) {
      await frames(16)
      samples.push(Number(dialog.style.opacity))
    }
    // A real curve: several intermediate values, never overshooting.
    const between = samples.filter((v) => v > 0 && v < 1)
    expect(between.length).toBeGreaterThanOrEqual(6)
    expect(Math.max(...samples)).toBeLessThanOrEqual(1)
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
    }
    await frames(1000)
    expect(dialog.style.opacity).toBe('1')
    expect(dialog.style.transform).toBe('scaleY(1.0000) translateY(0.00px)')
  })

  it('t2 — closing unmounts the panel only once the fade has reached rest', async () => {
    renderView()
    openNow()
    await frames(1000)

    fireEvent.click(chip()) // close
    // Still mounted: a panel that vanished on the click would have no close to
    // animate, which is the CLOSE_MS timer this replaced.
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.opacity).toBe('1')
    await frames(80)
    const mid = Number(dialog.style.opacity)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    expect(panel()).not.toBeNull()

    await frames(1000)
    expect(panel()).toBeNull()
  })

  it('t3 — reopening mid-close reverses from where it is, it does not restart', async () => {
    renderView()
    openNow()
    await frames(1000)

    fireEvent.click(chip()) // close
    await frames(80)
    const dialog = screen.getByRole('dialog')
    const mid = Number(dialog.style.opacity)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)

    fireEvent.click(chip()) // reopen, mid-fade
    // The same element, at the same value: no jump back to 0, no second mount.
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(Number(dialog.style.opacity)).toBeCloseTo(mid, 5)

    await frames(1000)
    expect(dialog.style.opacity).toBe('1')
    expect(panel()).not.toBeNull()
  })

  it('t4 — a flick too short to pass the distance threshold still commits on speed', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)
    expect(title()).toHaveTextContent('2026年9月')

    const grid = dialog.querySelector<HTMLElement>('.touch-none')!
    // 10 px of travel — nowhere near a quarter of the pane — but fast: 10 px
    // in 1 ms is 10,000 px/s, far past COMMIT_VELOCITY's 550. Stamped, because
    // an unstamped pair divides that 10 px by however long the machine took
    // between these two lines, and a loaded run that spends 18 ms there hands
    // the panel a speed too slow to commit.
    pointer('pointerdown', grid, { pointerId: 7, clientX: 200, clientY: 100, timeStamp: 1000 })
    pointer('pointermove', grid, { pointerId: 7, clientX: 190, clientY: 101, timeStamp: 1001 })
    pointer('pointerup', grid, { pointerId: 7, clientX: 190, clientY: 101, timeStamp: 1001 })

    await frames(2000)
    // The velocity carried it: without the flick path this stays on 9月.
    expect(title()).toHaveTextContent('2026年10月')
  })

  it('t4b — a slow drag of the same distance goes back to where it was', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)

    const grid = dialog.querySelector<HTMLElement>('.touch-none')!
    pointer('pointerdown', grid, { pointerId: 8, clientX: 200, clientY: 100 })
    pointer('pointermove', grid, { pointerId: 8, clientX: 190, clientY: 101 })
    // A pause on the glass: the last sample's speed is what the release reads,
    // and a finger that stopped is not a flick.
    await frames(200)
    pointer('pointermove', grid, { pointerId: 8, clientX: 190, clientY: 101 })
    pointer('pointerup', grid, { pointerId: 8, clientX: 190, clientY: 101 })

    await frames(2000)
    expect(title()).toHaveTextContent('2026年9月')
  })

  it('t4c — the flick’s SPEED is handed into the spring, not thrown away', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)

    const grid = dialog.querySelector<HTMLElement>('.touch-none')!
    const track = grid.firstElementChild as HTMLElement
    const x = () => Number(/translate3d\(([-\d.]+)px/.exec(track.style.transform)?.[1] ?? NaN)

    // Stamped: this test is ABOUT the speed, so the speed is stated rather
    // than left to the gap between two synchronous lines — 10 px in 1 ms,
    // 10,000 px/s (see `pointer`).
    pointer('pointerdown', grid, { pointerId: 9, clientX: 200, clientY: 100, timeStamp: 1000 })
    pointer('pointermove', grid, { pointerId: 9, clientX: 190, clientY: 101, timeStamp: 1001 })
    expect(x()).toBe(-10) // the finger owns the track, 1:1
    pointer('pointerup', grid, { pointerId: 9, clientX: 190, clientY: 101, timeStamp: 1001 })

    // What the SAME release would cover with no velocity handed over: the same
    // integrator, the same options, the same two frames, started from rest.
    // No magic number — the bound computes itself.
    let control = 0
    let queued: ((t: number) => void) | null = null
    const ref = makeSpring((v) => (control = v), {
      response: 0.3,
      damping: 1,
      eps: 0.4,
      raf: (cb) => {
        queued = cb
        return 1
      },
      cancel: () => {
        queued = null
      },
    })
    ref.jump(-10)
    ref.set(-377) // 377 = the pane-width fallback a laid-out-less jsdom uses
    for (let t = 16; t <= 32; t += 16) {
      const cb = queued as ((time: number) => void) | null
      queued = null
      cb?.(t)
    }

    await frames(32)
    // The flicked track is further along than a dead-stop release — strictly,
    // with no margin to tune. Both sides are now deterministic (the stamped
    // flick above, the same two hand-driven frames here), and the integrator
    // makes the inequality exact: one step of it is monotone in the velocity
    // it starts from. Measured, the gap is ~52.8 px — the old fixed -10 was
    // padding for a speed that moved with the machine's load, and a loaded
    // full-suite run ate it.
    expect(x()).toBeLessThan(control)

    await frames(2000)
    expect(title()).toHaveTextContent('2026年10月')
  })

  it('t5 — a second › mid-slide lands the first month at once, then slides the next', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)

    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await frames(100) // in flight, nowhere near rest
    expect(title()).toHaveTextContent('2026年9月')

    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    // Instantly, on the tap itself: the month that was moving has LANDED.
    expect(title()).toHaveTextContent('2026年10月')

    await frames(2000)
    expect(title()).toHaveTextContent('2026年11月')
  })

  /**
   * R1 — the tap the landed month used to swallow. The slide spring rests on
   * 0.4 px, so it keeps creeping for ~350 ms after the track has visually
   * stopped, and `onRest` is what commits the month. Measured on the
   * production build: the track is 98.7 % of the way there at 301 ms
   * (−354.3 px of −359) with the new month filling the screen, and the commit
   * does not land until ~611 ms. Whoever taps a day in that third of a second
   * is tapping a month that looks finished — and the pane was `inert`.
   */
  it('t6 — a day in the landed month takes the tap while the spring is still creeping', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)

    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await frames(300)
    // The month has NOT committed — this is the window, not the aftermath.
    expect(title()).toHaveTextContent('2026年9月')

    const panes = within(dialog).getAllByTestId('month-grid')
    // The pane the armed shift is travelling toward is live…
    expect(panes[2].closest('[inert]')).toBeNull()
    // …the far pane stays inert…
    expect(panes[0].closest('[inert]')).not.toBeNull()
    // …and the departing pane — the one the panel is ON — stays live too
    // (R2 on R1's D1): it is NEVER inert, armed or not. See t8.
    expect(panes[1].closest('[inert]')).toBeNull()

    const cell = within(panes[2]).getAllByRole('button')[0]
    expect(cell).toHaveAttribute('data-day', '2026-10-01')
    fireEvent.click(cell)

    // THAT day, on the tap itself — `onPickDay` carries the cell's own Date,
    // so an early tap can never land on the same square of another month.
    expect(push).toHaveBeenCalled()
    expect(push.mock.calls[0][0]).toContain('date=2026-10-01')
    await frames(1000)
    expect(panel()).toBeNull()
  })

  /**
   * R2 (⚖ lead ruling on R1's D1) — R1 made the CURRENT pane (the month the
   * panel is ON) inert the instant a shift armed, so a real-browser tap on the
   * OLD month mid-slide — still most of the screen for ~250 ms — went nowhere
   * (R10's case, for real this time: jsdom never enforced `inert`, so R10's
   * own test stayed green through the bug). The current pane must never go
   * inert; only the pane the shift is NOT travelling toward stays inert.
   */
  it('t8 — the departing pane stays live: a day tap there still lands on that day', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)

    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await frames(300)
    // Same window as t6 — armed, not yet committed.
    expect(title()).toHaveTextContent('2026年9月')

    const panes = within(dialog).getAllByTestId('month-grid')
    // The current pane — the one the panel is ON — is live no matter what.
    expect(panes[1].closest('[inert]')).toBeNull()
    // The far pane (behind the direction of travel) stays inert.
    expect(panes[0].closest('[inert]')).not.toBeNull()

    const cell = within(panes[1]).getAllByRole('button')[0]
    expect(cell).toHaveAttribute('data-day', '2026-09-01')
    fireEvent.click(cell)

    expect(push).toHaveBeenCalled()
    expect(push.mock.calls[0][0]).toContain('date=2026-09-01')
    await frames(1000)
    expect(panel()).toBeNull()
  })

  /**
   * R3 (fix round 3 — LENS-1 MEDIUM 2). `key` on the pane wrapper is right for
   * the transition-colors problem, but at commit all three keys change at
   * once: the pane that falls off the end unmounts, and the pane the focused
   * day button now belongs to goes `inert`. Either way the browser blurs to
   * <body> — the keyboard user is thrown out of the dialog entirely and the
   * next Tab restarts at the top of the page. Focus goes back to the PANEL:
   * never to the chip (that is Escape's answer) and never to a day cell
   * nobody chose.
   */
  it('t12 — a month commit does not throw the keyboard out of the panel', async () => {
    renderView()
    const dialog = await openSettled()

    const day = within(within(dialog).getAllByTestId('month-grid')[1]).getAllByRole('button')[0]
    day.focus()
    expect(document.activeElement).toBe(day)

    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await frames(2000)
    expect(title()).toHaveTextContent('2026年10月')

    // Still in the dialog, and not stranded inside a subtree a browser has
    // just taken out of the tab order (jsdom enforces neither inert nor the
    // blur-on-unmount, so the assertion has to name both).
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect((document.activeElement as HTMLElement).closest('[inert]')).toBeNull()
  })

  /**
   * R2 (fix round 3 — LENS-1 MEDIUM 1). Pointer capture is per-pointer-id, so
   * a second finger landing on the grid mid-drag (a palm, a second thumb)
   * still reached `onPointerDown` and OVERWROTE the single gesture slot. The
   * first finger's moves were then ignored (wrong id) and the second's
   * release took the `axis !== 'x'` early return without touching the spring
   * — the track was left showing two half-months until the next arrow tap.
   */
  it('t10 — a second finger cannot hijack the drag, and the release still settles', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)

    const grid = dialog.querySelector<HTMLElement>('.touch-none')!
    const track = grid.firstElementChild as HTMLElement
    const x = () => Number(/translate3d\(([-\d.]+)px/.exec(track.style.transform)?.[1] ?? NaN)

    pointer('pointerdown', grid, { pointerId: 11, clientX: 200, clientY: 100 })
    pointer('pointermove', grid, { pointerId: 11, clientX: 160, clientY: 101 })
    expect(x()).toBe(-40) // finger A owns the track, 1:1

    // Finger B lands and drags across the grid: neither event touches it.
    pointer('pointerdown', grid, { pointerId: 12, clientX: 300, clientY: 300 })
    pointer('pointermove', grid, { pointerId: 12, clientX: 100, clientY: 300 })
    expect(x()).toBe(-40)
    pointer('pointerup', grid, { pointerId: 12, clientX: 100, clientY: 300 })
    expect(x()).toBe(-40)

    // …and finger A still owns the gesture: it moves the track, and ITS
    // release settles — 40px is nowhere near a quarter of the pane, so the
    // track comes back to centre and the month does not change.
    pointer('pointermove', grid, { pointerId: 11, clientX: 170, clientY: 101 })
    expect(x()).toBe(-30)
    // A pause on the glass, the way t4b does it: the last sample's speed is
    // what the release reads, and this test is about the settle, not a flick.
    await frames(200)
    pointer('pointermove', grid, { pointerId: 11, clientX: 170, clientY: 101 })
    pointer('pointerup', grid, { pointerId: 11, clientX: 170, clientY: 101 })
    await frames(2000)
    expect(x()).toBe(0)
    expect(title()).toHaveTextContent('2026年9月')
  })

  /** R2, second half — a gesture the browser takes away settles the track too
   *  (the mock wires pointercancel to the same handler, MOCK 1373). */
  it('t11 — a cancelled drag never leaves the track parked between two months', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)

    const grid = dialog.querySelector<HTMLElement>('.touch-none')!
    const track = grid.firstElementChild as HTMLElement
    const x = () => Number(/translate3d\(([-\d.]+)px/.exec(track.style.transform)?.[1] ?? NaN)

    pointer('pointerdown', grid, { pointerId: 13, clientX: 200, clientY: 100 })
    pointer('pointermove', grid, { pointerId: 13, clientX: 170, clientY: 101 })
    expect(x()).toBe(-30)
    await frames(200)
    pointer('pointermove', grid, { pointerId: 13, clientX: 170, clientY: 101 })
    pointer('pointercancel', grid, { pointerId: 13, clientX: 170, clientY: 101 })

    await frames(2000)
    expect(x()).toBe(0)
    expect(title()).toHaveTextContent('2026年9月')
  })

  /**
   * R1 (fix round 3) — the panel must be untouchable the moment `open` goes
   * false. Unmount waits for the open spring's REST (≈483 ms), but the fade is
   * visually over by ≈367 ms: for a third of a second an invisible calendar
   * sat over the top of the 予約 list still catching taps, and a day cell's
   * handler navigates. `inert` takes the subtree out of hit-testing, out of
   * the tab order and out of the a11y tree in one attribute (~110 controls);
   * the scrim is outside the dialog, so it needs its own pointer-events-none.
   */
  it('t9 — a closing panel stops taking taps and leaves the tab order at once', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)
    expect(dialog.hasAttribute('inert')).toBe(false)

    fireEvent.click(chip()) // close
    await frames(80)
    // Still mounted, still fading — this is the window, not the aftermath.
    expect(panel()).not.toBeNull()
    expect(Number(dialog.style.opacity)).toBeLessThan(1)

    expect(dialog.hasAttribute('inert')).toBe(true)
    // jsdom does not enforce inert, so count the way a browser would: every
    // day button now has an inert ancestor, so none of them is focusable and
    // none of them can be clicked.
    const days = Array.from(dialog.querySelectorAll<HTMLElement>('[data-day]'))
    expect(days.length).toBeGreaterThan(0)
    expect(days.every((el) => el.closest('[inert]') !== null)).toBe(true)

    const scrim = dialog.previousElementSibling as HTMLElement
    expect(scrim.className).toContain('bg-foreground/20')
    expect(scrim.className).toContain('pointer-events-none')

    // …and reopening hands both of them back.
    fireEvent.click(chip())
    await frames(1000)
    const reopened = screen.getByRole('dialog')
    expect(reopened.hasAttribute('inert')).toBe(false)
    expect((reopened.previousElementSibling as HTMLElement).className).not.toContain(
      'pointer-events-none',
    )
  })

  /**
   * R5-1 — the compositor promotion, and its release. `will-change` is what
   * makes the open spring's per-frame writes cheap on the phone: without a
   * standing layer every frame repaints the card — border, shadow and ~40 day
   * buttons — and an OPEN measured 51 real Paint records on the production
   * build under a 4x CPU throttle. Half of this test is the UNMOUNT: a
   * promoted element that outlives its animation is a layer the compositor
   * keeps paying for on every unrelated scroll afterwards, so the classes are
   * only safe because both elements are mounted exclusively while `rendered`.
   * Nothing else here can prove that — the classes are unconditional.
   */
  it('t9b — both moving elements carry their layer hint, and both leave the DOM at rest', async () => {
    renderView()
    const dialog = openNow()
    await frames(1000)
    const scrim = dialog.previousElementSibling as HTMLElement

    expect(dialog.className).toContain('will-change-[transform,opacity]')
    expect(scrim.className).toContain('will-change-[opacity]')

    fireEvent.click(chip()) // close
    await frames(1000) // past the open spring's rest (~483 ms)
    expect(panel()).toBeNull()
    expect(dialog.isConnected).toBe(false)
    expect(scrim.isConnected).toBe(false)
  })

  /**
   * R4-3 — the cost of a shift. `setPending`, the `liveDir` flip and every
   * cache write re-render the panel, MonthGrid is a plain `forwardRef` in the
   * package (nothing memoizes it there), and all three panes were redrawing
   * ~40 day buttons every time: four long tasks of ~90-100 ms on ONE month
   * change, measured on the production build under a 4× CPU throttle. Browsing
   * months is the gesture staff make most, so that is the lag.
   *
   * The seam is the package mock, not the component: a render counter living
   * inside the panel would prove the counter, not the panel.
   */
  const neverAnswers = () => new Promise<MonthCellDTOType[]>(() => {})

  it('t13 — a month shift draws ONE new grid and redraws neither month on screen', async () => {
    renderView({ loadMonthCells: neverAnswers })
    const dialog = await openSettled()
    // Three months drawn, three distinct cells arrays: prev, current, next.
    const alreadyDrawn = new Set(mockGridRenders)
    expect(alreadyDrawn.size).toBe(3)
    mockGridRenders.length = 0

    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await frames(2000)
    expect(title()).toHaveTextContent('2026年10月')

    // R6-3 — THE LANDING FRAME DRAWS NOTHING. The month that arrives behind the
    // commit (the new far month) used to be created in this very frame: 35-44 ms
    // measured on the production build under a 4x CPU throttle, the one frame of
    // a shift that misses 60 fps. It is now one animation frame later, where
    // nothing is moving. The two months already on screen keep their nodes AND
    // their render in both frames.
    expect(mockGridRenders).toHaveLength(0)
    await frames(50)
    expect(mockGridRenders).toHaveLength(1)
    expect(alreadyDrawn.has(mockGridRenders[0])).toBe(false)
  })

  it('t14 — arming a shift with a flick redraws nothing at all', async () => {
    renderView({ loadMonthCells: neverAnswers })
    const dialog = await openSettled()

    const grid = dialog.querySelector<HTMLElement>('.touch-none')!
    mockGridRenders.length = 0
    pointer('pointerdown', grid, { pointerId: 31, clientX: 200, clientY: 100 })
    pointer('pointermove', grid, { pointerId: 31, clientX: 190, clientY: 101 })
    pointer('pointerup', grid, { pointerId: 31, clientX: 190, clientY: 101 })
    // The release IS a React render (liveDir arms the shift), and it costs one
    // `inert` attribute on a wrapper — no month is drawn again.
    expect(mockGridRenders).toHaveLength(0)

    await frames(2000)
    expect(title()).toHaveTextContent('2026年10月')
  })

  /**
   * R6-2 — WHAT AN OPEN COSTS. The panel's price is MonthGrid: ~40 day buttons
   * a month, three months on screen. All three used to be created in the commit
   * the open spring then animates out of — one 133-184 ms task on the production
   * build under a 4x CPU throttle, spent drawing two months nobody can see yet,
   * while the panel is supposed to be fading in. The far two are now drawn on
   * the first frame with nothing moving on it — for an open, the frame after
   * the open spring arrives. (Drawing them on the frame after the FIRST paint
   * was measurably worse: the work just moved into the middle of the fade, and
   * the longest gap between frames of an open went 38.8-51.3 ms → 77.3-83.6.)
   *
   * t17 is the invariant that makes it safe: the ‹ / › handler and pointerdown
   * draw the neighbours THEMSELVES, in the same React batch as the state that
   * starts the travel — so a tap that beats the frame still slides to a real
   * pane with a real height, never to an empty box.
   */
  it('t15 — opening the panel draws ONE month, not three', async () => {
    renderView({ loadMonthCells: neverAnswers })
    mockGridRenders.length = 0
    const dialog = openNow()
    // Not one frame has run. This is the commit the open spring animates out
    // of, and it carries one month's day buttons.
    expect(mockGridRenders).toHaveLength(1)
    expect(within(dialog).getAllByTestId('month-grid')).toHaveLength(1)
    await act(async () => {})
  })

  it('t16 — and the far months arrive one per frame, never two in one', async () => {
    renderView({ loadMonthCells: neverAnswers })
    const dialog = openNow()
    expect(within(dialog).getAllByTestId('month-grid')).toHaveLength(1)
    // The month a › would travel toward comes first — it is the one a finger
    // can want — and it comes ALONE.
    await frames(20)
    expect(within(dialog).getAllByTestId('month-grid')).toHaveLength(2)
    await frames(20)
    expect(within(dialog).getAllByTestId('month-grid')).toHaveLength(3)
  })

  it('t17 — a › tap that beats that frame still lands on the right month', async () => {
    renderView({ loadMonthCells: neverAnswers })
    const dialog = openNow()
    expect(within(dialog).getAllByTestId('month-grid')).toHaveLength(1)

    // The tap draws the month it is about to travel toward — in its own commit,
    // before the layout effect measures it — so the travel has somewhere real
    // to go. Just that one: the month behind can wait for its own frame.
    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    expect(within(dialog).getAllByTestId('month-grid')).toHaveLength(2)

    await frames(2000)
    expect(title()).toHaveTextContent('2026年10月')
  })

  /**
   * R6-3 — and what the LANDING frame is allowed to do. The heights the slide
   * interpolates between are read when the shift is ARMED (the › tap, or the
   * finger's release), never when it lands: the frame that commits a month
   * re-keys three panes and must not also force a layout.
   */
  it('t18 — the commit frame measures no pane: the heights were read at arm time', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    let reads = 0
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        reads += 1
        return original.get ? original.get.call(this) : 0
      },
    })
    try {
      renderView({ loadMonthCells: neverAnswers })
      const dialog = await openSettled()
      reads = 0

      fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
      // Arming measures: the pane in flow, and the pane being travelled toward.
      expect(reads).toBeGreaterThanOrEqual(1)
      const atArm = reads

      await frames(2000)
      expect(title()).toHaveTextContent('2026年10月')
      // Nothing between the arm and the end of the commit read a height.
      expect(reads).toBe(atArm)
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
    }
  })

  /**
   * R3 — React reuses the 21+ cell nodes across a month commit, and MonthGrid's
   * cell carries `transition-colors`: measured on the production build, 21
   * cells ran a 150 ms background fade starting 46 ms AFTER the month had
   * landed, so the new month "developed" once it arrived. The mock replaces its
   * pane's markup wholesale and has nothing to fade. Keying the wrapper on the
   * month is the same thing in React: the landed month mounts fresh.
   */
  it('t7 — a landed month mounts fresh instead of re-colouring the one before it', async () => {
    renderView()
    const dialog = await openSettled()
    const wrapper = () => within(dialog).getAllByTestId('month-grid')[1].parentElement
    const before = wrapper()

    fireEvent.click(within(dialog).getByRole('button', { name: 'next' }))
    await frames(1000)
    expect(title()).toHaveTextContent('2026年10月')
    expect(wrapper()).not.toBe(before)
  })
})

/**
 * R4-1 — the seam under the date bar, measured on the phone build: 40px where
 * the page's own contract says 24px. `space-y-4` compiles to a zero-specificity
 * `:where(.space-y-4 > :not(:last-child)) { margin-block-end: 1rem }`, and the
 * header's `mb-0` is what cancels it so the wrapper below owns the whole seam
 * (24px then; the mock's 9px since R6-1). The date-jump anchor moved in between
 * the two: IT is the direct child of `.space-y-4` now, the header is a
 * grandchild, and the 16px came back on top. The anchor carries the same
 * contract.
 */
describe('the date-jump anchor keeps the header margin contract', () => {
  it('the anchor carries mb-0, so space-y-4 adds nothing above the 日/週/月 row', () => {
    renderView()
    const anchor = chip().closest<HTMLElement>('[class*="data-date-jump-chip"]')
    expect(anchor).not.toBeNull()
    expect(anchor!.classList.contains('mb-0')).toBe(true)
  })

  /**
   * R6-1 — the seam is the MOCK's, measured at 393 on the production build:
   * 9px from the date-bar control to the 日/週/月 control, 11px from there to
   * the page's next block. Both live on the wrapper that holds the filter
   * row: the padding above it, and a margin that outranks space-y-4's
   * zero-specificity :where() 16px below it. A tailwind-merge collision or a
   * hand-edit back to pt-6 would silently put the gap back, so the assertion
   * is on the RENDERED class list, not on the source string.
   */
  it('the filter wrapper carries the mock’s two seam numbers', () => {
    renderView()
    const anchor = chip().closest<HTMLElement>('[class*="data-date-jump-chip"]')!
    const filterWrapper = anchor.nextElementSibling as HTMLElement
    expect(filterWrapper.classList.contains('pt-[9px]')).toBe(true)
    expect(filterWrapper.classList.contains('mb-[11px]')).toBe(true)
    // …and the seam is not silently doubled by an older one left behind.
    expect(filterWrapper.classList.contains('pt-6')).toBe(false)
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
