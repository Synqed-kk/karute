import {
  DEFAULT_OPERATING_HOURS,
  normalizeOperatingHours,
  validateDailyOperatingHours,
  utcToLocalDayAndMinute,
} from '@/lib/operating-hours'
import { validateAppointmentTime, type AppointmentInput } from '@/lib/appointments'

describe('operating hours utilities', () => {
  it('returns an error when open time is not earlier than close time', () => {
    expect(validateDailyOperatingHours({ openMinute: 600, closeMinute: 600 })).toBe(
      'Open time must be earlier than close time.'
    )
  })

  it('falls back to defaults when operating_hours payload is invalid', () => {
    const normalized = normalizeOperatingHours({
      mon: { openMinute: 900, closeMinute: 300 },
      tue: { openMinute: 480, closeMinute: 1200 },
    })

    expect(normalized.mon).toEqual(DEFAULT_OPERATING_HOURS.mon)
    expect(normalized.tue).toEqual({ openMinute: 480, closeMinute: 1200 })
    expect(normalized.sun).toEqual(DEFAULT_OPERATING_HOURS.sun)
  })

  it('derives local day and minute using timezone offset', () => {
    const source = new Date('2026-03-16T23:30:00.000Z')
    const result = utcToLocalDayAndMinute(source, -60)

    expect(result.dayKey).toBe('tue')
    expect(result.minuteOfDay).toBe(30)
  })
})

describe('appointment operating hours validation', () => {
  const operatingHours = {
    mon: { openMinute: 10 * 60, closeMinute: 18 * 60 },
    tue: { openMinute: 10 * 60, closeMinute: 18 * 60 },
    wed: { openMinute: 10 * 60, closeMinute: 18 * 60 },
    thu: { openMinute: 10 * 60, closeMinute: 18 * 60 },
    fri: { openMinute: 10 * 60, closeMinute: 18 * 60 },
    sat: { openMinute: 10 * 60, closeMinute: 18 * 60 },
    sun: { openMinute: 10 * 60, closeMinute: 18 * 60 },
  }

  function input(startTime: string, durationMinutes: number, tzOffsetMinutes: number): AppointmentInput {
    return {
      staffProfileId: 'staff-id',
      clientId: 'client-id',
      startTime,
      durationMinutes,
      tzOffsetMinutes,
    }
  }

  it('accepts appointments fully within configured hours', () => {
    const result = validateAppointmentTime(
      input('2026-03-16T11:00:00.000Z', 60, 0),
      operatingHours
    )

    expect(result).toBeNull()
  })

  it('rejects appointments that start before open', () => {
    const result = validateAppointmentTime(
      input('2026-03-16T09:30:00.000Z', 30, 0),
      operatingHours
    )

    expect(result).toBe('Appointment must be within operating hours (10:00-18:00).')
  })

  it('uses local day derived from timezone offset for validation', () => {
    const daySpecificHours = {
      ...operatingHours,
      tue: { openMinute: 8 * 60, closeMinute: 9 * 60 },
    }

    const result = validateAppointmentTime(
      input('2026-03-16T23:30:00.000Z', 30, -60),
      daySpecificHours
    )

    expect(result).toBe('Appointment must be within operating hours (08:00-09:00).')
  })
})
