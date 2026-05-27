// Adapter between Karute's integer-minute operating hours and the redesigned
// settings page's HH:MM + closed-flag shape (from the design spike).
//
// Karute stores: { mon: { openMinute: 600, closeMinute: 1140 }, ... }
// Spike uses:    [{ day: 'mon', open: '10:00', close: '19:00', closed: false }, ...]
//
// Existing "closed day" convention in Karute: openMinute === closeMinute.

import {
  WEEKDAY_KEYS,
  formatMinuteOfDay,
  type OperatingHours,
  type WeekdayKey,
} from './operating-hours'

export interface BusinessDay {
  day: WeekdayKey
  open: string // "HH:MM"
  close: string // "HH:MM"
  closed: boolean
}

export function toBusinessDays(hours: OperatingHours): BusinessDay[] {
  return WEEKDAY_KEYS.map((key) => {
    const d = hours[key]
    return {
      day: key,
      open: formatMinuteOfDay(d.openMinute),
      close: formatMinuteOfDay(d.closeMinute),
      closed: d.openMinute === d.closeMinute,
    }
  })
}

export function fromBusinessDays(days: BusinessDay[]): OperatingHours {
  const out = {} as OperatingHours
  for (const d of days) {
    out[d.day] = {
      openMinute: parseHHMM(d.open),
      // Closed day collapses close to open, matching Karute's convention.
      closeMinute: d.closed ? parseHHMM(d.open) : parseHHMM(d.close),
    }
  }
  return out
}

function parseHHMM(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return 0
  const hours = Math.max(0, Math.min(24, Number(match[1])))
  const minutes = Math.max(0, Math.min(59, Number(match[2])))
  return hours * 60 + minutes
}
