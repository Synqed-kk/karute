/**
 * ⚖ PKT-1c-C — the closed-day booking DOOR.
 *
 * Until this door existed, NOTHING in the app refused a booking on a closed
 * day — which is the whole reason a 休 day could still carry real bookings.
 * The rule has exactly ONE home (`validateAppointmentTime`) and resolves the
 * day through `resolveDayHours`, the same resolver the week/month cells paint
 * 休 from, so the day a staffer sees closed is exactly the day refused.
 *
 * What is pinned here:
 *   • the rule itself, against every hours source (store weekday · 臨時休業
 *     date · the business-wide blob · the 10:00–24:00 fallback nobody set);
 *   • the refusal is a REFUSAL (⚖ 9/2 reversible-by-default): a plain message,
 *     no appointment created, no existing row touched, and no audit row
 *     claiming either;
 *   • store isolation: the policy reads are keyed by the booking's CLAMPED
 *     store id, so a store-restricted staffer can never trigger another
 *     store's policy;
 *   • the reschedule path cannot be the way around it.
 *
 * The phone door's half is pinned in app-api-appointments-mutations.test.ts,
 * on the facade harness that already exists there.
 */

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedError: class extends Error {
    status = 0
  },
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
}))

const getActiveStoreId = jest.fn(async (): Promise<string | null> => 'store-ginza')
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: () => getActiveStoreId(),
}))

const resolveStoreScope = jest.fn(async () => ({
  storeId: 'store-ginza',
  viewAll: false,
  allowedStoreIds: ['store-ginza'] as string[] | null,
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScope(),
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
}))

/** Open 10:00–24:00 every weekday, SAVED — the business-wide blob. */
const ORG_HOURS = {
  mon: { openMinute: 600, closeMinute: 1440 },
  tue: { openMinute: 600, closeMinute: 1440 },
  wed: { openMinute: 600, closeMinute: 1440 },
  thu: { openMinute: 600, closeMinute: 1440 },
  fri: { openMinute: 600, closeMinute: 1440 },
  sat: { openMinute: 600, closeMinute: 1440 },
  sun: { openMinute: 600, closeMinute: 1440 },
}
const ALL_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const orgSettings = jest.fn(async (): Promise<Record<string, unknown> | null> => ({
  operating_hours: ORG_HOURS,
  operating_hours_saved: ALL_WEEKDAYS,
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: () => orgSettings(),
}))

const apptCreate = jest.fn(async () => ({ id: 'appt-new', customer_id: 'cust-1', store_id: 'store-ginza' }))
const apptGet = jest.fn(async () => ({
  id: 'appt-1',
  status: 'SCHEDULED',
  customer_id: 'cust-1',
  store_id: 'store-ginza',
  starts_at: '2026-05-12T04:00:00.000Z',
  ends_at: '2026-05-12T05:00:00.000Z',
  duration_minutes: 60,
  created_at: '2026-05-01T00:00:00.000Z',
}))
const apptUpdate = jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-ginza' }))
// Same zero-net-new-lint discipline as this file's other arg-taking stubs: the
// signatures have to accept what the wrapper forwards, and the DEFAULT bodies
// ignore it (every test drives them through mockResolvedValue).
/* eslint-disable @typescript-eslint/no-unused-vars */
const policyGet = jest.fn(async (_storeId: string): Promise<{ weekly_hours: unknown }> => ({
  weekly_hours: null,
}))
const listClosedDays = jest.fn(
  async (
    _storeId: string,
    _range?: { from?: string; to?: string },
  ): Promise<{ closed_days: { date: string }[] }> => ({ closed_days: [] }),
)
/* eslint-enable @typescript-eslint/no-unused-vars */
const fakeClient = {
  appointments: { create: apptCreate, get: apptGet, update: apptUpdate, delete: jest.fn() },
  packs: { listRecentRedemptions: jest.fn(async () => []) },
  staffStores: { get: jest.fn(async () => ({ store_ids: ['store-ginza'] })) },
  stores: { list: jest.fn(async () => ({ stores: [{ id: 'store-ginza', is_primary: true }] })) },
  storePolicies: {
    get: (storeId: string) => policyGet(storeId),
    listClosedDays: (storeId: string, range?: { from?: string; to?: string }) =>
      listClosedDays(storeId, range),
  },
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => fakeClient),
}))

