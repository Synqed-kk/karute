/**
 * @jest-environment jsdom
 *
 * Render coverage for SelectedDayCard.tsx (spec §S1, packet PKT-1b-month
 * B2-B4) — the card under the 月 grid that makes 「tap a day」 worth staying
 * for. Its four states (loaded · empty · closed · pending) are the whole
 * point: an empty day and a day whose read has not landed must never look
 * alike, and a closed day must not offer a door into nothing.
 */
import { act, render, screen, fireEvent } from '@testing-library/react'
import { capacityRowFields, type WeekDayRowData } from '@/lib/adapters/reservation'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { formatCompactDateJst, jstWallTimeToDate } from '@/lib/date/jst'
import ja from '../../../messages/ja.json'

// The three NEW strings are read out of the shipped dictionary, not retyped —
// the wording is the thing under test (native pass 2 row D-3 killed the mock's
// 「+N 他」), so a silent edit to ja.json has to turn this file red.
const WEEK_ROWS = ja.reservation.weekRows as unknown as Record<string, string>
const CARD = ja.reservation.card as unknown as Record<string, string>
const STATUS = ja.reservation.status as unknown as Record<string, string>

const DICTS: Record<string, Record<string, string>> = {
  'reservation.weekRows': WEEK_ROWS,
  'reservation.card': CARD,
  'reservation.status': STATUS,
}

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) =>
    (key: string, values?: Record<string, string | number>) => {
      let s = DICTS[ns]?.[key] ?? key
      if (values) for (const [k, v] of Object.entries(values)) s = s.split(`{${k}}`).join(String(v))
      return s
    },
}))

import { SelectedDayCard } from '@/components/appointments/SelectedDayCard'

function row(over: Partial<WeekDayRowData> = {}): WeekDayRowData {
  return {
    dateNumber: 16,
    monthNumber: 9,
    weekdayLabel: '水',
    isToday: false,
    count: 6,
    bookedMinutes: 180,
    availableMinutes: 480,
    newCustomerCount: 0,
    remindersPending: 0,
    consentPending: 0,
    unconfirmed: 0,
    visibleBookings: [],
    hiddenCount: 0,
    dateIso: '2026-09-16',
    capacityDefensible: false,
    hoursSaved: false,
    closed: false,
    cancelledCount: 0,
    noShowDayCount: 0,
    returningCount: 0,
    // The nine capacity-model fields for a day with no capacity — the same
    // no-capacity defaults `capacityDefensible: false` above already means.
    ...capacityRowFields(undefined),
    ...over,
  }
}

/** Booking fixtures, not a real store: this tenant has few bookings and no
 *  saved hours, so a 6+ booking day and a 休 day both come from here. */
function booking(n: number, over: Partial<ReservationView> = {}): ReservationView {
  return {
    id: `appt-${n}`,
    staffId: 'staff-1',
    staffName: 'スタッフ',
    startTimeHm: `${String(9 + n).padStart(2, '0')}:00`,
    durationMin: 60,
    customerName: `テスト${n}`,
    customerInitials: 'テ',
    karuteNumber: null,
    service: '',
    displayStatus: 'booked',
    isCancelled: false,
    isNoShow: false,
    statusReason: null,
    statusSetByName: null,
    statusSetAt: null,
    staffColorKey: 'neutral',
    clientId: `client-${n}`,
    karuteRecordId: null,
    isFirstTimeVisit: false,
    pack: null,
    needsRenewal: false,
    noShowCount: 0,
    ...over,
  } as ReservationView
}

function cardEl(over: Partial<Parameters<typeof SelectedDayCard>[0]> = {}) {
  return (
    <SelectedDayCard
      dateIso="2026-09-16"
      rows={[]}
      dayTotals={row()}
      soloMode={false}
      locale="ja"
      onOpenDay={jest.fn()}
      {...over}
    />
  )
}

function renderCard(over: Partial<Parameters<typeof SelectedDayCard>[0]> = {}) {
  return render(cardEl(over))
}

