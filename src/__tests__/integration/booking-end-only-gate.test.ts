/**
 * ⚖ W0.5 (PR A) X11 — the END-ONLY gate, closed.
 *
 * updateAppointmentCore judged a patch only when it carried `startsAt` or
 * `durationMinutes`. A patch carrying `endsAt` ALONE — a stretch past closing
 * — skipped the hours door and went straight to core, which has no
 * time-of-day check at all. Latent (the one caller, the updateAppointment web
 * action, always sends endsAt with startsAt), but the contract was open.
 *
 * P2 below is the proof the packet names: it FAILS on origin/main (the
 * stretch is silently written) and PASSES on this branch. The rest pin the
 * gate's other shapes through the ONE effective interval.
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

import { updateAppointmentCore } from '@/lib/appointments/mutations'

/** 2026-09-15 is a TUESDAY in JST. The stored booking: 17:00–18:00 JST. */
const STORED = {
  id: 'appt-1',
  status: 'SCHEDULED',
  customer_id: 'cust-1',
  staff_id: 'staff-core-1',
  store_id: 'store-ginza',
  starts_at: '2026-09-15T08:00:00.000Z',
  ends_at: '2026-09-15T09:00:00.000Z',
  duration_minutes: 60,
  created_at: '2026-09-01T00:00:00.000Z',
}
/** The store closes at 18:00 every day. */
const CLOSES_1800 = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '10:00', close: '18:00' }]),
)
const ACTOR = { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' as const }
const VIEW_ALL = { viewAll: true, allowedStoreIds: null }
const HOURS = { operatingHours: null, orgSaved: [] }

function client(weekly: unknown = CLOSES_1800, closed: string[] = []) {
  const update = jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-ginza' }))
  const policyGet = jest.fn(async () => ({ weekly_hours: weekly, special_open_days: [] }))
  const listClosedDays = jest.fn(async (_store: string, range: { from: string; to: string }) => ({
    closed_days: closed.filter((d) => d >= range.from && d < range.to).map((date) => ({ date })),
  }))
  return {
    update,
    policyGet,
    listClosedDays,
    synqed: {
      appointments: { get: jest.fn(async () => STORED), update },
      packs: {},
      staffStores: { get: jest.fn(async () => ({ store_ids: ['store-ginza'] })) },
      stores: { list: jest.fn(async () => ({ stores: [{ id: 'store-ginza', is_primary: true }] })) },
      storePolicies: { get: policyGet, listClosedDays },
    },
  }
}

let logSpy: jest.SpyInstance
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => logSpy.mockRestore())

describe('P2 — an end-only stretch past closing is REFUSED', () => {
  it('P2: 17:00–18:00 in a store closing 18:00, patch { endsAt: 18:30 } alone → the hours refusal, nothing written', async () => {
    const c = client()
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { endsAt: '2026-09-15T09:30:00.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({
      error: 'Appointment must be within operating hours (10:00-18:00).',
      code: 'outside_hours',
      params: { open: '10:00', close: '18:00' },
    })
    expect(c.update).not.toHaveBeenCalled()
    // No audit row claims a change that never happened.
    expect(logSpy).not.toHaveBeenCalled()
  })
})

describe('the gate’s other shapes, through the one effective interval', () => {
  it('an end-only stretch INSIDE hours passes, and core still gets exactly { ends_at } (payload unchanged)', async () => {
    const c = client()
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { endsAt: '2026-09-15T08:45:00.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ success: true })
    expect(c.update).toHaveBeenCalledWith('appt-1', { ends_at: '2026-09-15T08:45:00.000Z' })
    // The day was judged — the policy read happened.
    expect(c.policyGet).toHaveBeenCalledWith('store-ginza')
  })

  it('an end-only stretch into a CLOSED next day → refused naming that day', async () => {
    const OPEN_ALL_DAY = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '00:00', close: '24:00' }]),
    )
    const c = client(OPEN_ALL_DAY, ['2026-09-16'])
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      // 17:00 JST → 00:30 JST the next day.
      { endsAt: '2026-09-15T15:30:00.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(c.listClosedDays).toHaveBeenCalledWith('store-ginza', { from: '2026-09-15', to: '2026-09-17' })
    expect(result).toMatchObject({ code: 'closed_day', kind: 'closed_date', date: '2026-09-16' })
    expect(c.update).not.toHaveBeenCalled()
  })

  it('a start-only MOVE keeps the stored length: 17:30 start → judged 17:30–18:30 → refused', async () => {
    const c = client()
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { startsAt: '2026-09-15T08:30:00.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toMatchObject({ code: 'outside_hours' })
    expect(c.update).not.toHaveBeenCalled()
  })

  it('start + end + a disagreeing duration → time_patch_inconsistent, nothing read, nothing written', async () => {
    const c = client()
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { startsAt: '2026-09-15T05:00:00.000Z', endsAt: '2026-09-15T06:00:00.000Z', durationMinutes: 90 },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({
      error: 'The end time and the duration describe different bookings.',
      code: 'time_patch_inconsistent',
    })
    expect(c.policyGet).not.toHaveBeenCalled()
    expect(c.update).not.toHaveBeenCalled()
  })

  it.each([0, -30])('durationMinutes %s → refused (m5), nothing written', async (durationMinutes) => {
    const c = client()
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { durationMinutes },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ error: 'Duration must be a positive number of minutes.' })
    expect(c.update).not.toHaveBeenCalled()
  })

  it('an end at the stored start → refused, nothing written', async () => {
    const c = client()
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { endsAt: STORED.starts_at },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ error: 'A booking must end after it starts.' })
    expect(c.update).not.toHaveBeenCalled()
  })

  it('a staff-only reassign asks NO hours question (unchanged)', async () => {
    const c = client()
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { staffId: 'staff-core-2' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ success: true })
    expect(c.policyGet).not.toHaveBeenCalled()
    expect(c.update).toHaveBeenCalledWith('appt-1', { staff_id: 'staff-core-2' })
  })

  it('m6 — a 23:59 JST start is judged on its JST day, never the UTC one', async () => {
    const OPEN_TILL_MIDNIGHT = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '10:00', close: '24:00' }]),
    )
    // Wednesday 9/16 is closed; 23:59–24:00 JST Tuesday never touches it.
    const c = client(OPEN_TILL_MIDNIGHT, ['2026-09-16'])
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { startsAt: '2026-09-15T14:59:00.000Z', durationMinutes: 1 },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(c.listClosedDays).toHaveBeenCalledWith('store-ginza', { from: '2026-09-15', to: '2026-09-16' })
    expect(result).toEqual({ success: true })
  })
})