import { createAppointment, updateAppointment } from '@/actions/appointments'
import { createAppointmentCore } from '@/lib/appointments/mutations'
import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'
import { validateAppointmentTime, type BookingDayHours } from '@/lib/appointments'
import { auditLines } from './helpers/audit-lines'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

/** 2026-05-11 is a MONDAY in JST, 2026-05-12 a TUESDAY. 04:00Z = 13:00 JST,
 *  inside the 10:00–24:00 org window, so only the closed-day rule can refuse. */
const MON_1300_JST = '2026-05-11T04:00:00.000Z'
const TUE_1300_JST = '2026-05-12T04:00:00.000Z'

const OPEN_WEEK = {
  mon: { open: '10:00', close: '19:00' },
  tue: { open: '10:00', close: '19:00' },
  wed: { open: '10:00', close: '19:00' },
  thu: { open: '10:00', close: '19:00' },
  fri: { open: '10:00', close: '19:00' },
  sat: { open: '10:00', close: '19:00' },
  sun: { open: '10:00', close: '19:00' },
}
/** A store that saved its week with MONDAY left out — its 定休日. */
const CLOSED_ON_MONDAY = { ...OPEN_WEEK, mon: null }

function bookingInput(startTime: string) {
  return {
    staffProfileId: 'staff-1',
    clientId: 'cust-1',
    startTime,
    durationMinutes: 60,
    tzOffsetMinutes: -540,
  }
}

function dayHours(over: Partial<BookingDayHours> = {}): BookingDayHours {
  return {
    weeklyHours: null,
    closedDates: new Set<string>(),
    orgSaved: new Set(ALL_WEEKDAYS as never),
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  getActiveStoreId.mockResolvedValue('store-ginza')
  resolveStoreScope.mockResolvedValue({
    storeId: 'store-ginza',
    viewAll: false,
    allowedStoreIds: ['store-ginza'],
  })
  orgSettings.mockResolvedValue({
    operating_hours: ORG_HOURS,
    operating_hours_saved: ALL_WEEKDAYS,
  })
  policyGet.mockResolvedValue({ weekly_hours: null })
  listClosedDays.mockResolvedValue({ closed_days: [] })
  apptCreate.mockResolvedValue({ id: 'appt-new', customer_id: 'cust-1', store_id: 'store-ginza' })
  apptGet.mockResolvedValue({
    id: 'appt-1',
    status: 'SCHEDULED',
    customer_id: 'cust-1',
    store_id: 'store-ginza',
    starts_at: '2026-05-12T04:00:00.000Z',
    ends_at: '2026-05-12T05:00:00.000Z',
    duration_minutes: 60,
    created_at: '2026-05-01T00:00:00.000Z',
  })
  apptUpdate.mockResolvedValue({ customer_id: 'cust-1', store_id: 'store-ginza' })
})

