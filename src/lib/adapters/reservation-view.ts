import type { AppointmentRow } from '@/actions/appointments'
import type { StaffMember } from '@/lib/staff'
import { getStaffColor, type StaffColorKey } from '@/lib/staff-colors'

// ---------------------------------------------------------------------------
// Adapter: AppointmentRow -> ReservationView for the reservation UI.
//
// Display-status mapping (phase 1, 3 states):
//   COMPLETED, CANCELLED -> 'completed'  (inactive — greyed out)
//   IN_PROGRESS          -> 'in_session' (explicit signal beats time)
//   SCHEDULED + time     -> 'completed' | 'in_session' | 'booked'
//
// 'pending' and 'new' are deferred. 'pending' requires a synqed-core schema
// change (no PENDING-equivalent in AppointmentStatus today). 'new' requires a
// first-visit lookup deferred to phase 1.5.
// ---------------------------------------------------------------------------

export type DisplayStatus = 'booked' | 'in_session' | 'completed'

export interface ReservationView {
  id: string
  staffId: string
  startTimeHm: string
  durationMin: number
  customerName: string
  customerInitials: string
  service: string
  displayStatus: DisplayStatus
  staffColorKey: StaffColorKey
}

function hm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '—'
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const first = seg.segment(trimmed)[Symbol.iterator]().next().value as
    | { segment?: string }
    | undefined
  return first?.segment ?? trimmed[0] ?? '—'
}

export function computeDisplayStatus(row: AppointmentRow, now: Date): DisplayStatus {
  if (row.synqed_status === 'COMPLETED' || row.synqed_status === 'CANCELLED') return 'completed'
  if (row.synqed_status === 'IN_PROGRESS') return 'in_session'
  const start = new Date(row.start_time).getTime()
  const end = start + row.duration_minutes * 60_000
  if (now.getTime() > end) return 'completed'
  if (now.getTime() >= start) return 'in_session'
  return 'booked'
}

export function appointmentsToReservationViews(
  rows: AppointmentRow[],
  _staffList: StaffMember[],
  now: Date,
): ReservationView[] {
  return rows.map((r) => {
    const customerName = r.customers?.name ?? '—'
    return {
      id: r.id,
      staffId: r.staff_profile_id,
      startTimeHm: hm(r.start_time),
      durationMin: r.duration_minutes,
      customerName,
      customerInitials: initialsOf(customerName),
      service: r.title ?? 'セッション',
      displayStatus: computeDisplayStatus(r, now),
      staffColorKey: getStaffColor(r.staff_profile_id).key,
    }
  })
}
