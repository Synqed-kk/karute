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
import { weekStartFor, weekendTone, type WeekStart } from '@/lib/date/week-start'
import type { MonthCell } from '@/lib/adapters/reservation'

// The two strings the 先月同期間比 clause is MADE of come from the REAL message
// file, never a hand copy: a hand copy cannot notice the day the app's own
// wording moves, and the production render path is the only place the width
// was ever measured.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JA_WEEK_ROWS = (require('../../../messages/ja.json') as {
  reservation: { weekRows: Record<string, string> }
}).reservation.weekRows
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EN_WEEK_ROWS = (require('../../../messages/en.json') as {
  reservation: { weekRows: Record<string, string> }
}).reservation.weekRows

const WEEK_ROWS: Record<string, string> = {
  sep: '·',
  count: '予約',
  new: '新規',
  returning: '再来',
  closed: '休',
  ariaSep: '、',
  lastMonthSamePeriod: JA_WEEK_ROWS.lastMonthSamePeriod,
  countValue: JA_WEEK_ROWS.countValue,
  countLine: JA_WEEK_ROWS.countLine,
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
      // A splice is the RIGHT stub here, proven rather than assumed: ICU prints
      // a BARE `{n}` with String(value) and groups only a typed `{n, number}`
      // — checked against intl-messageformat itself and against the production
      // build, which renders 「+1234件」 (see the four-digit case below).
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

/** The line as a SIGHTED reader sees it. `sr-only` nodes exist for assistive
 *  tech and are out of flow, so they must never move a pixel: every visible
 *  assertion below reads through this, and the separators they add are
 *  asserted separately on the raw `textContent`. */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  for (const node of Array.from(clone.querySelectorAll('.sr-only'))) node.remove()
  return clone.textContent ?? ''
}

/** A real grid: leading/trailing out-of-month fillers + every day of `month`. */
function monthCells(year: number, month: number, weekStart: WeekStart, over: Record<string, Partial<MonthCell>> = {}) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const first = new Date(Date.UTC(year, month - 1, 1))
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // Locale-ordered padding, exactly as the adapter builds it.
  const lead = (first.getUTCDay() - weekStart + 7) % 7
  const last = new Date(Date.UTC(year, month - 1, daysIn))
  const trail = 6 - ((last.getUTCDay() - weekStart + 7) % 7)
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

const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat('ja', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 7 + weekStartFor('ja') + i)),
  ),
) as [string, string, string, string, string, string, string]

const baseProps = {
  selectedDateIso: '2026-09-15',
  todayIso: '2026-09-14',
  weekStart: weekStartFor('ja'),
  tone: weekendTone('ja'),
  typeSlot: 'off' as const,
  locale: 'ja',
  onPickDay: jest.fn(),
  onPickOtherMonthDay: jest.fn(),
}

/** The days that BELONG to the rendered month. Since R1-2 the leading and
 *  trailing fillers are buttons too, so 「every button」 is no longer 「every
 *  day of this month」. */
const IN_MONTH = '[data-month-cell]:not([data-out])'

/** Those cells as elements, in calendar order — what 「the 15th button」 meant
 *  before the fillers became buttons too. */
const days = () => Array.from(document.querySelectorAll<HTMLElement>(IN_MONTH))

