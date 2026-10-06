/**
 * 担当未定 (PR-B piece 1): a booking core imported with no staff is shown at
 * its time, kept under every staff filter, counted once in 件, and never
 * offered as a recording target.
 */
import type { Appointment } from '@synqed-kk/client'
import {
  getAppointmentsByDateWithClient,
  isCountedBooking,
  isRecordingTarget,
} from '@/lib/appointments/by-date'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'

const DAY = new Date('2026-09-15T00:00:00+09:00')
const NOW = new Date('2026-09-15T05:00:00+09:00')

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    starts_at: '2026-09-15T01:00:00Z',
    ends_at: '2026-09-15T02:00:00Z',
    duration_minutes: 60,
    title: 'カット',
    notes: null,
    status: 'SCHEDULED',
    source: 'QUICKRESERVE',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  } as unknown as Appointment
}

function dayClient(rows: Appointment[]) {
  const staffList = jest.fn(async () => ({
    staff: [
      { id: 's1', user_id: 'p1', name: '佐藤' },
      { id: 's2', user_id: 'p2', name: '鈴木' },
    ],
    total: 2,
  }))
  return {
    client: {
      appointments: { list: jest.fn(async () => ({ appointments: rows, total: rows.length })) },
      karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) },
      staff: { list: staffList },
    } as never,
    staffList,
  }
}

const list = (rows: Appointment[], includeCancelled = false) =>
  getAppointmentsByDateWithClient(dayClient(rows).client, '2026-09-15', {
    nameById: new Map([['c9', '山田']]),
    includeCancelled,
  })

describe('by-date keeps a staff-less BOOKING', () => {
  it('keeps it (staff_profile_id null), still drops a customerless BOOKING and every BLOCK', async () => {
    const rows = await list([
      appt({ id: 'ok', staff_id: 's1' }),
      appt({ id: 'no-staff', staff_id: null, customer_id: 'c9' }),
      appt({ id: 'no-customer', staff_id: null, customer_id: null }),
      appt({ id: 'block', kind: 'BLOCK', staff_id: null, customer_id: 'c9' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['ok', 'no-staff'])
    const noStaff = rows.find((r) => r.id === 'no-staff')!
    expect(noStaff.staff_profile_id).toBeNull()
    expect(noStaff.customers).toEqual({ name: '山田' })
    expect(rows.find((r) => r.id === 'ok')!.staff_profile_id).toBe('p1')
  })

  it('a cancelled staff-less booking is dropped unless includeCancelled', async () => {
    const rows = [appt({ id: 'gone', staff_id: null, status: 'CANCELLED' })]
    expect((await list(rows)).map((r) => r.id)).toEqual([])
    expect((await list(rows, true)).map((r) => r.id)).toEqual(['gone'])
  })

  it('件 equals the rows shown for a day with one staff-less booking', async () => {
    const day = [
      appt({ id: 'ok-1' }),
      appt({ id: 'ok-2', staff_id: 's2', customer_id: 'c2' }),
      appt({ id: 'no-staff', staff_id: null, customer_id: 'c9' }),
      appt({ id: 'block', kind: 'BLOCK', customer_id: null }),
    ]
    const shown = await list(day)
    expect(shown).toHaveLength(3)
    expect(day.filter(isCountedBooking)).toHaveLength(shown.length)
  })

  it('30 staff-less bookings render from ONE staff read (no per-row fetch)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      appt({ id: `ns-${i}`, staff_id: null, customer_id: 'c9' }),
    )
    const { client, staffList } = dayClient(rows)
    const shown = await getAppointmentsByDateWithClient(client, '2026-09-15', { nameById: new Map() })
    expect(shown).toHaveLength(30)
    expect(staffList).toHaveBeenCalledTimes(1)
  })

  it('source STAFF with no staff (core rejects it; defensive) still maps without throwing', async () => {
    const rows = await list([appt({ id: 'odd', staff_id: null, source: 'STAFF' as never })])
    expect(rows.map((r) => [r.id, r.staff_profile_id])).toEqual([['odd', null]])
  })
})

describe('recording target', () => {
  it('a staff-less row is never a recording target; a staffed one is', async () => {
    const rows = await list([appt({ id: 'ok' }), appt({ id: 'no-staff', staff_id: null })])
    expect(rows.filter(isRecordingTarget).map((r) => r.id)).toEqual(['ok'])
  })
})

describe('the Self / All / one-staff filter never hides 担当未定', () => {
  async function screenFor(staffFilter: string, activeStaffId: string | null) {
    const dayAppointments = await list([
      appt({ id: 'mine', staff_id: 's1' }),
      appt({ id: 'theirs', staff_id: 's2', customer_id: 'c2', starts_at: '2026-09-15T03:00:00Z' }),
      appt({ id: 'no-staff', staff_id: null, customer_id: 'c9', starts_at: '2026-09-15T04:00:00Z' }),
    ])
    const screen = buildAppointmentsScreen({
      locale: 'ja',
      now: NOW,
      selectedDate: DAY,
      staffFilter,
      staffList: [
        { id: 'p1', full_name: '佐藤' },
        { id: 'p2', full_name: '鈴木' },
      ] as never,
      activeStaffId,
      storeStaffIds: null,
      orgSettings: null,
      customers: [],
      dayAppointments,
      weekRange: null,
      monthRange: null,
      weekRangeAppts: null,
      monthRangeAppts: null,
      dayWindow: null,
      enrichment: new Map(),
      packUsage: new Map(),
    } as never)
    return (screen as unknown as { reservationViews: Array<{ id: string; staffId: string | null; staffName: string; staffColorKey: string }> }).reservationViews
  }

  it.each([
    ['all', null, ['mine', 'theirs', 'no-staff']],
    ['self', 'p1', ['mine', 'no-staff']],
    ['p2', 'p1', ['theirs', 'no-staff']],
  ])('filter %s keeps the staff-less booking', async (filter, self, ids) => {
    const views = await screenFor(filter, self)
    expect(views.map((v) => v.id).sort()).toEqual([...ids].sort())
    const ns = views.find((v) => v.id === 'no-staff')!
    expect(ns.staffId).toBeNull()
    expect(ns.staffName).toBe('')
    expect(ns.staffColorKey).toBe('neutral')
  })
})
