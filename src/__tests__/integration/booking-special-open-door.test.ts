/**
 * ⚖ W0.5 (PR A) — the booking DOOR reads 臨時営業日 too.
 *
 * fetchBookingDayHours already had the store's whole StoreBookingPolicy in
 * hand and read only its weekly_hours — special_open_days was fetched from
 * core and dropped. So a booking on a day the store explicitly opened (and
 * core's own requireStoreOpen accepts) was refused as 定休日 / 臨時休業.
 *
 * Pinned: the fetch carries the map; the door accepts inside the special
 * day's window and refuses outside it; a failed policy read knows no special
 * day; the create core lands the row.
 *
 * Pinned to TZ=UTC to mirror the deploy runtime.
 */
process.env.TZ = 'UTC'

// The house SDK stub (booking-closed-day-door.test.ts): this file's cores are
// driven through the explicit fake client below, never a real one.
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {
    status = 0
  },
}))

import { fetchBookingDayHours } from '@/lib/appointments/day-hours'
import { validateAppointmentTime } from '@/lib/appointments'
import { createAppointmentCore } from '@/lib/appointments/mutations'

/** 2026-09-16 is a WEDNESDAY in JST — this store's 定休日. */
const WED_1300_JST = '2026-09-16T04:00:00.000Z'
const WED_1100_JST = '2026-09-16T02:00:00.000Z'

const WEEK_WED_CLOSED = {
  mon: { open: '10:00', close: '19:00' },
  tue: { open: '10:00', close: '19:00' },
  wed: null,
  thu: { open: '10:00', close: '19:00' },
  fri: { open: '10:00', close: '19:00' },
  sat: { open: '10:00', close: '19:00' },
  sun: { open: '10:00', close: '19:00' },
}
const SPECIAL_WED = [{ date: '2026-09-16', open: '12:00', close: '18:00' }]
const ALL_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function client(policy: () => Promise<unknown>, closed: string[] = []) {
  const create = jest.fn(async () => ({ id: 'appt-new', customer_id: 'cust-1', store_id: 'store-ginza' }))
  return {
    create,
    synqed: {
      appointments: { create },
      // createAppointmentCore's live active + business check (fix round 7).
      staff: { get: jest.fn(async (id: string) => ({ id, is_active: true, business_id: 'business-1' })) },
      packs: {},
      staffStores: { get: jest.fn(async () => ({ store_ids: ['store-ginza'] })) },
      stores: { list: jest.fn(async () => ({ stores: [{ id: 'store-ginza', is_primary: true }] })) },
      storePolicies: {
        get: jest.fn(policy),
        listClosedDays: jest.fn(async () => ({ closed_days: closed.map((date) => ({ date })) })),
      },
    },
  }
}

function booking(startTime: string, durationMinutes = 60) {
  return { staffProfileId: 'staff-1', clientId: 'cust-1', startTime, durationMinutes, tzOffsetMinutes: -540 }
}

let errorSpy: jest.SpyInstance
let logSpy: jest.SpyInstance
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  // audit() writes its interim line to console.log.
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  logSpy.mockRestore()
})

describe('fetchBookingDayHours — the policy already in hand stops dropping special_open_days', () => {
  it('reads the list off the SAME policy object, keyed by date', async () => {
    const c = client(async () => ({ weekly_hours: WEEK_WED_CLOSED, special_open_days: SPECIAL_WED }))
    const hours = await fetchBookingDayHours(
      c.synqed as never,
      'store-ginza',
      new Date(WED_1300_JST),
      [...ALL_WEEKDAYS],
    )
    expect([...(hours.specialOpenDays ?? new Map()).entries()]).toEqual([
      ['2026-09-16', { open: '12:00', close: '18:00' }],
    ])
    expect(c.synqed.storePolicies.get).toHaveBeenCalledTimes(1)
  })

  it('a policy with no special_open_days key (older core) → an empty map, never a throw', async () => {
    const c = client(async () => ({ weekly_hours: WEEK_WED_CLOSED }))
    const hours = await fetchBookingDayHours(c.synqed as never, 'store-ginza', new Date(WED_1300_JST), [])
    expect(hours.specialOpenDays?.size).toBe(0)
  })

  it('a FAILED policy read knows no special day — exactly as it knows no weekly hours', async () => {
    const c = client(async () => {
      throw new Error('core 503')
    })
    const hours = await fetchBookingDayHours(c.synqed as never, 'store-ginza', new Date(WED_1300_JST), [])
    expect(hours.weeklyHours).toBeNull()
    expect(hours.specialOpenDays?.size).toBe(0)
  })
})