describe('MonthPage — the grid', () => {
  it('renders 35 cells for a 5-row month and 42 for a 6-row one', () => {
    const { MonthPage } = loadMonthPage()
    // 2026-05 starts on Friday and runs 31 days → 6 Sunday-first rows (42).
    const { container, rerender } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 5, weekStartFor('ja'))} selectedDateIso="2026-05-01" />,
    )
    expect(container.querySelectorAll('[class*="h-[46px]"]')).toHaveLength(42)
    // 2027-03 starts on Monday: one leading Sunday, 5 rows (35).
    rerender(
      <MonthPage {...baseProps} cells={monthCells(2027, 3, weekStartFor('ja'))} selectedDateIso="2027-03-01" />,
    )
    expect(container.querySelectorAll('[class*="h-[46px]"]')).toHaveLength(35)
  })

  // R1-2 (D-1): the mock gives EVERY cell a `data-go` and its handler makes no
  // `out` check (MOCK 976, 1325-1329) — 4a's inert fillers came from the
  // packet's sentence, not the mock. Every cell is a button now; what differs
  // is where it goes.
  it('every cell is pressable — the fillers too', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
    // September 2026 starts on a Tuesday and runs 30 days: 2 leading fillers +
    // 30 days + 3 trailing = 35 cells, all of them buttons.
    expect(screen.getAllByRole('button')).toHaveLength(35)
    expect(container.querySelectorAll(IN_MONTH)).toHaveLength(30)
    expect(container.querySelectorAll('[data-month-cell][data-out]')).toHaveLength(5)
  })

  it('a filler tap MOVES THE MONTH — the other handler, never the day one', () => {
    const { MonthPage } = loadMonthPage()
    const onPickDay = jest.fn()
    const onPickOtherMonthDay = jest.fn()
    const { container } = render(
      <MonthPage
        {...baseProps}
        cells={monthCells(2026, 9, weekStartFor('ja'))}
        onPickDay={onPickDay}
        onPickOtherMonthDay={onPickOtherMonthDay}
      />,
    )
    const fillers = container.querySelectorAll('[data-month-cell][data-out]')
    // The leading filler is August 30; the first trailing one is October 1.
    fireEvent.click(fillers[0])
    fireEvent.click(fillers[2])
    expect(onPickOtherMonthDay.mock.calls).toEqual([['2026-08-30'], ['2026-10-01']])
    expect(onPickDay).not.toHaveBeenCalled()
  })

  it('a filler stays muted, and its NAME carries the month it belongs to', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
    const filler = container.querySelector('[data-month-cell][data-out]')!
    // A date from another month must never read as this month's.
    expect(filler.getAttribute('aria-label')).toBe(`8/30(${WEEKDAYS[0]})`)
    // Muted: the filler's own wash, unchanged by R1-2. The number itself
    // stepped up a notch at R2-3 (LENS-1 #3 / LENS-3 #1): now that the cell
    // is a tappable control its label has to clear 4.5:1 on the muted wash —
    // light zinc-500 (4.66:1), dark zinc-400 (6.91:1; dark zinc-500 alone is
    // still under 4.5:1 on the darker wash).
    expect(filler.getAttribute('class')).toContain('bg-[var(--color-bg-muted)]/40')
    const numberClass = filler.querySelector('span')!.getAttribute('class')!
    expect(numberClass).toContain('text-zinc-500')
    expect(numberClass).toContain('dark:text-zinc-400')
    // And no count, ever — the adapter zeroes an out-of-month cell.
    expect(filler.textContent).toBe('30')
  })

  it('prints the JST day number even on a UTC runtime', () => {
    // The package grid reads `cell.date.getDate()` — the RUNTIME's local day,
    // which for a JST-midnight instant under TZ=UTC is the day before. Every
    // number here comes off `cell.id`, which is already the JST day.
    const { MonthPage } = loadMonthPage()
    render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
    const numbers = days().map((b) => b.querySelector('span')!.textContent)
    // 1..30, in order, with nothing shifted a day back. `toContain('1')` would
    // pass on a shifted 「31」 — measured: that exact mutant survived it.
    expect(numbers).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)))
    expect(days()[0].getAttribute('aria-label')).toContain('9/1(火)')
  })

  it('a tap hands back that cell s own dateIso', () => {
    const { MonthPage } = loadMonthPage()
    const onPickDay = jest.fn()
    render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} onPickDay={onPickDay} />)
    fireEvent.click(days()[15])
    expect(onPickDay).toHaveBeenCalledWith('2026-09-16')
  })

  // R2-6 (LENS-3 #2) — the header row and every cell share the ONE hair token
  // with the week rows (WeekRows.tsx), not the weaker zinc-100 the mock's own
  // pixels disagreed with.
  it('the header row and the cells carry the shared hair token, not zinc-100', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
    const header = container.querySelector('[data-month-grid] > div:first-child')!
    expect(header.className).toContain('border-zinc-200/70')
    expect(header.className).not.toContain('border-zinc-100')
    const firstCell = container.querySelector('[data-month-cell]')!
    expect(firstCell.className).toContain('border-zinc-200/70')
    expect(firstCell.className).not.toContain('border-zinc-100')
  })
})

