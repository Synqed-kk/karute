/**
 * Booking flow tests — covers the user-facing create path:
 *   AppointmentsView form submit → createAppointment action → synqed-core
 *
 * What's exercised here vs. migrated-appointments.test.ts:
 *   - Operating-hours validation rejects out-of-hours slots before the API
 *     call is made.
 *   - Date-string + time-string combine into the right UTC instant.
 *   - The submit handler's customer-lookup-by-name behavior.
 *   - source: 'MANUAL' default for staff-entered bookings round-trips.
 *
 * The migrated test already covers happy-path mapping, 409 overlap, and the
 * update/delete field-shape pass-through — keep the create-flow describe
 * block above scoped to flow-level invariants. The audit describe blocks
 * below (create + update + delete) pin the booking-mutation audit contract
 * for every writer that shares this file's mocks.
 */

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: jest.fn((fn: (...args: unknown[]) => unknown) => fn),
}))
// createAppointment reads the active-store cookie via getActiveStoreId(); no
// cookie set = all-stores view (store_id omitted from the create call).
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined })),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  // Audit identity seam (resolveWebAuditContext, @/lib/audit-web) — booking
  // mutations now emit through the shared cores.
  resolveUserId: jest.fn(async () => 'auth-user-1'),
}))

// updateAppointment/deleteAppointment gate on requireCapability (createAppointment
// gates on can() instead — see its own doc comment — which resolves true here
// same as it always has). Same mocking pattern as cancel-appointment.test.ts /
// mark-no-show-appointment.test.ts, so the denial-path tests below can drive it.
// Signature must accept the arg the wrapper below forwards (same shape as
// cancel-appointment.test.ts / mark-no-show-appointment.test.ts, unsuppressed
// there — disabled here to keep this file's lint delta at zero-net-new).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const requireCapability = jest.fn(async (_cap: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (cap: string) => requireCapability(cap),
  can: jest.fn(async () => true),
}))

// Restrictive operating hours for the operating-hours rejection test below.
// 09:00–18:00 every day, in minutes-since-midnight.
const PERMISSIVE_HOURS = {
  mon: { openMinute: 0, closeMinute: 1440 },
  tue: { openMinute: 0, closeMinute: 1440 },
  wed: { openMinute: 0, closeMinute: 1440 },
  thu: { openMinute: 0, closeMinute: 1440 },
  fri: { openMinute: 0, closeMinute: 1440 },
  sat: { openMinute: 0, closeMinute: 1440 },
  sun: { openMinute: 0, closeMinute: 1440 },
}
const NINE_TO_SIX = {
  mon: { openMinute: 540, closeMinute: 1080 },
  tue: { openMinute: 540, closeMinute: 1080 },
  wed: { openMinute: 540, closeMinute: 1080 },
  thu: { openMinute: 540, closeMinute: 1080 },
  fri: { openMinute: 540, closeMinute: 1080 },
  sat: { openMinute: 540, closeMinute: 1080 },
  sun: { openMinute: 540, closeMinute: 1080 },
}
let activeHours: typeof PERMISSIVE_HOURS = PERMISSIVE_HOURS

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: activeHours })),
}))

jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  return { SynqedError }
})

// staff-map translates karute profile id → synqed staff id. The translation
// is exercised in its own suite; here we just want the booking action under
// test to see a resolved id without hitting a real synqed client.
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (profileId: string) => profileId),
}))

const appointments = {
  create: jest.fn(),
  list: jest.fn(),
  // update/get/delete: updateAppointmentCore reads update()'s return for the
  // audit target; deleteAppointmentCore reads the row first (delete() itself
  // returns void).
  update: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
}
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ appointments })),
}))

import { createAppointment, deleteAppointment, updateAppointment } from '@/actions/appointments'
import { auditLines } from './helpers/audit-lines'

