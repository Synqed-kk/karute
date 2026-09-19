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
import { fetchBookingDayHours } from '@/lib/appointments/day-hours'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'
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
  describe('JST default offset', () => {
    const STORE_1000_2200 = Object.fromEntries(
      ALL_WEEKDAYS.map((day) => [day, { open: '10:00', close: '22:00' }]),
    )

    function inputWithoutOffset(startTime: string) {
      return {
        staffProfileId: 'staff-1',
        clientId: 'cust-1',
        startTime,
        durationMinutes: 60,
      }
    }

    it('t1 accepts 13:00 JST when the offset is omitted', async () => {
      const result = await validateAppointmentTime(
        inputWithoutOffset(TUE_1300_JST),
        ORG_HOURS,
        dayHours({ weeklyHours: STORE_1000_2200 as never }),
      )

      expect(result).toBeNull()
    })

    it('t2 refuses 22:30 JST for 60 minutes when the offset is omitted', async () => {
      const result = await validateAppointmentTime(
        inputWithoutOffset('2026-05-12T13:30:00.000Z'),
        ORG_HOURS,
        dayHours({ weeklyHours: STORE_1000_2200 as never }),
      )

      expect(result).toMatchObject({
        code: 'outside_hours',
        params: { open: '10:00', close: '22:00' },
      })
    })

    it('t3 refuses a closed JST weekday when the offset is omitted', async () => {
      // Sunday in UTC, but Monday 00:30 in JST: the store's closed weekday.
      const result = await validateAppointmentTime(
        inputWithoutOffset('2026-05-10T15:30:00.000Z'),
        ORG_HOURS,
        dayHours({ weeklyHours: CLOSED_ON_MONDAY as never }),
      )

      expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
    })

    it('t4 keeps an explicit UTC offset instead of the JST default', async () => {
      const result = await validateAppointmentTime(
        { ...inputWithoutOffset('2026-05-12T13:30:00.000Z'), tzOffsetMinutes: 0 },
        ORG_HOURS,
        dayHours({ weeklyHours: STORE_1000_2200 as never }),
      )

      expect(result).toBeNull()
    })
  })

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

    // 00:30Z = 09:30 JST — before this store opens, the pre-existing rule.
    // ⚖ R1-4: the window it names is now the STORE's own (10:00–19:00), not
    // the business-wide blob's 10:00–24:00, which describes a different shop.
    const tooEarly = await validateAppointmentTime(
      bookingInput('2026-05-12T00:30:00.000Z'),
      ORG_HOURS,
      dayHours({ weeklyHours: OPEN_WEEK as never }),
    )
    expect(tooEarly).toEqual({
      error: 'Appointment must be within operating hours (10:00-19:00).',
      code: 'outside_hours',
      params: { open: '10:00', close: '19:00' },
    })
  })

  // ⚖ R1-4 — the door and the week grid must answer the same day's hours from
  // the same place. The store's own window rules whenever the store has one.
  describe('the window belongs to the store that has one', () => {
    /** Open 09:00–22:00 every day — narrower at the top than the org default
     *  (10:00–24:00) and wider at the bottom, so both edges are provable. */
    const STORE_0900_2200 = Object.fromEntries(
      ALL_WEEKDAYS.map((d) => [d, { open: '09:00', close: '22:00' }]),
    )

    it('allows 09:30 — inside the store’s window, outside the org blob’s', async () => {
      const result = await validateAppointmentTime(
        { ...bookingInput('2026-05-12T00:30:00.000Z'), durationMinutes: 30 },
        ORG_HOURS,
        dayHours({ weeklyHours: STORE_0900_2200 as never }),
      )

      expect(result).toBeNull()
    })

    it('refuses 23:00 — after the store shut, and REPORTS the store’s window', async () => {
      const result = await validateAppointmentTime(
        { ...bookingInput('2026-05-12T14:00:00.000Z'), durationMinutes: 30 },
        ORG_HOURS,
        dayHours({ weeklyHours: STORE_0900_2200 as never }),
      )

      expect(result).toEqual({
        error: 'Appointment must be within operating hours (09:00-22:00).',
        code: 'outside_hours',
        params: { open: '09:00', close: '22:00' },
      })
    })

    it('leaves an org-only store on the org blob’s window, unchanged', async () => {
      const result = await validateAppointmentTime(
        { ...bookingInput('2026-05-12T00:30:00.000Z'), durationMinutes: 30 },
        ORG_HOURS,
        dayHours({ weeklyHours: null }),
      )

      expect(result).toEqual({
        error: 'Appointment must be within operating hours (10:00-24:00).',
        code: 'outside_hours',
        params: { open: '10:00', close: '24:00' },
      })
    })

    // NOTE-10 falls with this: the closed check resolves the day in JST and the
    // window now comes off that same JST-resolved fact, so a caller-supplied
    // tzOffsetMinutes can no longer make the two judge different days. 13:00
    // JST on a Tuesday, declared as offset 0, still reads TUESDAY's window —
    // and the store closed that one day at 12:00.
    it('judges the window on the SAME day the closed check judged', async () => {
      const mondayOpenTuesdayShort = {
        ...STORE_0900_2200,
        tue: { open: '09:00', close: '12:00' },
      }

      const result = await validateAppointmentTime(
        { ...bookingInput(TUE_1300_JST), durationMinutes: 30, tzOffsetMinutes: 0 },
        ORG_HOURS,
        dayHours({ weeklyHours: mondayOpenTuesdayShort as never }),
      )

      expect(result).toEqual({
        error: 'Appointment must be within operating hours (09:00-12:00).',
        code: 'outside_hours',
        params: { open: '09:00', close: '12:00' },
      })
    })
  })

  // ⚖ R1-3 — the refusal that a throw had made unreachable. Before, the day
  // was resolved (Intl → RangeError) before this line was ever reached, so an
  // unparseable start time was a 500 on the booking write path.
  it('refuses an unparseable start time, with a store in hand, instead of throwing', async () => {
    const result = await validateAppointmentTime(
      bookingInput('tomorrow'),
      ORG_HOURS,
      dayHours({ weeklyHours: OPEN_WEEK as never }),
    )

    expect(result).toEqual({ error: 'Invalid appointment start time.', code: 'invalid_start' })
  })

  it('never resolves a day from an Invalid Date, even called directly', async () => {
    await expect(
      fetchBookingDayHours(fakeClient as never, 'store-ginza', new Date('tomorrow'), ALL_WEEKDAYS as never),
    ).resolves.toEqual({
      weeklyHours: null,
      closedDates: new Set(),
      orgSaved: new Set(ALL_WEEKDAYS),
    })
    expect(policyGet).not.toHaveBeenCalled()
    expect(listClosedDays).not.toHaveBeenCalled()
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
  })

  // ⚖ R1-2, the honest ordering. The PURE half still runs ahead of the
  // resolver (which CREATES a staff record on miss), because junk input must
  // not leave that side effect behind. The closed-day half cannot: the store
  // it must judge is the store the row lands in, and that is only knowable
  // once the booked staff's core id is resolved.
  it('refuses junk input before the resolver can mint a staff record', async () => {
    const result = await createAppointment({
      ...bookingInput('not-a-date'),
      staffProfileId: 'staff-unknown',
    })

    expect(result).toEqual({ error: 'Invalid appointment start time.', code: 'invalid_start' })
    expect(resolveSynqedStaffId).not.toHaveBeenCalled()
    expect(policyGet).not.toHaveBeenCalled()
    expect(apptCreate).not.toHaveBeenCalled()
  })

  // ⚖ R1-2 / LENS-4 BLOCKER — the state of EVERY single-store salon: the store
  // switcher never renders below two stores, so the active-store cookie is
  // never written. The door used to ask nobody and the row still landed in the
  // staff's own store, whose Monday is 定休日. The screen painted 休; the door
  // took the booking.
  //
  // ⚖ MERGE #937 fix round 1, B3d — this probes `preferredStoreId: null →
  // defaultBookingStore` on purpose: a viewAll/floating scope with no cookie,
  // for THIS test only (the file's shared beforeEach clamps
  // allowedStoreIds, which makes `cookieStore` always `scope.storeId` and
  // never null — so the pre-fix version of this test asserted the same
  // 'store-ginza' outcome without ever exercising the fallback its name and
  // comment claim). `asks the store the row will LAND in…` below (`the core
  // — createAppointmentCore`) is the sibling pin for the CORE'S OWN copy of
  // this same rule.
  it('refuses on the staff’s own store when NO cookie is set at all', async () => {
    getActiveStoreId.mockResolvedValue(null)
    resolveStoreScope.mockResolvedValue({
      storeId: null as never,
      viewAll: true,
      allowedStoreIds: null,
    })
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await createAppointment(bookingInput(MON_1300_JST))

    expect(policyGet).toHaveBeenCalledWith('store-ginza')
    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  // The all-stores viewer with no pin: same answer, same store — the one the
  // core lands the row in.
  it('refuses on the landing store for a viewAll staffer with no pin', async () => {
    getActiveStoreId.mockResolvedValue(null)
    resolveStoreScope.mockResolvedValue({
      storeId: null as never,
      viewAll: true,
      allowedStoreIds: null,
    })
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await createAppointment(bookingInput(MON_1300_JST))

    expect(policyGet).toHaveBeenCalledWith('store-ginza')
    expect(result).toMatchObject({ code: 'closed_day' })
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
  // — let alone be refused by — another store's policy. ⚖ R1-2 sharpened the
  // pin: the clamped-out cookie is not "no policy read", it is "their OWN
  // store's policy", because that is where the row lands.
  it('never reads another store’s policy when the cookie points outside the staffer’s scope', async () => {
    getActiveStoreId.mockResolvedValue('store-daikanyama')
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    })

    const result = await createAppointment(bookingInput(MON_1300_JST))

    expect(policyGet).not.toHaveBeenCalledWith('store-daikanyama')
    expect(listClosedDays).not.toHaveBeenCalledWith('store-daikanyama', expect.anything())
    expect(policyGet).toHaveBeenCalledWith('store-ginza')
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

  // ⚖ R1-8 (superseded 2026-09-19 by #948, MERGE #937×#948) — a failed
  // assignment lookup used to report allowedStoreIds: null, the same shape as
  // a genuinely unrestricted viewer, and the raw cookie passed straight
  // through it: this test originally pinned R1-8's narrower fix (treat the
  // cookie as unset, still let the booking through to the closed-day check on
  // whatever store defaultBookingStore names). #948 (FRESH-EYES-P1B F4, on
  // main) closes the same gap more strictly — a scope we could not read
  // vouches for NOTHING, so the whole write is refused outright, before any
  // store is even chosen. Strictly safer than R1-8 alone (refuses instead of
  // falling through), so this test now pins THAT behavior.
  it('refuses outright when the assignment lookup is degraded — never falls through to a store guess', async () => {
    getActiveStoreId.mockResolvedValue('store-daikanyama')
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-daikanyama',
      viewAll: false,
      allowedStoreIds: null,
      degraded: true,
    } as never)
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await createAppointment(bookingInput(MON_1300_JST))

    // No store is ever read or guessed at — the refusal fires before the
    // day-hours question is even asked.
    expect(policyGet).not.toHaveBeenCalled()
    expect(apptCreate).not.toHaveBeenCalled()
    expect(result).toEqual({ error: STORE_SCOPE_UNVERIFIED, code: 'store_forbidden' })
  })

  // ⚖ R1-6 — the two reads answer different questions, so one blipping must
  // not throw away the other's good answer. A hiccuped 臨時休業 read used to
  // reopen the store's whole weekly 定休日 with it.
  it('keeps a good weekly-hours answer when only the closed-dates read fails', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })
    listClosedDays.mockRejectedValue(new Error('core down'))

    const result = await createAppointment(bookingInput(MON_1300_JST))

    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
    expect(apptCreate).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  // Ids and the error class only — the one thing an operator needs to find the
  // booking that was accepted on a day nobody could check.
  it('names the store and the JST day in the degrade log, and no more', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    policyGet.mockRejectedValue(new Error('core down'))

    await createAppointment(bookingInput(MON_1300_JST))

    expect(errSpy).toHaveBeenCalledWith(
      '[booking-day-hours] weekly hours read degraded — store store-ginza, 2026-05-11 JST:',
      'Error: core down',
    )
    errSpy.mockRestore()
  })
})

