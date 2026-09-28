/**
 * ⚖ W0.5 (PR A) X11 — ONE effective interval per change, and EVERY calendar
 * day it touches judged.
 *
 * Pinned here (PKT-S25-W05-HOURS-PR-A):
 *   • effectiveInterval — the truth table every create/update is normalised
 *     through before any hours question (the nine patch shapes, the refusals);
 *   • P3 — a booking that crosses midnight is two day facts: both must be
 *     open and the interval inside both windows, else the refusal NAMES the
 *     offending next day;
 *   • the door's 臨時休業 read covers every day the booking touches.
 *
 * Pinned to TZ=UTC to mirror the deploy runtime.
 */
process.env.TZ = 'UTC'

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {
    status = 0
  },
}))

import {
  bookingLastDay,
  effectiveInterval,
  validateAppointmentTime,
  type BookingDayHours,
} from '@/lib/appointments'
import { createAppointmentCore } from '@/lib/appointments/mutations'

const iso = (d: unknown) => (d as { toISOString(): string }).toISOString()

describe('effectiveInterval — the truth table (whatever the patch leaves out comes from the stored row)', () => {
  // A stored 17:00–18:00 JST booking.
  const STORED = { startsAt: '2026-09-15T08:00:00.000Z', endsAt: '2026-09-15T09:00:00.000Z' }
  const S = '2026-09-15T05:00:00.000Z' // 14:00 JST
  const E = '2026-09-15T09:30:00.000Z' // 18:30 JST

  it.each([
    ['{} → the stored interval', {}, STORED.startsAt, STORED.endsAt],
    ['{ startsAt } → a MOVE: the stored length rides along', { startsAt: S }, S, '2026-09-15T06:00:00.000Z'],
    ['{ endsAt } → an end-only STRETCH: the stored start', { endsAt: E }, STORED.startsAt, E],
    ['{ durationMinutes } → stored start + D', { durationMinutes: 90 }, STORED.startsAt, '2026-09-15T09:30:00.000Z'],
    ['{ startsAt, endsAt } → exactly those', { startsAt: S, endsAt: E }, S, E],
    ['{ startsAt, durationMinutes } → S + D', { startsAt: S, durationMinutes: 45 }, S, '2026-09-15T05:45:00.000Z'],
    ['{ endsAt, durationMinutes } agreeing with the stored start', { endsAt: E, durationMinutes: 90 }, STORED.startsAt, E],
    ['{ startsAt, endsAt, durationMinutes } agreeing', { startsAt: S, endsAt: E, durationMinutes: 270 }, S, E],
  ] as const)('%s', (_label, patch, start, end) => {
    const interval = effectiveInterval(STORED, patch)
    expect('error' in interval).toBe(false)
    expect(iso((interval as { startsAt: Date }).startsAt)).toBe(start)
    expect(iso((interval as { endsAt: Date }).endsAt)).toBe(end)
  })

  it('no stored row: the patch must carry its own start — { startsAt, durationMinutes } is enough', () => {
    const interval = effectiveInterval(null, { startsAt: S, durationMinutes: 60 })
    expect(iso((interval as { endsAt: Date }).endsAt)).toBe('2026-09-15T06:00:00.000Z')
  })

  it.each([
    [
      'start + end + a DIFFERENT duration → time_patch_inconsistent',
      STORED,
      { startsAt: S, endsAt: E, durationMinutes: 60 },
      { error: 'The end time and the duration describe different bookings.', code: 'time_patch_inconsistent' },
    ],
    [
      'end + a duration that disagrees with the stored start → time_patch_inconsistent',
      STORED,
      { endsAt: E, durationMinutes: 60 },
      { error: 'The end time and the duration describe different bookings.', code: 'time_patch_inconsistent' },
    ],
    [
      'an end AT the start → refused',
      STORED,
      { endsAt: STORED.startsAt },
      { error: 'A booking must end after it starts.' },
    ],
    [
      'an end BEFORE the start → refused',
      STORED,
      { startsAt: S, endsAt: '2026-09-15T04:00:00.000Z' },
      { error: 'A booking must end after it starts.' },
    ],
    [
      'a start moved past the stored end with the end kept → refused',
      STORED,
      { startsAt: '2026-09-15T10:00:00.000Z', endsAt: STORED.endsAt },
      { error: 'A booking must end after it starts.' },
    ],
    ['durationMinutes 0 → refused', STORED, { durationMinutes: 0 }, { error: 'Duration must be a positive number of minutes.' }],
    ['durationMinutes negative → refused', STORED, { durationMinutes: -30 }, { error: 'Duration must be a positive number of minutes.' }],
    ['durationMinutes fractional → refused', STORED, { durationMinutes: 30.5 }, { error: 'Duration must be a positive number of minutes.' }],
    ['an unparseable start → invalid_start', STORED, { startsAt: 'tomorrow' }, { error: 'Invalid appointment start time.', code: 'invalid_start' }],
    ['an unparseable end → refused', STORED, { endsAt: 'later' }, { error: 'Invalid appointment end time.' }],
    ['no stored row and no start → invalid_start', null, { endsAt: E }, { error: 'Invalid appointment start time.', code: 'invalid_start' }],
  ] as const)('%s', (_label, current, patch, refusal) => {
    expect(effectiveInterval(current, patch)).toEqual(refusal)
  })
})

