/**
 * The 予約 screen DTO is ADDITIVE, and every new key is defaulted.
 *
 * The thin bundle parses THIS SAME schema client-side from a baked copy, so a
 * required new key would blank the whole 予約 screen on any server/bundle skew —
 * a phone baked before the server, or a server rolled back under a newer phone.
 * These are the skew pins: an old payload still parses, and a new one survives
 * the round trip.
 */
import {
  AppointmentsScreenDTO,
  MonthCellDTO,
  WeekDayCardDataDTO,
} from '@/lib/app-api/appointments-screen-dto'

/** A week row exactly as a PRE-PKT-1a server would have emitted it. */
const OLD_WEEK_ROW = {
  dateNumber: 15,
  monthNumber: 9,
  weekdayLabel: '火',
  isToday: true,
  count: 3,
  bookedMinutes: 180,
  availableMinutes: 600,
  newCustomerCount: 1,
  remindersPending: 0,
  consentPending: 0,
  unconfirmed: 0,
  visibleBookings: [],
  hiddenCount: 0,
}

/** A whole screen payload as a pre-PKT-1a server would have emitted it. */
const OLD_PAYLOAD = {
  view: 'week' as const,
  selectedDateIso: '2026-09-15T00:00:00.000Z',
  staffFilter: 'all',
  staff: [],
  activeStaffId: null,
  authProfileId: null,
  customers: [],
  reservationViews: [],
  reservationStaff: [],
  businessHours: { start: 10, end: 24 },
  weekData: [OLD_WEEK_ROW],
  weekStartIso: '2026-09-15T00:00:00.000Z',
  monthData: null,
}

describe('WeekDayCardDataDTO — a row without the new keys still parses', () => {
  it('fills every new field with its safe default', () => {
    const row = WeekDayCardDataDTO.parse(OLD_WEEK_ROW)
    expect(row.dateIso).toBe('')
    expect(row.capacityDefensible).toBe(false)
    expect(row.hoursSaved).toBe(false)
    expect(row.closed).toBe(false)
    expect(row.cancelledCount).toBe(0)
    expect(row.noShowDayCount).toBe(0)
    expect(row.returningCount).toBe(0)
  })

  it('the three dead counters are defaulted now (step 1 of 3) and still read 0', () => {
    const bare = { ...OLD_WEEK_ROW } as Record<string, unknown>
    delete bare.remindersPending
    delete bare.consentPending
    delete bare.unconfirmed
    const row = WeekDayCardDataDTO.parse(bare)
    expect(row.remindersPending).toBe(0)
    expect(row.consentPending).toBe(0)
    expect(row.unconfirmed).toBe(0)
  })

  it('round-trips the new fields when the server does send them', () => {
    const row = WeekDayCardDataDTO.parse({
      ...OLD_WEEK_ROW,
      dateIso: '2026-09-15',
      capacityDefensible: true,
      hoursSaved: true,
      closed: false,
      cancelledCount: 2,
      noShowDayCount: 1,
      returningCount: 0,
    })
    expect(row.dateIso).toBe('2026-09-15')
    expect(row.capacityDefensible).toBe(true)
    expect(row.cancelledCount).toBe(2)
    expect(row.noShowDayCount).toBe(1)
  })
})

describe('AppointmentsScreenDTO — the new screen keys are defaulted', () => {
  it('a pre-PKT-1a payload parses, with dayTotals null and truncated false', () => {
    const dto = AppointmentsScreenDTO.parse(OLD_PAYLOAD)
    expect(dto.dayTotals).toBeNull()
    expect(dto.monthStartIso).toBeNull()
    expect(dto.monthCompareDelta).toBeNull()
    expect(dto.truncated).toBe(false)
    // …and nothing that already worked changed meaning.
    expect(dto.weekData).toHaveLength(1)
    expect(dto.weekData![0].count).toBe(3)
  })

  it('round-trips dayTotals, monthStartIso and truncated', () => {
    const dto = AppointmentsScreenDTO.parse({
      ...OLD_PAYLOAD,
      view: 'month',
      weekData: null,
      weekStartIso: null,
      monthData: [],
      monthStartIso: '2026-09-01T00:00:00.000Z',
      truncated: false,
      dayTotals: { ...OLD_WEEK_ROW, dateIso: '2026-09-15', cancelledCount: 1 },
    })
    expect(dto.monthStartIso).toBe('2026-09-01T00:00:00.000Z')
    expect(
      AppointmentsScreenDTO.parse({ ...OLD_PAYLOAD, monthCompareDelta: -3 }).monthCompareDelta,
    ).toBe(-3)
    expect(dto.dayTotals?.dateIso).toBe('2026-09-15')
    expect(dto.dayTotals?.cancelledCount).toBe(1)
  })

  it('a month cell from a server that predates `closed` parses as open', () => {
    // A2's new key. Without the default a phone bundle baked with it would
    // blank the whole 予約 screen the moment it met an older server, which is
    // the one failure this file exists to stop.
    const dto = AppointmentsScreenDTO.parse({
      ...OLD_PAYLOAD,
      view: 'month',
      weekData: null,
      weekStartIso: null,
      monthData: [
        {
          id: '2026-09-01',
          dateIso: '2026-08-31T15:00:00.000Z',
          inMonth: true,
          isToday: false,
          count: 2,
          density: 'light',
        },
      ],
    })
    expect(dto.monthData![0].closed).toBe(false)
  })

  it('a truncated payload carries the flag with null data', () => {
    const dto = AppointmentsScreenDTO.parse({
      ...OLD_PAYLOAD,
      weekData: null,
      truncated: true,
    })
    expect(dto.truncated).toBe(true)
    expect(dto.weekData).toBeNull()
    expect(dto.dayTotals).toBeNull()
  })
})

