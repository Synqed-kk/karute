/**
 * Coverage for the reservation-view adapter (PR 18, replay/18):
 * computeDisplayStatus (the 5-state precedence ladder) and
 * appointmentsToReservationViews (AppointmentRow[] → ReservationView[]),
 * including null/missing-field handling for customer name, title, and staff.
 *
 * Pure logic — no mocks. Staff colors are now assigned DISTINCTLY over the
 * roster (assignStaffColors, sorted-index), so staffColorKey is asserted
 * against that same map rather than a per-id hash. An off-roster staff id
 * falls back to 'neutral'.
 */
import {
  computeDisplayStatus,
  appointmentsToReservationViews,
  type DisplayStatus,
} from '@/lib/adapters/reservation-view'
import { assignStaffColors } from '@/lib/staff-colors'
import type { AppointmentRow } from '@/actions/appointments'
import type { StaffMember } from '@/lib/staff'

const MIN = 60_000
const NOW = new Date('2024-06-01T05:00:00Z') // 14:00 JST

function row(over: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: 'a1',
    staff_profile_id: 'staff-1',
    client_id: 'cust-1',
    // Default start: well in the future so terminal/time rules don't fire.
    start_time: new Date(NOW.getTime() + 60 * MIN).toISOString(),
    duration_minutes: 60,
    title: 'Cut & Color',
    notes: null,
    karute_record_id: null,
    created_at: '2024-05-01T00:00:00Z',
    customers: { name: 'Hanako Tanaka' },
    synqed_status: 'SCHEDULED',
    source: 'MANUAL',
    ...over,
  }
}

function staff(over: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 'staff-1',
    full_name: 'Yuki Sato',
    has_pin: true,
    created_at: '2024-01-01T00:00:00Z',
    ...over,
  }
}

describe('computeDisplayStatus — terminal states (highest precedence)', () => {
  it('maps COMPLETED to "completed"', () => {
    expect(computeDisplayStatus(row({ synqed_status: 'COMPLETED' }), NOW)).toBe('completed')
  })

  it('maps CANCELLED to "completed"', () => {
    expect(computeDisplayStatus(row({ synqed_status: 'CANCELLED' }), NOW)).toBe('completed')
  })

  it('terminal status beats an in-progress time window', () => {
    const r = row({
      synqed_status: 'COMPLETED',
      start_time: new Date(NOW.getTime() - 10 * MIN).toISOString(),
      duration_minutes: 60,
    })
    expect(computeDisplayStatus(r, NOW)).toBe('completed')
  })
})

describe('computeDisplayStatus — in-session', () => {
  it('maps IN_PROGRESS to "in_session" even for a future-timed row', () => {
    expect(computeDisplayStatus(row({ synqed_status: 'IN_PROGRESS' }), NOW)).toBe('in_session')
  })

  it('maps a SCHEDULED row whose window contains now to "in_session"', () => {
    const r = row({
      start_time: new Date(NOW.getTime() - 10 * MIN).toISOString(),
      duration_minutes: 60,
    })
    expect(computeDisplayStatus(r, NOW)).toBe('in_session')
  })

  it('treats now === start as in_session (boundary, inclusive)', () => {
    const r = row({ start_time: NOW.toISOString(), duration_minutes: 60 })
    expect(computeDisplayStatus(r, NOW)).toBe('in_session')
  })
})

describe('computeDisplayStatus — time-completed', () => {
  it('maps a SCHEDULED row whose end is in the past to "completed"', () => {
    const r = row({
      start_time: new Date(NOW.getTime() - 120 * MIN).toISOString(),
      duration_minutes: 60,
    })
    expect(computeDisplayStatus(r, NOW)).toBe('completed')
  })

  it('treats now === end as still in_session (only now > end is completed)', () => {
    // start = now - 60m, duration 60m => end === now exactly.
    const r = row({
      start_time: new Date(NOW.getTime() - 60 * MIN).toISOString(),
      duration_minutes: 60,
    })
    expect(computeDisplayStatus(r, NOW)).toBe('in_session')
  })
})

