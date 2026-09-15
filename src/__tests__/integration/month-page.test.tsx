/**
 * @jest-environment jsdom
 *
 * Render coverage for MonthPage.tsx (spec §4, packet PKT-1b-month A1-A3) —
 * the app-local 月 grid + month line that replace @synqed-kk/ui's MonthGrid on
 * the page. The three things the package could not do are the three things
 * most of these tests are about: a SELECTED day, a 休 cell, and day numbers
 * that survive a UTC runtime (this file runs under TZ=UTC in CI).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import type { MonthCell } from '@/lib/adapters/reservation'

const WEEK_ROWS: Record<string, string> = {
  sep: '·',
  count: '予約',
  new: '新規',
  returning: '再来',
  closed: '休',
  countValue: '{n}件',
  failed: '予約状況を取得できませんでした。もう一度お試しください。',
  rowAria: '{date} {cells}',
}
const MONTH: Record<string, string> = {
  legendLight: '少なめ',
  legendMedium: '普通',
  legendBusy: '混雑',
}
const DATE_JUMP: Record<string, string> = { legendCount: '数字＝その日の予約件数' }

const DICTS: Record<string, Record<string, string>> = {
  'reservation.weekRows': WEEK_ROWS,
  'reservation.month': MONTH,
  'reservation.dateJump': DATE_JUMP,
}

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) =>
    (key: string, values?: Record<string, string | number>) => {
      let s = DICTS[ns]?.[key] ?? key
      if (values) for (const [k, v] of Object.entries(values)) s = s.split(`{${k}}`).join(String(v))
      return s
    },
}))

function loadMonthPage(switchOverrides: Partial<Record<string, boolean>> = {}) {
  jest.resetModules()
  jest.doMock('@/lib/appointments/booking-switches', () => {
    const actual = jest.requireActual('@/lib/appointments/booking-switches') as {
      BOOKING_SWITCHES: Record<string, boolean>
    }
    return { BOOKING_SWITCHES: { ...actual.BOOKING_SWITCHES, ...switchOverrides } }
  })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/components/appointments/MonthPage') as typeof import('@/components/appointments/MonthPage')
}

afterEach(() => {
  jest.dontMock('@/lib/appointments/booking-switches')
  jest.resetModules()
})

function cell(id: string, over: Partial<MonthCell> = {}): MonthCell {
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

/** A real grid: leading/trailing out-of-month fillers + every day of `month`. */
function monthCells(year: number, month: number, over: Record<string, Partial<MonthCell>> = {}) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const first = new Date(Date.UTC(year, month - 1, 1))
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // Mon-first lead, exactly as the adapter builds it.
  const lead = (first.getUTCDay() + 6) % 7
  const last = new Date(Date.UTC(year, month - 1, daysIn))
  const trail = 6 - ((last.getUTCDay() + 6) % 7)
  const out: MonthCell[] = []
  for (let i = lead; i > 0; i -= 1) {
    const d = new Date(Date.UTC(year, month - 1, 1 - i))
    out.push(
      cell(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, {
        inMonth: false,
      }),
    )
  }
  for (let d = 1; d <= daysIn; d += 1) {
    const id = `${year}-${pad(month)}-${pad(d)}`
    out.push(cell(id, over[id]))
  }
  for (let i = 1; i <= trail; i += 1) {
    const d = new Date(Date.UTC(year, month - 1, daysIn + i))
    out.push(
      cell(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, {
        inMonth: false,
      }),
    )
  }
  return out
}

const WEEKDAYS: [string, string, string, string, string, string, string] = [
  '月',
  '火',
  '水',
  '木',
  '金',
  '土',
  '日',
]

const baseProps = {
  selectedDateIso: '2026-09-15',
  todayIso: '2026-09-14',
  weekdayLabels: WEEKDAYS,
  typeSlot: 'off' as const,
  locale: 'ja',
  onPickDay: jest.fn(),
}

