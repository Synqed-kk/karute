/**
 * @jest-environment jsdom
 *
 * T-4 (FIXLIST-TYPE-SYSTEM-2026-09-15) — the guard for the type-system rule:
 * "the writing's too fat… doesn't match the system" (Liam 23:4x,
 * feedback_design_system_type_not_mock_type.md). The mock rules layout/
 * motion/colour; the app's own type scale (ReservationMobileAgenda.tsx —
 * value 13/600, word/label 11-12/500) rules the text on DayNumbersLine and
 * WeekRows. Neither component has any element below 11px, so the rule here
 * is simple: no rendered element in either surface carries `font-bold`
 * (700) at all. MUTANT (m1, manually verified): reverting either VALUE
 * constant or a bare class back to `font-bold` turns this red.
 */
import { render } from '@testing-library/react'
import { capacityRowFields, type WeekDayRowData } from '@/lib/adapters/reservation'
import { withDerivedCapacity } from './__fixtures__/capacity-row'

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
  summaryRange: '{from}〜{to}',
  sep: '·',
  loading: '予約状況を読み込み中…',
  failed: '予約状況を取得できませんでした。もう一度お試しください。',
  rowAria: '{date}、{cells}',
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
  // MERGE 2026-09-16 (PR #934) — this fixture arrived from feat/booking-week-face,
  // where WeekDayRowData had no capacity half. On this branch the capacity
  // model owns nine more fields, and a row that sets capacityDefensible
  // without them describes a day with no capacity at all — the 稼働/空き
  // cells would render 未設定 and this guard would stop seeing the very
  // elements it exists to check. So the row is built the way every other
  // 予約-surface test builds one: through the shared derivation, never a
  // re-typed percentage. What the test ASSERTS is untouched.
  return withDerivedCapacity({
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
    ...capacityRowFields(undefined),
    returningCount: 2,
    ...over,
  }, over)
}

function sevenDays(): WeekDayRowData[] {
  const isoDays = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']
  return isoDays.map((dateIso, i) => row({ dateIso, dateNumber: 14 + i }))
}

// The rule is "no font-bold at ≥11px". Neither component ever renders an
// element below 11px (the smallest explicit size either uses is
// text-[11px]; the two Tailwind `text-xs` status lines are 12px) — so any
// font-bold hit here is a violation, full stop.
function boldViolations(container: HTMLElement): string[] {
  const hits: string[] = []
  for (const el of Array.from(container.querySelectorAll('*'))) {
    const cls = el.getAttribute('class') ?? ''
    if (/\bfont-bold\b/.test(cls)) {
      hits.push(`<${el.tagName.toLowerCase()} class="${cls}">${el.textContent ?? ''}`)
    }
  }
  return hits
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

describe('type system — no font-bold on DayNumbersLine', () => {
  it('a loaded line, every typeSlot', () => {
    for (const typeSlot of ['new', 'returning', 'off'] as const) {
      const DayNumbersLine = loadDayNumbersLine()
      const { container } = render(
        <DayNumbersLine row={row()} soloMode={false} typeSlot={typeSlot} locale="ja" />,
      )
      expect(boldViolations(container)).toEqual([])
    }
  })

  it('the closed-day 休 line', () => {
    const DayNumbersLine = loadDayNumbersLine({ closedDays: true })
    const { container } = render(
      <DayNumbersLine row={row({ closed: true, count: 0 })} soloMode={false} typeSlot="new" locale="ja" />,
    )
    expect(boldViolations(container)).toEqual([])
  })

  it('the pending shimmer', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale="ja" pending />,
    )
    expect(boldViolations(container)).toEqual([])
  })

  // Positive pins (2026-09-16, FIX-931-R1): the font-bold checks above only
  // prove 700 is absent — they would not have caught the merge dropping
  // main's 2026-09-15 type-system fix back to the mock's own weights/size.
  // These pin the actual values so that regression goes red.
  it('the wrapper carries flat text-[13px], never the mock breakpoint step', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const wrapper = container.querySelector('[data-day-line]')
    const cls = wrapper?.getAttribute('class') ?? ''
    expect(cls).toMatch(/\btext-\[13px\]/)
    expect(cls).not.toMatch(/max-\[400px\]:/)
    expect(cls).not.toMatch(/\btext-\[14px\]/)
  })

  it('every label span carries font-medium, never font-semibold', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const labelSpans = Array.from(container.querySelectorAll('[data-day-line] > span'))
    expect(labelSpans.length).toBeGreaterThan(0)
    for (const el of labelSpans) {
      const cls = el.getAttribute('class') ?? ''
      expect(cls).toMatch(/\bfont-medium\b/)
      expect(cls).not.toMatch(/\bfont-semibold\b/)
    }
  })

  it('every value carries font-semibold tabular-nums', () => {
    const DayNumbersLine = loadDayNumbersLine()
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="new" locale="ja" />,
    )
    const values = Array.from(container.querySelectorAll('[data-day-line] b'))
    expect(values.length).toBeGreaterThan(0)
    for (const el of values) {
      const cls = el.getAttribute('class') ?? ''
      expect(cls).toMatch(/\bfont-semibold\b/)
      expect(cls).toMatch(/\btabular-nums\b/)
    }
  })
})

describe('type system — no font-bold on WeekRows', () => {
  it('seven open rows, summary line included', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(
      <WeekRows
        rows={sevenDays()}
        weekStartIso="2026-09-14"
        selectedDateIso="2026-09-15"
        todayIso="2026-09-15"
        soloMode={false}
        typeSlot="new"
        locale="ja"
        onPickDay={() => {}}
      />,
    )
    expect(boldViolations(container)).toEqual([])
  })

  it('a closed row', () => {
    const WeekRows = loadWeekRows({ closedDays: true })
    const days = sevenDays()
    days[0] = row({ ...days[0], closed: true, count: 0 })
    const { container } = render(
      <WeekRows
        rows={days}
        weekStartIso="2026-09-14"
        selectedDateIso="2026-09-15"
        todayIso="2026-09-15"
        soloMode={false}
        typeSlot="new"
        locale="ja"
        onPickDay={() => {}}
      />,
    )
    expect(boldViolations(container)).toEqual([])
  })

  it('pending rows', () => {
    const WeekRows = loadWeekRows()
    const { container } = render(
      <WeekRows
        rows={sevenDays()}
        weekStartIso="2026-09-14"
        selectedDateIso="2026-09-15"
        todayIso="2026-09-15"
        soloMode={false}
        typeSlot="new"
        locale="ja"
        pending
        onPickDay={() => {}}
      />,
    )
    expect(boldViolations(container)).toEqual([])
  })
})