describe('Booking creation flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    activeHours = PERMISSIVE_HOURS
    requireCapability.mockImplementation(async () => {})
  })

  it('builds the start/end pair from a HH:MM time string', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-1' })

    // Same call shape the AppointmentsView dialog produces: a date string +
    // time string + duration are combined into an ISO startTime before reaching
    // the action.
    const startIso = new Date('2026-05-20T13:30:00').toISOString()
    const result = await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: startIso,
      durationMinutes: 45,
      title: 'Hair cut',
    })

    expect(result).toEqual({ id: 'appt-1' })
    expect(appointments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'cust-9',
        staff_id: 'staff-1',
        starts_at: startIso,
        // 45 min later
        ends_at: new Date(new Date(startIso).getTime() + 45 * 60_000).toISOString(),
        duration_minutes: 45,
        title: 'Hair cut',
      }),
    )
  })

  it('rejects a booking outside operating hours without touching the API', async () => {
    activeHours = NINE_TO_SIX
    appointments.create.mockResolvedValue({ id: 'should-not-fire' })

    // 06:00 JST (= 21:00 UTC the previous day) — before the 09:00 open. The
    // real dialog (NewBookingDialog) hard-codes JST as tzOffsetMinutes: -540
    // (getTimezoneOffset semantics: negative when local is ahead of UTC) rather
    // than reading the runner's tz, so reproduce that exactly. Using an explicit
    // UTC instant + fixed offset keeps this deterministic in any runner timezone
    // (the old `-getTimezoneOffset()` had the wrong sign and only passed in UTC).
    const result = await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: '2026-05-19T21:00:00.000Z',
      durationMinutes: 60,
      tzOffsetMinutes: -540,
    })

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toMatch(/operating hours/i)
    }
    expect(appointments.create).not.toHaveBeenCalled()
  })

  it('rejects a non-positive duration before reaching the API', async () => {
    appointments.create.mockResolvedValue({ id: 'should-not-fire' })

    const result = await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: new Date('2026-05-20T11:00:00').toISOString(),
      durationMinutes: 0,
    })

    expect('error' in result).toBe(true)
    expect(appointments.create).not.toHaveBeenCalled()
  })

  it('omits title when not supplied (service field optional in dialog)', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-2' })

    await createAppointment({
      staffProfileId: 'staff-1',
      clientId: 'cust-9',
      startTime: new Date('2026-05-20T11:00:00').toISOString(),
      durationMinutes: 60,
    })

    const call = appointments.create.mock.calls[0][0]
    expect(call.title).toBeNull()
  })
})

// Booking mutations now audit (Liam ruling 2026-07-26): exactly one row per
// mutation, ids-only detail, targeting the customer. Line-shape assertions
// (evt/at/actor_type/break_glass) are pinned once in facade-audit.test.ts;
// this pins the create-specific category, action, and detail contract.
describe('Booking creation flow — audit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    activeHours = PERMISSIVE_HOURS
    requireCapability.mockImplementation(async () => {})
  })

  it('emits exactly one booking.create row targeting the customer, ids-only detail', async () => {
    appointments.create.mockResolvedValue({ id: 'appt-1', customer_id: 'cust-9', store_id: 'store-1' })

    const startIso = new Date('2026-05-20T13:30:00').toISOString()
    let result: unknown
    const lines = await auditLines(async () => {
      result = await createAppointment({
        staffProfileId: 'staff-1',
        clientId: 'cust-9',
        startTime: startIso,
        durationMinutes: 45,
      })
    })

    expect(result).toEqual({ id: 'appt-1' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.create',
      actor_id: 'auth-user-1',
      business_id: '00000000-0000-0000-0000-000000000001',
      target_type: 'customer',
      target_id: 'cust-9',
      severity: 'info',
      source: 'web',
    })
    // Exact equality (not toMatchObject/objectContaining) — a future key
    // leaking a customer name or memo text into detail must fail this test.
    expect(lines[0].detail).toEqual({ appointment_id: 'appt-1', customer_id: 'cust-9', store_id: 'store-1' })
  })

  it('a rejected (out-of-hours) booking emits no audit row', async () => {
    activeHours = NINE_TO_SIX
    appointments.create.mockResolvedValue({ id: 'should-not-fire' })
    const lines = await auditLines(async () => {
      const result = await createAppointment({
        staffProfileId: 'staff-1',
        clientId: 'cust-9',
        startTime: '2026-05-19T21:00:00.000Z',
        durationMinutes: 60,
        tzOffsetMinutes: -540,
      })
      expect('error' in result).toBe(true)
    })
    expect(lines).toHaveLength(0)
  })

  it('a failed write emits no audit row', async () => {
    appointments.create.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const result = await createAppointment({
        staffProfileId: 'staff-1',
        clientId: 'cust-9',
        startTime: new Date('2026-05-20T11:00:00').toISOString(),
        durationMinutes: 60,
      })
      expect(result).toEqual({ error: 'core down' })
    })
    expect(lines).toHaveLength(0)
  })
})