describe('MonthPage — the grid', () => {
  it('renders 35 cells for a 5-row month and 42 for a 6-row one', () => {
    const { MonthPage } = loadMonthPage()
    // 2026-11 starts on a Sunday and runs 30 days → 6 rows (42).
    const { container, rerender } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 11)} selectedDateIso="2026-11-01" />,
    )
    expect(container.querySelectorAll('[class*="h-[46px]"]')).toHaveLength(42)
    // 2027-03 starts on a MONDAY and runs 31 days → no lead, 5 rows (35).
    rerender(
      <MonthPage {...baseProps} cells={monthCells(2027, 3)} selectedDateIso="2027-03-01" />,
    )
    expect(container.querySelectorAll('[class*="h-[46px]"]')).toHaveLength(35)
  })

  it('only in-month cells are pressable — the fillers are inert', () => {
    const { MonthPage } = loadMonthPage()
    render(<MonthPage {...baseProps} cells={monthCells(2026, 9)} />)
    // September 2026 has 30 days; the leading/trailing fillers render as divs.
    expect(screen.getAllByRole('button')).toHaveLength(30)
  })

  it('prints the JST day number even on a UTC runtime', () => {
    // The package grid reads `cell.date.getDate()` — the RUNTIME's local day,
    // which for a JST-midnight instant under TZ=UTC is the day before. Every
    // number here comes off `cell.id`, which is already the JST day.
    const { MonthPage } = loadMonthPage()
    render(<MonthPage {...baseProps} cells={monthCells(2026, 9)} />)
    const numbers = screen.getAllByRole('button').map((b) => b.querySelector('span')!.textContent)
    // 1..30, in order, with nothing shifted a day back. `toContain('1')` would
    // pass on a shifted 「31」 — measured: that exact mutant survived it.
    expect(numbers).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)))
    expect(screen.getAllByRole('button')[0].getAttribute('aria-label')).toContain('9/1(火)')
  })

  it('a tap hands back that cell s own dateIso', () => {
    const { MonthPage } = loadMonthPage()
    const onPickDay = jest.fn()
    render(<MonthPage {...baseProps} cells={monthCells(2026, 9)} onPickDay={onPickDay} />)
    fireEvent.click(screen.getAllByRole('button')[15])
    expect(onPickDay).toHaveBeenCalledWith('2026-09-16')
  })
})

describe('MonthPage — the two marks never read as one', () => {
  it('today is a solid accent circle; the selected day is a hollow ring', () => {
    const { MonthPage } = loadMonthPage()
    render(
      <MonthPage
        {...baseProps}
        cells={monthCells(2026, 9)}
        todayIso="2026-09-14"
        selectedDateIso="2026-09-20"
      />,
    )
    const buttons = screen.getAllByRole('button')
    const today = buttons[13].querySelector('span')!
    const selected = buttons[19].querySelector('span')!
    expect(today.className).toMatch(/bg-primary/)
    expect(today.className).not.toMatch(/ring-primary/)
    expect(selected.className).toMatch(/ring-primary/)
    // The ring is HOLLOW — a filled ring would read as a second "today".
    expect(selected.className).not.toMatch(/bg-primary/)
  })

  it('the selected day is the one marked aria-current', () => {
    const { MonthPage } = loadMonthPage()
    render(<MonthPage {...baseProps} cells={monthCells(2026, 9)} selectedDateIso="2026-09-20" />)
    const current = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'date')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('aria-label')).toContain('9/20')
  })
})

describe('MonthPage — 休', () => {
  const closedGrid = monthCells(2026, 9, {
    '2026-09-16': { closed: true, count: 0 },
    '2026-09-17': { closed: true, count: 4, density: 'medium' },
  })

  it('a closed day with NOTHING booked shows 休 instead of a count', () => {
    const { MonthPage } = loadMonthPage({ closedDays: true })
    render(<MonthPage {...baseProps} cells={closedGrid} />)
    const cellEl = screen.getAllByRole('button')[15]
    expect(cellEl.textContent).toContain('休')
    expect(cellEl.getAttribute('aria-label')).toBe('9/16(水) 休')
  })

  it('a closed day WITH bookings shows its numbers, never 休 (⚖ lead ruling)', () => {
    const { MonthPage } = loadMonthPage({ closedDays: true })
    render(<MonthPage {...baseProps} cells={closedGrid} />)
    const cellEl = screen.getAllByRole('button')[16]
    expect(cellEl.textContent).not.toContain('休')
    expect(cellEl.textContent).toContain('4')
    expect(cellEl.getAttribute('aria-label')).toBe('9/17(木) 予約 4件')
  })

  it('with the switch OFF no cell says 休 — the count is all it ever shows', () => {
    const { MonthPage } = loadMonthPage({ closedDays: false })
    render(<MonthPage {...baseProps} cells={closedGrid} />)
    expect(screen.queryByText('休')).toBeNull()
  })
})

