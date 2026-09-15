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

/** The line's four items, in DOM order. The mock renders each item as
 *  `<span class="it"><b>{value}</b>{word}</span>` — the word is a bare text
 *  node inside the item, not its own element — so reading the ITEM texts
 *  pins the order, the values AND the value-then-word grammar at once. */
function itemTexts(container: HTMLElement): string[] {
  return Array.from(container.firstElementChild!.children).map((el) => el.textContent ?? '')
}

describe('DayNumbersLine — order per typeSlot', () => {
  it("'new' → 予約, 新規, 稼働, 空き in that DOM order (the SHIPPED registry, 空き ON)", () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    // 11件 carries its own unit and shows no word; the rest are value-then-word.
    expect(itemTexts(container)).toEqual(['11件', '5新規', '56%稼働', '3時間30分空き'])
  })

  it("'returning' → 予約, 再来, 予約時間, キャンセル", () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="returning" locale="ja" />,
    )
    expect(itemTexts(container)).toEqual(['11件', '2再来', '4時間30分予約時間', '0キャンセル'])
  })

  it("'off' → 予約, 稼働, 予約時間 (free OFF), next unused metric", () => {
    const DayNumbersLine = loadDayNumbersLine({ freeTimeCell: false })
    const { container } = render(
      <DayNumbersLine row={row({ bookedMinutes: 100 })} soloMode={false} typeSlot="off" locale="ja" />,
    )
    expect(itemTexts(container)).toEqual(['11件', '21%稼働', '1時間40分予約時間', '0キャンセル'])
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

describe('DayNumbersLine — the mock’s §v9d geometry and grammar', () => {
  it('the block carries the mock line-for-line: gap 14, padding 2px 0, margin-bottom 8, 14px / 13.5px ≤400px, nowrap', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const cls = container.firstElementChild!.className
    for (const rule of [
      'gap-[14px]', // .dayline{gap:14px}
      'py-0.5', // .dayline{padding:2px 0}
      'mb-2', // .dayline{margin:0 0 8px}
      'text-[14px]', // .dayline{font-size:14px}
      'max-[400px]:text-[13.5px]', // @media (max-width:400px)
      'leading-[1.25]', // .dayline{line-height:1.25}
      'whitespace-nowrap', // .dayline{white-space:nowrap}
      'items-center', // .dayline{align-items:center}
    ]) {
      expect(cls).toContain(rule)
    }
  })

  it('the 新規 spark PRECEDES its value (mock: SPARK + <b>val</b>), never follows it', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const newItem = itemTexts(container).findIndex((s) => s.includes('新規'))
    const item = container.firstElementChild!.children[newItem]
    expect(item.firstElementChild!.tagName.toLowerCase()).toBe('svg')
    expect(item.children[1].tagName.toLowerCase()).toBe('b')
  })

  it('a closed day’s 休 is a VALUE (ink, bold), not a grey word (mock: <b>休</b>)', () => {
    const DayNumbersLine = loadDayNumbersLine({ closedDays: true })
    const { container } = render(
      <DayNumbersLine row={row({ closed: true, count: 0 })} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const closedCell = screen.getByText('休')
    expect(closedCell.tagName.toLowerCase()).toBe('b')
    expect(itemTexts(container)).toEqual(['0件', '休'])
  })
})
