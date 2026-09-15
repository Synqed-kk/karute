/**
 * Pure-logic coverage for metric-menu.ts (spec §8, packet W3/W7) — the
 * week-row grid order, the day-line order, the fallback fill order, and
 * 未設定 gating. No React here; WeekRows.tsx / DayNumbersLine.tsx are
 * covered separately (week-rows.test.tsx, day-numbers-line.test.tsx).
 */
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import type { Translate } from '@/lib/appointments/format-duration'
import type * as MetricMenu from '@/lib/appointments/metric-menu'

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

const t: Translate = (key, values) => {
  let s = MESSAGES[key] ?? key
  if (values) for (const [k, v] of Object.entries(values)) s = s.split(`{${k}}`).join(String(v))
  return s
}

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

// BOOKING_SWITCHES is a plain module constant (no settings door yet, spec
// §10) — tests that need a non-default switch mock the registry module
// per-call rather than editing the committed constants.
function loadMetricMenu(overrides: Partial<Record<string, boolean>> = {}): typeof MetricMenu {
  jest.resetModules()
  jest.doMock('@/lib/appointments/booking-switches', () => {
    const actual = jest.requireActual('@/lib/appointments/booking-switches') as {
      BOOKING_SWITCHES: Record<string, boolean>
    }
    return { BOOKING_SWITCHES: { ...actual.BOOKING_SWITCHES, ...overrides } }
  })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/lib/appointments/metric-menu')
}

afterEach(() => {
  jest.dontMock('@/lib/appointments/booking-switches')
  jest.resetModules()
})

describe('weekRowCells — grid order (spec §8/§3)', () => {
  it("'new' → count, utilization, bookedTime (free OFF), new", () => {
    const { weekRowCells } = loadMetricMenu()
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 240, availableMinutes: 480 })
    expect(weekRowCells(r, { soloMode: false, typeSlot: 'new', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'bookedTime', 'new',
    ])
  })

  it("'new' with freeTimeCell ON swaps the third cell to free", () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: true })
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 240, availableMinutes: 480 })
    expect(weekRowCells(r, { soloMode: false, typeSlot: 'new', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'free', 'new',
    ])
  })

  it("'returning' → count, returning, bookedTime, cancelled — unaffected by the switch", () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: true })
    expect(weekRowCells(row(), { soloMode: false, typeSlot: 'returning', t }).map((c) => c.key)).toEqual([
      'count', 'returning', 'bookedTime', 'cancelled',
    ])
  })

  it("'off' → count, utilization, bookedTime (free OFF), next unused metric", () => {
    const { weekRowCells } = loadMetricMenu()
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 100, availableMinutes: 480 })
    expect(weekRowCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'bookedTime', 'cancelled',
    ])
  })
})

describe('dayLineCells — day-line order (spec §8/§2)', () => {
  it("'new' → count, new, utilization, bookedTime (free OFF)", () => {
    const { dayLineCells } = loadMetricMenu()
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 240, availableMinutes: 480 })
    expect(dayLineCells(r, { soloMode: false, typeSlot: 'new', t }).map((c) => c.key)).toEqual([
      'count', 'new', 'utilization', 'bookedTime',
    ])
  })

  it("'new' with freeTimeCell ON swaps the fourth cell to free", () => {
    const { dayLineCells } = loadMetricMenu({ freeTimeCell: true })
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 240, availableMinutes: 480 })
    expect(dayLineCells(r, { soloMode: false, typeSlot: 'new', t }).map((c) => c.key)).toEqual([
      'count', 'new', 'utilization', 'free',
    ])
  })

  it("'returning' → count, returning, bookedTime, cancelled", () => {
    const { dayLineCells } = loadMetricMenu()
    expect(dayLineCells(row(), { soloMode: false, typeSlot: 'returning', t }).map((c) => c.key)).toEqual([
      'count', 'returning', 'bookedTime', 'cancelled',
    ])
  })

  it("'off' → count, utilization, bookedTime (free OFF), next unused metric", () => {
    const { dayLineCells } = loadMetricMenu()
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 100, availableMinutes: 480 })
    expect(dayLineCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'bookedTime', 'cancelled',
    ])
  })
})