/** 2026-09-15 is a TUESDAY in JST, 9/16 a WEDNESDAY. */
const TUE_2330_JST = '2026-09-15T14:30:00.000Z'

function booking(startTime: string, durationMinutes: number) {
  return { staffProfileId: 'staff-1', clientId: 'cust-1', startTime, durationMinutes, tzOffsetMinutes: -540 }
}
function hours(over: Partial<BookingDayHours>): BookingDayHours {
  return { weeklyHours: null, closedDates: new Set<string>(), orgSaved: new Set(), ...over }
}
/** Tuesday runs to midnight, Wednesday opens at midnight. */
const OVERNIGHT = {
  mon: { open: '10:00', close: '24:00' },
  tue: { open: '10:00', close: '24:00' },
  wed: { open: '00:00', close: '19:00' },
  thu: { open: '00:00', close: '24:00' },
  fri: { open: '00:00', close: '24:00' },
  sat: { open: '00:00', close: '24:00' },
  sun: { open: '00:00', close: '24:00' },
}

describe('P3 — a booking that crosses midnight is judged on BOTH days', () => {
  it('23:30–00:30: D open till 24:00 and D+1 open from 00:00 → accepted', async () => {
    await expect(
      validateAppointmentTime(booking(TUE_2330_JST, 60), null, hours({ weeklyHours: OVERNIGHT as never })),
    ).resolves.toBeNull()
  })

  it('D+1 a 臨時休業 date → refused, and the refusal NAMES D+1', async () => {
    await expect(
      validateAppointmentTime(
        booking(TUE_2330_JST, 60),
        null,
        hours({ weeklyHours: OVERNIGHT as never, closedDates: new Set(['2026-09-16']) }),
      ),
    ).resolves.toEqual({
      error: 'The booking runs into 2026-09-16, which is closed — pick another time.',
      code: 'closed_day',
      level: 'store',
      kind: 'closed_date',
      date: '2026-09-16',
    })
  })

  it('D+1 the weekly 定休日 → refused naming D+1, kind weekday', async () => {
    await expect(
      validateAppointmentTime(
        booking(TUE_2330_JST, 60),
        null,
        hours({ weeklyHours: { ...OVERNIGHT, wed: null } as never }),
      ),
    ).resolves.toMatchObject({ code: 'closed_day', kind: 'weekday', date: '2026-09-16' })
  })

  it('D+1 opens at 10:00 → refused on D+1’s own window, naming D+1', async () => {
    await expect(
      validateAppointmentTime(
        booking(TUE_2330_JST, 60),
        null,
        hours({ weeklyHours: { ...OVERNIGHT, wed: { open: '10:00', close: '19:00' } } as never }),
      ),
    ).resolves.toEqual({
      error: 'Appointment must be within operating hours (10:00-19:00) on 2026-09-16.',
      code: 'outside_hours',
      params: { open: '10:00', close: '19:00' },
      date: '2026-09-16',
    })
  })

  it('D closes at 22:00 → refused on D’s window, with NO date (the start day keeps its old shape)', async () => {
    await expect(
      validateAppointmentTime(
        booking(TUE_2330_JST, 60),
        null,
        hours({ weeklyHours: { ...OVERNIGHT, tue: { open: '10:00', close: '22:00' } } as never }),
      ),
    ).resolves.toEqual({
      error: 'Appointment must be within operating hours (10:00-22:00).',
      code: 'outside_hours',
      params: { open: '10:00', close: '22:00' },
    })
  })

  it('a booking ENDING exactly at 24:00 touches one day — a closed D+1 is not its question', async () => {
    await expect(
      validateAppointmentTime(
        booking(TUE_2330_JST, 30),
        null,
        hours({ weeklyHours: OVERNIGHT as never, closedDates: new Set(['2026-09-16']) }),
      ),
    ).resolves.toBeNull()
  })

  it('D+1 a 臨時営業日 from 00:00 on its 定休日 → accepted (the two rounds together)', async () => {
    await expect(
      validateAppointmentTime(
        booking(TUE_2330_JST, 60),
        null,
        hours({
          weeklyHours: { ...OVERNIGHT, wed: null } as never,
          specialOpenDays: new Map([['2026-09-16', { open: '00:00', close: '02:00' }]]),
        }),
      ),
    ).resolves.toBeNull()
  })

  it('the org fallback (nobody saved anything) still refuses a midnight crossing — 10:00–24:00 never opens at 00:00', async () => {
    await expect(
      validateAppointmentTime(booking(TUE_2330_JST, 60), null, hours({})),
    ).resolves.toMatchObject({ code: 'outside_hours', date: '2026-09-16', params: { open: '10:00', close: '24:00' } })
  })

  it('23:59 JST is the JST day, never the UTC one (m6): a one-minute booking is judged on 9/15', async () => {
    await expect(
      validateAppointmentTime(
        booking('2026-09-15T14:59:00.000Z', 1),
        null,
        hours({ weeklyHours: OVERNIGHT as never, closedDates: new Set(['2026-09-16']) }),
      ),
    ).resolves.toBeNull()
  })
})

