import {
  formatMinuteOfDay,
  normalizeOperatingHours,
  utcToLocalDayAndMinute,
} from '@/lib/operating-hours'

export interface AppointmentInput {
  staffProfileId: string
  clientId: string
  startTime: string
  durationMinutes: number
  tzOffsetMinutes?: number
  title?: string
  notes?: string
}

export async function validateAppointmentTime(input: AppointmentInput, operatingHours: unknown): Promise<string | null> {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    return 'Duration must be a positive number of minutes.'
  }

  const startDate = new Date(input.startTime)
  if (Number.isNaN(startDate.getTime())) {
    return 'Invalid appointment start time.'
  }

  const tzOffsetMinutes = Number.isFinite(input.tzOffsetMinutes) ? (input.tzOffsetMinutes as number) : 0
  const { dayKey, minuteOfDay } = utcToLocalDayAndMinute(startDate, tzOffsetMinutes)
  const hours = normalizeOperatingHours(operatingHours)[dayKey]
  const endMinute = minuteOfDay + input.durationMinutes

  if (minuteOfDay < hours.openMinute || endMinute > hours.closeMinute) {
    return `Appointment must be within operating hours (${formatMinuteOfDay(hours.openMinute)}-${formatMinuteOfDay(hours.closeMinute)}).`
  }

  return null
}
