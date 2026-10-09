/**
 * ⚖ W0.5 (PR A) fix 1 — the stored interval IS the judged interval.
 *
 * updateAppointmentCore judges every time patch as ONE interval
 * (effectiveInterval). Core (synqed-core appointment.service.ts) fills an
 * omitted `starts_at`/`ends_at` from the stored row and never derives `ends_at`
 * from `duration_minutes` (a label there). So a payload carrying only the
 * fields the patch named lands a DIFFERENT booking than the one judged:
 * stored 17:00–18:00 + { startsAt: 16:00 } → judged 16:00–17:00 (inside
 * hours) → core stores 16:00–18:00, two hours nobody validated.
 *
 * The rule pinned here: whenever the time gate opens, the payload carries the
 * WHOLE judged interval — starts_at, ends_at, and duration_minutes as the
 * judged whole minutes. A patch that touched no time field sends exactly what
 * it named. The create core already sends the pair it judged (C1).
 *
 * P8 FAILS on 12d3a6d1e (the payload was `{ starts_at }` alone) and PASSES
 * with the fix.
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

import { createAppointmentCore, updateAppointmentCore } from '@/lib/appointments/mutations'

/** 2026-09-15 is a TUESDAY in JST. */
const EVENING = { starts_at: '2026-09-15T08:00:00.000Z', ends_at: '2026-09-15T09:00:00.000Z' } // 17:00–18:00 JST
const MORNING = { starts_at: '2026-09-15T01:00:00.000Z', ends_at: '2026-09-15T02:00:00.000Z' } // 10:00–11:00 JST

function stored(times: { starts_at: string; ends_at: string }) {
  return {
    id: 'appt-1',
    status: 'SCHEDULED',
    customer_id: 'cust-1',
    staff_id: 'staff-core-1',
    store_id: 'store-ginza',
    ...times,
    duration_minutes: 60,
    created_at: '2026-09-01T00:00:00.000Z',
  }
}
/** The store is open 10:00–18:00 every day. */
const CLOSES_1800 = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '10:00', close: '18:00' }]),
)
const ACTOR = { actorId: 'auth-user-1', businessId: 'business-1', source: 'web' as const }
const VIEW_ALL = { viewAll: true, allowedStoreIds: null }
const HOURS = { operatingHours: null, orgSaved: [] }

function client(row: ReturnType<typeof stored>) {
  const update = jest.fn(async () => ({ customer_id: 'cust-1', store_id: 'store-ginza' }))
  const create = jest.fn(async () => ({ id: 'appt-new', customer_id: 'cust-1', store_id: 'store-ginza' }))
  const policyGet = jest.fn(async () => ({ weekly_hours: CLOSES_1800, special_open_days: [] }))
  const listClosedDays = jest.fn(async () => ({ closed_days: [] }))
  return {
    update,
    create,
    policyGet,
    synqed: {
      appointments: { get: jest.fn(async () => row), update, create },
      packs: {},
      staff: { get: jest.fn(async (id: string) => ({ id, business_id: 'business-1', is_active: true })) },
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

describe('a time patch carries the WHOLE judged interval to core', () => {
  it('P8: stored 17:00–18:00, { startsAt: 16:00 } → core gets 16:00–17:00, 60 min (never 16:00 + the stored 18:00)', async () => {
    const c = client(stored(EVENING))
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { startsAt: '2026-09-15T07:00:00.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ success: true })
    expect(c.update).toHaveBeenCalledTimes(1)
    expect(c.update).toHaveBeenCalledWith('appt-1', {
      starts_at: '2026-09-15T07:00:00.000Z',
      ends_at: '2026-09-15T08:00:00.000Z',
      duration_minutes: 60,
    })
  })

  it('P9: stored 10:00–11:00, { durationMinutes: 90 } → core gets 10:00–11:30, 90 min (core never derives the end from the label)', async () => {
    const c = client(stored(MORNING))
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { durationMinutes: 90 },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ success: true })
    expect(c.update).toHaveBeenCalledWith('appt-1', {
      starts_at: '2026-09-15T01:00:00.000Z',
      ends_at: '2026-09-15T02:30:00.000Z',
      duration_minutes: 90,
    })
  })

  it('P10: stored 10:00–11:00, { endsAt: 11:30 } → core gets 10:00–11:30, and the label says 90 (never a stale 60)', async () => {
    const c = client(stored(MORNING))
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { endsAt: '2026-09-15T02:30:00.000Z' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ success: true })
    expect(c.update).toHaveBeenCalledWith('appt-1', {
      starts_at: '2026-09-15T01:00:00.000Z',
      ends_at: '2026-09-15T02:30:00.000Z',
      duration_minutes: 90,
    })
  })

  it('P11: a staff-only patch sends exactly { staff_id } — no time field added, no hours question', async () => {
    const c = client(stored(MORNING))
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { staffId: 'staff-core-2' },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toEqual({ success: true })
    expect(c.update).toHaveBeenCalledTimes(1)
    const [, payload] = c.update.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(Object.keys(payload)).toEqual(['staff_id'])
    expect(payload).toEqual({ staff_id: 'staff-core-2' })
    expect(c.policyGet).not.toHaveBeenCalled()
  })

  it('P12: a time patch the hours door refuses reaches core with NOTHING — stored 17:00–18:00, { durationMinutes: 90 } runs to 18:30', async () => {
    const c = client(stored(EVENING))
    const result = await updateAppointmentCore(
      c.synqed as never,
      'appt-1',
      { durationMinutes: 90 },
      ACTOR,
      HOURS,
      VIEW_ALL,
    )
    expect(result).toMatchObject({ code: 'outside_hours' })
    expect(c.update).not.toHaveBeenCalled()
    // No audit row claims a change that never happened.
    expect(logSpy).not.toHaveBeenCalled()
  })
})

describe('the create core sends the pair it judged (audit, fix 1)', () => {
  const deps = {
    synqedStaffId: 'staff-core-1',
    preferredStoreId: 'store-ginza',
    operatingHours: null,
    orgSaved: [],
    actor: ACTOR,
  }
  const input = (durationMinutes: number) => ({
    staffProfileId: 'staff-1',
    clientId: 'cust-1',
    startTime: EVENING.starts_at,
    durationMinutes,
    tzOffsetMinutes: -540,
  })

  it('C1: 17:00 + 60 in a store closing 18:00 → core gets starts_at 17:00, ends_at 18:00, 60 — and 17:00 + 61 (the next minute) is refused, nothing created', async () => {
    const c = client(stored(EVENING))
    expect(await createAppointmentCore(c.synqed as never, input(60), deps)).toEqual({ id: 'appt-new' })
    expect(c.create).toHaveBeenCalledTimes(1)
    expect(c.create).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: '2026-09-15T08:00:00.000Z',
        ends_at: '2026-09-15T09:00:00.000Z',
        duration_minutes: 60,
      }),
    )

    // The judged end is start + duration — the same end the payload carries:
    // one minute more and the door refuses before core is asked.
    const d = client(stored(EVENING))
    expect(await createAppointmentCore(d.synqed as never, input(61), deps)).toMatchObject({
      code: 'outside_hours',
    })
    expect(d.create).not.toHaveBeenCalled()
  })
})