describe('bookingLastDay — the fetch range is cut from the same arithmetic as the walk', () => {
  it('a booking inside one day → its start instant; one crossing midnight → the next day', () => {
    expect(iso(bookingLastDay(booking('2026-09-15T04:00:00.000Z', 60)))).toBe('2026-09-15T04:00:00.000Z')
    expect(iso(bookingLastDay(booking(TUE_2330_JST, 30)))).toBe(TUE_2330_JST)
    expect(iso(bookingLastDay(booking(TUE_2330_JST, 31)))).toBe('2026-09-16T14:30:00.000Z')
  })
})

describe('the create core reads — and refuses on — every day the booking touches', () => {
  function client(closed: string[]) {
    const create = jest.fn(async () => ({ id: 'appt-new', customer_id: 'cust-1', store_id: 'store-ginza' }))
    const listClosedDays = jest.fn(async (_store: string, range: { from: string; to: string }) => ({
      closed_days: closed.filter((d) => d >= range.from && d < range.to).map((date) => ({ date })),
    }))
    return {
      create,
      listClosedDays,
      synqed: {
        appointments: { create },
        packs: {},
        staffStores: { get: jest.fn(async () => ({ store_ids: ['store-ginza'] })) },
        stores: { list: jest.fn(async () => ({ stores: [{ id: 'store-ginza', is_primary: true }] })) },
        storePolicies: {
          get: jest.fn(async () => ({ weekly_hours: OVERNIGHT, special_open_days: [] })),
          listClosedDays,
        },
      },
    }
  }
  const deps = {
    synqedStaffId: 'staff-core-1',
    preferredStoreId: 'store-ginza',
    operatingHours: null,
    orgSaved: [],
    actor: { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' as const },
  }
  let logSpy: jest.SpyInstance
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => logSpy.mockRestore())

  it('a single-day booking asks for its one day, exactly as before', async () => {
    const c = client([])
    await createAppointmentCore(c.synqed as never, booking('2026-09-15T04:00:00.000Z', 60), deps)
    expect(c.listClosedDays).toHaveBeenCalledWith('store-ginza', { from: '2026-09-15', to: '2026-09-16' })
  })

  it('23:30–00:30 asks for BOTH days, and a 臨時休業 D+1 refuses it with nothing created', async () => {
    const c = client(['2026-09-16'])
    const result = await createAppointmentCore(c.synqed as never, booking(TUE_2330_JST, 60), deps)
    expect(c.listClosedDays).toHaveBeenCalledWith('store-ginza', { from: '2026-09-15', to: '2026-09-17' })
    expect(result).toMatchObject({ code: 'closed_day', kind: 'closed_date', date: '2026-09-16' })
    expect(c.create).not.toHaveBeenCalled()
  })

  it('…and with D+1 open from midnight the same booking lands', async () => {
    const c = client([])
    const result = await createAppointmentCore(c.synqed as never, booking(TUE_2330_JST, 60), deps)
    expect(result).toEqual({ id: 'appt-new' })
    expect(c.create).toHaveBeenCalledTimes(1)
  })
})