describe('MonthPage — the legend', () => {
  it('names the three bands and says what the number is, joined by the half-width 「·」', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9)} />)
    const legend = container.querySelector('[data-month-grid] > div:last-child')!
    expect(legend.textContent).toBe('少なめ普通混雑·数字＝その日の予約件数')
    // 「／」 enumerates alternatives in this app; it never joins two clauses
    // (native pass 2 row F).
    expect(legend.textContent).not.toContain('／')
  })
})

describe('MonthPage — the month line', () => {
  it('counts ONLY the days that belong to the month', () => {
    const { MonthPage, monthBookingTotal } = loadMonthPage()
    const cells = monthCells(2026, 9, { '2026-09-15': { count: 3 }, '2026-09-16': { count: 4 } })
    // A filler carrying a count is what the adapter promises never to send —
    // and what this line promises never to print.
    cells[0] = { ...cells[0], count: 99 }
    expect(monthBookingTotal(cells)).toBe(7)
    const { container } = render(<MonthPage {...baseProps} cells={cells} />)
    expect(container.querySelector('[data-month-line]')!.textContent).toBe('予約7件')
  })

  it("typeSlot 'off' renders no 新規/再来 item — never a substitute metric", () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9)} />)
    const line = container.querySelector('[data-month-line]')!
    expect(line.textContent).not.toContain('新規')
    expect(line.textContent).not.toContain('再来')
  })

  it('the type slot prints label-first, with the spark on the number (native pass 2 C-2)', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 9)} typeSlot="new" typeCount={80} />,
    )
    const line = container.querySelector('[data-month-line]')!
    expect(line.textContent).toBe('予約0件新規80')
    expect(line.querySelector('[data-new-spark]')).not.toBeNull()
  })

  it('a type slot with no honest number is ABSENT, not a zero', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 9)} typeSlot="new" typeCount={null} />,
    )
    expect(container.querySelector('[data-month-line]')!.textContent).toBe('予約0件')
  })

  it('mid-transition it shows shims, never the month being navigated away from', () => {
    const { MonthPage } = loadMonthPage()
    const cells = monthCells(2026, 9, { '2026-09-15': { count: 3 } })
    const { container } = render(<MonthPage {...baseProps} cells={cells} pending />)
    const line = container.querySelector('[data-month-line]')!
    expect(line.textContent).toBe('')
    expect(line.querySelectorAll('.reservation-shim')).toHaveLength(2)
  })

  it('with the monthLine switch OFF the line is gone and the grid still stands', () => {
    const { MonthPage } = loadMonthPage({ monthLine: false })
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9)} />)
    expect(container.querySelector('[data-month-line]')).toBeNull()
    expect(container.querySelector('[data-month-grid]')).not.toBeNull()
  })
})

describe('MonthPage — bandTone', () => {
  it('reads the wire density today and a per-store band the day it lands', () => {
    const { bandTone } = loadMonthPage()
    expect(bandTone({ density: 'light' })).toBe('bg-[var(--color-success)]')
    expect(bandTone({ density: 'medium' })).toBe('bg-[var(--color-accent)]')
    expect(bandTone({ density: 'busy' })).toBe('bg-[var(--color-warning)]')
    expect(bandTone({ density: 'empty' })).toBeNull()
    // 1c-B's seam: a per-store band overrides the fixed table, and until it is
    // on the wire `density` is the whole answer.
    expect(bandTone({ density: 'busy', band: 'light' })).toBe('bg-[var(--color-success)]')
  })

  it('is the SAME map the week rows draw their dot from', () => {
    const { bandTone } = loadMonthPage()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { densityDotClass } = require('@/components/appointments/WeekRows') as typeof import('@/components/appointments/WeekRows')
    expect(bandTone({ density: 'light' })).toBe(densityDotClass(1))
    expect(bandTone({ density: 'medium' })).toBe(densityDotClass(4))
    expect(bandTone({ density: 'busy' })).toBe(densityDotClass(9))
    expect(bandTone({ density: 'empty' })).toBe(densityDotClass(0))
  })
})

describe('MonthPage — a failed read says so', () => {
  it('renders the week page s own failed line and NOTHING else', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 9)} failed />,
    )
    expect(screen.getByRole('alert').textContent).toBe(WEEK_ROWS.failed)
    expect(container.querySelector('[data-month-grid]')).toBeNull()
    expect(container.querySelector('[data-month-line]')).toBeNull()
  })
})