describe('MonthPage — the two marks never read as one', () => {
  it('today is a solid accent circle; the selected day is a hollow ring', () => {
    const { MonthPage } = loadMonthPage()
    render(
      <MonthPage
        {...baseProps}
        cells={monthCells(2026, 9, weekStartFor('ja'))}
        todayIso="2026-09-14"
        selectedDateIso="2026-09-20"
      />,
    )
    const buttons = days()
    const today = buttons[13].querySelector('span')!
    const selected = buttons[19].querySelector('span')!
    expect(today.className).toMatch(/bg-primary/)
    expect(today.className).not.toMatch(/ring-primary/)
    expect(selected.className).toMatch(/ring-primary/)
    // The ring is HOLLOW — a filled ring would read as a second "today".
    expect(selected.className).not.toMatch(/bg-primary/)
  })

  // R2-2 (LENS-1 #2) — `aria-current="date"` means "this IS today"; putting
  // it on the SELECTED day told a screen reader the wrong day was today. Today
  // gets aria-current, the selection gets aria-pressed — two separate facts,
  // on two separate cells when they differ.
  it('today carries aria-current; the selected day carries aria-pressed, not aria-current', () => {
    const { MonthPage } = loadMonthPage()
    render(
      <MonthPage
        {...baseProps}
        cells={monthCells(2026, 9, weekStartFor('ja'))}
        todayIso="2026-09-15"
        selectedDateIso="2026-09-16"
      />,
    )
    const buttons = screen.getAllByRole('button')
    const current = buttons.filter((b) => b.getAttribute('aria-current') === 'date')
    const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('aria-label')).toContain('9/15')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].getAttribute('aria-label')).toContain('9/16')
    // The two marks stay on their own cell — nothing else on the grid.
    expect(current[0].getAttribute('aria-pressed')).toBeNull()
    expect(pressed[0].getAttribute('aria-current')).toBeNull()
  })

  it('when today IS the selection, the one cell carries both marks', () => {
    const { MonthPage } = loadMonthPage()
    render(
      <MonthPage
        {...baseProps}
        cells={monthCells(2026, 9, weekStartFor('ja'))}
        todayIso="2026-09-15"
        selectedDateIso="2026-09-15"
      />,
    )
    const cellEl = days()[14]
    expect(cellEl.getAttribute('aria-current')).toBe('date')
    expect(cellEl.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('MonthPage — 休', () => {
  const closedGrid = monthCells(2026, 9, weekStartFor('ja'), {
    '2026-09-16': { closed: true, count: 0 },
    '2026-09-17': { closed: true, count: 4, density: 'medium' },
  })

  it('a closed day with NOTHING booked shows 休 instead of a count', () => {
    const { MonthPage } = loadMonthPage({ closedDays: true })
    render(<MonthPage {...baseProps} cells={closedGrid} />)
    const cellEl = days()[15]
    expect(cellEl.textContent).toContain('休')
    expect(cellEl.getAttribute('aria-label')).toBe('9/16(水) 休')
  })

  it('a closed day WITH bookings shows its numbers, never 休 (⚖ lead ruling)', () => {
    const { MonthPage } = loadMonthPage({ closedDays: true })
    render(<MonthPage {...baseProps} cells={closedGrid} />)
    const cellEl = days()[16]
    expect(cellEl.textContent).not.toContain('休')
    expect(cellEl.textContent).toContain('4')
    expect(cellEl.getAttribute('aria-label')).toBe('9/17(木) 予約 4件')
  })

  // R1-3 (D-3): the tests above mock the registry to pin behaviour per switch
  // VALUE. This one runs the SHIPPED one — no override — so 「休 is ON」 is
  // proven where it is actually seen, on a rendered cell, and flipping the
  // constant back goes red here and not only on a constant's own assertion.
  //
  // It is also the honest stand-in for a live shot: the e2e tenant (Dev Salon)
  // has NO closed weekday saved and no 臨時休業 in the windows checked, so no
  // 休 cell is reachable on a real screen today (R1-3 proof note).
  it('SHIPPED: a closed, empty day really renders 休 on the page', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={closedGrid} />)
    const cellEl = Array.from(container.querySelectorAll(IN_MONTH))[15]
    expect(cellEl.textContent).toContain('休')
    expect(cellEl.getAttribute('aria-label')).toBe('9/16(水) 休')
  })

  it('with the switch OFF no cell says 休 — the count is all it ever shows', () => {
    const { MonthPage } = loadMonthPage({ closedDays: false })
    render(<MonthPage {...baseProps} cells={closedGrid} />)
    expect(screen.queryByText('休')).toBeNull()
  })
})

describe('MonthPage — the cell s one piece of motion', () => {
  it('names its curve and its property, and stands down under reduced motion', () => {
    // review-animations, standard 3: an unnamed curve inherits Tailwind's
    // default cubic-bezier(.4,0,.2,1) — an ease-in-out, the exact defect R3-16
    // caught on the chip's chevron. The mock's own `.cell` rule is plain
    // `ease`, and it transitions background-color ONLY.
    const { MonthPage } = loadMonthPage()
    render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
    const cls = days()[0].className
    expect(cls).toContain('ease-[ease]')
    expect(cls).toContain('transition-[background-color]')
    expect(cls).toContain('duration-[120ms]')
    expect(cls).toContain('motion-reduce:transition-none')
    // No press scale on a page-grid cell — the mock gives that to the week
    // rows and the door, never to these.
    expect(cls).not.toMatch(/scale-\[/)
  })
})

describe('MonthPage — the legend', () => {
  it('names the three bands and says what the number is, joined by the half-width 「·」', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
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
    const cells = monthCells(2026, 9, weekStartFor('ja'), { '2026-09-15': { count: 3 }, '2026-09-16': { count: 4 } })
    // A filler carrying a count is what the adapter promises never to send —
    // and what this line promises never to print.
    cells[0] = { ...cells[0], count: 99 }
    expect(monthBookingTotal(cells)).toBe(7)
    const { container } = render(<MonthPage {...baseProps} cells={cells} />)
    expect(container.querySelector('[data-month-line]')!.textContent).toBe('予約7件')
  })

  it("typeSlot 'off' renders no 新規/再来 item — never a substitute metric", () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
    const line = container.querySelector('[data-month-line]')!
    expect(line.textContent).not.toContain('新規')
    expect(line.textContent).not.toContain('再来')
  })

  it('the type slot prints label-first, with the spark on the number (native pass 2 C-2)', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} typeSlot="new" typeCount={80} />,
    )
    const line = container.querySelector('[data-month-line]')!
    expect(visibleText(line)).toBe('予約0件新規80')
    expect(line.querySelector('[data-new-spark]')).not.toBeNull()
  })

  it('a known zero in the new type slot prints its label and value', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} typeSlot="new" typeCount={0} />,
    )
    const line = container.querySelector('[data-month-line]')!
    expect(visibleText(line)).toBe(
      `${WEEK_ROWS.count}${WEEK_ROWS.countValue.replace('{n}', '0')}${WEEK_ROWS.new}0`,
    )
    expect(screen.getByText(WEEK_ROWS.new).querySelector('b')!.textContent).toBe('0')
  })

  it('a type slot with no honest number is ABSENT, not a zero', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} typeSlot="new" typeCount={null} />,
    )
    expect(container.querySelector('[data-month-line]')!.textContent).toBe('予約0件')
  })

  it('mid-transition it shows shims, never the month being navigated away from', () => {
    const { MonthPage } = loadMonthPage()
    const cells = monthCells(2026, 9, weekStartFor('ja'), { '2026-09-15': { count: 3 } })
    const { container } = render(<MonthPage {...baseProps} cells={cells} pending />)
    const line = container.querySelector('[data-month-line]')!
    expect(line.textContent).toBe('')
    const shims = line.querySelectorAll('.reservation-shim')
    expect(shims).toHaveLength(2)
    // R2-7 (LENS-3 #4) — `mr-3` (12px) on top of the line's own `gap-[14px]`
    // is the mock's 26px edge-to-edge gap between the two pending pills.
    for (const shim of Array.from(shims)) {
      expect(shim.className).toContain('mr-3')
    }
  })

  describe('先月同期間比 — an annotation, never an alarm', () => {
    /** The clause's own value element, whatever tone it carries. */
    const clause = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-month-line] span'))
        .find((el) => el.textContent?.startsWith('先月同期間比')) ?? null

    it('prints label-first, last on the line, with the app s own term', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const cells = monthCells(2026, 9, weekStartFor('ja'), { '2026-09-15': { count: 234 } })
      const { container } = render(
        <MonthPage {...baseProps} cells={cells} monthCompareDelta={12} />,
      )
      const line = container.querySelector('[data-month-line]')!
      expect(visibleText(line)).toBe('予約234件先月同期間比+12件')
      // …and SPOKEN as two facts, not one run-on string. The 14px gap is CSS;
      // a screen reader reads the app's own 「、」 (the week rows' ariaSep).
      expect(line.textContent).toBe('予約234件、先月同期間比+12件')
    })

    it('ahead takes the 少なめ green — the week rows own token, not a second one', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={12} />,
      )
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { VALUE_TONE_CLASS } = require('@/components/appointments/WeekRows') as typeof import('@/components/appointments/WeekRows')
      expect(clause(container)!.querySelector('span')!.className).toContain(
        VALUE_TONE_CLASS['band-low'],
      )
    })

    it('behind is the MUTE GREY and never red — a quiet month is not a fault', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={-12} />,
      )
      const value = clause(container)!.querySelector('span')!
      // U+2212, the typographic minus the mock itself spells — not a hyphen.
      expect(value.textContent).toBe('\u221212件')
      expect(value.className).toContain('text-[var(--color-text-muted)]')
      expect(clause(container)!.outerHTML).not.toMatch(/red|destructive/)
    })

    it('level prints ±0件 in the same grey, never a blank', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={0} />,
      )
      const value = clause(container)!.querySelector('span')!
      expect(value.textContent).toBe('\u00b10件')
      expect(value.className).toContain('text-[var(--color-text-muted)]')
    })

    it('no honest number = ABSENT: no 0, no dash, no label', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={null} />,
      )
      expect(container.querySelector('[data-month-line]')!.textContent).toBe('予約0件')
    })

    it('a FOUR-DIGIT delta stays ONE clause — ungrouped, as the real template prints it', () => {
      // A busy multi-store salon can plausibly cross into four digits, and no
      // fixture covered that range. The app's own string is a BARE 「{n}件」,
      // and ICU prints a bare argument with String(value) — grouping would
      // need a typed 「{n, number}」. Measured on the production build at 393
      // with this exact value: the line ends at 209.44px inside a 361px
      // track, one line, no overflow.
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={1234} />,
      )
      expect(clause(container)!.querySelector('span')!.textContent).toBe('+1234\u4ef6')
    })

    it('\u2026and the same on the way down, behind the typographic minus', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={-1234} />,
      )
      const value = clause(container)!.querySelector('span')!
      expect(value.textContent).toBe('\u22121234\u4ef6')
      expect(value.className).toContain('text-[var(--color-text-muted)]')
    })

    it('mid-transition it is the two shims, never a clause about the month being left', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={12} pending />,
      )
      expect(container.querySelector('[data-month-line]')!.textContent).toBe('')
    })

    it('with the monthCompare switch OFF the clause is gone and the line still stands', () => {
      const { MonthPage } = loadMonthPage({ monthCompare: false })
      const { container } = render(
        <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={12} />,
      )
      expect(container.querySelector('[data-month-line]')!.textContent).toBe('予約0件')
    })

    it('EN: the clause carries its own word — 「+12 bookings」, never a bare number', () => {
      // The JA `clause` finder above matches on the JA label text, so this
      // one locates the same outer LineItem span by the EN label instead.
      const enClause = (container: HTMLElement) =>
        Array.from(container.querySelectorAll('[data-month-line] span')).find((el) =>
          el.textContent?.startsWith(EN_WEEK_ROWS.lastMonthSamePeriod),
        ) ?? null

      const { MonthPage } = loadMonthPage({ monthCompare: true })
      const jaDict = DICTS['reservation.weekRows']
      DICTS['reservation.weekRows'] = EN_WEEK_ROWS
      try {
        const { container, rerender } = render(
          <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={12} />,
        )
        expect(enClause(container)!.querySelector('span')!.textContent).toBe('+12 bookings')

        // …and the same on the way down, behind the typographic minus.
        rerender(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} monthCompareDelta={-12} />)
        expect(enClause(container)!.querySelector('span')!.textContent).toBe('−12 bookings')
      } finally {
        DICTS['reservation.weekRows'] = jaDict
      }
    })
  })

  it('with the monthLine switch OFF the line is gone and the grid still stands', () => {
    const { MonthPage } = loadMonthPage({ monthLine: false })
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} />)
    expect(container.querySelector('[data-month-line]')).toBeNull()
    expect(container.querySelector('[data-month-grid]')).not.toBeNull()
  })
})