describe('the rule — validateAppointmentTime, the ONE home', () => {
  it("refuses the store's own 定休日, and says the STORE closed it", async () => {
    const result = await validateAppointmentTime(
      bookingInput(MON_1300_JST),
      ORG_HOURS,
      dayHours({ weeklyHours: CLOSED_ON_MONDAY as never }),
    )

    expect(result).toEqual({
      error: 'This day is closed — pick another day.',
      code: 'closed_day',
      level: 'store',
      kind: 'weekday',
    })
  })

  it('refuses a 臨時休業 date, and says it was the DATE, not the weekday', async () => {
    const result = await validateAppointmentTime(
      bookingInput(TUE_1300_JST),
      ORG_HOURS,
      dayHours({
        weeklyHours: OPEN_WEEK as never,
        // The JST calendar day, which is what the closed-days list is keyed by.
        closedDates: new Set(['2026-05-12']),
      }),
    )

    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'closed_date' })
  })

  // ⚖ PKT-1c-C: "a day with no saved hours anywhere is NEVER closed" — the door
  // only closes on something a manager actually set.
  it('never closes a day nobody saved anywhere (source: default)', async () => {
    const result = await validateAppointmentTime(
      bookingInput(MON_1300_JST),
      // Nothing saved: no store week, no org blob, no closed dates.
      null,
      { weeklyHours: null, closedDates: new Set(), orgSaved: new Set() },
    )

    expect(result).toBeNull()
  })

  // HONEST CEILING (2026-09-16), and the reason the org LEVEL exists but never
  // fires today: the business-wide blob has no way to SAY "closed". A weekday
  // only counts as saved when it parses with open < close (operating-hours.ts
  // parseDailyHours/savedWeekdays), so an org day is either open or unset —
  // never closed. Only a STORE can declare a closed day, which is why every
  // closed answer carries source 'store'. Pinned so the day the org blob learns
  // to express one, this test fails and the level mapping gets its own case.
  it('cannot be closed by the business-wide blob alone — the org blob has no way to say closed', async () => {
    const orgWithMondayBlanked = { ...ORG_HOURS, mon: null }

    const result = await validateAppointmentTime(
      bookingInput(MON_1300_JST),
      orgWithMondayBlanked,
      dayHours({ weeklyHours: null, orgSaved: new Set() }),
    )

    // Not closed — it falls to the 10:00–24:00 fallback, which describes no day.
    expect(result).toBeNull()
  })

  it('leaves an open day exactly as it was — including the hours-window error', async () => {
    const open = await validateAppointmentTime(
      bookingInput(TUE_1300_JST),
      ORG_HOURS,
      dayHours({ weeklyHours: OPEN_WEEK as never }),
    )
    expect(open).toBeNull()

    // 01:00Z = 10:00 JST... minus one minute: before open, the pre-existing rule.
    const tooEarly = await validateAppointmentTime(
      bookingInput('2026-05-12T00:30:00.000Z'),
      ORG_HOURS,
      dayHours({ weeklyHours: OPEN_WEEK as never }),
    )
    expect(tooEarly).toEqual({
      error: 'Appointment must be within operating hours (10:00-24:00).',
    })
  })

  it('a store week that says NOTHING at all falls through — an empty save must not black out a week', async () => {
    const result = await validateAppointmentTime(
      bookingInput(MON_1300_JST),
      ORG_HOURS,
      dayHours({ weeklyHours: {} as never }),
    )

    expect(result).toBeNull()
  })
})

