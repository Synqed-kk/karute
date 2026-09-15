/**
 * @jest-environment jsdom
 *
 * Render coverage for DayNumbersLine.tsx (spec §2/§v9d, packet W5/W7) — the
 * day page's §v9d numbers line. ISOLATED: nothing imports this yet (the
 * wiring PR retires ReservationTotals once `row` is non-null).
 */
import { render, screen } from '@testing-library/react'
import type { WeekDayRowData } from '@/lib/adapters/reservation'

const MESSAGES: Record<string, string> = {
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
    count: 11,
    bookedMinutes: 270,
    availableMinutes: 480,
    newCustomerCount: 5,
    remindersPending: 0,
    consentPending: 0,
    unconfirmed: 0,
    visibleBookings: [],
    hiddenCount: 0,
    dateIso: '2026-09-15',
    capacityDefensible: true,
    hoursSaved: true,
    closed: false,
    cancelledCount: 0,
    noShowDayCount: 0,
    returningCount: 2,
    ...over,
  }
}

function loadDayNumbersLine(switchOverrides: Partial<Record<string, boolean>> = {}) {
  jest.resetModules()
  jest.doMock('@/lib/appointments/booking-switches', () => {
    const actual = jest.requireActual('@/lib/appointments/booking-switches') as {
      BOOKING_SWITCHES: Record<string, boolean>
    }
    return { BOOKING_SWITCHES: { ...actual.BOOKING_SWITCHES, ...switchOverrides } }
  })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@/components/appointments/DayNumbersLine') as typeof import('@/components/appointments/DayNumbersLine')
  return mod.DayNumbersLine
}

afterEach(() => {
  jest.dontMock('@/lib/appointments/booking-switches')
  jest.resetModules()
})

describe('DayNumbersLine — null row', () => {
  it('renders nothing', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={null} soloMode={false} typeSlot="off" locale="ja" />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DayNumbersLine — order per typeSlot', () => {
  it("'new' → 予約, 新規, 稼働, 空き in that DOM order (the SHIPPED registry, 空き ON)", () => {
    const DayNumbersLine = loadDayNumbersLine()
    render(<DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />)
    // 11件 has no separate word; the rest are value-then-word.
    expect(screen.getByText('11件')).toBeInTheDocument()
    const labels = screen.getAllByText(/^(新規|稼働|空き)$/).map((el) => el.textContent)
    expect(labels).toEqual(['新規', '稼働', '空き'])
  })

  it("'returning' → 予約, 再来, 予約時間, キャンセル", () => {
    const DayNumbersLine = loadDayNumbersLine()
    render(<DayNumbersLine row={row()} soloMode={false} typeSlot="returning" locale="ja" />)
    const labels = screen.getAllByText(/^(再来|予約時間|キャンセル)$/).map((el) => el.textContent)
    expect(labels).toEqual(['再来', '予約時間', 'キャンセル'])
  })

  it("'off' → 予約, 稼働, 予約時間 (free OFF), next unused metric", () => {
    const DayNumbersLine = loadDayNumbersLine({ freeTimeCell: false })
    render(<DayNumbersLine row={row({ bookedMinutes: 100 })} soloMode={false} typeSlot="off" locale="ja" />)
    const labels = screen.getAllByText(/^(稼働|予約時間|キャンセル)$/).map((el) => el.textContent)
    expect(labels).toEqual(['稼働', '予約時間', 'キャンセル'])
  })
})

describe('DayNumbersLine — closed day', () => {
  it('renders 0件 休 only, when the switch is ON', () => {
    const DayNumbersLine = loadDayNumbersLine({ closedDays: true })
    render(
      <DayNumbersLine row={row({ closed: true, count: 0 })} soloMode={false} typeSlot="new" locale="ja" />,
    )
    expect(screen.getByText('0件')).toBeInTheDocument()
    expect(screen.getByText('休')).toBeInTheDocument()
    expect(screen.queryByText('新規')).not.toBeInTheDocument()
  })
})

describe('DayNumbersLine — no separators', () => {
  it('the rendered line has no middle-dot or pipe characters', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(<DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />)
    expect(container.textContent).not.toMatch(/[·・|]/)
  })
})
