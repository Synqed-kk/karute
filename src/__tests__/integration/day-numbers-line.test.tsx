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
  countLine: '{n}件',
  hours: '{h}時間',
  minutes: '{m}分',
  loading: '予約状況を読み込み中…',
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

  it("'off' → 予約, 稼働, キャンセル (free OFF), next unused metric — never 予約時間 beside 稼働%", () => {
    const DayNumbersLine = loadDayNumbersLine({ freeTimeCell: false })
    const { container } = render(
      <DayNumbersLine row={row({ bookedMinutes: 100 })} soloMode={false} typeSlot="off" locale="ja" />,
    )
    // R2-1: 稼働 21% and 予約時間 1時間40分 are the same minutes in two units.
    expect(itemTexts(container)).toEqual(['11件', '21%稼働', '0キャンセル', '0無断'])
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
  it('the block carries the mock line-for-line: gap 14, padding 2px 0, margin-bottom 8, nowrap — font size is the app’s own 13px (2026-09-15 type-system fix), no breakpoint step', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const cls = container.firstElementChild!.className
    for (const rule of [
      'gap-[14px]', // .dayline{gap:14px}
      'py-0.5', // .dayline{padding:2px 0}
      'mb-2', // .dayline{margin:0 0 8px}
      'text-[13px]', // app's value size (ReservationMobileAgenda.tsx :316)
      'leading-[1.25]', // .dayline{line-height:1.25}
      'whitespace-nowrap', // .dayline{white-space:nowrap}
      'items-center', // .dayline{align-items:center}
    ]) {
      expect(cls).toContain(rule)
    }
    expect(cls).not.toContain('max-[400px]:text-[13.5px]')
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

describe('DayNumbersLine — the pending state is two shims, not nothing (R3-18)', () => {
  it('renders the mock’s two 52×11 shims while the router transition runs', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale="ja" pending />,
    )
    const shims = container.querySelectorAll('.reservation-shim')
    expect(shims).toHaveLength(2)
    for (const shim of Array.from(shims)) {
      expect(shim.className).toContain('w-[52px]')
      expect(shim.className).toContain('h-[11px]')
    }
    // no stale number survives the move (the sr-only status text added below,
    // Greptile G2, carries no digits either)
    expect(container.querySelector('[data-day-line]')!.textContent).not.toMatch(/\d/)
  })

  it('is announced to screen readers too — an sr-only role="status" carrying the shared loading key (Greptile G2, DayNumbersLine.tsx:94)', () => {
    const DayNumbersLine = loadDayNumbersLine()
    render(<DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale="ja" pending />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(MESSAGES.loading)
    expect(status.className).toContain('sr-only')
  })

  it('not pending renders no status role — the announcement stops with the shimmer', () => {
    const DayNumbersLine = loadDayNumbersLine()
    render(<DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale="ja" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the loaded line’s block height, so the list card below does not jump', () => {
    // jsdom cannot measure, so the rule is pinned rather than the pixels: the
    // line's min-height is its own loaded block height — 1.25em of content at
    // whichever font size the breakpoint gives it (16.875 px at 393, 17.5 px
    // at 430) plus the 0.25rem of py-0.5, because min-height is border-box.
    // Measured 20.88 px loaded AND pending at 393; the proof is Playwright's.
    const DayNumbersLine = loadDayNumbersLine()
    const loaded = render(<DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale="ja" />)
    const busy = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale="ja" pending />,
    )
    const cls = (r: { container: HTMLElement }) =>
      r.container.querySelector('[data-day-line]')!.className
    expect(cls(loaded)).toContain('min-h-[calc(1.25em+0.25rem)]')
    expect(cls(busy)).toBe(cls(loaded))
  })

  it('a pending line with no row yet still holds the space', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={null} soloMode={false} typeSlot="off" locale="ja" pending />,
    )
    expect(container.querySelectorAll('.reservation-shim')).toHaveLength(2)
  })

  it('no row and NOT pending stays absent (the skew fallback owns that case)', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={null} soloMode={false} typeSlot="off" locale="ja" />,
    )
    expect(container.querySelector('[data-day-line]')).toBeNull()
  })
})

describe('DayNumbersLine — the spark is the shared component (R3-19)', () => {
  it('renders the same two-star glyph the week cell does, on the 新規 tone', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const spark = container.querySelector('[data-new-spark]')!
    expect(spark.querySelectorAll('path')).toHaveLength(2)
    expect(spark.getAttribute('stroke-width')).toBe('1.8')
    // mock `.dayline .it.nw svg{align-self:center}` — re-centred against the
    // baseline-aligned row
    expect(spark.getAttribute('class')).toContain('self-center')
    expect(spark.getAttribute('class')).toContain('text-[var(--reservation-new-chip-bg)]')
  })
})
