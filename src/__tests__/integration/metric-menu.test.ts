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
  bookedTime: '稼働時間',
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
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: false })
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
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: false })
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 100, availableMinutes: 480 })
    expect(weekRowCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'bookedTime', 'cancelled',
    ])
  })
})

describe('dayLineCells — day-line order (spec §8/§2)', () => {
  it("'new' → count, new, utilization, bookedTime (free OFF)", () => {
    const { dayLineCells } = loadMetricMenu({ freeTimeCell: false })
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
    const { dayLineCells } = loadMetricMenu({ freeTimeCell: false })
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
    expect(cells.map((c) => c.key)).not.toContain('unset')
    // 稼働's slot falls back to 稼働時間 — which R1-1 then seats in the WIDE
    // column (cell 3). This case is about the metric CHOSEN, not its seat.
    expect(cells[2].key).toBe('bookedTime')
  })
})

describe('placeForGrid — a DURATION never sits in the 100 px column (R1-1, D10)', () => {
  // The week grid is `120px 100px` (WeekRows.tsx `.wkgrid`) and fills
  // row-major, so cells 1+3 land in the WIDE column and cells 2+4 in the
  // narrow one. 「稼働時間 6時間30分」 does not fit 100 px — on the live Dev
  // Salon week it overflowed its box (D10). The last step of weekRowCells
  // seats a duration in the one movable wide slot; 予約 keeps cell 1, and the
  // DAY LINE (one flowing line) is never re-placed.
  const DURATION: ReadonlySet<string> = new Set(['bookedTime', 'free'])

  it('holds across typeSlot × defensible × freeTimeCell × solo × hoursSaved', () => {
    for (const freeTimeCell of [true, false]) {
      const { weekRowCells, dayLineCells } = loadMetricMenu({ freeTimeCell })
      for (const typeSlot of ['new', 'returning', 'off'] as const) {
        for (const capacityDefensible of [true, false]) {
          for (const soloMode of [true, false]) {
            for (const hoursSaved of [true, false]) {
              const where = `${typeSlot}/def=${capacityDefensible}/free=${freeTimeCell}/solo=${soloMode}/hours=${hoursSaved}`
              const r = row({
                capacityDefensible,
                hoursSaved,
                bookedMinutes: 390,
                availableMinutes: 480,
              })
              const ctx = { soloMode, typeSlot, t }
              const keys = weekRowCells(r, ctx).map((c) => c.key)
              const day = dayLineCells(r, ctx).map((c) => c.key)

              // 予約 keeps cell 1.
              expect(`${where}:${keys[0]}`).toBe(`${where}:count`)

              // Only POSITIONS move: the four cells stay the set the fill
              // order chose. dayLineCells runs that same fill order and is
              // deliberately NOT re-placed, so it is an independent oracle.
              expect({ where, set: [...keys].sort() }).toEqual({
                where,
                set: [...day].sort(),
              })

              // …and the week row's order BEFORE placement, reconstructed from
              // that same oracle: identical for 'off'/'returning', and for
              // 'new' the day line only moves 新規 to the front.
              const before =
                typeSlot === 'new' ? [day[0], day[2], day[3], day[1]] : day

              // Nothing moves unless it must: when the wide slot (cell 3)
              // already holds a duration, the placement leaves the row alone
              // — it never trades one duration for another.
              if (DURATION.has(before[2])) {
                expect({ where, keys }).toEqual({ where, keys: before })
              }

              // Cells 2 and 4 are the 100 px column. Only ONE wide slot can
              // move (cell 1 is 予約), so a row that holds BOTH durations must
              // keep exactly one of them narrow — and never more than that.
              const durations = keys.filter((k) => DURATION.has(k)).length
              const narrow = [1, 3].filter((i) => DURATION.has(keys[i])).length
              expect(`${where}:${narrow}`).toBe(`${where}:${Math.max(0, durations - 1)}`)
            }
          }
        }
      }
    }
  })

  it("today's non-defensible store reads 予約 · キャンセル / 稼働時間 · 無断", () => {
    // Every store with no solo_mode + saved hours — Dev Salon included. Before
    // R1-1 this row read 予約 · 稼働時間 / キャンセル · 無断, with the duration
    // overflowing the narrow cell.
    const { weekRowCells } = loadMetricMenu()
    const r = row({ capacityDefensible: false, hoursSaved: false, bookedMinutes: 390 })
    expect(
      weekRowCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => `${c.label} ${c.value}`),
    ).toEqual(['予約 3件', 'キャンセル 0', '稼働時間 6時間30分', '無断 0'])
  })

  it('the DAY LINE keeps the fill order — one flowing line, never re-placed', () => {
    const { dayLineCells } = loadMetricMenu()
    const r = row({ capacityDefensible: false, hoursSaved: false, bookedMinutes: 390 })
    expect(dayLineCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => c.key)).toEqual([
      'count',
      'bookedTime',
      'cancelled',
      'noShow',
    ])
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

describe('the SHIPPED switch registry (⚖ Liam 9/15 11:1x — 空き ON, everywhere)', () => {
  // The tests above mock the registry to pin behaviour per switch VALUE. This
  // one pins the value the app actually ships with: no doMock, the real
  // module, so flipping the constant back to false goes red here.
  it('freeTimeCell is ON, and a defensible day really renders 空き', () => {
    const { BOOKING_SWITCHES } = jest.requireActual<
      typeof import('@/lib/appointments/booking-switches')
    >('@/lib/appointments/booking-switches')
    expect(BOOKING_SWITCHES.freeTimeCell).toBe(true)

    const { weekRowCells, dayLineCells } = jest.requireActual<typeof MetricMenu>(
      '@/lib/appointments/metric-menu',
    )
    const r = row({
      capacityDefensible: true,
      hoursSaved: true,
      bookedMinutes: 240,
      availableMinutes: 480,
    })
    const ctx = { soloMode: true, typeSlot: 'off' as const, t }
    expect(weekRowCells(r, ctx).map((c) => c.key)).toEqual([
      'count', 'utilization', 'free', 'bookedTime',
    ])
    expect(dayLineCells(r, ctx).map((c) => c.key)).toEqual([
      'count', 'utilization', 'free', 'bookedTime',
    ])
    expect(weekRowCells(r, ctx)[2].value).toBe('4時間')
  })
})

describe("typeSlot 'off' — the QR flag never prints (W-D, spec §8)", () => {
  // `newCustomerCount` today is the QR import flag (is_existing_customer ===
  // false), NOT the strict 「初回来店がこの日」 count PKT-2 will produce. Both
  // surfaces therefore ship with typeSlot 'off' until that producer lands, and
  // the fill order supplies the fourth cell instead. A cell that leaked the
  // flag would read as a real 新規 number and no one could tell.
  it('no cell carries the flag, on either surface, across the whole switch/conjunct matrix', () => {
    const POISON = 4242
    for (const freeTimeCell of [true, false]) {
      const { weekRowCells, dayLineCells } = loadMetricMenu({ freeTimeCell })
      for (const soloMode of [true, false]) {
        for (const capacityDefensible of [true, false]) {
          for (const hoursSaved of [true, false]) {
            const r = row({
              capacityDefensible,
              hoursSaved,
              newCustomerCount: POISON,
              bookedMinutes: 200,
              availableMinutes: 480,
            })
            const ctx = { soloMode, typeSlot: 'off' as const, t }
            for (const cells of [weekRowCells(r, ctx), dayLineCells(r, ctx)]) {
              expect(cells.map((c) => c.key)).not.toContain('new')
              expect(cells.map((c) => c.value).join('|')).not.toContain(String(POISON))
              expect(cells.some((c) => c.tone === 'new')).toBe(false)
            }
          }
        }
      }
    }
  })
})