// The core is the LAST wall, not the only one: even called directly — as the
// facade and the web action both do — it refuses before `appointments.create`.
describe('the core — createAppointmentCore', () => {
  it('refuses a closed day itself, so no caller can be the way in', async () => {
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await createAppointmentCore(
      fakeClient as never,
      bookingInput(MON_1300_JST),
      {
        synqedStaffId: 'staff-core-1',
        preferredStoreId: 'store-ginza',
        operatingHours: ORG_HOURS,
        orgSaved: ALL_WEEKDAYS as never,
        actor: { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' },
      },
    )

    expect(result).toMatchObject({ code: 'closed_day' })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  // ⚖ R1-2 — the whole point: with no preferred store the row lands in
  // defaultBookingStore, so THAT is the store whose hours decide.
  it('asks the store the row will LAND in when no store was preferred', async () => {
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await createAppointmentCore(
      fakeClient as never,
      bookingInput(MON_1300_JST),
      {
        synqedStaffId: 'staff-core-1',
        preferredStoreId: null,
        operatingHours: ORG_HOURS,
        orgSaved: ALL_WEEKDAYS as never,
        actor: { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' },
      },
    )

    // staffStores.get resolves the single assignment — the landing store.
    expect(policyGet).toHaveBeenCalledWith('store-ginza')
    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
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
    // MERGE #937×#948 (2026-09-19): #948's store lock (ensureRecordStoreInScope)
    // now runs ahead of the hours check and refuses a clamped actor touching a
    // booking outside their allowed stores — orthogonal to what THIS test
    // probes (which store's hours get read), so the scope here is unrestricted,
    // same pattern as the viewAll tests elsewhere in this file.
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: true,
      allowedStoreIds: null,
    })
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

  // ⚖ R1-2 / LENS-3 MEDIUM-5 — a row with no store of its own (BLOCK rows,
  // some imports) used to ask nobody, so it could be moved onto any store's
  // 定休日. It resolves its landing store the way create does.
  it('resolves the landing store for a booking whose store_id is null', async () => {
    // MERGE #937×#948 (2026-09-19): a clamped actor is out-of-scope for a
    // null-store record (ensureRecordStoreInScope's null arm) — orthogonal to
    // what THIS test probes (the store the hours check falls back to), so the
    // scope here is unrestricted, same pattern as the viewAll tests elsewhere
    // in this file.
    resolveStoreScope.mockResolvedValue({
      storeId: 'store-ginza',
      viewAll: true,
      allowedStoreIds: null,
    })
    apptGet.mockResolvedValue({
      id: 'appt-1',
      status: 'SCHEDULED',
      customer_id: 'cust-1',
      staff_id: 'staff-core-1',
      store_id: null,
      starts_at: '2026-05-12T04:00:00.000Z',
      ends_at: '2026-05-12T05:00:00.000Z',
      duration_minutes: 60,
      created_at: '2026-05-01T00:00:00.000Z',
    } as never)
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await updateAppointment('appt-1', { startTime: MON_1300_JST })

    expect(policyGet).toHaveBeenCalledWith('store-ginza')
    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('still reschedules onto an open day', async () => {
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })

    const result = await updateAppointment('appt-1', { startTime: TUE_1300_JST })

    expect(result).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledTimes(1)
  })
})

// ⚖ MERGE #937 fix round 1, B2 — a layer switched OFF must reproduce the
// behaviour from before the round: no closed-day refusal at all (the org
// hours-window check keeps running). Same jest.doMock/jest.resetModules
// pattern as day-numbers-line.test.tsx's loadDayNumbersLine, scoped to this
// describe only.
describe('the closedDays switch OFF — reproduces the behaviour from before the round', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.doMock('@/lib/appointments/booking-switches', () => {
      const actual = jest.requireActual('@/lib/appointments/booking-switches') as {
        BOOKING_SWITCHES: Record<string, boolean>
      }
      return { BOOKING_SWITCHES: { ...actual.BOOKING_SWITCHES, closedDays: false } }
    })
  })

  afterEach(() => {
    jest.dontMock('@/lib/appointments/booking-switches')
    jest.resetModules()
  })

  it('accepts a CREATE on a store-closed day through the web action, and never reads the store policy', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/actions/appointments') as typeof import('@/actions/appointments')
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await mod.createAppointment(bookingInput(MON_1300_JST))

    expect(result).toEqual({ id: 'appt-new' })
    expect(apptCreate).toHaveBeenCalledTimes(1)
    expect(policyGet).not.toHaveBeenCalled()
  })

  it('accepts a RESCHEDULE onto a store-closed day through updateAppointmentCore, and never reads the store policy', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/lib/appointments/mutations') as typeof import('@/lib/appointments/mutations')
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await mod.updateAppointmentCore(
      fakeClient as never,
      'appt-1',
      { startsAt: MON_1300_JST },
      { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' },
      { operatingHours: ORG_HOURS, orgSaved: ALL_WEEKDAYS as never },
      { viewAll: true, allowedStoreIds: null },
    )

    expect(result).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledTimes(1)
    expect(policyGet).not.toHaveBeenCalled()
  })

  it('still refuses outside_hours — the org hours-window check keeps running', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/actions/appointments') as typeof import('@/actions/appointments')

    // 00:30Z = 09:30 JST Tuesday — before the org blob's 10:00 open
    // (ORG_HOURS, 10:00–24:00 every day). The store's own policy is never
    // read with the switch off, so only the org window can refuse this.
    const result = await mod.createAppointment(bookingInput('2026-05-12T00:30:00.000Z'))

    expect(result).toMatchObject({ code: 'outside_hours' })
    expect(policyGet).not.toHaveBeenCalled()
  })
})

