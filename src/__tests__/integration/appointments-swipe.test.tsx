/** @jest-environment jsdom */
/**
 * ⚖ THE SWIPE ON THE 予約 PAGE (S2) and the count's own word (S6), driven
 * through the real AppointmentsView.
 *
 * The gesture's own rules are pinned once, against the hook
 * (use-horizontal-slide.test.tsx). What this suite is for is the half only the
 * PAGE can answer: that a landed swipe moves the right number of days for the
 * view it was made on, that a vertical intent leaves the page alone, and that
 * the pane travelling in is the neighbour's own dates with no numbers on them.
 *
 * ⚖ 9/16 15:4x (Liam) — 日 is a scrolled, tapped LIST; a horizontal drag there
 * can change the day under a thumb mid-scroll. The gesture binds ONLY on 週
 * and 月 now — see "no swipe on 日" below for the negative proof.
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
  return {
    ReservationPageHeader: (props: { dateDisplayCompact?: React.ReactNode }) =>
      h('div', null, h('button', { type: 'button' }, props.dateDisplayCompact)),
    MonthGrid: () => null,
    DayWeekMonthToggle: () => null,
    WeekDayCard: () => null,
  }
})

import { act, fireEvent, render, screen } from '@testing-library/react'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import { capacityRowFields, type WeekDayRowData } from '@/lib/adapters/reservation'
import type { DayWeekMonthView } from '@synqed-kk/ui'

const SELECTED = new Date('2026-09-14T00:00:00+09:00').toISOString()

function weekRow(over: Partial<WeekDayRowData> = {}): WeekDayRowData {
  return {
    dateIso: '2026-09-14',
    dateNumber: 14,
    monthNumber: 9,
    weekdayLabel: '月',
    isToday: false,
    count: 11,
    bookedMinutes: 210,
    closed: false,
    newCustomerCount: 5,
    newCountKnown: true,
    cancelledCount: 0,
    noShowDayCount: 0,
    bookings: [],
    ...capacityRowFields(undefined),
    ...over,
  } as WeekDayRowData
}

function renderView(view: DayWeekMonthView) {
  return render(
    <AppointmentsView
      staff={[]}
      activeStaffId={null}
      authProfileId={null}
      customers={[]}
      locale="ja"
      orgSettings={null}
      initialView={view}
      selectedDateIso={SELECTED}
      weekData={view === 'week' ? [weekRow()] : null}
      weekStartIso={view === 'week' ? '2026-09-14' : null}
      monthData={view === 'month' ? [] : null}
      monthStartIso={null}
      dayTotals={weekRow()}
      soloMode={false}
      reservationViews={[]}
      reservationStaff={[]}
      colorRosterIds={[]}
      businessHours={{ start: 10, end: 19 }}
      staffFilter="all"
      menus={[]}
      loadMonthCells={jest.fn(async () => [])}
    />,
  )
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  el: Element,
  init: { pointerId: number; clientX: number; clientY: number; timeStamp?: number },
) {
  const { timeStamp, ...props } = init
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, props)
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  fireEvent(el, event)
}

const box = () => document.querySelector<HTMLElement>('[data-slide-box]')!
const frames = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

/** A flick fast enough to commit whatever the distance — 10px in 1ms. */
async function flick(id: number, dx: number) {
  const el = box()
  pointer('pointerdown', el, { pointerId: id, clientX: 300, clientY: 200, timeStamp: 1000 })
  pointer('pointermove', el, { pointerId: id, clientX: 300 + dx, clientY: 201, timeStamp: 1001 })
  pointer('pointerup', el, { pointerId: id, clientX: 300 + dx, clientY: 201, timeStamp: 1001 })
  await frames(3000)
}

