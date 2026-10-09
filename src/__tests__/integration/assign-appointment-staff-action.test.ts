/**
 * ⚖ FIX ROUND 4 (R2) — the web server action assignAppointmentStaff (a public
 * POST) on cancel-appointment.test.ts's harness. The sheet's canAssign only
 * hides a control; these pin the wall: bookings.manage, the store lock with the
 * caller's own scope, and (R3) the staff resolver reached only after both.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
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

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: null })),
}))
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => null) }))
const resolveSynqedStaffId = jest.fn(async (_id: string) => 'staff-new')
jest.mock('@/lib/synqed/staff-map', () => ({ resolveSynqedStaffId: (id: string) => resolveSynqedStaffId(id) }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerList: jest.fn(async () => []) }))

const requireCapability = jest.fn(async (_cap: string) => {})
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: (cap: string) => requireCapability(cap),
  can: jest.fn(async () => true),
}))
// The store lock seam: the PREDICATE (src/lib/auth/store-lock.ts) stays real;
// only the caller's resolved scope is set per test.
const VIEW_ALL = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
const resolveStoreScope = jest.fn(async (): Promise<unknown> => VIEW_ALL)
// filterStaffIdsToStore (the shared staff check) stays real too.
jest.mock('@/lib/auth/store-scope', () => ({
  ...jest.requireActual('@/lib/auth/store-scope'),
  resolveStoreScope: () => resolveStoreScope(),
  customerLensFor: jest.fn(() => undefined),
  storeStaffIdSet: jest.fn(async () => null),
}))

jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
}))

const LIVE = {
  id: 'appt-1',
  customer_id: 'cust-1',
  store_id: 'store-1',
  staff_id: null,
  status: 'SCHEDULED',
  starts_at: '2026-10-06T01:00:00.000Z',
  ends_at: '2026-10-06T02:00:00.000Z',
}
const apptGet = jest.fn(async (): Promise<unknown> => LIVE)
const apptUpdate = jest.fn(async (_id: string, _patch: unknown) => ({ customer_id: 'cust-1', store_id: 'store-1' }))
const staffGet = jest.fn(async (id: string) => ({ id, is_active: true, business_id: 'biz-1' }))
const staffStoresGet = jest.fn(async (_id: string) => ({ store_ids: ['store-1'] }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    appointments: { get: apptGet, update: apptUpdate },
    staff: { get: staffGet },
    staffStores: { get: staffStoresGet },
    packs: {},
  })),
}))

import { assignAppointmentStaff } from '@/actions/appointments'

beforeEach(() => {
  jest.clearAllMocks()
  requireCapability.mockImplementation(async () => {})
  resolveStoreScope.mockImplementation(async () => VIEW_ALL)
  apptGet.mockImplementation(async () => LIVE)
})

describe('assignAppointmentStaff (web server action)', () => {
  it('(i) no bookings.manage → { error }, no resolve, appointments.update never called', async () => {
    requireCapability.mockImplementation(async () => {
      throw new Error('Forbidden')
    })
    const res = await assignAppointmentStaff('appt-1', 'profile-new')
    expect(requireCapability).toHaveBeenCalledWith('bookings.manage')
    expect(res).toHaveProperty('error')
    expect(resolveSynqedStaffId).not.toHaveBeenCalled()
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it("(ii) a caller clamped to store-1 on store-2's booking → refused, resolver never called, 0 writes", async () => {
    resolveStoreScope.mockImplementation(async () => ({
      storeId: 'store-1',
      viewAll: false,
      allowedStoreIds: ['store-1'],
      degraded: false,
    }))
    apptGet.mockImplementation(async () => ({ ...LIVE, store_id: 'store-2' }))
    const res = await assignAppointmentStaff('appt-1', 'profile-new')
    expect(res).toHaveProperty('error')
    expect(res).not.toEqual({ success: true })
    expect(resolveSynqedStaffId).not.toHaveBeenCalled()
    expect(staffGet).not.toHaveBeenCalled()
    expect(apptUpdate).not.toHaveBeenCalled()
  })

  it('(iii) success → { success: true }; the profile is resolved once and the patch is { staff_id } only', async () => {
    const res = await assignAppointmentStaff('appt-1', 'profile-new')
    expect(res).toEqual({ success: true })
    expect(resolveSynqedStaffId).toHaveBeenCalledTimes(1)
    expect(resolveSynqedStaffId).toHaveBeenCalledWith('profile-new')
    expect(apptUpdate).toHaveBeenCalledTimes(1)
    expect(apptUpdate).toHaveBeenCalledWith('appt-1', { staff_id: 'staff-new' })
  })
})
