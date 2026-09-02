/**
 * Post-migration appointment actions. Mocks @synqed-kk/client and verifies:
 *   - createAppointment maps UI camelCase → API snake_case and computes ends_at
 *   - Overlap (SynqedError 409) surfaces as a friendly user message
 *   - getAppointmentsByDate merges customer names + matches karute_record_id
 *   - deleteAppointment / updateAppointment field-shape pass-through (audit
 *     behavior for both is pinned separately in booking-flow.test.ts)
 */

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  // unstable_cache is invoked at module-init by lib/customers/cached.ts; the
  // bare next/cache mock left it undefined and threw "is not a function".
  // Real one wraps a function with caching — for tests, just return the
  // inner function so it's called directly with no caching layer.
  unstable_cache: jest.fn((fn: (...args: unknown[]) => unknown) => fn),
}))
// createAppointment reads the active-store cookie via getActiveStoreId(); no
// cookie set = all-stores view (store_id omitted from the create call).
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined })),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
  getCurrentUserStaffId: jest.fn(async () => '28318e68-6b73-46ed-a1a2-c21299deee3f'),
}))
// can()/getMyCapabilities() and resolveStoreScope() both bottom out in a REAL
// createServiceClient() Supabase call, unmocked here — createAppointment's
// permission gate and every getAppointmentsByDate call each fire it fresh
// (react's cache() does not dedupe across separate `it()` blocks — confirmed
// by instrumenting global.fetch: 2 real fetches per exposed test). Against
// the dummy test host this fails closed today (practitioner-preset fallback,
// viewAll: false), but as an uncontrolled real network round-trip per test —
// the exact CI-runner-load 5s timeout flake class (see
// CLOCKPROOF-PR814-AI-STORE-SCOPE-2026-09-02.md, same root class named there
// for this suite's "returns [] on client error" case). Neither is under test
// here — store-scope clamping is pinned separately in
// appointments-store-scope.test.ts — so stub both flat, matching that file's
// own mock shape.
jest.mock('@/lib/auth/require-permission', () => ({
  can: jest.fn(async () => true),
  requireCapability: jest.fn(async () => {}),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({
    storeId: null,
    viewAll: true,
    allowedStoreIds: null,
    degraded: false,
  })),
}))

// Stub getOrgSettings so validateAppointmentTime treats operating hours as permissive
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({
    operating_hours: {
      monday: { open: '00:00', close: '24:00', enabled: true },
      tuesday: { open: '00:00', close: '24:00', enabled: true },
      wednesday: { open: '00:00', close: '24:00', enabled: true },
      thursday: { open: '00:00', close: '24:00', enabled: true },
      friday: { open: '00:00', close: '24:00', enabled: true },
      saturday: { open: '00:00', close: '24:00', enabled: true },
      sunday: { open: '00:00', close: '24:00', enabled: true },
    },
  })),
}))

// Mock @synqed-kk/client's SynqedError so instanceof checks work
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

const customers = {
  get: jest.fn(),
  list: jest.fn(),
}
const appointments = {
  create: jest.fn(),
  list: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
  // updateAppointmentCore/deleteAppointmentCore (booking mutations now audit,
  // Liam ruling 2026-07-26) read this: update()'s return for the audit
  // target, delete's precondition read before the SDK delete call.
  get: jest.fn(),
}
const karuteRecords = {
  list: jest.fn(),
}
const staff = {
  list: jest.fn(),
}
// deleteAppointmentCore's burn-dedup guard (FIX 8) reads this before every
// delete — mirrors cancel-appointment.test.ts's packs mock. Signature must
// accept the arg the wrapper below forwards (kept net-zero on the lint delta).
const listRecentRedemptions = jest.fn(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (_since: string): Promise<Array<{ appointment_id: string | null }>> => [],
)
const packs = { listRecentRedemptions: (since: string) => listRecentRedemptions(since) }

jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    customers,
    appointments,
    karuteRecords,
    staff,
    packs,
  })),
}))

// getAppointmentsByDate switched from N+1 customers.get calls to a single
// cached batch via getCachedCustomerList — mock that or it returns [].
const cachedCustomerList: Array<{ id: string; name: string }> = []
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => cachedCustomerList),
}))