// updateAppointment/deleteAppointment (src/actions/appointments.ts) now audit
// too, armed the same day as the rest of the P-B 2/2 booking writers (Liam
// ruling 2026-07-26) even though neither action has a caller anywhere yet (no
// UI, no facade twin — verified by exhaustive grep) — a future booking-edit
// feature that picks them up is audited by default from day one.
describe('updateAppointment — audit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    requireCapability.mockImplementation(async () => {})
  })

  it('emits exactly one booking.update row, ids-only detail, changed:"staff" for a staff-only reassign', async () => {
    appointments.update.mockResolvedValue({ customer_id: 'cust-9', store_id: 'store-1' })

    let result: unknown
    const lines = await auditLines(async () => {
      result = await updateAppointment('appt-1', { staffProfileId: 'staff-2' })
    })

    expect(result).toEqual({ success: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.update',
      target_type: 'customer',
      target_id: 'cust-9',
      severity: 'info',
      source: 'web',
    })
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-9',
      store_id: 'store-1',
      changed: 'staff',
    })
  })

  it('changed:"time,duration" when both startTime and durationMinutes are patched together', async () => {
    appointments.update.mockResolvedValue({ customer_id: 'cust-9', store_id: 'store-1' })
    const startIso = new Date('2026-05-20T13:30:00').toISOString()

    const lines = await auditLines(async () => {
      await updateAppointment('appt-1', { startTime: startIso, durationMinutes: 45 })
    })

    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-9',
      store_id: 'store-1',
      changed: 'time,duration',
    })
  })

  it('detail carries ids/codes only — a name, title, or memo text on the return value never leaks in', async () => {
    appointments.update.mockResolvedValue({
      customer_id: 'cust-9',
      store_id: 'store-1',
      title: 'Should never appear in detail',
      notes: 'Should never appear in detail either',
    })

    const lines = await auditLines(async () => {
      await updateAppointment('appt-1', { durationMinutes: 30 })
    })

    expect(Object.keys(lines[0].detail as object).sort()).toEqual(
      ['appointment_id', 'changed', 'customer_id', 'store_id'].sort(),
    )
    expect(JSON.stringify(lines[0].detail)).not.toMatch(/Should never appear/)
  })

  it('a rejected SDK update returns { error } and emits no audit row', async () => {
    appointments.update.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const result = await updateAppointment('appt-1', { durationMinutes: 30 })
      expect(result).toEqual({ error: 'core down' })
    })
    expect(lines).toHaveLength(0)
  })

  it('a denied update never reaches the SDK and emits no audit row', async () => {
    requireCapability.mockRejectedValueOnce(new Error('nope'))
    const lines = await auditLines(async () => {
      const result = await updateAppointment('appt-1', { durationMinutes: 30 })
      expect(result).toEqual({ error: 'nope' })
    })
    expect(appointments.update).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })
})

describe('deleteAppointment — audit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    requireCapability.mockImplementation(async () => {})
  })

  it('emits exactly one booking.delete row at severity notice, ids-only detail', async () => {
    appointments.get.mockResolvedValue({ customer_id: 'cust-9', store_id: 'store-1' })
    appointments.delete.mockResolvedValue(undefined)

    let result: unknown
    const lines = await auditLines(async () => {
      result = await deleteAppointment('appt-1')
    })

    expect(result).toEqual({ success: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'booking',
      action: 'booking.delete',
      target_type: 'customer',
      target_id: 'cust-9',
      severity: 'notice',
      source: 'web',
    })
    expect(lines[0].detail).toEqual({
      appointment_id: 'appt-1',
      customer_id: 'cust-9',
      store_id: 'store-1',
    })
  })

  it('a missing booking returns { error: "Booking not found." }, never calls delete, emits no audit row', async () => {
    appointments.get.mockResolvedValueOnce(null)
    const lines = await auditLines(async () => {
      const result = await deleteAppointment('appt-1')
      expect(result).toEqual({ error: 'Booking not found.' })
    })
    expect(appointments.delete).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('a rejected SDK delete emits no audit row', async () => {
    appointments.get.mockResolvedValue({ customer_id: 'cust-9', store_id: 'store-1' })
    appointments.delete.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const result = await deleteAppointment('appt-1')
      expect(result).toEqual({ error: 'core down' })
    })
    expect(lines).toHaveLength(0)
  })

  it('a denied delete never reaches the SDK and emits no audit row', async () => {
    requireCapability.mockRejectedValueOnce(new Error('nope'))
    const lines = await auditLines(async () => {
      const result = await deleteAppointment('appt-1')
      expect(result).toEqual({ error: 'nope' })
    })
    expect(appointments.get).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })
})