describe('未設定 — only when the sole failing conjunct is the hours one', () => {
  it('solo ∧ !hoursSaved ∧ !closed → unset', () => {
    const { weekRowCells } = loadMetricMenu()
    const r = row({ capacityDefensible: false, hoursSaved: false, closed: false })
    expect(weekRowCells(r, { soloMode: true, typeSlot: 'off', t })[1]).toMatchObject({
      key: 'unset',
      value: '未設定',
      label: '稼働',
    })
  })

  it('not solo → no unset even with hours unsaved', () => {
    const { weekRowCells } = loadMetricMenu()
    const r = row({ capacityDefensible: false, hoursSaved: false, closed: false })
    expect(weekRowCells(r, { soloMode: false, typeSlot: 'off', t })[1].key).not.toBe('unset')
  })

  it('closed day → no unset even solo with hours unsaved', () => {
    const { weekRowCells } = loadMetricMenu()
    const r = row({ capacityDefensible: false, hoursSaved: false, closed: true })
    expect(weekRowCells(r, { soloMode: true, typeSlot: 'off', t })[1].key).not.toBe('unset')
  })

  it('solo store, two overlapping bookings (hours WERE saved) → next metric, not unset', () => {
    const { weekRowCells } = loadMetricMenu()
    // capacityDefensible is false because of the overlap conjunct, not the
    // hours conjunct — hoursSaved stays true, so 未設定 must NOT fire.
    const r = row({ capacityDefensible: false, hoursSaved: true, closed: false })
    const cells = weekRowCells(r, { soloMode: true, typeSlot: 'off', t })
    expect(cells[1].key).not.toBe('unset')
    expect(cells[1].key).toBe('bookedTime')
  })
})

describe('band thresholds (spec §2/§3: <35 low · 35–65 mid · >65 high)', () => {
  it('exact boundary: 34% low, 35% mid, 65% mid, 66% high', () => {
    const { weekRowCells } = loadMetricMenu()
    const tone = (pct: number) => {
      const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: pct, availableMinutes: 100 })
      return weekRowCells(r, { soloMode: false, typeSlot: 'off', t })[1].tone
    }
    expect(tone(34)).toBe('band-low')
    expect(tone(35)).toBe('band-mid')
    expect(tone(65)).toBe('band-mid')
    expect(tone(66)).toBe('band-high')
  })
})

describe('>100% utilization is never defensible', () => {
  it('a pct over 100 falls through instead of rendering a percent', () => {
    const { weekRowCells } = loadMetricMenu()
    const r = row({
      capacityDefensible: true,
      hoursSaved: true,
      bookedMinutes: 700,
      availableMinutes: 480,
      closed: false,
    })
    const cells = weekRowCells(r, { soloMode: false, typeSlot: 'off', t })
    expect(cells[1].key).not.toBe('utilization')
    expect(cells[1].value).not.toMatch(/%/)
  })
})

describe('the fill order never repeats a cell', () => {
  it('produces 4 distinct keys across every typeSlot/switch/context combination', () => {
    for (const typeSlot of ['new', 'returning', 'off'] as const) {
      for (const solo of [true, false]) {
        for (const defensible of [true, false]) {
          for (const hoursSaved of [true, false]) {
            for (const closed of [true, false]) {
              for (const freeTimeCell of [true, false]) {
                const { weekRowCells, dayLineCells } = loadMetricMenu({ freeTimeCell })
                const r = row({
                  capacityDefensible: defensible,
                  hoursSaved,
                  closed,
                  bookedMinutes: 200,
                  availableMinutes: 480,
                })
                const ctx = { soloMode: solo, typeSlot, t }
                for (const cells of [weekRowCells(r, ctx), dayLineCells(r, ctx)]) {
                  expect(cells).toHaveLength(4)
                  expect(new Set(cells.map((c) => c.key)).size).toBe(4)
                }
              }
            }
          }
        }
      }
    }
  })
})

describe('isClosedRow', () => {
  it('false when count > 0, even with the switch ON and closed true (a closed day WITH bookings still shows numbers)', () => {
    const { isClosedRow } = loadMetricMenu({ closedDays: true })
    expect(isClosedRow(row({ closed: true, count: 5 }))).toBe(false)
  })

  it('true when closed, zero bookings, and the switch is ON', () => {
    const { isClosedRow } = loadMetricMenu({ closedDays: true })
    expect(isClosedRow(row({ closed: true, count: 0 }))).toBe(true)
  })

  it('false while the switch stays OFF (today), even closed with zero bookings', () => {
    const { isClosedRow } = loadMetricMenu()
    expect(isClosedRow(row({ closed: true, count: 0 }))).toBe(false)
  })
})