// Profile-id → synqed-staff-id translation moved into its own cached module
// (src/lib/synqed/staff-map.ts). Mock the resolver directly so tests don't
// need to stub the inner SynqedClient construction.
const resolveSynqedStaffIdMock = jest.fn(async (id: string) => id)
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: (id: string) => resolveSynqedStaffIdMock(id),
}))

import {
  createAppointment,
  getAppointmentsByDate,
  updateAppointment,
  deleteAppointment,
} from '@/actions/appointments'
import { SynqedError } from '@synqed-kk/client'

describe('Migrated appointment actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createAppointment', () => {
    it('translates supabase profile id → synqed staff id before insert', async () => {
      // synqed-core's appointments.staff_id FKs to staff.id, but the UI passes
      // profiles.id (== staff.user_id). Without this translation the insert
      // fails with appointments_staff_id_fkey on synqed-core.
      appointments.create.mockResolvedValue({ id: 'appt-1' })
      resolveSynqedStaffIdMock.mockImplementationOnce(async (id: string) =>
        id === 'profile-1' ? 'synqed-staff-1' : id,
      )

      const result = await createAppointment({
        staffProfileId: 'profile-1',
        clientId: 'cust-1',
        startTime: '2026-05-10T10:00:00.000Z',
        durationMinutes: 60,
        title: 'Cut',
        notes: 'return client',
      })

      expect(result).toEqual({ id: 'appt-1' })
      expect(appointments.create).toHaveBeenCalledWith({
        customer_id: 'cust-1',
        staff_id: 'synqed-staff-1',
        starts_at: '2026-05-10T10:00:00.000Z',
        ends_at: '2026-05-10T11:00:00.000Z',
        duration_minutes: 60,
        title: 'Cut',
        notes: 'return client',
      })
    })

    it('returns overlap message on SynqedError 409', async () => {
      appointments.create.mockRejectedValue(new SynqedError(409, 'overlap'))

      const result = await createAppointment({
        staffProfileId: 'staff-1',
        clientId: 'cust-1',
        startTime: '2026-05-10T10:00:00.000Z',
        durationMinutes: 60,
      })

      expect(result).toEqual({
        error: 'This time slot overlaps with an existing booking.',
      })
    })
  })

  describe('getAppointmentsByDate', () => {
    it('returns AppointmentRow[] with customer names and karute_record_id', async () => {
      appointments.list.mockResolvedValue({
        appointments: [
          {
            id: 'appt-1',
            staff_id: 'staff-1',
            customer_id: 'cust-1',
            starts_at: '2026-05-10T10:00:00.000Z',
            duration_minutes: 60,
            title: null,
            notes: null,
            created_at: '2026-05-10T00:00:00.000Z',
            status: 'SCHEDULED',
            source: 'MANUAL',
          },
          {
            id: 'appt-2',
            staff_id: 'staff-1',
            customer_id: 'cust-2',
            starts_at: '2026-05-10T12:00:00.000Z',
            duration_minutes: 60,
            title: null,
            notes: null,
            created_at: '2026-05-10T00:00:00.000Z',
            status: 'SCHEDULED',
            source: 'QUICKRESERVE',
          },
        ],
      })
      cachedCustomerList.length = 0
      cachedCustomerList.push(
        { id: 'cust-1', name: '山田' },
        { id: 'cust-2', name: '佐藤' },
      )
      karuteRecords.list.mockResolvedValue({
        karute_records: [{ id: 'k-1', appointment_id: 'appt-1' }, { id: 'k-2', appointment_id: null }],
      })
      staff.list.mockResolvedValue({
        staff: [{ id: 'staff-1', user_id: 'staff-1' }],
      })

      const rows = await getAppointmentsByDate('2026-05-10', 0)

      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        id: 'appt-1',
        staff_profile_id: 'staff-1',
        client_id: 'cust-1',
        karute_record_id: 'k-1',
        customers: { name: '山田' },
        source: 'MANUAL',
      })
      expect(rows[1]).toMatchObject({
        id: 'appt-2',
        karute_record_id: null,
        customers: { name: '佐藤' },
        source: 'QUICKRESERVE',
      })
    })

    it('returns [] on client error (swallowed)', async () => {
      appointments.list.mockRejectedValue(new Error('boom'))
      const rows = await getAppointmentsByDate('2026-05-10', 0)
      expect(rows).toEqual([])
    })

    it('resolves status_set_by to a display name via the staff list', async () => {
      appointments.list.mockResolvedValue({
        appointments: [
          {
            id: 'appt-1',
            staff_id: 'staff-1',
            customer_id: 'cust-1',
            starts_at: '2026-05-10T10:00:00.000Z',
            duration_minutes: 60,
            title: null,
            notes: null,
            created_at: '2026-05-10T00:00:00.000Z',
            status: 'CANCELLED',
            source: 'MANUAL',
            status_set_by: 'staff-1',
            status_set_at: '2026-05-10T09:00:00.000Z',
          },
        ],
      })
      cachedCustomerList.length = 0
      cachedCustomerList.push({ id: 'cust-1', name: '山田' })
      karuteRecords.list.mockResolvedValue({ karute_records: [] })
      staff.list.mockResolvedValue({
        staff: [{ id: 'staff-1', user_id: 'staff-1', name: 'Tanaka Misaki' }],
      })

      const rows = await getAppointmentsByDate('2026-05-10', 0, { includeCancelled: true })

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        status_set_by_name: 'Tanaka Misaki',
        status_set_at: '2026-05-10T09:00:00.000Z',
      })
    })

    it('leaves status_set_by_name null when status_set_by is absent (sync-cancelled rows)', async () => {
      appointments.list.mockResolvedValue({
        appointments: [
          {
            id: 'appt-1',
            staff_id: 'staff-1',
            customer_id: 'cust-1',
            starts_at: '2026-05-10T10:00:00.000Z',
            duration_minutes: 60,
            title: null,
            notes: null,
            created_at: '2026-05-10T00:00:00.000Z',
            status: 'CANCELLED',
            source: 'QUICKRESERVE',
          },
        ],
      })
      cachedCustomerList.length = 0
      cachedCustomerList.push({ id: 'cust-1', name: '山田' })
      karuteRecords.list.mockResolvedValue({ karute_records: [] })
      staff.list.mockResolvedValue({
        staff: [{ id: 'staff-1', user_id: 'staff-1', name: 'Tanaka Misaki' }],
      })

      const rows = await getAppointmentsByDate('2026-05-10', 0, { includeCancelled: true })

      expect(rows[0].status_set_by_name).toBeNull()
      expect(rows[0].status_set_at).toBeNull()
    })
  })

  describe('updateAppointment', () => {
    it('computes ends_at when both startTime and durationMinutes change', async () => {
      // updateAppointmentCore now reads the booking first (Fable fix-round
      // FIX 2 terminal guard) — give it a live row so the update is reached.
      appointments.get.mockResolvedValue({ status: 'SCHEDULED' })
      // update()'s return rides the full Appointment row (verified fact: core
      // always returns customer_id/store_id) — updateAppointmentCore reads
      // the audit target off it directly.
      appointments.update.mockResolvedValue({ customer_id: 'cust-1', store_id: 'store-1' })

      await updateAppointment('appt-1', {
        startTime: '2026-05-10T14:00:00.000Z',
        durationMinutes: 90,
      })

      expect(appointments.update).toHaveBeenCalledWith('appt-1', {
        starts_at: '2026-05-10T14:00:00.000Z',
        duration_minutes: 90,
        ends_at: '2026-05-10T15:30:00.000Z',
      })
    })

    it('partial update omits ends_at if only duration changes', async () => {
      appointments.get.mockResolvedValue({ status: 'SCHEDULED' })
      appointments.update.mockResolvedValue({ customer_id: 'cust-1', store_id: 'store-1' })

      await updateAppointment('appt-1', { durationMinutes: 45 })

      expect(appointments.update).toHaveBeenCalledWith('appt-1', {
        duration_minutes: 45,
      })
    })
  })

  describe('deleteAppointment', () => {
    it('forwards to client', async () => {
      // deleteAppointmentCore reads the row FIRST (delete() itself returns
      // void) so the audit detail has a customer_id/store_id to point at.
      // starts_at/created_at feed the burn-dedup guard's window (FIX 8).
      appointments.get.mockResolvedValue({
        customer_id: 'cust-1',
        store_id: 'store-1',
        starts_at: '2026-07-06T03:00:00.000Z',
        created_at: '2026-07-06T03:00:00.000Z',
      })
      appointments.delete.mockResolvedValue(undefined)
      listRecentRedemptions.mockResolvedValue([])

      const result = await deleteAppointment('appt-1')

      expect(result).toEqual({ success: true })
      expect(appointments.delete).toHaveBeenCalledWith('appt-1')
    })
  })
})
