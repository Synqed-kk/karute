// The 録音対象 card's view-model while a recording/pipeline is LIVE — split
// from RecordPageView so the derivation is unit-testable (field bug 7/29:
// the live branch degraded the card to 担当:— for the whole recording).
// While live the card MUST show the customer the audio is BOUND to (the
// recorder singleton's target) — never re-derive from nextAppointment,
// which can drift to today's first booking after navigation.

import type { RecordingTarget } from '@/lib/global-recorder'
import type { RecordTargetAppointment } from './RecordingTargetCard'

export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatHHMM(d: Date): string {
  // Pin to JST so the time-range pill ("11:30–12:30") matches the booking
  // dialog input regardless of where the renderer is running.
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "16:00–17:00" from a booking's start + duration, JST-pinned. */
export function formatTimeRange(startTimeIso: string, durationMinutes: number): string {
  const start = new Date(startTimeIso)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  return `${formatHHMM(start)}–${formatHHMM(end)}`
}

export function liveTargetCardAppointment(
  target: RecordingTarget,
  currentStaffName: string | null,
): RecordTargetAppointment {
  return {
    id: target.appointmentId ?? '',
    customerName: target.customerName,
    initials: deriveInitials(target.customerName),
    karuteNumber: target.karuteNumber,
    // Booking pixels from the bind-time snapshot; a legacy persisted take
    // without one falls back to the old placeholders.
    service: target.service ?? '—',
    timeRange: target.timeRange ?? '',
    // 担当 while live = the SAVE-AS identity (the signed-in user) so the
    // card agrees with the 別のスタッフの予約 banner (Liam ruling 7/29):
    // recording someone else's booking shows the recorder, never a blank.
    staffName: currentStaffName ?? '—',
    statusKey: target.statusKey ?? 'booked',
    isNew: target.isNew ?? false,
  }
}