/**
 * ⚖ R1-11 — the capacity keys, both directions.
 *
 * Ten keys ride this round (the nine the model owns plus capacityDefensible),
 * and the thin bundle re-parses this SAME schema from a baked copy. A future
 * edit that drops one `.default()` would blank the whole 予約 screen on any
 * server/bundle skew, and nothing in CI would have caught it — the file above
 * only pins the PRIOR round's fields.
 */
describe('⚖ R1-11 — the capacity keys survive a bundle skew, both ways', () => {
  const CAPACITY_DEFAULTS = {
    capacityMinutes: null,
    lanes: 0,
    // Not 'none': that is the positive claim "this store runs classes", and a
    // server that sent no capacity keys never looked at the store (R1-8).
    laneKind: 'staff',
    hoursSource: null,
    occupancyPct: null,
    full: false,
    band: null,
    freeMinutes: null,
    // The pairing: no capacity, and a reason saying why — here, nobody looked.
    capacityReason: 'unknown',
    capacityDefensible: false,
  }

  const FULL_ROW = {
    ...OLD_WEEK_ROW,
    dateIso: '2026-09-15',
    capacityMinutes: 1200,
    lanes: 2,
    laneKind: 'staff' as const,
    hoursSource: 'store' as const,
    occupancyPct: 40,
    full: false,
    band: 'medium' as const,
    freeMinutes: 720,
    capacityReason: null,
    capacityDefensible: true,
    hoursSaved: true,
  }

  it('a STRIPPED week row lands on the ten documented defaults', () => {
    const row = WeekDayCardDataDTO.parse(OLD_WEEK_ROW) as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(CAPACITY_DEFAULTS)) {
      expect({ key, value: row[key] }).toEqual({ key, value })
    }
  })

  it('a STRIPPED month cell lands on the same ten — one spelling, two surfaces', () => {
    const cell = MonthCellDTO.parse({
      id: '2026-09-15',
      dateIso: '2026-09-15T00:00:00.000Z',
      inMonth: true,
      isToday: false,
      count: 3,
      density: 'medium',
    }) as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(CAPACITY_DEFAULTS)) {
      if (key === 'capacityDefensible') continue // week-row only
      expect({ key, value: cell[key] }).toEqual({ key, value })
    }
  })

  it('a FULL row round-trips every one of them, unchanged', () => {
    const row = WeekDayCardDataDTO.parse(FULL_ROW)
    expect(row.capacityMinutes).toBe(1200)
    expect(row.lanes).toBe(2)
    expect(row.laneKind).toBe('staff')
    expect(row.hoursSource).toBe('store')
    expect(row.occupancyPct).toBe(40)
    expect(row.full).toBe(false)
    expect(row.band).toBe('medium')
    expect(row.freeMinutes).toBe(720)
    expect(row.capacityDefensible).toBe(true)
  })

  it('an EXPLICIT null reason stays null — a real capacity keeps saying so', () => {
    // The default fires on `undefined` only, which is what lets "nobody looked"
    // and "there is a capacity here" stay two different answers.
    expect(WeekDayCardDataDTO.parse(FULL_ROW).capacityReason).toBeNull()
    expect(
      WeekDayCardDataDTO.parse({ ...FULL_ROW, capacityReason: 'over-concurrency' }).capacityReason,
    ).toBe('over-concurrency')
  })

  it('an OLD bundle parsing a NEW payload strips what it does not know, and still renders', () => {
    // The other direction: no .strict()/.passthrough() anywhere on these
    // schemas, so a newer server's extra keys are dropped rather than throwing.
    const row = WeekDayCardDataDTO.parse({
      ...FULL_ROW,
      somethingTheNextRoundAdds: 42,
      shiftMinutes: 999,
    }) as unknown as Record<string, unknown>
    expect(row.somethingTheNextRoundAdds).toBeUndefined()
    expect(row.shiftMinutes).toBeUndefined()
    expect(row.capacityMinutes).toBe(1200)
  })

  it('the whole screen payload carries them through weekData, dayTotals and monthData', () => {
    const dto = AppointmentsScreenDTO.parse({
      ...OLD_PAYLOAD,
      weekData: [FULL_ROW],
      dayTotals: FULL_ROW,
      monthData: [
        {
          id: '2026-09-15',
          dateIso: '2026-09-15T00:00:00.000Z',
          inMonth: true,
          isToday: false,
          count: 3,
          density: 'medium',
          capacityMinutes: 1200,
          lanes: 2,
          occupancyPct: 40,
        },
      ],
    })
    expect(dto.weekData![0].occupancyPct).toBe(40)
    expect(dto.dayTotals!.freeMinutes).toBe(720)
    expect(dto.monthData![0].capacityMinutes).toBe(1200)
    // …and the month cell's own unsent keys still default, cell by cell.
    expect(dto.monthData![0].capacityReason).toBe('unknown')
    expect(dto.monthData![0].band).toBeNull()
  })
})