beforeEach(() => {
  push.mockClear()
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('a landed swipe moves the page by ONE unit of the view it was made on', () => {
  it.each([
    ['week', -20, 'date=2026-09-21'],
    ['week', 20, 'date=2026-09-07'],
    ['month', -20, 'date=2026-10-01'],
    ['month', 20, 'date=2026-08-01'],
  ] as const)('%s, dx %d → %s', async (view, dx, expected) => {
    renderView(view)
    await flick(1, dx)
    expect(push).toHaveBeenCalled()
    const href = String(push.mock.calls[0][0])
    expect(href).toContain(expected)
    // THE MODE NEVER CHANGES on a swipe — a week swipe stays on the week.
    expect(href).toContain(`view=${view}`)
  })
})

describe('⚖ 9/16 — no swipe on 日 (Liam 15:4x): the 日 page is a list, not a track', () => {
  it('day renders no slide track at all — the gesture has nothing to bind to', () => {
    const { container } = renderView('day')
    expect(container.querySelector('[data-slide-box]')).toBeNull()
  })

  it('day, dx -60 (a fast flick, the same speed that commits on week/month) never calls navigateTo', async () => {
    const { container } = renderView('day')
    // `[data-pending-dim]` is inside `viewBody`, so it sits INSIDE the track
    // when a mutant re-wraps 日 in `data-slide-box` — the same flick that
    // commits on week/month would then commit here too.
    const el = container.querySelector('[data-pending-dim]')!
    const id = 9
    pointer('pointerdown', el, { pointerId: id, clientX: 300, clientY: 200, timeStamp: 1000 })
    pointer('pointermove', el, { pointerId: id, clientX: 240, clientY: 201, timeStamp: 1001 })
    pointer('pointerup', el, { pointerId: id, clientX: 240, clientY: 201, timeStamp: 1001 })
    await frames(3000)
    expect(push).not.toHaveBeenCalled()
  })

  it('a vertical drag on 日 scrolls normally — no pointer-capture, no preventDefault path exists', async () => {
    const { container } = renderView('day')
    const el = container.querySelector('[data-pending-dim]')!
    const id = 10
    pointer('pointerdown', el, { pointerId: id, clientX: 300, clientY: 200, timeStamp: 2000 })
    pointer('pointermove', el, { pointerId: id, clientX: 302, clientY: 340, timeStamp: 2016 })
    pointer('pointerup', el, { pointerId: id, clientX: 302, clientY: 340, timeStamp: 2016 })
    await frames(3000)
    expect(push).not.toHaveBeenCalled()
  })
})

describe('the page is not taken away from a finger that meant to scroll', () => {
  it('a vertical intent never navigates, however far it later drifts sideways', async () => {
    renderView('week')
    const el = box()
    pointer('pointerdown', el, { pointerId: 2, clientX: 300, clientY: 200 })
    pointer('pointermove', el, { pointerId: 2, clientX: 302, clientY: 260 })
    pointer('pointermove', el, { pointerId: 2, clientX: 60, clientY: 262 })
    pointer('pointerup', el, { pointerId: 2, clientX: 60, clientY: 262 })
    await frames(3000)
    expect(push).not.toHaveBeenCalled()
  })

  it('the track yields vertical gestures to the page by CSS, not by JS', () => {
    renderView('week')
    // `touch-pan-y` is what makes the browser scroll the list without ever
    // asking us — a JS guard alone runs after the browser has already decided.
    expect(box().firstElementChild!.className).toContain('touch-pan-y')
    // …and the shell's own tab swipe is told to keep its hands off (the walk
    // in thin/gestures.ts looks for exactly this attribute).
    expect(box().hasAttribute('data-gesture-inert')).toBe(true)
  })

  it('a drag SHORT of the commit rule puts the page back where it was', async () => {
    renderView('week')
    const el = box()
    pointer('pointerdown', el, { pointerId: 3, clientX: 300, clientY: 200 })
    pointer('pointermove', el, { pointerId: 3, clientX: 288, clientY: 201 })
    await frames(200) // a pause on the glass — the release reads no speed
    pointer('pointermove', el, { pointerId: 3, clientX: 288, clientY: 201 })
    pointer('pointerup', el, { pointerId: 3, clientX: 288, clientY: 201 })
    await frames(3000)
    expect(push).not.toHaveBeenCalled()
  })
})

describe('the pane travelling in', () => {
  it('is not drawn at all until a finger asks for it', () => {
    renderView('week')
    // One week on screen, and nothing else paying for itself.
    expect(document.querySelectorAll('[data-week-row]')).toHaveLength(1)
  })

  it('carries the NEIGHBOUR week’s own dates, with no numbers on them', async () => {
    renderView('week')
    pointer('pointerdown', box(), { pointerId: 4, clientX: 300, clientY: 200 })
    await act(async () => {})
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-week-row]'))
    // The week on screen, plus a full seven days either side.
    expect(rows.length).toBe(1 + 7 + 7)
    const panes = Array.from(box().firstElementChild!.children).filter((el) =>
      el.className.includes('absolute'),
    )
    for (const pane of panes) {
      // Seven real dates…
      expect(pane.querySelectorAll('[data-week-row]')).toHaveLength(7)
      // …and every number on them is a shimmer, never a stale one and never a
      // 0 standing in for "we have not read this yet".
      expect(pane.querySelectorAll('.reservation-shim').length).toBeGreaterThanOrEqual(7)
    }
    // …while the pane ON SCREEN shows its real numbers and no shimmer at all,
    // which is the contrast that makes the travelling pane readable as "not
    // read yet" rather than as "a week with nothing in it".
    const current = Array.from(box().firstElementChild!.children).find(
      (el) => !el.className.includes('absolute'),
    )!
    expect(current.querySelectorAll('.reservation-shim')).toHaveLength(0)
  })

  it('is out of the tab order and out of the a11y tree while it waits', async () => {
    renderView('week')
    pointer('pointerdown', box(), { pointerId: 5, clientX: 300, clientY: 200 })
    await act(async () => {})
    const panes = Array.from(box().firstElementChild!.children).filter((el) =>
      el.className.includes('absolute'),
    )
    expect(panes).toHaveLength(2)
    for (const pane of panes) {
      expect(pane.hasAttribute('inert')).toBe(true)
      expect(pane.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

describe('⚖ 「11件 予約」 — the count says its word like its three neighbours (S6)', () => {
  it('through the SAME element, with the same classes as the 新規 cell’s word', () => {
    renderView('day')
    const line = document.querySelector('[data-day-line]')!
    const items = Array.from(line.children) as HTMLElement[]
    expect(items).toHaveLength(4)
    // `useTranslations` is stubbed to echo its key here, so the SHIPPED text
    // (「11件 予約」 / "11 Bookings") is pinned against the real ja.json/en.json
    // in appointments-numbers-real-messages.test.tsx. What this line proves is
    // that the count now HAS a word at all, where it used to have none.
    expect(items[0].textContent).toBe('countValuecount')
    expect(items[1].textContent).toBe('5new')
    // The WORD is the wrapper's own styling, and the wrapper is one element for
    // every cell — so 予約 cannot be a different size, weight or grey from 新規.
    const [count, isNew] = items
    expect(count.className).toBe(isNew.className)
    expect(count.className).toContain('gap-1')
    expect(count.className).toContain('font-medium')
    expect(count.className).toContain('text-zinc-500')
    // …and the VALUE is the same 13/600 tabular in both.
    expect(count.querySelector('b')!.className).toContain('font-semibold')
    expect(count.querySelector('b')!.className).toContain('tabular-nums')
  })
})
