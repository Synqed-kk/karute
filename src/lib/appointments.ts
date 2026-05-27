import {
  formatMinuteOfDay,
  normalizeOperatingHours,
  utcToLocalDayAndMinute,
} from '@/lib/operating-hours'

export interface AppointmentInput {
  /** New canonical name — matches the appointments table column.
   *  Either this or the legacy `staffId` alias may be supplied;
   *  consumers should resolve via `resolveStaffProfileId(input)`. */
  staffProfileId?: string
  /** @deprecated Use staffProfileId. Kept for legacy callers during
   *  the rename; consumers fall back to this if staffProfileId is
   *  not provided. A follow-up cleanup PR will drop the alias. */
  staffId?: string
  clientId: string
  startTime: string
  durationMinutes: number
  tzOffsetMinutes?: number
  title?: string
  notes?: string
}

/** Returns the staff id from an AppointmentInput, preferring the new
 *  `staffProfileId` field over the legacy `staffId` alias. Returns
 *  null when neither is set — callers should treat that as a
 *  validation error. */
export function resolveStaffProfileId(input: AppointmentInput): string | null {
  return input.staffProfileId ?? input.staffId ?? null
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