describe('the web door — createAppointment', () => {
  it('refuses a closed day: no appointment, no audit row, and the refusal carries its provenance', async () => {
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    let result: unknown
    const lines = await auditLines(async () => {
      result = await createAppointment(bookingInput(MON_1300_JST))
    })

    expect(result).toEqual({
      error: 'This day is closed — pick another day.',
      code: 'closed_day',
      level: 'store',
      kind: 'weekday',
    })
    expect(apptCreate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
    // The refusal stops AT THE DOOR — it never reaches the resolver, which can
    // CREATE a staff record on miss, nor the core behind it.
    expect(resolveSynqedStaffId).not.toHaveBeenCalled()
  })

  it('refuses a 臨時休業 date the same way', async () => {
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })
    listClosedDays.mockResolvedValue({ closed_days: [{ date: '2026-05-12' }] })

    const result = await createAppointment(bookingInput(TUE_1300_JST))

    expect(result).toMatchObject({ code: 'closed_day', kind: 'closed_date' })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('takes the booking on an open day, unchanged', async () => {
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })

    const result = await createAppointment(bookingInput(TUE_1300_JST))

    expect(result).toEqual({ id: 'appt-new' })
    expect(apptCreate).toHaveBeenCalledTimes(1)
  })

  it('reads the hours for THE BOOKING’S store only, for the one date', async () => {
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })

    await createAppointment(bookingInput(TUE_1300_JST))

    expect(policyGet).toHaveBeenCalledTimes(1)
    expect(policyGet).toHaveBeenCalledWith('store-ginza')
    expect(listClosedDays).toHaveBeenCalledTimes(1)
    // `to` is EXCLUSIVE — one JST day, never a window.
    expect(listClosedDays).toHaveBeenCalledWith('store-ginza', {
      from: '2026-05-12',
      to: '2026-05-13',
    })
  })

  // Store isolation: an out-of-scope cookie is treated as unset (the clamp this
  // action has always applied), so a restricted staffer cannot make the app read
  // — let alone be refused by — another store's policy.
  it('never reads another store’s policy when the cookie points outside the staffer’s scope', async () => {
    getActiveStoreId.mockResolvedValue('store-daikanyama')
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })

    const result = await createAppointment(bookingInput(MON_1300_JST))

    expect(policyGet).not.toHaveBeenCalled()
    expect(listClosedDays).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'appt-new' })
  })

  // A policy read we could not make says NOTHING about the day. Refusing every
  // booking over it would be a new outage the app invented.
  it('degrades to allowed when the store policy cannot be read', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    policyGet.mockRejectedValue(new Error('core down'))

    const result = await createAppointment(bookingInput(MON_1300_JST))

    expect(result).toEqual({ id: 'appt-new' })
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

// The core is the LAST wall, not the only one: even called directly — as the
// facade and the web action both do — it refuses before `appointments.create`.
describe('the core — createAppointmentCore', () => {
  it('refuses a closed day itself, so no caller can be the way in', async () => {
    const result = await createAppointmentCore(
      fakeClient as never,
      bookingInput(MON_1300_JST),
      {
        synqedStaffId: 'staff-core-1',
        preferredStoreId: 'store-ginza',
        operatingHours: ORG_HOURS,
        dayHours: dayHours({ weeklyHours: CLOSED_ON_MONDAY as never }),
        actor: { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' },
      },
    )

    expect(result).toMatchObject({ code: 'closed_day' })
    expect(apptCreate).not.toHaveBeenCalled()
  })
})

describe('the reschedule door — updateAppointment', () => {
  it('refuses a move onto a closed day: the existing row is never touched and no audit row is written', async () => {
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    let result: unknown
    const lines = await auditLines(async () => {
      result = await updateAppointment('appt-1', { startTime: MON_1300_JST })
    })

    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('judges the day against the BOOKING’S own store, not the active one', async () => {
    apptGet.mockResolvedValue({
      id: 'appt-1',
      status: 'SCHEDULED',
      customer_id: 'cust-1',
      store_id: 'store-daikanyama',
      starts_at: '2026-05-12T04:00:00.000Z',
      ends_at: '2026-05-12T05:00:00.000Z',
      duration_minutes: 60,
      created_at: '2026-05-01T00:00:00.000Z',
    })
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })

    await updateAppointment('appt-1', { startTime: TUE_1300_JST })

    expect(policyGet).toHaveBeenCalledWith('store-daikanyama')
  })

  it('still reschedules onto an open day', async () => {
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })

    const result = await updateAppointment('appt-1', { startTime: TUE_1300_JST })

    expect(result).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('the lines the staffer reads', () => {
  it('has one line per level in both locales, in the reservation.errors register', () => {
    for (const messages of [ja, en]) {
      const errors = messages.reservation.errors as Record<string, string>
      expect(typeof errors.closedDayStore).toBe('string')
      expect(typeof errors.closedDayDate).toBe('string')
      expect(typeof errors.closedDayOrg).toBe('string')
    }
  })
})