describe('computeDisplayStatus — future SCHEDULED finer labels', () => {
  it('maps a synced (non-MANUAL) future booking to "booked" (no 未確定)', () => {
    expect(computeDisplayStatus(row({ source: 'QUICKRESERVE' }), NOW)).toBe('booked')
  })

  it('first-time customer wins on a synced booking → "new"', () => {
    const r = row({ source: 'SALON_BOARD' })
    expect(computeDisplayStatus(r, NOW, { isFirstTimeCustomer: true })).toBe('new')
  })

  it('maps a MANUAL first-time-customer future booking to "new"', () => {
    expect(computeDisplayStatus(row(), NOW, { isFirstTimeCustomer: true })).toBe('new')
  })

  it('maps a MANUAL returning-customer future booking to "booked"', () => {
    expect(computeDisplayStatus(row(), NOW, { isFirstTimeCustomer: false })).toBe('booked')
  })

  it('defaults to "booked" when no options are supplied', () => {
    expect(computeDisplayStatus(row(), NOW)).toBe('booked')
  })
})

describe('appointmentsToReservationViews', () => {
  it('maps a populated row to the full view shape', () => {
    const isFirst = new Map<string, boolean>([['cust-1', false]])
    const [view] = appointmentsToReservationViews([row()], [staff()], NOW, isFirst)
    expect(view).toMatchObject({
      id: 'a1',
      staffId: 'staff-1',
      staffName: 'Yuki Sato',
      durationMin: 60,
      customerName: 'Hanako Tanaka',
      service: 'Cut & Color',
      displayStatus: 'booked',
      clientId: 'cust-1',
      karuteRecordId: null,
      isFirstTimeVisit: false,
    })
    // Single-staff roster → that staff takes the first palette color (index 0).
    expect(view.staffColorKey).toBe(assignStaffColors(['staff-1']).get('staff-1')!.key)
    // startTimeHm rendered in JST (now+60m from 14:00 JST = 15:00).
    expect(view.startTimeHm).toBe('15:00')
    expect(view.customerInitials).toBe('H')
  })

  it('renders startTimeHm in Asia/Tokyo, not UTC', () => {
    // 11:30 JST booking = 02:30 UTC start_time.
    const r = row({ start_time: '2024-06-01T02:30:00Z' })
    const [view] = appointmentsToReservationViews([r], [staff()], NOW)
    expect(view.startTimeHm).toBe('11:30')
  })

  it('falls back to "—" name and "—" initials when the customer relation is null', () => {
    const r = row({ customers: null })
    const [view] = appointmentsToReservationViews([r], [staff()], NOW)
    expect(view.customerName).toBe('—')
    expect(view.customerInitials).toBe('—')
  })

  it('uses an empty service string when title is null', () => {
    const r = row({ title: null })
    const [view] = appointmentsToReservationViews([r], [staff()], NOW)
    expect(view.service).toBe('')
  })

  it('uses an empty staffName when the staff record is missing from the list', () => {
    const r = row({ staff_profile_id: 'ghost' })
    const [view] = appointmentsToReservationViews([r], [staff()], NOW)
    expect(view.staffName).toBe('')
    // 'ghost' isn't in the roster passed to the adapter → neutral fallback.
    expect(view.staffColorKey).toBe('neutral')
  })

  it('skips staff entries with a null full_name when building the name map', () => {
    const r = row({ staff_profile_id: 'staff-x' })
    const view = appointmentsToReservationViews(
      [r],
      [staff({ id: 'staff-x', full_name: null })],
      NOW,
    )[0]
    expect(view.staffName).toBe('')
  })

  it('defaults isFirstTimeVisit to false when the client is absent from the map', () => {
    const [view] = appointmentsToReservationViews([row()], [staff()], NOW, new Map())
    expect(view.isFirstTimeVisit).toBe(false)
    expect(view.displayStatus).toBe('booked')
  })

  it('drives the "new" displayStatus from the first-time map', () => {
    const isFirst = new Map<string, boolean>([['cust-1', true]])
    const [view] = appointmentsToReservationViews([row()], [staff()], NOW, isFirst)
    expect(view.isFirstTimeVisit).toBe(true)
    expect(view.displayStatus).toBe('new')
  })

  it('computes a non-Latin grapheme initial for a Japanese name', () => {
    const r = row({ customers: { name: '田中花子' } })
    const [view] = appointmentsToReservationViews([r], [staff()], NOW)
    expect(view.customerInitials).toBe('田')
  })

  it('returns "—" initials for a whitespace-only customer name', () => {
    const r = row({ customers: { name: '   ' } })
    const [view] = appointmentsToReservationViews([r], [staff()], NOW)
    expect(view.customerInitials).toBe('—')
  })

  it('maps multiple rows independently and preserves order', () => {
    const rows = [
      row({ id: 'r1', client_id: 'c1', customers: { name: 'Alice' } }),
      row({ id: 'r2', client_id: 'c2', customers: { name: 'Bob' }, synqed_status: 'COMPLETED' }),
    ]
    const isFirst = new Map<string, boolean>([['c1', true]])
    const views = appointmentsToReservationViews(rows, [staff()], NOW, isFirst)
    expect(views.map((v) => v.id)).toEqual(['r1', 'r2'])
    expect(views[0].displayStatus).toBe('new')
    expect(views[1].displayStatus).toBe('completed')
  })

  it('returns an empty array for empty input', () => {
    const views: { id: string }[] = appointmentsToReservationViews([], [staff()], NOW)
    expect(views).toEqual([])
  })
})