/** The card's own fade window (SelectedDayCard's FADE_MS / the mock's 120 ms). */
const FADE_MS = 120

/** jsdom ships no matchMedia at all, which is the NOT-reduced answer the card
 *  reads through `?.`; this is the other one. */
function reduceMotion(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: on,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

const rowsOf = (c: HTMLElement) => c.querySelectorAll('[data-selected-day-card] > * > .relative')

describe('the loaded day', () => {
  it('shows the first FIVE bookings by time and counts the rest into 他N件', () => {
    const { container } = renderCard({
      rows: [7, 3, 1, 5, 2, 6, 4].map((n) => booking(n)),
    })
    // Sorted by start time, capped at five — the day page's own order.
    expect(screen.getByText('テスト1')).toBeTruthy()
    expect(screen.getByText('テスト5')).toBeTruthy()
    expect(screen.queryByText('テスト6')).toBeNull()
    expect(rowsOf(container)).toHaveLength(5)
    // 「他2件」 — the app's own pattern, never the mock's dead 「+2 他」.
    expect(screen.getByText('他2件')).toBeTruthy()
    expect(screen.queryByText(/\+2/)).toBeNull()
  })

  it('shows no 他N件 at exactly five', () => {
    renderCard({ rows: [1, 2, 3, 4, 5].map((n) => booking(n)) })
    expect(screen.queryByText(/^他/)).toBeNull()
  })

  it('renders the DAY LIST s own compact row — time · avatar · name 様 · tag', () => {
    const { container } = renderCard({ rows: [booking(1, { displayStatus: 'new' })] })
    const r = rowsOf(container)[0]
    expect(r.className).toContain('px-4')
    expect(r.textContent).toContain('10:00')
    expect(r.textContent).toContain('テスト1')
    expect(r.textContent).toContain('様')
    // Exceptions only: 新規 prints, 予約済 does not.
    expect(r.textContent).toContain(STATUS.new)
    // No 担当 line, no menu line, no duration — the compact variant.
    expect(r.textContent).not.toContain('担当')
    expect(r.textContent).not.toContain('60分')
  })

  // R1-3 (LENS-1 #3) — the card is the SUMMARY of the 予約N件 beside it, so its
  // rows are that number's rows. The day page stays the ledger and keeps
  // drawing tombstones; here a cancellation is simply not one of the five.
  it('counts the SAME set as 予約N件 — cancelled and no-show rows are not in the five', () => {
    const { container } = renderCard({
      rows: [
        booking(1),
        booking(2, { isCancelled: true, displayStatus: 'completed' }),
        booking(3),
        booking(4, { isNoShow: true, displayStatus: 'completed' }),
        booking(5, { isCancelled: true, displayStatus: 'completed' }),
        booking(6, { isCancelled: true, displayStatus: 'completed' }),
        booking(7),
      ],
      dayTotals: row({ count: 3, cancelledCount: 3, noShowDayCount: 1 }),
    })
    expect(rowsOf(container)).toHaveLength(3)
    expect(screen.getByText('テスト1')).toBeTruthy()
    expect(screen.getByText('テスト3')).toBeTruthy()
    expect(screen.getByText('テスト7')).toBeTruthy()
    expect(screen.queryByText('テスト2')).toBeNull()
    expect(screen.queryByText(CARD.cancelled)).toBeNull()
    expect(screen.queryByText(CARD.noShow)).toBeNull()
    // three shown out of three counted — 「3件 … 他N件」 can no longer disagree.
    expect(screen.queryByText(/^他/)).toBeNull()
  })

  it('a day whose bookings were ALL cancelled is an empty day, not five tombstones under 0件', () => {
    const { container } = renderCard({
      rows: [1, 2, 3, 4, 5, 6].map((n) =>
        booking(n, { isCancelled: true, displayStatus: 'completed' }),
      ),
      dayTotals: row({ count: 0, cancelledCount: 6 }),
    })
    expect(rowsOf(container)).toHaveLength(0)
    expect(screen.queryByText(/^他/)).toBeNull()
    expect(screen.getByText(WEEK_ROWS.noBookings)).toBeTruthy()
    expect(screen.getByText(WEEK_ROWS.openDay)).toBeTruthy()
  })

  it('他N件 counts only past the counted rows — six bookings + four tombstones', () => {
    renderCard({
      rows: [
        ...[1, 2, 3, 4, 5, 6].map((n) => booking(n)),
        ...[7, 8, 9].map((n) => booking(n, { isCancelled: true, displayStatus: 'completed' })),
        booking(10, { isNoShow: true, displayStatus: 'completed' }),
      ],
      dayTotals: row({ count: 6, cancelledCount: 3, noShowDayCount: 1 }),
    })
    expect(screen.getByText('他1件')).toBeTruthy()
  })

  it('has NO date header — the chip already names the day (§v11b)', () => {
    const { container } = renderCard({ rows: [booking(1)] })
    expect(container.textContent).not.toContain('9/16')
    expect(container.textContent).not.toContain('2026')
  })

  // R1-4 (LENS-1 #4) — no date header means nothing on screen names the region
  // a tap several hundred pixels above just swapped, and 「この日を開く →」 has
  // no antecedent. The NAME carries the date instead, from the chip's formatter.
  it('is a NAMED region — the compact JST date, the same formatter the chip uses', () => {
    const { container } = renderCard({ rows: [booking(1)] })
    const card = container.querySelector('[data-selected-day-card]')!
    expect(card.getAttribute('role')).toBe('region')
    const name = card.getAttribute('aria-label')!
    expect(name).toBe(formatCompactDateJst(jstWallTimeToDate('2026-09-16', '00:00'), 'ja'))
    // …and it really is the day, not a formatter that quietly returns nothing.
    expect(name).toContain('16')
    // The name is spoken, never printed — §v11b holds.
    expect(card.textContent).not.toContain(name)
  })

  it('the name follows the day the card describes', () => {
    const { container } = renderCard({ dateIso: '2026-08-20', rows: [booking(1)] })
    expect(container.querySelector('[data-selected-day-card]')!.getAttribute('aria-label')).toBe(
      formatCompactDateJst(jstWallTimeToDate('2026-08-20', '00:00'), 'ja'),
    )
  })

  // R1-5 (LENS-1 #6) — DayNumbersLine renders NOTHING when it has no row and is
  // not pending (a phone on a bundle older than the dayTotals DTO field — the
  // case its own prop comment names). The top breathing room belongs to the
  // card, so it survives that.
  it('keeps its top padding when the day line renders nothing at all', () => {
    const { container } = renderCard({ rows: [booking(1)], dayTotals: null })
    const card = container.querySelector('[data-selected-day-card]')!
    expect(container.querySelector('[data-day-line]')).toBeNull()
    expect(card.className).toContain('pt-3')
    // the line no longer carries it — one owner, not two
    expect(rowsOf(container)).toHaveLength(1)
  })

  it('the door opens THIS day', () => {
    const onOpenDay = jest.fn()
    renderCard({ rows: [booking(1)], onOpenDay })
    fireEvent.click(screen.getByText(WEEK_ROWS.openDay))
    expect(onOpenDay).toHaveBeenCalledWith('2026-09-16')
  })

  it('the door is a wash, never a black or solid fill (R13)', () => {
    renderCard({ rows: [booking(1)] })
    const door = screen.getByText(WEEK_ROWS.openDay)
    expect(door.className).toContain('bg-primary/8')
    expect(door.className).toContain('text-primary')
    expect(door.className).toContain('h-11')
    // The mock's control radius is 12 (`--r-ctl`), and the app's own
    // `rounded-xl` measures 14 in this theme — so the door names 12 outright.
    expect(door.className).toContain('rounded-[12px]')
    expect(door.className).not.toContain('bg-foreground')
  })
})

describe('the empty day', () => {
  it('SAYS it is empty and still offers its door — an empty day is where a booking gets made', () => {
    const { container } = renderCard({ rows: [], dayTotals: row({ count: 0 }) })
    expect(screen.getByText(WEEK_ROWS.noBookings)).toBeTruthy()
    expect(screen.getByText(WEEK_ROWS.openDay)).toBeTruthy()
    expect(rowsOf(container)).toHaveLength(0)
  })
})

describe('the closed day', () => {
  it('shows 0件 休 and stops — no rows, no door', () => {
    const { container } = renderCard({
      rows: [booking(1)],
      dayTotals: row({ closed: true, count: 0 }),
    })
    const line = container.querySelector('[data-day-line]')!
    expect(line.textContent).toContain('0件')
    expect(line.textContent).toContain(WEEK_ROWS.closed)
    expect(rowsOf(container)).toHaveLength(0)
    expect(screen.queryByText(WEEK_ROWS.openDay)).toBeNull()
    expect(screen.queryByText(WEEK_ROWS.noBookings)).toBeNull()
  })

  it('a closed day WITH bookings is an open day here (⚖ lead ruling, spec §8)', () => {
    renderCard({ rows: [booking(1)], dayTotals: row({ closed: true, count: 1 }) })
    expect(screen.getByText('テスト1')).toBeTruthy()
    expect(screen.getByText(WEEK_ROWS.openDay)).toBeTruthy()
  })
})

describe('pending', () => {
  it('shows the two shims and nothing readable — never the old day s numbers', () => {
    const { container } = renderCard({ rows: [booking(1)], pending: true })
    const line = container.querySelector('[data-day-line]')!
    expect(line.querySelectorAll('.reservation-shim')).toHaveLength(2)
    expect(line.textContent).not.toContain('件')
  })

  // R1-2 (LENS-1 #2/#5, LENS-3 #2) — spec §4's 「pending → two shimmers,
  // nothing else」 is about the DOM. The first port kept the previous day's
  // rows, 他N件 and the door mounted and relied on the wrapper's opacity, which
  // hides nothing: Reduce Motion keeps the wrapper lit, and an invisible door
  // is still focusable, still tappable and still opens the day being left.
  it('renders NO row, no 他N件, no sentence and NO DOOR — absent, not transparent', () => {
    const { container } = renderCard({
      rows: [1, 2, 3, 4, 5, 6].map((n) => booking(n)),
      pending: true,
    })
    expect(rowsOf(container)).toHaveLength(0)
    expect(screen.queryByText('テスト1')).toBeNull()
    expect(screen.queryByText(/^他/)).toBeNull()
    expect(screen.queryByText(WEEK_ROWS.noBookings)).toBeNull()
    expect(screen.queryByText(WEEK_ROWS.openDay)).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(0)
    // …and the two shims are the whole of what is left.
    expect(
      container.querySelector('[data-day-line]')!.querySelectorAll('.reservation-shim'),
    ).toHaveLength(2)
  })

  it('an empty day mid-move is not read as an empty day — no sentence, no door', () => {
    renderCard({ rows: [], dayTotals: row({ count: 0 }), pending: true })
    expect(screen.queryByText(WEEK_ROWS.noBookings)).toBeNull()
    expect(screen.queryByText(WEEK_ROWS.openDay)).toBeNull()
  })

  it('a CLOSED day mid-move shows the shims, not 休 — the answer has not arrived', () => {
    const { container } = renderCard({
      rows: [booking(1)],
      dayTotals: row({ closed: true, count: 0 }),
      pending: true,
    })
    const line = container.querySelector('[data-day-line]')!
    expect(line.querySelectorAll('.reservation-shim')).toHaveLength(2)
    expect(line.textContent).not.toContain(WEEK_ROWS.closed)
  })
})

describe('MOTION (B3 · R1-6) — the mock s .selfade, driven by the TAP', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    act(() => void jest.runOnlyPendingTimers())
    jest.useRealTimers()
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('fades on OPACITY alone, 120ms, the mock s own curve', () => {
    const { container } = renderCard({ rows: [booking(1)] })
    const fade = container.querySelector('[data-sel-fade]')!
    expect(fade.className).toContain('transition-opacity')
    expect(fade.className).toContain('duration-[120ms]')
    expect(fade.className).toContain('ease-[ease]')
    expect(fade.className).toContain('opacity-100')
    // No transform, no height, no layout property on the hot path.
    expect(fade.className).not.toContain('transition-all')
    expect(fade.className).not.toContain('scale')
  })

  it('reduced motion swaps INSTANTLY — the mock s REDUCE branch', () => {
    const { container } = renderCard({ rows: [booking(1)] })
    expect(container.querySelector('[data-sel-fade]')!.className).toContain(
      'motion-reduce:transition-none',
    )
    const door = screen.getByText(WEEK_ROWS.openDay)
    expect(door.className).toContain('motion-reduce:transition-none')
    expect(door.className).toContain('motion-reduce:active:scale-100')
  })

  it('reduced motion never BLANKS the card — the mock never touches its opacity there', () => {
    // The mock's REDUCE branch swaps the content and leaves the card lit.
    // Dropping the transition alone would still take it to opacity 0, which is
    // a panel blinking out — exactly what the setting exists to prevent.
    const { container } = renderCard({ rows: [booking(1)], pending: true })
    const fade = container.querySelector('[data-sel-fade]')!
    expect(fade.className).toContain('motion-reduce:opacity-100')
    // …and what they see is the pending state, not the day being left.
    expect(container.querySelector('[data-day-line]')!.querySelectorAll('.reservation-shim')).toHaveLength(2)
    expect(screen.queryByText('テスト1')).toBeNull()
  })

  // R1-6a/b (LENS-3 #1 + #2) — the fade belongs to the TAP. It used to be
  // `pending ? opacity-0 : opacity-100`, i.e. bound to the network: a warm tap
  // (router cache, ~22 ms) never stayed pending long enough for the transition
  // to start and hard-cut at opacity 1, while a cold one held an empty bordered
  // box for the whole round trip with the shims rendered inside the thing the
  // same flag had faded to zero. One gesture, three motions.
  it('a WARM tap plays the WHOLE sequence — 0, the swap behind it, then 1', () => {
    const view = renderCard({ dateIso: '2026-09-16', rows: [booking(1)] })
    const fade = () => view.container.querySelector('[data-sel-fade]')!
    expect(fade().className).toContain('opacity-100')

    // the tap: the card's day moves before any answer exists
    view.rerender(cardEl({ dateIso: '2026-09-17', rows: [booking(1)], pending: true }))
    expect(fade().className).toContain('opacity-0')

    // the router cache answers in 22 ms — far inside the window, which neither
    // ends early nor swaps early
    act(() => void jest.advanceTimersByTime(22))
    view.rerender(cardEl({ dateIso: '2026-09-17', rows: [booking(9)] }))
    expect(fade().className).toContain('opacity-0')
    expect(screen.queryByText('テスト9')).toBeNull()
    expect(screen.getByText('テスト1')).toBeTruthy()

    // …and only at the end of it does the content change and come back
    act(() => void jest.advanceTimersByTime(FADE_MS))
    expect(fade().className).toContain('opacity-100')
    expect(screen.getByText('テスト9')).toBeTruthy()
    expect(screen.queryByText('テスト1')).toBeNull()
  })

  it('a COLD tap is LIT with the two shims after the window — never an empty box', () => {
    const view = renderCard({ dateIso: '2026-09-16', rows: [booking(1)] })
    const fade = () => view.container.querySelector('[data-sel-fade]')!
    view.rerender(cardEl({ dateIso: '2026-09-17', rows: [booking(1)], pending: true }))

    act(() => void jest.advanceTimersByTime(200))
    // t = 200 ms, the answer is still out there
    expect(fade().className).toContain('opacity-100')
    expect(
      view.container.querySelector('[data-day-line]')!.querySelectorAll('.reservation-shim'),
    ).toHaveLength(2)
    expect(screen.queryByText('テスト1')).toBeNull()
    expect(screen.queryByText(WEEK_ROWS.openDay)).toBeNull()

    // the answer lands at 800 ms — the shims fade out, the day fades in
    act(() => void jest.advanceTimersByTime(600))
    view.rerender(cardEl({ dateIso: '2026-09-17', rows: [booking(9)] }))
    expect(fade().className).toContain('opacity-0')
    act(() => void jest.advanceTimersByTime(FADE_MS))
    expect(fade().className).toContain('opacity-100')
    expect(screen.getByText('テスト9')).toBeTruthy()
  })

  // R1-6d (Greptile round 1, FIX-932-G1) — a CANCELLED fade: the props flip
  // back to the SAME dateIso inside the window (a 今日 press, or a re-tap of
  // the selected day, answered from the router cache well before 120 ms) —
  // the swap the window opened for never happens, and the card must not be
  // left dark and inert until some unrelated later swap comes along.
  it('a cancelled fade does not leave the card stuck invisible', () => {
    const view = renderCard({ dateIso: '2026-09-16', rows: [booking(1)], pending: false })
    const fade = () => view.container.querySelector('[data-sel-fade]')!
    expect(fade().className).toContain('opacity-100')

    // the tap: pending flips true, the window opens
    view.rerender(cardEl({ dateIso: '2026-09-16', rows: [booking(1)], pending: true }))
    expect(fade().className).toContain('opacity-0')

    // the answer lands INSIDE the window, well before 120ms, with the SAME
    // dateIso and pending back to false — the day never actually moved.
    act(() => void jest.advanceTimersByTime(30))
    view.rerender(cardEl({ dateIso: '2026-09-16', rows: [booking(1)], pending: false }))

    expect(fade().className).toContain('opacity-100')
    expect(fade().hasAttribute('inert')).toBe(false)
    expect(screen.getByText('テスト1')).toBeTruthy()
  })

  it('the invisible half of the window is INERT — no Tab into an outgoing door', () => {
    const view = renderCard({ dateIso: '2026-09-16', rows: [booking(1)] })
    const fade = () => view.container.querySelector('[data-sel-fade]')!
    expect(fade().hasAttribute('inert')).toBe(false)
    view.rerender(cardEl({ dateIso: '2026-09-17', rows: [booking(1)], pending: true }))
    expect(fade().hasAttribute('inert')).toBe(true)
    act(() => void jest.advanceTimersByTime(FADE_MS))
    expect(fade().hasAttribute('inert')).toBe(false)
  })

  it('a same-day refresh just lands — new rows, no window, no flicker', () => {
    const view = renderCard({ dateIso: '2026-09-16', rows: [booking(1)] })
    view.rerender(cardEl({ dateIso: '2026-09-16', rows: [booking(1), booking(2)] }))
    expect(view.container.querySelector('[data-sel-fade]')!.className).toContain('opacity-100')
    expect(screen.getByText('テスト2')).toBeTruthy()
  })

  it('under REDUCE the swap is instant — no window, no dark card, no stale day', () => {
    reduceMotion(true)
    const view = renderCard({ dateIso: '2026-09-16', rows: [booking(1)] })
    view.rerender(cardEl({ dateIso: '2026-09-17', rows: [booking(1)], pending: true }))
    // no timer ran: the shims are already there and the card never went to 0
    expect(view.container.querySelector('[data-sel-fade]')!.className).toContain('opacity-100')
    expect(
      view.container.querySelector('[data-day-line]')!.querySelectorAll('.reservation-shim'),
    ).toHaveLength(2)
    expect(screen.queryByText('テスト1')).toBeNull()
  })

  it('the door press is the app s own press — one property, the app s curve', () => {
    renderCard({ rows: [booking(1)] })
    const door = screen.getByText(WEEK_ROWS.openDay)
    expect(door.className).toContain('transition-[scale]')
    expect(door.className).toContain('duration-100')
    expect(door.className).toContain('ease-[cubic-bezier(0.23,1,0.32,1)]')
    expect(door.className).toContain('active:scale-[0.97]')
  })
})