describe('MonthPage — cellTone', () => {
  it('reads the wire density today and a per-store band the day it lands', () => {
    const { cellTone } = loadMonthPage()
    expect(cellTone({ density: 'light' })).toBe('bg-[var(--color-success)]')
    expect(cellTone({ density: 'medium' })).toBe('bg-[var(--color-accent)]')
    expect(cellTone({ density: 'busy' })).toBe('bg-[var(--color-warning)]')
    expect(cellTone({ density: 'empty' })).toBeNull()
    // 1c-B's seam: a per-store band overrides the fixed table, and until it is
    // on the wire `density` is the whole answer.
    expect(cellTone({ density: 'busy', band: 'light' })).toBe('bg-[var(--color-success)]')
  })

  it('is the SAME map the week rows draw their dot from', () => {
    const { cellTone } = loadMonthPage()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { densityDotClass } = require('@/components/appointments/WeekRows') as typeof import('@/components/appointments/WeekRows')
    expect(cellTone({ density: 'light' })).toBe(densityDotClass(1))
    expect(cellTone({ density: 'medium' })).toBe(densityDotClass(4))
    expect(cellTone({ density: 'busy' })).toBe(densityDotClass(9))
    expect(cellTone({ density: 'empty' })).toBe(densityDotClass(0))
  })
})

