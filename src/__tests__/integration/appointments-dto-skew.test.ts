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
    expect(dto.dayTotals?.dateIso).toBe('2026-09-15')
    expect(dto.dayTotals?.cancelledCount).toBe(1)
  })

  it('⚖ PKT-2 — a month cell with no newCount reads 0, never a crash', () => {
    // The skew that matters: a phone baked with THIS schema talking to a
    // server that predates PKT-2. The cell must parse and print nothing,
    // rather than blanking the whole 月 screen.
    const dto = AppointmentsScreenDTO.parse({
      ...OLD_PAYLOAD,
      view: 'month',
      weekData: null,
      weekStartIso: null,
      monthData: [
        {
          id: '2026-09-15',
          dateIso: '2026-09-15T00:00:00.000Z',
          inMonth: true,
          isToday: false,
          count: 4,
          density: 'medium',
        },
      ],
    })
    expect(dto.monthData![0].newCount).toBe(0)
    // …and a server that DOES send it round-trips the number.
    const withCount = AppointmentsScreenDTO.parse({
      ...OLD_PAYLOAD,
      view: 'month',
      weekData: null,
      weekStartIso: null,
      monthData: [
        {
          id: '2026-09-15',
          dateIso: '2026-09-15T00:00:00.000Z',
          inMonth: true,
          isToday: false,
          count: 4,
          density: 'medium',
          newCount: 2,
        },
      ],
    })
    expect(withCount.monthData![0].newCount).toBe(2)
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
