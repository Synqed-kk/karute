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
  countLine: '{n}件',
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
  it("'new' → count, utilization, cancelled (free OFF — never 予約時間 beside 稼働%), new", () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: false })
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 240, availableMinutes: 480 })
    expect(weekRowCells(r, { soloMode: false, typeSlot: 'new', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'cancelled', 'new',
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

  it("'off' → count, utilization, cancelled (free OFF), next unused metric", () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: false })
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 100, availableMinutes: 480 })
    expect(weekRowCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'cancelled', 'noShow',
    ])
  })
})

describe('dayLineCells — day-line order (spec §8/§2)', () => {
  it("'new' → count, new, utilization, cancelled (free OFF — the day line follows R2-1 too)", () => {
    const { dayLineCells } = loadMetricMenu({ freeTimeCell: false })
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 240, availableMinutes: 480 })
    expect(dayLineCells(r, { soloMode: false, typeSlot: 'new', t }).map((c) => c.key)).toEqual([
      'count', 'new', 'utilization', 'cancelled',
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

  it("'off' → count, utilization, cancelled (free OFF), next unused metric", () => {
    const { dayLineCells } = loadMetricMenu({ freeTimeCell: false })
    const r = row({ capacityDefensible: true, hoursSaved: true, bookedMinutes: 100, availableMinutes: 480 })
    expect(dayLineCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => c.key)).toEqual([
      'count', 'utilization', 'cancelled', 'noShow',
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
    // R2-3 — pinned by KEY, and by the invariant that owns the seat, never by
    // a bare index. This case is about the metric CHOSEN: 稼働's slot falls
    // back to 予約時間 (no 稼働% is on this line, so R2-1 does not skip it),
    // and the placement seats a duration in a WIDE slot — cell 1 or cell 3.
    // R1 moved this assertion once already (`cells[1]` → `cells[2]`) because
    // it named a seat; naming the rule instead is what stops the next round
    // moving it again.
    expect(cells.map((c) => c.key)).toContain('bookedTime')
    // indices 0 and 2 ARE the wide column (the grid fills row-major)
    expect([0, 2]).toContain(cells.findIndex((c) => c.key === 'bookedTime'))
  })
})

describe('placeForGrid — a DURATION never sits in the 100 px column (R1-1, D10)', () => {
  // The week grid is `130px 100px` (WeekRows.tsx `.wkgrid`, R2-2) and fills
  // row-major, so cells 1+3 land in the WIDE column and cells 2+4 in the
  // narrow one. 「予約時間 6時間30分」 does not fit 100 px — on the live Dev
  // Salon week it overflowed its box (D10). The last step of weekRowCells
  // seats a duration in the one movable wide slot; 予約 keeps cell 1, and the
  // DAY LINE (one flowing line) is never re-placed.
  const DURATION: ReadonlySet<string> = new Set(['bookedTime', 'free'])

  it('holds across typeSlot × defensible × freeTimeCell × solo × hoursSaved × over-capacity', () => {
    for (const freeTimeCell of [true, false]) {
      const { weekRowCells, dayLineCells } = loadMetricMenu({ freeTimeCell })
      for (const typeSlot of ['new', 'returning', 'off'] as const) {
        for (const capacityDefensible of [true, false]) {
          for (const soloMode of [true, false]) {
            for (const hoursSaved of [true, false]) {
              // R3-1 — 390 is 81% of the saved capacity, 700 is 146% of it.
              // The over-capacity row is the one that used to put a duration
              // in the narrow column; it belongs in the matrix, not only in
              // its own test.
              for (const bookedMinutes of [390, 700]) {
              const where = `${typeSlot}/def=${capacityDefensible}/free=${freeTimeCell}/solo=${soloMode}/hours=${hoursSaved}/booked=${bookedMinutes}`
              const r = row({
                capacityDefensible,
                hoursSaved,
                bookedMinutes,
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

              // Cells 2 and 4 are the narrow column: NO duration sits there.
              // R1 had to pin `max(0, durations − 1)` instead, because the
              // defensible row then carried TWO durations (空き AND 予約時間)
              // and only one wide slot can move — D-1 of FIX-REPORT-1B-WIRE-R1.
              // R2-1 removed that row shape at the source (稼働% and 予約時間
              // are one measure, so at most one duration is ever on a line), so
              // the packet's literal wording is satisfiable again and the
              // weaker pin is deleted rather than carried.
              const narrow = [1, 3].filter((i) => DURATION.has(keys[i])).length
              expect(`${where}:${narrow}`).toBe(`${where}:0`)
              }
            }
          }
        }
      }
    }
  })

  it("today's non-defensible store reads 予約 · キャンセル / 予約時間 · 無断", () => {
    // Every store with no solo_mode + saved hours — Dev Salon included. Before
    // R1-1 this row read 予約 · 予約時間 / キャンセル · 無断, with the duration
    // overflowing the narrow cell.
    const { weekRowCells } = loadMetricMenu()
    const r = row({ capacityDefensible: false, hoursSaved: false, bookedMinutes: 390 })
    expect(
      weekRowCells(r, { soloMode: false, typeSlot: 'off', t }).map((c) => `${c.label} ${c.value}`),
    ).toEqual(['予約 3件', 'キャンセル 0', '予約時間 6時間30分', '無断 0'])
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

describe('R2-1 — 稼働% and 予約時間 are ONE measure in two units, never both on a line', () => {
  // ⚖ LEAD 2026-09-15 17:3x. 稼働 N% and 予約時間 H時間M分 are the same booked
  // minutes told twice — a row printing both spent a cell saying nothing new.
  // So when 稼働% is on the line the fill order SKIPS 予約時間 and takes
  // キャンセル → 無断 → (the type's other people-count, after PKT-2). Both
  // surfaces: weekRowCells AND dayLineCells route through the same pickNext.
  //
  // 未設定 is NOT 稼働%: it prints no number at all, so the duration still
  // follows it — pinned below.
  const DEFENSIBLE = {
    capacityDefensible: true,
    hoursSaved: true,
    bookedMinutes: 390, // 6h30 of 8h → 81%
    availableMinutes: 480,
  }
  const read = (cells: { label: string; value: string }[]) =>
    cells.map((c) => `${c.label} ${c.value}`)

  it('capacity defensible + 空き ON → 予約 · 稼働% / 空き · キャンセル', () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: true })
    expect(read(weekRowCells(row(DEFENSIBLE), { soloMode: false, typeSlot: 'off', t }))).toEqual([
      '予約 3件', '稼働 81%', '空き 1時間30分', 'キャンセル 0',
    ])
  })

  it('capacity defensible + 空き OFF → 予約 · 稼働% / キャンセル · 無断, never 予約時間', () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: false })
    expect(read(weekRowCells(row(DEFENSIBLE), { soloMode: false, typeSlot: 'off', t }))).toEqual([
      '予約 3件', '稼働 81%', 'キャンセル 0', '無断 0',
    ])
  })

  it('not defensible → 予約 · キャンセル / 予約時間 · 無断 (R1 shape, unchanged)', () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: true })
    const r = row({ capacityDefensible: false, hoursSaved: false, bookedMinutes: 390 })
    expect(read(weekRowCells(r, { soloMode: false, typeSlot: 'off', t }))).toEqual([
      '予約 3件', 'キャンセル 0', '予約時間 6時間30分', '無断 0',
    ])
  })

  it('the DAY LINE follows the same rule, in both switch states', () => {
    const on = loadMetricMenu({ freeTimeCell: true })
    expect(read(on.dayLineCells(row(DEFENSIBLE), { soloMode: false, typeSlot: 'off', t }))).toEqual([
      '予約 3件', '稼働 81%', '空き 1時間30分', 'キャンセル 0',
    ])
    const off = loadMetricMenu({ freeTimeCell: false })
    expect(read(off.dayLineCells(row(DEFENSIBLE), { soloMode: false, typeSlot: 'off', t }))).toEqual([
      '予約 3件', '稼働 81%', 'キャンセル 0', '無断 0',
    ])
  })

  it('未設定 is not 稼働% — it prints no number, so the duration still follows it', () => {
    const { weekRowCells, dayLineCells } = loadMetricMenu({ freeTimeCell: true })
    const r = row({ capacityDefensible: false, hoursSaved: false, closed: false })
    const ctx = { soloMode: true, typeSlot: 'off' as const, t }
    expect(weekRowCells(r, ctx).map((c) => c.key)).toEqual(['count', 'unset', 'bookedTime', 'cancelled'])
    expect(dayLineCells(r, ctx).map((c) => c.key)).toEqual(['count', 'unset', 'bookedTime', 'cancelled'])
  })

  it('holds across typeSlot × defensible × freeTimeCell × solo × hoursSaved, on BOTH surfaces', () => {
    for (const freeTimeCell of [true, false]) {
      const { weekRowCells, dayLineCells } = loadMetricMenu({ freeTimeCell })
      for (const typeSlot of ['new', 'returning', 'off'] as const) {
        for (const capacityDefensible of [true, false]) {
          for (const soloMode of [true, false]) {
            for (const hoursSaved of [true, false]) {
              const where = `${typeSlot}/def=${capacityDefensible}/free=${freeTimeCell}/solo=${soloMode}/hours=${hoursSaved}`
              const r = row({ capacityDefensible, hoursSaved, bookedMinutes: 390, availableMinutes: 480 })
              const ctx = { soloMode, typeSlot, t }
              for (const [surface, cells] of [
                ['week', weekRowCells(r, ctx)],
                ['day', dayLineCells(r, ctx)],
              ] as const) {
                const keys = cells.map((c) => c.key)
                const both = keys.includes('utilization') && keys.includes('bookedTime')
                expect(`${surface}/${where}:${both}`).toBe(`${surface}/${where}:false`)
                // The consequence the lead named: one measure per row means a
                // row can carry AT MOST ONE duration (空き or 予約時間) — which
                // is what lets the placement test below pin narrow === 0.
                const durations = keys.filter((k) => k === 'free' || k === 'bookedTime')
                expect(`${surface}/${where}:${durations.join('+') || 'none'}`).toMatch(
                  /:(none|free|bookedTime)$/,
                )
              }
            }
          }
        }
      }
    }
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

describe('>100% utilization is never defensible (R3-1 — ONE predicate for 稼働 AND 空き)', () => {
  // The day that over-ran its saved capacity: 700 booked minutes against 480
  // available, capacity otherwise defensible. Before R3-1 稼働 called that
  // indefensible (pct > 100) and fell through to 予約時間, while 空き still
  // read `capacityDefensible` on its own and printed 空き 0分 — TWO durations
  // on one line, and the placement could only move one of them out of the
  // 100 px column. One predicate, read by both slots, is what removes the
  // disagreement at the source.
  const OVER = {
    capacityDefensible: true,
    hoursSaved: true,
    bookedMinutes: 700,
    availableMinutes: 480,
    closed: false,
  }
  const read = (cells: { label: string; value: string }[]) =>
    cells.map((c) => `${c.label} ${c.value}`)

  it('a pct over 100 falls through instead of rendering a percent', () => {
    const { weekRowCells } = loadMetricMenu()
    const cells = weekRowCells(row(OVER), { soloMode: false, typeSlot: 'off', t })
    expect(cells[1].key).not.toBe('utilization')
    expect(cells[1].value).not.toMatch(/%/)
  })

  it('the WEEK row reads the full line: no 空き, one duration, in the wide cell', () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: true })
    const cells = weekRowCells(row(OVER), { soloMode: false, typeSlot: 'off', t })
    expect(read(cells)).toEqual(['予約 3件', 'キャンセル 0', '予約時間 11時間40分', '無断 0'])
    // indices 1 and 3 ARE the narrow column (the grid fills row-major)
    expect(cells.filter((c) => c.key === 'free')).toHaveLength(0)
    expect(cells.filter((c) => c.key === 'bookedTime' || c.key === 'free')).toHaveLength(1)
    expect([1, 3].filter((i) => cells[i].key === 'bookedTime' || cells[i].key === 'free')).toEqual([])
  })

  it('the DAY LINE reads the same set — one duration, no 空き', () => {
    const { dayLineCells } = loadMetricMenu({ freeTimeCell: true })
    const cells = dayLineCells(row(OVER), { soloMode: false, typeSlot: 'off', t })
    expect(read(cells)).toEqual(['予約 3件', '予約時間 11時間40分', 'キャンセル 0', '無断 0'])
    expect(cells.filter((c) => c.key === 'bookedTime' || c.key === 'free')).toHaveLength(1)
  })

  it('a 100.4% day rounds to 100 but is still over — the predicate reads the minutes, not the rounding', () => {
    const { weekRowCells } = loadMetricMenu({ freeTimeCell: true })
    const cells = weekRowCells(
      row({ ...OVER, bookedMinutes: 482, availableMinutes: 480 }),
      { soloMode: false, typeSlot: 'off', t },
    )
    expect(cells.map((c) => c.key)).not.toContain('utilization')
    expect(cells.map((c) => c.key)).not.toContain('free')
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
    // The fourth cell is キャンセル, not 予約時間: 稼働% is already on the line
    // (R2-1). 空き stays — it is a different measure, not the same one twice.
    expect(weekRowCells(r, ctx).map((c) => c.key)).toEqual([
      'count', 'utilization', 'free', 'cancelled',
    ])
    expect(dayLineCells(r, ctx).map((c) => c.key)).toEqual([
      'count', 'utilization', 'free', 'cancelled',
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

describe('property — 1000 seeded rows × 3 typeSlots × 2 soloModes (LENS-2, mulberry32 seed 42)', () => {
  // The blind round's own generator, kept as the structural guard rather than
  // as a one-off finding. It is what found R3-1: the random rows included
  // `capacityDefensible: true` days whose bookings ran past the saved
  // capacity, and the week grid then left a duration in the narrow column.
  // Deterministic by seed, so a failure is always reproducible.
  function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const DURATION: ReadonlySet<string> = new Set(['bookedTime', 'free'])

  it('every combination yields four distinct, non-empty cells with no duration in the narrow column', () => {
    const rnd = mulberry32(42)
    const int = (max: number) => Math.floor(rnd() * (max + 1))
    const bool = () => rnd() < 0.5
    const { weekRowCells, dayLineCells } = loadMetricMenu()

    for (let i = 0; i < 1000; i++) {
      const r = row({
        count: int(60),
        bookedMinutes: int(900),
        availableMinutes: int(960),
        newCustomerCount: int(30),
        returningCount: int(30),
        cancelledCount: int(20),
        noShowDayCount: int(20),
        capacityDefensible: bool(),
        hoursSaved: bool(),
        closed: bool(),
      })
      for (const typeSlot of ['new', 'returning', 'off'] as const) {
        for (const soloMode of [true, false]) {
          const where = `#${i}/${typeSlot}/solo=${soloMode}/booked=${r.bookedMinutes}/avail=${r.availableMinutes}/def=${r.capacityDefensible}`
          const ctx = { soloMode, typeSlot, t }
          for (const [surface, cells] of [
            ['week', weekRowCells(r, ctx)],
            ['day', dayLineCells(r, ctx)],
          ] as const) {
            const at = `${surface}/${where}`
            expect(`${at}:${cells.length}`).toBe(`${at}:4`)
            expect(`${at}:${new Set(cells.map((c) => c.key)).size}`).toBe(`${at}:4`)
            for (const c of cells) {
              expect(`${at}:${c.key}:${c.value === '' || c.value === '-' || c.value === '—'}`).toBe(
                `${at}:${c.key}:false`,
              )
            }
            if (surface === 'week') {
              // cells 2 and 4 are the 100 px column — never a duration there
              const narrow = [1, 3].filter((n) => DURATION.has(cells[n].key))
              expect(`${at}:${narrow.join(',')}`).toBe(`${at}:`)
            }
            // R2-1's consequence, re-checked on random input: one measure per
            // line means at most one duration on it.
            const durations = cells.filter((c) => DURATION.has(c.key)).length
            expect(`${at}:${durations <= 1}`).toBe(`${at}:true`)
          }
        }
      }
    }
  })
})