describe('the door — validateAppointmentTime on a 臨時営業日', () => {
  it('accepts 13:00–14:00 on the special Wednesday (the 定休日 it overrides)', async () => {
    const c = client(async () => ({ weekly_hours: WEEK_WED_CLOSED, special_open_days: SPECIAL_WED }))
    const hours = await fetchBookingDayHours(c.synqed as never, 'store-ginza', new Date(WED_1300_JST), [])
    await expect(validateAppointmentTime(booking(WED_1300_JST), null, hours)).resolves.toBeNull()
  })

  it('refuses 11:00 on it — before the SPECIAL window opens — and names that window', async () => {
    const c = client(async () => ({ weekly_hours: WEEK_WED_CLOSED, special_open_days: SPECIAL_WED }))
    const hours = await fetchBookingDayHours(c.synqed as never, 'store-ginza', new Date(WED_1100_JST), [])
    await expect(validateAppointmentTime(booking(WED_1100_JST), null, hours)).resolves.toEqual({
      error: 'Appointment must be within operating hours (12:00-18:00).',
      code: 'outside_hours',
      params: { open: '12:00', close: '18:00' },
    })
  })

  it('a special day ALSO opens a 臨時休業 date on it (core’s order)', async () => {
    const c = client(
      async () => ({ weekly_hours: WEEK_WED_CLOSED, special_open_days: SPECIAL_WED }),
      ['2026-09-16'],
    )
    const hours = await fetchBookingDayHours(c.synqed as never, 'store-ginza', new Date(WED_1300_JST), [])
    await expect(validateAppointmentTime(booking(WED_1300_JST), null, hours)).resolves.toBeNull()
  })

  it('without the special entry the same Wednesday is refused as the store’s 定休日 (unchanged)', async () => {
    const c = client(async () => ({ weekly_hours: WEEK_WED_CLOSED, special_open_days: [] }))
    const hours = await fetchBookingDayHours(c.synqed as never, 'store-ginza', new Date(WED_1300_JST), [])
    await expect(validateAppointmentTime(booking(WED_1300_JST), null, hours)).resolves.toEqual({
      error: 'This day is closed — pick another day.',
      code: 'closed_day',
      level: 'store',
      kind: 'weekday',
    })
  })
})

describe('the create core lands a booking on the special day', () => {
  it('createAppointmentCore → core create called, the row lands', async () => {
    const c = client(async () => ({ weekly_hours: WEEK_WED_CLOSED, special_open_days: SPECIAL_WED }))
    const result = await createAppointmentCore(c.synqed as never, booking(WED_1300_JST), {
      synqedStaffId: 'staff-core-1',
      preferredStoreId: 'store-ginza',
      operatingHours: null,
      orgSaved: [],
      actor: { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' },
    })
    expect(result).toEqual({ id: 'appt-new' })
    expect(c.create).toHaveBeenCalledTimes(1)
  })

  it('outside the special window → refused, and core is never called', async () => {
    const c = client(async () => ({ weekly_hours: WEEK_WED_CLOSED, special_open_days: SPECIAL_WED }))
    const result = await createAppointmentCore(c.synqed as never, booking('2026-09-16T08:30:00.000Z'), {
      synqedStaffId: 'staff-core-1',
      preferredStoreId: 'store-ginza',
      operatingHours: null,
      orgSaved: [],
      actor: { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' },
    })
    // 17:30–18:30 JST: runs past the special day's 18:00 close.
    expect(result).toMatchObject({ code: 'outside_hours', params: { open: '12:00', close: '18:00' } })
    expect(c.create).not.toHaveBeenCalled()
  })
})
