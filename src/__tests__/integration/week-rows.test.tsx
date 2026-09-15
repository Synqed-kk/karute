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
import { formatCompactDateJst, jstWallTimeToDate } from '@/lib/date/jst'
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
  countLine: '{n}件',
  hours: '{h}時間',
  minutes: '{m}分',
  loading: '予約状況を読み込み中…',
  failed: '予約状況を取得できませんでした。もう一度お試しください。',
  rowAria: '{date} {cells}',
  ariaSep: '、',
  ariaLoading: '読み込み中',
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

describe('WeekRows — the accessible name says every number (R3-6)', () => {
  // aria-label on a <button> REPLACES its contents for assistive tech, so the
  // name has to carry what the row shows — not a summary of it.
  function nameOf(button: HTMLElement): string {
    return button.getAttribute('aria-label')!
  }
  function cellsOf(button: HTMLElement): string {
    return Array.from(button.querySelectorAll('[data-week-cell]'))
      .map((cell) => {
        const label = cell.firstElementChild!.textContent
        const value = cell.querySelector('[data-week-value]')!.textContent
        return `${label} ${value}`
      })
      .join('、')
  }

  it('equals the date plus the row’s OWN cells, label and value, 、-joined', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} typeSlot="off" rows={sevenDays()} onPickDay={jest.fn()} />)
    const button = screen.getAllByRole('button')[1] // 9/15
    const joined = cellsOf(button)
    expect(joined).toContain('、')
    expect(joined.split('、')).toHaveLength(4)
    expect(nameOf(button)).toBe(
      `${formatCompactDateJst(jstWallTimeToDate('2026-09-15', '00:00'), 'ja')} ${joined}`,
    )
    // the old name carried the count alone — the three numbers it dropped
    for (const piece of joined.split('、').slice(1)) {
      expect(nameOf(button)).toContain(piece)
    }
  })

  it('a closed row is named 休, the only thing it shows (WCAG 2.5.3)', () => {
    const WeekRows = loadWeekRows({ closedDays: true })
    const rows = sevenDays()
    rows[0] = row({ dateIso: rows[0].dateIso, dateNumber: rows[0].dateNumber, closed: true, count: 0 })
    render(<WeekRows {...baseProps} typeSlot="off" rows={rows} onPickDay={jest.fn()} />)
    const name = nameOf(screen.getAllByRole('button')[0])
    expect(name).toContain('休')
    expect(name).not.toMatch(/予約|稼働|キャンセル/)
  })

  it('a pending row says 読み込み中 instead of last week’s numbers', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} typeSlot="off" rows={sevenDays()} pending onPickDay={jest.fn()} />)
    const name = nameOf(screen.getAllByRole('button')[0])
    expect(name).toContain('読み込み中')
    expect(name).not.toMatch(/件/)
  })

  it('the density dot is gone while pending (mock dotFor(d, pend) === "")', () => {
    const WeekRows = loadWeekRows()
    const rows = sevenDays(new Array(7).fill({ count: 4 }))
    const loaded = render(<WeekRows {...baseProps} rows={rows} onPickDay={jest.fn()} />)
    expect(loaded.container.querySelectorAll('.size-1\\.5').length).toBe(7)
    loaded.unmount()
    const busy = render(<WeekRows {...baseProps} rows={rows} pending onPickDay={jest.fn()} />)
    expect(busy.container.querySelectorAll('.size-1\\.5').length).toBe(0)
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
    expect(screen.getByText('予約状況を読み込み中…')).toBeInTheDocument()
    // W-F's split keys gave the line a per-number seam, so it does what the
    // mock's own weekSumHTML(mon, pend) does: range + words stay, the numbers
    // shimmer. No <b> is rendered, so no stale sum can survive a refetch.
    expect(screen.getByTestId('week-summary').querySelectorAll('b')).toHaveLength(0)
    // R3-18 — the mock's 1.1s gradient sweep, not an opacity pulse
    expect(container.querySelectorAll('.reservation-shim').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0)
  })

  it('the pending line is a polite live region and the failed line interrupts (R3-7)', () => {
    const WeekRows = loadWeekRows()
    const busy = render(<WeekRows {...baseProps} rows={sevenDays()} pending onPickDay={jest.fn()} />)
    expect(busy.getByRole('status').textContent).toBe(MESSAGES.loading)
    busy.unmount()
    const dead = render(<WeekRows {...baseProps} rows={sevenDays()} failed onPickDay={jest.fn()} />)
    expect(dead.getByRole('alert').textContent).toBe(MESSAGES.failed)
  })

  it('failed renders only the failure line, no rows', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} failed onPickDay={jest.fn()} />)
    expect(screen.getByText('予約状況を取得できませんでした。もう一度お試しください。')).toBeInTheDocument()
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

  it('the grid is a minmax(130px,max-content)/100px two-column block that never flexes (mock .wkgrid{flex:0 0 auto}, R2-2 + R3-12)', () => {
    // ⚖ R2-2 (lead, 2026-09-15) — the ONE recorded deviation from the mock's
    // geometry: column 1 is 130 px, not the mock's 120. The mock's fixtures
    // were whole hours (「12時間」); a real day carries minutes, and
    // 「予約時間 12時間30分」 measures 130.03 px (label 44 + gap 5 + value 81),
    // which at 120 px ran 2 px INTO its neighbour's box (D-2 of
    // FIX-REPORT-1B-WIRE-R1) — and still measured 0.03 px over the new fixed
    // 130 (R3-12), with 「予約時間 100時間30分」 at 139.42 px. The track keeps
    // 130 as a FLOOR and grows with max-content instead. Everything else in
    // the row geometry is the mock's, unchanged. jsdom cannot measure text, so
    // this pins the class string; the pixel proof is Playwright's, at 393 and
    // 430 px, in the lane evidence folder.
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const grid = container.querySelector('[data-week-grid]')!
    expect(grid.className).toContain('grid-cols-[minmax(130px,max-content)_100px]')
    // R3-12 — a FIXED wide track is what let 「予約時間 100時間30分」 (139.42 px)
    // walk into the narrow column's box; the floor is kept, the ceiling is
    // gone. The narrow track stays fixed at 100 px on purpose.
    expect(grid.className).not.toContain('grid-cols-[130px_100px]')
    expect(grid.className).not.toContain('grid-cols-[120px_100px]')
    expect(grid.className).toContain('_100px]')
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
      'transition-[background-color,scale]', // .wkrow + [data-press] (see W-I, R3-14)
    ]) {
      expect(cls).toContain(rule)
    }
  })

  it('the spark is the mock’s own two-star glyph at stroke 1.8 (R3-19)', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const spark = container.querySelector('[data-new-spark]')!
    // mock line 780: two <path>s, stroke-width 1.8, 15×15 on a 24 viewBox.
    // lucide's Sparkles draws THREE stars at stroke 2.
    expect(spark.querySelectorAll('path')).toHaveLength(2)
    expect(spark.getAttribute('stroke-width')).toBe('1.8')
    expect(spark.getAttribute('width')).toBe('15')
    expect(spark.getAttribute('height')).toBe('15')
    expect(spark.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(spark.getAttribute('class') ?? '').not.toContain('lucide')
  })

  it('the 新規 spark PRECEDES its value in the cell (mock: cellHTML(lb, SPARK + val))', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    // typeSlot 'new' → the fourth cell is 新規, the only sparked one.
    const sparked = container.querySelector('[data-new-spark]')!.closest('[data-week-value]')!
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

describe('WeekRows — the 少なめ band reads at AA (R3-9)', () => {
  it('a sub-35% row carries text-green-700, not green-600', () => {
    const WeekRows = loadWeekRows()
    // 96 of 480 saved minutes = 20% — the common state for a solo store, and
    // the one that used to render #00a63e (3.22:1 on white at 14.5px/600).
    const low = sevenDays().map((r) =>
      row({ ...r, capacityDefensible: true, hoursSaved: true, bookedMinutes: 96, availableMinutes: 480 }),
    )
    const { container } = render(
      <WeekRows {...baseProps} typeSlot="off" rows={low} onPickDay={jest.fn()} />,
    )
    const values = Array.from(container.querySelectorAll('[data-week-value]'))
    const band = values.find((v) => v.textContent === '20%')!
    expect(band.className).toContain('text-green-700')
    expect(band.className).not.toContain('text-green-600')
    expect(band.className).toContain('dark:text-green-400')
  })

  it('the density dot keeps its own green — a 6 px shape is not text', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(
      <WeekRows {...baseProps} rows={sevenDays(new Array(7).fill({ count: 1 }))} onPickDay={jest.fn()} />,
    )
    expect(container.querySelector('.size-1\\.5')!.className).toContain('bg-[var(--color-success)]')
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
    // R3-17 — the mock's MIDDLE grey (--sub), with the dark pair the 4.5:1
    // word floor needs on the dark card.
    expect(summary.className).toContain('text-zinc-500')
    expect(summary.className).toContain('dark:text-zinc-400')
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

describe('WeekRows — the mock’s three greys, not one (R3-17)', () => {
  it('label, word and chevron each take their own step, and the card clips its corner', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(
      <WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />,
    )
    // mock --mute (#9ca3af): the label recedes so the number carries the row
    const label = container.querySelector('[data-week-cell]')!.firstElementChild!
    expect(label.className).toContain('text-zinc-400')
    expect(label.className).not.toContain('--color-text-muted')
    // mock --sub (#6b7280): the weekday letter is a word, not a label
    const weekday = container.querySelector('[data-week-row] span span')!
    expect(weekday.className).toMatch(/text-zinc-500|text-primary|text-red-600/)
    // mock #c3c8cf: the lightest thing in the row
    expect(container.querySelector('[data-week-chevron]')!.getAttribute('class')).toContain(
      'text-zinc-300',
    )
    // mock --hair (#eef0f2) vs the card's own --line (#e6e8eb)
    const row0 = screen.getAllByRole('button')[0]
    expect(row0.className).toContain('border-zinc-100')
    expect(row0.className).not.toContain('border-[var(--color-border)]')
    // mock .listcard{overflow:hidden} — the today wash must not square off the
    // card's 16 px corner
    const card = row0.parentElement!
    expect(card.className).toContain('overflow-hidden')
    expect(card.className).toContain('border-[var(--color-border)]')
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
    // R3-14 — Tailwind v4 emits `scale-*` as the standalone `scale` property,
    // so the transition list has to NAME scale. It named `transform`, which
    // covers nothing here, and the press snapped with zero intermediate
    // values in 52 frame samples.
    expect(cls).toMatch(/transition-\[[^\]]*\bscale\b[^\]]*\]/)
    // Reduced motion is a CSS variant here, not a hook: seven plain rows need
    // no JS to stop moving, and a variant also holds during SSR's first paint.
    expect(cls).toContain('motion-reduce:transition-none')
    expect(cls).toContain('motion-reduce:active:scale-100')
    expect(cls).toContain('motion-reduce:data-pressed:scale-100')
  })

  it('the press starts on pointerdown and clears on up / cancel / leave (R3-15)', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const button = screen.getAllByRole('button')[0]
    expect(button.className).toContain('data-pressed:scale-[0.97]')

    for (const clear of [fireEvent.pointerUp, fireEvent.pointerCancel, fireEvent.pointerLeave]) {
      fireEvent.pointerDown(button)
      expect(button.hasAttribute('data-pressed')).toBe(true)
      clear(button)
      expect(button.hasAttribute('data-pressed')).toBe(false)
    }
  })

  it('a pointer press on one row never marks another (R3-15)', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const [first, second] = screen.getAllByRole('button')
    fireEvent.pointerDown(second)
    expect(second.hasAttribute('data-pressed')).toBe(true)
    expect(first.hasAttribute('data-pressed')).toBe(false)
    fireEvent.pointerUp(second)
  })

  it('a tap still navigates exactly once (R3-15)', () => {
    const WeekRows = loadWeekRows()
    const onPickDay = jest.fn()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={onPickDay} />)
    const button = screen.getAllByRole('button')[2]
    fireEvent.pointerDown(button)
    fireEvent.pointerUp(button)
    fireEvent.click(button)
    expect(onPickDay).toHaveBeenCalledTimes(1)
    expect(onPickDay).toHaveBeenCalledWith('2026-09-16')
  })

  it('the row takes the shared Button recipe’s focus-visible ring, verbatim (R3-8)', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} onPickDay={jest.fn()} />)
    const cls = screen.getAllByRole('button')[0].className
    const button = readFileSync(join(__dirname, '../../components/ui/button.tsx'), 'utf8')
    for (const token of ['focus-visible:border-ring', 'focus-visible:ring-3', 'focus-visible:ring-ring/50']) {
      expect(cls).toContain(token)
      // …and it really is the shared recipe's spelling, not a lookalike
      expect(button).toContain(token)
    }
    expect(cls).toContain('outline-none')
  })

  it('the header chip’s chevron turns on the same curve as the panel’s (R3-16)', () => {
    // Both are string constants, so this is a source pin: the chip lives
    // inside @synqed-kk/ui (no ref, no class hook) and the panel's chevron is
    // in a file this PR does not touch, so neither can be rendered here
    // together. What the round fixes is the authored recipe itself.
    const view = readFileSync(
      join(__dirname, '../../components/appointments/AppointmentsView.tsx'),
      'utf8',
    )
    const panel = readFileSync(
      join(__dirname, '../../components/appointments/DateJumpPanel.tsx'),
      'utf8',
    )
    const chipChevron = /const CHIP_CHEVRON =\s*\n?\s*'([^']+)'/.exec(view)![1]
    expect(chipChevron).toContain('ease-[cubic-bezier(0.23,1,0.32,1)]')
    expect(chipChevron).toContain('duration-[160ms]')
    // the panel's own chevron names the same curve and the same 160 ms
    expect(panel).toContain('ease-[cubic-bezier(0.23,1,0.32,1)]')
    expect(panel).toContain("'160ms'")
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
