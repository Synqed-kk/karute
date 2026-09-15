/**
 * @jest-environment jsdom
 *
 * Render coverage for WeekRows.tsx (spec §3/§8, packet W4/W7) — the seven
 * week-row grid + summary line. ISOLATED: nothing imports WeekRows.tsx yet
 * (the wiring PR replaces @synqed-kk/ui's WeekDayCard with it).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import type { WeekDayRowData } from '@/lib/adapters/reservation'

const MESSAGES: Record<string, string> = {
  summaryRange: '{from}〜{to}',
  sep: '·',
  count: '予約',
  utilization: '稼働',
  free: '空き',
  bookedTime: '予約時間',
  new: '新規',
  returning: '再来',
  cancelled: 'キャンセル',
  noShow: '無断',
  unset: '未設定',
  closed: '休',
  countValue: '{n}件',
  hours: '{h}時間',
  minutes: '{m}分',
  loading: '予約状況を読み込み中',
  failed: '予約状況を取得できませんでした。もう一度お試しください',
  rowAria: '{date} 予約{n}件',
}

function t(key: string, values?: Record<string, string | number | Date>): string {
  let s = MESSAGES[key] ?? key
  if (values) for (const [k, v] of Object.entries(values)) s = s.split(`{${k}}`).join(String(v))
  return s
}

jest.mock('next-intl', () => ({ useTranslations: () => t }))

function row(over: Partial<WeekDayRowData> = {}): WeekDayRowData {
  return {
    dateNumber: 15,
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
    dateIso: '2026-09-15',
    capacityDefensible: false,
    hoursSaved: false,
    closed: false,
    cancelledCount: 0,
    noShowDayCount: 0,
    returningCount: 2,
    ...over,
  }
}

function sevenDays(overrides: Array<Partial<WeekDayRowData>> = []): WeekDayRowData[] {
  const isoDays = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']
  return isoDays.map((dateIso, i) => row({ dateIso, dateNumber: 14 + i, ...overrides[i] }))
}

// BOOKING_SWITCHES is a plain module constant — closedDays defaults OFF
// (spec §10), so a "closed row" scenario needs a per-file module mock, then
// a fresh require of WeekRows.tsx (which imports metric-menu.ts, which
// captures BOOKING_SWITCHES at import time).
function loadWeekRows(switchOverrides: Partial<Record<string, boolean>> = {}) {
  jest.resetModules()
  jest.doMock('@/lib/appointments/booking-switches', () => {
    const actual = jest.requireActual('@/lib/appointments/booking-switches') as {
      BOOKING_SWITCHES: Record<string, boolean>
    }
    return { BOOKING_SWITCHES: { ...actual.BOOKING_SWITCHES, ...switchOverrides } }
  })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/components/appointments/WeekRows') as typeof import('@/components/appointments/WeekRows'))
    .WeekRows
}

afterEach(() => {
  jest.dontMock('@/lib/appointments/booking-switches')
  jest.resetModules()
})

const baseProps = {
  weekStartIso: '2026-09-14',
  selectedDateIso: '2026-09-15',
  todayIso: '2026-09-15',
  soloMode: false,
  typeSlot: 'new' as const,
  locale: 'ja',
  onPickDay: jest.fn(),
}

describe('WeekRows — seven rows', () => {
  it('renders exactly seven row buttons', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(7)
  })

  it('tap calls onPickDay with that row\'s dateIso', () => {
    const WeekRows = loadWeekRows()
    const onPickDay = jest.fn()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={onPickDay} />)
    fireEvent.click(screen.getAllByRole('button')[2])
    expect(onPickDay).toHaveBeenCalledWith('2026-09-16')
  })

  it('today row gets the accent-wash class, selected-not-today gets the ring class', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} selectedDateIso="2026-09-17" todayIso="2026-09-15" onPickDay={jest.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[1].className).toMatch(/bg-primary\/8/) // 9/15 = today
    expect(buttons[3].className).toMatch(/ring-primary/) // 9/17 = selected, not today
    expect(buttons[3].className).not.toMatch(/bg-primary\/8/)
  })
})

describe('WeekRows — summary line', () => {
  it('the 新規 summary number carries no accent/new-tone class', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const summary = screen.getByTestId('week-summary')
    expect(summary.innerHTML).not.toMatch(/reservation-new-chip-bg/)
  })

  it('excludes a closed row\'s counts from the summary sums', () => {
    const WeekRows = loadWeekRows({ closedDays: true })
    // A synthetic closed row (count 0, switch ON → isClosedRow true) carrying
    // a poisoned newCustomerCount, with every OTHER row's set to 0 — only
    // reachable in a test fixture, but it isolates the exclusion: the
    // correct 新規 sum must read 0 (the poison never lands), where a leak
    // would read 999.
    const rows = sevenDays(new Array(7).fill({ newCustomerCount: 0 }))
    rows[0] = row({ dateIso: rows[0].dateIso, dateNumber: rows[0].dateNumber, closed: true, count: 0, newCustomerCount: 999 })
    render(<WeekRows {...baseProps} rows={rows} onPickDay={jest.fn()} />)
    const summary = screen.getByTestId('week-summary')
    // The two bold numbers are 予約 and 新規, in that order (mock .wksum b).
    const numbers = Array.from(summary.querySelectorAll('b')).map((b) => b.textContent)
    expect(numbers[1]).toBe('0')
    expect(summary.textContent).not.toMatch(/999/)
  })
})

describe("WeekRows — typeSlot 'off' never touches newCustomerCount (R3-4)", () => {
  it('a throwing getter on the field is never called', () => {
    const WeekRows = loadWeekRows()
    // `newCustomerCount` today is the QR import flag, not the 新規 count
    // PKT-2 will produce (spec §8). A getter that throws is the only honest
    // proof that the field is not read: a spy returning 0 would pass even if
    // every render still touched it.
    const rows = sevenDays().map((r) => {
      const guarded = { ...r }
      Object.defineProperty(guarded, 'newCustomerCount', {
        get() {
          throw new Error('newCustomerCount read under typeSlot off')
        },
        enumerable: true,
      })
      return guarded
    })
    expect(() =>
      render(<WeekRows {...baseProps} typeSlot="off" rows={rows} onPickDay={jest.fn()} />),
    ).not.toThrow()
  })

  it("typeSlot 'new' DOES read it — the guard above is not passing by accident", () => {
    const WeekRows = loadWeekRows()
    const rows = sevenDays().map((r) => {
      const guarded = { ...r }
      Object.defineProperty(guarded, 'newCustomerCount', {
        get() {
          throw new Error('newCustomerCount read under typeSlot new')
        },
        enumerable: true,
      })
      return guarded
    })
    expect(() =>
      render(<WeekRows {...baseProps} typeSlot="new" rows={rows} onPickDay={jest.fn()} />),
    ).toThrow(/newCustomerCount/)
  })
})

describe('WeekRows — closed row', () => {
  it('renders 休 spanning the row when the switch is ON', () => {
    const WeekRows = loadWeekRows({ closedDays: true })
    const rows = sevenDays()
    rows[0] = row({ dateIso: rows[0].dateIso, dateNumber: rows[0].dateNumber, closed: true, count: 0 })
    render(<WeekRows {...baseProps} rows={rows} onPickDay={jest.fn()} />)
    expect(screen.getByText('休')).toBeInTheDocument()
  })

  it('a closed day WITH bookings still shows numbers, not 休 (switch ON)', () => {
    const WeekRows = loadWeekRows({ closedDays: true })
    const rows = sevenDays()
    rows[0] = row({ dateIso: rows[0].dateIso, dateNumber: rows[0].dateNumber, closed: true, count: 5 })
    render(<WeekRows {...baseProps} rows={rows} onPickDay={jest.fn()} />)
    expect(screen.queryByText('休')).not.toBeInTheDocument()
  })
})

describe('WeekRows — pending / failed', () => {
  it('pending renders the loading line, the summary\'s shape, and shimmer pills — never a stale number', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} pending onPickDay={jest.fn()} />)
    expect(screen.getByText('予約状況を読み込み中')).toBeInTheDocument()
    // W-F's split keys gave the line a per-number seam, so it does what the
    // mock's own weekSumHTML(mon, pend) does: range + words stay, the numbers
    // shimmer. No <b> is rendered, so no stale sum can survive a refetch.
    expect(screen.getByTestId('week-summary').querySelectorAll('b')).toHaveLength(0)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('failed renders only the failure line, no rows', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} failed onPickDay={jest.fn()} />)
    expect(screen.getByText('予約状況を取得できませんでした。もう一度お試しください')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('WeekRows — no hardcoded display strings', () => {
  it('has no literal Japanese characters outside comments', () => {
    const src = readFileSync(join(__dirname, '../../components/appointments/WeekRows.tsx'), 'utf8')
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(withoutComments.match(/[ぁ-んァ-ン一-龥]/g)).toBeNull()
  })
})

describe('WeekRows — the mock’s §v5/§v6 geometry, ported rule for rule', () => {
  it('a metric cell is label-LEFT-of-value on a shared baseline (mock .wkcell{display:flex;align-items:baseline;gap:5px}), never stacked', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const cell = container.querySelector('[data-week-cell]')!
    expect(cell.className).toContain('items-baseline')
    expect(cell.className).toContain('gap-[5px]')
    expect(cell.className).not.toContain('flex-col')
  })

  it('the grid is a fixed 130/100 two-column block that never flexes (mock .wkgrid{flex:0 0 auto}, wide column +10px per R2-2)', () => {
    // ⚖ R2-2 (lead, 2026-09-15) — the ONE recorded deviation from the mock's
    // geometry: column 1 is 130 px, not the mock's 120. The mock's fixtures
    // were whole hours (「12時間」); a real day carries minutes, and
    // 「予約時間 12時間30分」 measures 130.03 px (label 44 + gap 5 + value 81),
    // which at 120 px ran 2 px INTO its neighbour's box (D-2 of
    // FIX-REPORT-1B-WIRE-R1). Everything else in the row geometry is the
    // mock's, unchanged. jsdom cannot measure text, so this pins the class
    // string; the pixel proof is Playwright's, at 393 px, in the lane
    // evidence folder.
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const grid = container.querySelector('[data-week-grid]')!
    expect(grid.className).toContain('grid-cols-[130px_100px]')
    expect(grid.className).not.toContain('grid-cols-[120px_100px]')
    expect(grid.className).toContain('shrink-0')
    expect(grid.className).not.toContain('flex-1')
  })

  it('the chevron is pushed right by the row itself (mock .wkchev{margin-left:auto})', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    // an <svg>'s .className is an SVGAnimatedString, not a string
    expect(container.querySelector('[data-week-chevron]')!.getAttribute('class')).toContain('ml-auto')
  })

  it('the row carries the mock’s box and its background transition', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const cls = screen.getAllByRole('button')[0].className
    for (const rule of [
      'min-h-[76px]', // .wkrow{min-height:76px}
      'gap-2.5', // .wkrow{gap:10px}
      'py-3', // .wkrow{padding:12px …}
      'pl-3', // … 12px left
      'pr-2.5', // … 10px right
      'transition-[background-color,transform]', // .wkrow + [data-press] (see W-I)
    ]) {
      expect(cls).toContain(rule)
    }
  })

  it('the 新規 spark PRECEDES its value in the cell (mock: cellHTML(lb, SPARK + val))', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    // typeSlot 'new' → the fourth cell is 新規, the only sparked one.
    const sparked = container.querySelector('svg.lucide-sparkles')!.closest('[data-week-value]')!
    expect(sparked.firstElementChild!.tagName.toLowerCase()).toBe('svg')
    expect(sparked.textContent).toBe('1')
  })

  it('every metric value is tabular (mock .wkcell .vl{font-variant-numeric:tabular-nums})', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const values = Array.from(container.querySelectorAll('[data-week-value]'))
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) expect(v.className).toContain('tabular-nums')
  })
})

describe('WeekRows — the summary line is the mock’s .wksum (W-F)', () => {
  it('the NUMBERS are ink 700 tabular and the words stay grey', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const summary = screen.getByTestId('week-summary')
    // grey 12.5/600 on the line (mock .wksum), ink 700 tabular on each <b>.
    expect(summary.className).toContain('text-[12.5px]')
    expect(summary.className).toContain('font-semibold')
    expect(summary.className).toContain('text-[var(--color-text-muted)]')
    const bolds = Array.from(summary.querySelectorAll('b'))
    expect(bolds).toHaveLength(2) // typeSlot 'new' → 予約 + 新規
    for (const b of bolds) {
      expect(b.className).toContain('font-bold')
      expect(b.className).toContain('tabular-nums')
      expect(b.className).toContain('text-[var(--color-text)]')
    }
  })

  it("the 新規 number is INK here, not the 新規 blue (spec §3: §v11c touched four surfaces, NOT the summary)", () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    expect(screen.getByTestId('week-summary').innerHTML).not.toMatch(/reservation-new-chip-bg/)
  })

  it("typeSlot 'off' shows the range and 予約 only — no PKT-2 slot", () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} typeSlot="off" rows={sevenDays()} onPickDay={jest.fn()} />)
    const summary = screen.getByTestId('week-summary')
    expect(summary.querySelectorAll('b')).toHaveLength(1)
    expect(summary.textContent).not.toMatch(/新規|再来/)
  })

  it('the range comes from the FIRST and LAST row’s own dateIso, never week-start arithmetic', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    expect(screen.getByTestId('week-summary').textContent).toContain('9/14〜9/20')
  })

  it('pending keeps the range and the word, and shimmers the number (mock weekSumHTML’s pend branch)', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} pending onPickDay={jest.fn()} />)
    const summary = screen.getByTestId('week-summary')
    expect(summary.textContent).toContain('9/14〜9/20')
    expect(summary.querySelectorAll('b')).toHaveLength(0)
    // mock .wksum .shim{width:38px;height:11px}
    expect(summary.querySelector('.w-\\[38px\\]')).not.toBeNull()
  })
})

describe('WeekRows — the press is the app’s own recipe (W-I)', () => {
  it('a row presses with the mock’s [data-press] transform, and stops moving under reduced motion', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const cls = screen.getAllByRole('button')[0].className
    // mock `[data-press]{transition:transform .1s cubic-bezier(.23,1,.32,1)}`
    // + `[data-press].is-pressed{transform:scale(.97)}`
    expect(cls).toContain('duration-100')
    expect(cls).toContain('ease-[cubic-bezier(0.23,1,0.32,1)]')
    expect(cls).toContain('active:scale-[0.97]')
    expect(cls).toContain('transform') // the transition names transform
    // Reduced motion is a CSS variant here, not a hook: seven plain rows need
    // no JS to stop moving, and a variant also holds during SSR's first paint.
    expect(cls).toContain('motion-reduce:transition-none')
    expect(cls).toContain('motion-reduce:active:scale-100')
  })

  it('that recipe is byte-identical to DateJumpPanel’s PRESS — one press feel on this page', () => {
    // DateJumpPanel.tsx is on this PR's untouched list, so its PRESS constant
    // cannot be exported and shared. Pin the two spellings equal instead: if
    // #921's press is ever retuned, this goes red and the week rows follow.
    const panel = readFileSync(
      join(__dirname, '../../components/appointments/DateJumpPanel.tsx'),
      'utf8',
    )
    const press = /const PRESS =\s*\n?\s*'([^']+)'/.exec(panel)![1]
    const rows = readFileSync(join(__dirname, '../../components/appointments/WeekRows.tsx'), 'utf8')
    for (const token of press.split(' ')) {
      if (token === 'transition-transform') continue // the row also transitions its background
      expect(rows).toContain(token)
    }
  })
})
