/**
 * @jest-environment jsdom
 *
 * Render coverage for SelectedDayCard.tsx (spec §S1, packet PKT-1b-month
 * B2-B4) — the card under the 月 grid that makes 「tap a day」 worth staying
 * for. Its four states (loaded · empty · closed · pending) are the whole
 * point: an empty day and a day whose read has not landed must never look
 * alike, and a closed day must not offer a door into nothing.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import type { ReservationView } from '@/lib/adapters/reservation-view'
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

function renderCard(over: Partial<Parameters<typeof SelectedDayCard>[0]> = {}) {
  return render(
    <SelectedDayCard
      dateIso="2026-09-16"
      rows={[]}
      dayTotals={row()}
      soloMode={false}
      locale="ja"
      onOpenDay={jest.fn()}
      {...over}
    />,
  )
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

  it('a cancelled booking keeps its slot and says so', () => {
    renderCard({ rows: [booking(1, { isCancelled: true, displayStatus: 'completed' })] })
    expect(screen.getByText(CARD.cancelled)).toBeTruthy()
  })

  it('has NO date header — the chip already names the day (§v11b)', () => {
    const { container } = renderCard({ rows: [booking(1)] })
    expect(container.textContent).not.toContain('9/16')
    expect(container.textContent).not.toContain('2026')
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
    expect(door.className).toContain('rounded-xl')
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
    // The whole card's content is faded OUT while the answer is in flight.
    expect(container.querySelector('[data-sel-fade]')!.className).toContain('opacity-0')
  })
})

describe('MOTION (B3) — the mock s .selfade, one property, reduced motion instant', () => {
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
    expect(fade.className).toContain('opacity-0')
    expect(fade.className).toContain('motion-reduce:opacity-100')
    // …and what they see under it is the pending state, not the day's numbers.
    expect(container.querySelector('[data-day-line]')!.querySelectorAll('.reservation-shim')).toHaveLength(2)
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