// ⚖ R1-9 — the four invariants the packet names by name and the 12,4xx-test
// suite had no guard for. Each of these killed a mutant that had survived the
// whole suite unchanged.
describe('the invariants with no guard until now', () => {
  /** 2026-05-13T00:00Z is still 2026-05-12 in UTC terms for anything before
   *  15:00Z; 20:00Z on the 12th is 05:00 JST on the 13th — inside the JST/UTC
   *  seam (JST 00:00–08:59), where the UTC day and the JST day differ. */
  const WED_0500_JST = '2026-05-12T20:00:00.000Z'

  it('fetches the closed-days range for the JST day, not the UTC day', async () => {
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })

    // 00:30 JST — the far edge of the seam, and the ONE start time at which a
    // short day-step is visible: +23h from here still lands on the SAME JST
    // day, so the range would collapse to a single point and every 臨時休業
    // date would stop matching.
    await createAppointment(bookingInput('2026-05-12T15:30:00.000Z'))

    // Exactly [JST day, next JST day) — a UTC-day read would say 2026-05-12,
    // and a 23-hour step would say to: '2026-05-13'.
    expect(listClosedDays).toHaveBeenCalledWith('store-ginza', {
      from: '2026-05-13',
      to: '2026-05-14',
    })
  })

  it('still matches a 臨時休業 date for a booking at 00:30 JST', async () => {
    policyGet.mockResolvedValue({ weekly_hours: OPEN_WEEK })
    listClosedDays.mockResolvedValue({ closed_days: [{ date: '2026-05-13' }] })

    const result = await createAppointment(bookingInput('2026-05-12T15:30:00.000Z'))

    expect(result).toMatchObject({ code: 'closed_day', kind: 'closed_date' })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('judges the WEEKDAY in JST too, inside the seam', async () => {
    // Open every day except WEDNESDAY. 05:00 JST Wed is 20:00 UTC Tue — a
    // UTC-day weekday read would ask about Tuesday and let it through.
    policyGet.mockResolvedValue({ weekly_hours: { ...OPEN_WEEK, wed: null } })

    const result = await createAppointment(bookingInput(WED_0500_JST))

    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('judges a booking that crosses midnight on its START day', async () => {
    // Mon 23:30 JST, 60 min → ends 00:30 Tue. TUESDAY is the closed day, and
    // the booking must NOT be refused for it: the rule is the START day.
    policyGet.mockResolvedValue({ weekly_hours: { ...OPEN_WEEK, tue: null } })

    const result = await createAppointment(bookingInput('2026-05-11T14:30:00.000Z'))

    // Refused, but by the pre-existing hours WINDOW (a booking cannot run past
    // the store's closing time — there is no day-wrap), never as a closed day.
    // Judging off the END time would have produced code: 'closed_day'.
    expect(result).toMatchObject({ code: 'outside_hours' })
    expect(apptCreate).not.toHaveBeenCalled()
  })

  it('refuses the START day when THAT is the closed one, mid-crossing', async () => {
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await createAppointment(bookingInput('2026-05-11T14:30:00.000Z'))

    expect(result).toMatchObject({ code: 'closed_day', kind: 'weekday' })
  })

  // A staff reassign or a memo edit on a booking that already sits on a day a
  // manager has since marked 定休日 must still go through. A regression here
  // locks staff out of real bookings they can see on the calendar.
  it('never refuses a NON-TIME patch on a booking sitting on a now-closed day', async () => {
    apptGet.mockResolvedValue({
      id: 'appt-1',
      status: 'SCHEDULED',
      customer_id: 'cust-1',
      staff_id: 'staff-core-1',
      store_id: 'store-ginza',
      // A MONDAY, and the store now closes on Mondays.
      starts_at: MON_1300_JST,
      ends_at: '2026-05-11T05:00:00.000Z',
      duration_minutes: 60,
      created_at: '2026-05-01T00:00:00.000Z',
    } as never)
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await updateAppointment('appt-1', { staffProfileId: 'staff-2' })

    expect(result).toEqual({ success: true })
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { staff_id: 'staff-2' })
    // The hours question is never even asked — the booking did not move.
    expect(policyGet).not.toHaveBeenCalled()
  })

  // Stress round 1, survivor m9 — a DURATION-ONLY patch is still a TIME patch:
  // updateAppointmentCore's own doc says "a duration-only edit is still judged
  // against the real start." Mutant mR2 (dropping the
  // `|| patch.durationMinutes !== undefined` half of the guard above) let a
  // booking's duration change land on a closed day with no hours question
  // asked at all — the exact mirror of the NON-TIME test just above.
  it('refuses a duration-only reschedule of a booking sitting on a now-closed day', async () => {
    apptGet.mockResolvedValue({
      id: 'appt-1',
      status: 'SCHEDULED',
      customer_id: 'cust-1',
      staff_id: 'staff-core-1',
      store_id: 'store-ginza',
      // A MONDAY, and the store now closes on Mondays.
      starts_at: MON_1300_JST,
      ends_at: '2026-05-11T05:00:00.000Z',
      duration_minutes: 60,
      created_at: '2026-05-01T00:00:00.000Z',
    } as never)
    policyGet.mockResolvedValue({ weekly_hours: CLOSED_ON_MONDAY })

    const result = await updateAppointment('appt-1', { durationMinutes: 90 })

    expect(result).toMatchObject({ code: 'closed_day', level: 'store', kind: 'weekday' })
    expect(apptUpdate).not.toHaveBeenCalled()
    expect(policyGet).toHaveBeenCalledWith('store-ginza')
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
