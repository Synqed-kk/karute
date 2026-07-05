/**
 * Store-scope (RBAC) clamp on appointment READS.
 *
 * The list reads used to pass the raw active-store cookie to synqed-core. A
 * branch-restricted staff with NO cookie (any fresh login) therefore fetched
 * with no store predicate at all — every store's bookings, real customer
 * names included. Found by the first real restricted login (the Apple-review
 * account: frontdesk, 銀座-only, saw the 代官山 agenda).
 *
 * These tests pin the fix: every appointment read resolves the RBAC store
 * scope (resolveStoreScope), so
 *   - a clamped staff's reads are ALWAYS store-filtered (scope.storeId is one
 *     of their assigned stores even with no cookie),
 *   - cross-store viewers keep exactly the old behavior (cookie = lens,
 *     absent cookie = all stores),
 *   - the per-id read can't be used to deep-link another branch's booking,
 *     and fails CLOSED on storeless (pre-repair import) rows.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// @synqed-kk/client ships ESM jest can't parse; appointments.ts imports
// SynqedError from it. Stub it (only SynqedError is referenced at module load).
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

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

// The clamp under test is driven per-test through this spy.
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(),
}))

jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(async () => null),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: null })),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
}))
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
}))

jest.mock('@/lib/synqed/client', () => {
  const appointments = {
    list: jest.fn(async () => ({ appointments: [] })),
    get: jest.fn(async () => null),
    create: jest.fn(async () => ({ id: 'appt-1' })),
    update: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
  }
  const karuteRecords = { list: jest.fn(async () => ({ karute_records: [] })) }
  const staff = { list: jest.fn(async () => ({ staff: [] })) }
  const client = { appointments, karuteRecords, staff }
  return { getSynqedClient: jest.fn(async () => client) }
})

import {
  getAppointmentsByDate,
  getAppointmentsInRange,
  getAppointmentById,
} from '@/actions/appointments'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getSynqedClient } from '@/lib/synqed/client'

const scopeMock = resolveStoreScope as jest.Mock

const GINZA = 'store-ginza'
const DAIKANYAMA = 'store-daikanyama'

function clampedToGinza() {
  scopeMock.mockResolvedValue({ storeId: GINZA, viewAll: false, allowedStoreIds: [GINZA] })
}
function crossStore(pinned: string | null) {
  scopeMock.mockResolvedValue({ storeId: pinned, viewAll: true, allowedStoreIds: null })
}

function makeSynqedAppointment(storeId: string | null) {
  return {
    id: 'appt-x',
    staff_id: 'staff-1',
    customer_id: 'cust-1',
    starts_at: '2026-07-06T03:00:00.000Z',
    duration_minutes: 60,
    title: null,
    notes: null,
    created_at: '2026-07-01T00:00:00.000Z',
    status: 'CONFIRMED',
    source: 'MANUAL',
    store_id: storeId,
  }
}

async function appointmentsMock() {
  const client = await (getSynqedClient as jest.Mock)()
  return client.appointments as { list: jest.Mock; get: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getAppointmentsByDate — store scope', () => {
  it('clamped staff: the fetch is ALWAYS filtered to their store (even with no cookie)', async () => {
    clampedToGinza()
    await getAppointmentsByDate('2026-07-06')
    const { list } = await appointmentsMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
  })

  it('cross-store viewer with no pinned store: no store filter (unchanged behavior)', async () => {
    crossStore(null)
    await getAppointmentsByDate('2026-07-06')
    const { list } = await appointmentsMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })

  it('cross-store viewer pinned to a store: the pin is still the lens', async () => {
    crossStore(DAIKANYAMA)
    await getAppointmentsByDate('2026-07-06')
    const { list } = await appointmentsMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: DAIKANYAMA }))
  })
})

describe('getAppointmentsInRange — store scope', () => {
  it('clamped staff: week/month range reads carry the same store filter', async () => {
    clampedToGinza()
    await getAppointmentsInRange('2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z')
    const { list } = await appointmentsMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
  })
})

describe('getAppointmentById — store scope', () => {
  it("clamped staff: another store's booking resolves to null (no deep-link bypass)", async () => {
    clampedToGinza()
    const { get } = await appointmentsMock()
    get.mockResolvedValueOnce(makeSynqedAppointment(DAIKANYAMA))
    expect(await getAppointmentById('appt-x')).toBeNull()
  })

  it('clamped staff: an own-store booking resolves normally', async () => {
    clampedToGinza()
    const { get } = await appointmentsMock()
    get.mockResolvedValueOnce(makeSynqedAppointment(GINZA))
    const row = await getAppointmentById('appt-x')
    expect(row?.id).toBe('appt-x')
  })

  it('clamped staff: a storeless (pre-repair) booking is hidden — fail closed', async () => {
    clampedToGinza()
    const { get } = await appointmentsMock()
    get.mockResolvedValueOnce(makeSynqedAppointment(null))
    expect(await getAppointmentById('appt-x')).toBeNull()
  })

  it('cross-store viewer: any store resolves (unchanged behavior)', async () => {
    crossStore(null)
    const { get } = await appointmentsMock()
    get.mockResolvedValueOnce(makeSynqedAppointment(DAIKANYAMA))
    const row = await getAppointmentById('appt-x')
    expect(row?.id).toBe('appt-x')
  })
})
