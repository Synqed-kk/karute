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
  summary: '{from}〜{to} · 予約 {count}件',
  summaryNew: ' · 新規 {n}',
  summaryReturning: ' · 再来 {n}',
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
  failed: '予約状況を取得できませんでした',
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
    // a poisoned newCustomerCount — only reachable in a test fixture, but it
    // isolates the exclusion: the correct sum must ignore it regardless of
    // what the row's other fields say.
    const rows = sevenDays()
    rows[0] = row({ dateIso: rows[0].dateIso, dateNumber: rows[0].dateNumber, closed: true, count: 0, newCustomerCount: 999 })
    render(<WeekRows {...baseProps} rows={rows} onPickDay={jest.fn()} />)
    const summary = screen.getByTestId('week-summary')
    expect(summary.textContent).not.toMatch(/999/)
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
  it('pending renders the loading line and shimmer pills, no summary', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(<WeekRows {...baseProps} rows={sevenDays()} pending onPickDay={jest.fn()} />)
    expect(screen.getByText('予約状況を読み込み中')).toBeInTheDocument()
    expect(screen.queryByTestId('week-summary')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('failed renders only the failure line, no rows', () => {
    const WeekRows = loadWeekRows()
    render(<WeekRows {...baseProps} rows={sevenDays()} failed onPickDay={jest.fn()} />)
    expect(screen.getByText('予約状況を取得できませんでした')).toBeInTheDocument()
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