describe('MonthPage — a failed read says so', () => {
  it('renders the week page s own failed line and NOTHING else', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(
      <MonthPage {...baseProps} cells={monthCells(2026, 9, weekStartFor('ja'))} failed />,
    )
    expect(screen.getByRole('alert').textContent).toBe(WEEK_ROWS.failed)
    expect(container.querySelector('[data-month-grid]')).toBeNull()
    expect(container.querySelector('[data-month-line]')).toBeNull()
  })
})


describe('MonthPage — locale calendar colours', () => {
  it.each([0, 1] as const)('headers follow cells in order %i despite the opposite fallback', (start) => {
    const { MonthPage } = loadMonthPage()
    const cells = monthCells(2027, 3, start)
    const { container } = render(<MonthPage {...baseProps} weekStart={start === 0 ? 1 : 0} cells={cells} />)
    const headers = container.querySelectorAll('[data-month-grid] > div:first-child > div')
    const buttons = container.querySelectorAll('[data-month-cell]')
    const fmt = new Intl.DateTimeFormat('ja', { weekday: 'short', timeZone: 'UTC' })
    expect(headers).toHaveLength(7)
    for (let i = 0; i < 7; i++) {
      const date = new Date(`${cells[i].id}T00:00:00Z`)
      expect(headers[i].textContent).toBe(fmt.format(date))
      expect(buttons[i].querySelector('span')!.textContent).toBe(String(date.getUTCDate()))
      expect(headers[i].className).toContain(date.getUTCDay() === 0
        ? 'text-red-600' : date.getUTCDay() === 6 ? 'text-primary' : 'text-zinc-500')
      if (date.getUTCDay() === 0) expect(headers[i].className).toContain('dark:text-red-400')
    }
  })

  it('Sunday-first puts red on column 1 and accent on column 7', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} cells={monthCells(2026, 11, weekStartFor('ja'))} />)
    const headers = container.querySelectorAll('[data-month-grid] > div:first-child > div')
    expect(headers[0].className).toContain('text-red-600')
    expect(headers[0].className).toContain('dark:text-red-400')
    expect(headers[5].className).toContain('text-zinc-500')
    expect(headers[6].className).toContain('text-primary')
    expect(container.querySelector('[data-month-cell]')!.textContent).toBe('1')
  })

  it('English mutes all seven headers and leaves ordinary weekend numbers plain', () => {
    const { MonthPage } = loadMonthPage()
    const { container } = render(<MonthPage {...baseProps} locale="en" weekStart={weekStartFor('en')} tone={weekendTone('en')} cells={monthCells(2026, 11, weekStartFor('en'))} />)
    const headers = container.querySelectorAll('[data-month-grid] > div:first-child > div')
    expect(headers).toHaveLength(7)
    for (const header of Array.from(headers)) {
      expect(header.className).toContain('text-zinc-500')
      expect(header.className).toContain('dark:text-zinc-400')
      expect(header.className).not.toMatch(/text-red|text-primary/)
    }
    for (const i of [0, 6]) {
      const number = days()[i].querySelector('span')!
      expect(number.className).toContain('text-[var(--color-text)]')
      expect(number.className).not.toMatch(/text-red|text-primary/)
    }
  })
})
