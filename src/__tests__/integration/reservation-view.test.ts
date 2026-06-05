/**
 * Reservation-view adapter: maps AppointmentRow -> ReservationView with derived
 * fields (display status, formatted time, customer initials, staff color key).
 *
 * Display status mapping (4 states):
 *   COMPLETED, CANCELLED         -> 'completed'  (treated as inactive)
 *   IN_PROGRESS or time-in       -> 'in_session' (explicit override)
 *   end < now                    -> 'completed'
 *   isFirstTimeCustomer === true -> 'new'        (genuine first visit only)
 *   else                         -> 'booked'
 *
 * 'new' is derived (not a stored column). The old 'pending' state — which just
 * meant "synced from QuickReserve" — was removed; a synced booking is 予約済.
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
    source: 'MANUAL',
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

  it('returns "booked" for a synced future booking (no more 未確定/pending)', () => {
    const r = row({ start_time: '2026-05-12T14:00:00.000Z', source: 'QUICKRESERVE' })
    expect(computeDisplayStatus(r, NOW_MID)).toBe('booked')
  })

  it('returns "new" when the customer is first-time (no past appointments)', () => {
    const r = row({ start_time: '2026-05-12T14:00:00.000Z' })
    expect(computeDisplayStatus(r, NOW_MID, { isFirstTimeCustomer: true })).toBe('new')
  })

  it('returns "new" for a first-time customer even on a synced booking', () => {
    const r = row({ start_time: '2026-05-12T14:00:00.000Z', source: 'QUICKRESERVE' })
    expect(computeDisplayStatus(r, NOW_MID, { isFirstTimeCustomer: true })).toBe('new')
  })

  it('still returns "booked" for a returning customer on a manual future booking', () => {
    const r = row({ start_time: '2026-05-12T14:00:00.000Z' })
    expect(computeDisplayStatus(r, NOW_MID, { isFirstTimeCustomer: false })).toBe('booked')
  })
})

describe('appointmentsToReservationViews', () => {
  it('maps rows to ReservationView with derived fields', () => {
    const result = appointmentsToReservationViews(
      [row({ karute_record_id: 'k-9' })],
      [{ id: 'staff-1', full_name: 'Tanaka Misaki' } as StaffMember],
      NOW_MID,
      // isFirstTimeByClient — returning customer = false.
      new Map([['cust-1', false]]),
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'a1',
      staffId: 'staff-1',
      durationMin: 60,
      customerName: 'Yamada Hanako',
      service: 'Facial',
      displayStatus: 'in_session',
      clientId: 'cust-1',
      karuteRecordId: 'k-9',
      isFirstTimeVisit: false,
    })
    expect(result[0].startTimeHm).toMatch(/^\d{2}:\d{2}$/)
    expect(result[0].customerInitials.length).toBeGreaterThan(0)
  })

  it('flags isFirstTimeVisit when the customer is first-time', () => {
    const result = appointmentsToReservationViews(
      [row({ start_time: '2026-05-12T14:00:00.000Z' })],
      [],
      NOW_MID,
      new Map([['cust-1', true]]),
    )
    expect(result[0].isFirstTimeVisit).toBe(true)
  })

  it('never flags 新規 for a 回数券 booking, even when the client map says first-time', () => {
    // An established ticket holder whose past visits / QR existing-customer flag
    // haven't synced still shows as first-time in the client map. The course
    // title ("10回券") is the reliable returning-customer signal — overrides it.
    // Guards Liam's agenda where every 回数券 regular wrongly read 新規.
    const result = appointmentsToReservationViews(
      [row({ start_time: '2026-05-12T14:00:00.000Z', title: '10回券' })],
      [],
      NOW_MID,
      new Map([['cust-1', true]]),
    )
    expect(result[0].displayStatus).toBe('booked')
    expect(result[0].isFirstTimeVisit).toBe(false)
  })

  it('still flags 新規 for a genuine new-course booking (no ticket in the title)', () => {
    const result = appointmentsToReservationViews(
      [row({ start_time: '2026-05-12T14:00:00.000Z', title: '新規コース ¥1,980' })],
      [],
      NOW_MID,
      new Map([['cust-1', true]]),
    )
    expect(result[0].displayStatus).toBe('new')
    expect(result[0].isFirstTimeVisit).toBe(true)
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

  it('leaves service empty when title is null (no misleading fallback)', () => {
    // Previously fell back to 'セッション' which read like a real service
    // name on the agenda — Liam called this out. Empty string lets the
    // row hide the service line entirely.
    const result = appointmentsToReservationViews(
      [row({ title: null })],
      [],
      NOW_MID,
    )
    expect(result[0].service).toBe('')
  })
})
