/**
 * Reservation-view adapter: maps AppointmentRow -> ReservationView with derived
 * fields (display status, formatted time, customer initials, staff color key).
 *
 * Display status mapping (phase 1 — 3 states):
 *   COMPLETED, CANCELLED   -> 'completed'  (treated as inactive)
 *   IN_PROGRESS            -> 'in_session' (explicit override)
 *   SCHEDULED + time-based -> 'completed' | 'in_session' | 'booked'
 *
 * 'pending' and 'new' are deferred — current synqed-core has no PENDING analog
 * and first-visit lookup is out of scope for this phase.
 */

import {
  appointmentsToReservationViews,
  computeDisplayStatus,
} from '@/lib/adapters/reservation-view'
import type { AppointmentRow } from '@/actions/appointments'
import type { StaffMember } from '@/lib/staff'

function row(over: Partial<AppointmentRow>): AppointmentRow {
  return {
    id: 'a1',
    staff_profile_id: 'staff-1',
    client_id: 'cust-1',
    start_time: '2026-05-12T10:00:00.000Z',
    duration_minutes: 60,
    title: 'Facial',
    notes: null,
    karute_record_id: null,
    created_at: '2026-05-12T08:00:00.000Z',
    customers: { name: 'Yamada Hanako' },
    synqed_status: 'SCHEDULED',
    ...over,
  } as AppointmentRow
}

const NOW_MID = new Date('2026-05-12T10:30:00.000Z')

describe('computeDisplayStatus', () => {
  it('returns "completed" when ends_at < now', () => {
    const r = row({ start_time: '2026-05-12T08:00:00.000Z', duration_minutes: 30 })
    expect(computeDisplayStatus(r, NOW_MID)).toBe('completed')
  })

  it('returns "in_session" when now is inside [start, end]', () => {
    expect(computeDisplayStatus(row({}), NOW_MID)).toBe('in_session')
  })

  it('returns "in_session" when raw status is IN_PROGRESS regardless of time', () => {
    const r = row({ start_time: '2026-05-12T14:00:00.000Z', synqed_status: 'IN_PROGRESS' })
    expect(computeDisplayStatus(r, NOW_MID)).toBe('in_session')
  })

  it('returns "booked" when start is future and raw status is SCHEDULED', () => {
    const r = row({ start_time: '2026-05-12T14:00:00.000Z' })
    expect(computeDisplayStatus(r, NOW_MID)).toBe('booked')
  })

  it('returns "completed" when raw status is COMPLETED even if times are weird', () => {
    const r = row({
      start_time: '2026-05-12T20:00:00.000Z',
      duration_minutes: 60,
      synqed_status: 'COMPLETED',
    })
    expect(computeDisplayStatus(r, NOW_MID)).toBe('completed')
  })

  it('returns "completed" for CANCELLED rows', () => {
    const r = row({ synqed_status: 'CANCELLED' })
    expect(computeDisplayStatus(r, NOW_MID)).toBe('completed')
  })
})

describe('appointmentsToReservationViews', () => {
  it('maps rows to ReservationView with derived fields', () => {
    const result = appointmentsToReservationViews(
      [row({})],
      [{ id: 'staff-1', full_name: 'Tanaka Misaki' } as StaffMember],
      NOW_MID,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'a1',
      staffId: 'staff-1',
      durationMin: 60,
      customerName: 'Yamada Hanako',
      service: 'Facial',
      displayStatus: 'in_session',
    })
    expect(result[0].startTimeHm).toMatch(/^\d{2}:\d{2}$/)
    expect(result[0].customerInitials.length).toBeGreaterThan(0)
  })

  it('falls back to "—" customer name when customers join is null', () => {
    const result = appointmentsToReservationViews(
      [row({ customers: null })],
      [],
      NOW_MID,
    )
    expect(result[0].customerName).toBe('—')
    expect(result[0].customerInitials).toBe('—')
  })

  it('uses appointment.title verbatim when present, else "セッション" fallback', () => {
    const result = appointmentsToReservationViews(
      [row({ title: null })],
      [],
      NOW_MID,
    )
    expect(result[0].service).toBe('セッション')
  })
})