describe('DisplayStatus type surface', () => {
  it('every documented status is reachable', () => {
    const seen = new Set<DisplayStatus>()
    seen.add(computeDisplayStatus(row({ synqed_status: 'COMPLETED' }), NOW))
    seen.add(computeDisplayStatus(row({ synqed_status: 'IN_PROGRESS' }), NOW))
    seen.add(computeDisplayStatus(row({ source: 'QUICKRESERVE' }), NOW))
    seen.add(computeDisplayStatus(row(), NOW, { isFirstTimeCustomer: true }))
    seen.add(computeDisplayStatus(row(), NOW))
    expect(seen).toEqual(new Set(['completed', 'in_session', 'new', 'booked']))
  })
})

describe('appointmentsToReservationViews — pack usage (残3/10 pill)', () => {
  it('threads pack usage onto the view when the customer holds an active pack', () => {
    const packs = new Map([['cust-1', { remaining: 3, size: 10 }]])
    const [view] = appointmentsToReservationViews(
      [row()],
      [staff()],
      NOW,
      new Map(),
      new Map(),
      packs,
    )
    expect(view.pack).toEqual({ remaining: 3, size: 10 })
  })

  it('pack is null when the customer has no entry in the map', () => {
    const [view] = appointmentsToReservationViews(
      [row()],
      [staff()],
      NOW,
      new Map(),
      new Map(),
      new Map(),
    )
    expect(view.pack).toBe(null)
  })

  it('pack defaults to null when the caller omits the map (back-compat)', () => {
    const [view] = appointmentsToReservationViews([row()], [staff()], NOW)
    expect(view.pack).toBe(null)
  })
})

describe('real ledger data beats title-string heuristics (chopstick)', () => {
  const packs = (entry: { remaining: number; size: number } | null) =>
    entry ? new Map([['cust-1', entry]]) : new Map()

  it('needsRenewal fires from remaining 0 even without 終了 in the title', () => {
    const r = row({ title: '10回券' })
    const [view] = appointmentsToReservationViews(
      [r], [staff()], NOW, new Map(), new Map(), packs({ remaining: 0, size: 10 }),
    )
    expect(view.needsRenewal).toBe(true)
  })

  it('ledger says sessions remain → NO renewal even when the title says 終了', () => {
    const r = row({ title: '6回券終了' })
    const [view] = appointmentsToReservationViews(
      [r], [staff()], NOW, new Map(), new Map(), packs({ remaining: 3, size: 6 }),
    )
    expect(view.needsRenewal).toBe(false)
  })

  it('no ledger entry → falls back to the 終了 title marker (pre-import)', () => {
    const r = row({ title: '6回券終了' })
    const [view] = appointmentsToReservationViews(
      [r], [staff()], NOW, new Map(), new Map(), packs(null),
    )
    expect(view.needsRenewal).toBe(true)
  })

  it('a ledger entry marks the customer as pack holder → never 新規, even with a plain title', () => {
    const r = row({ title: 'メンテナンス' })
    const isFirst = new Map([['cust-1', true]])
    const [view] = appointmentsToReservationViews(
      [r], [staff()], NOW, isFirst, new Map(), packs({ remaining: 5, size: 10 }),
    )
    expect(view.isFirstTimeVisit).toBe(false)
  })
})
