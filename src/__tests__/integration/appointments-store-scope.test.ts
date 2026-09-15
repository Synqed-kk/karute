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
// ⚖ R1-3 — `customerLensFor` comes along because the month door now reads the
// cached customer list for the 新規 rule's QR signals; it is the REAL
// implementation (the scope-to-lens mapping is what the clamp means), driven
// by the mocked scope above.
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(),
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
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
  // defaultBookingStore (createAppointment's unset/rejected-cookie fallback)
  // resolves the booked staff's single assigned store — store-ginza here.
  const staffStores = { get: jest.fn(async () => ({ store_ids: ['store-ginza'] })) }
  const stores = { list: jest.fn(async () => ({ stores: [{ id: 'store-ginza', is_primary: true }] })) }
  // ⚖ R1-2 — the booking core reads the LANDING store's own hours before it
  // writes, so a client stub needs the two read verbs. Open every day, no
  // 臨時休業: this file is about the store CLAMP, not about closed days.
  const storePolicies = {
    get: jest.fn(async () => ({ weekly_hours: null })),
    listClosedDays: jest.fn(async () => ({ closed_days: [] })),
  }
  const client = { appointments, karuteRecords, staff, staffStores, stores, storePolicies }
  return { getSynqedClient: jest.fn(async () => client) }
})

import {
  getAppointmentsByDate,
  getAppointmentsInRange,
  getAppointmentById,
  createAppointment,
  getMonthCells,
} from '@/actions/appointments'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getActiveStoreId } from '@/actions/stores'
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

// The 予約 date-jump panel's WEB month door. Same clamp as every read above —
// the panel can reach ANY month, so a missed clamp here would leak another
// branch's booking VOLUME (not names, but a competitor-grade signal) on every
// month a restricted staff member swipes to.
describe('getMonthCells — store scope + the failure contract', () => {
  it('clamped staff: the month read carries their store filter', async () => {
    clampedToGinza()
    await getMonthCells('2026-07')
    const { list } = await appointmentsMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
  })

  it('cross-store viewer with no pinned store: no store filter (same as the siblings)', async () => {
    crossStore(null)
    await getMonthCells('2026-07')
    const { list } = await appointmentsMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })

  it('asks for the month window the key names, leading and trailing days included', async () => {
    crossStore(null)
    await getMonthCells('2026-07')
    const { list } = await appointmentsMock()
    const { from, to } = list.mock.calls[0][0] as { from: string; to: string }
    // computeMonthRange pads a week either side so the grid's outside-month
    // cells are covered: 2026-07-01 JST minus 7 days … 2026-07-31 plus 7.
    expect(from).toBe(new Date('2026-06-24T00:00:00+09:00').toISOString())
    expect(to).toBe(new Date('2026-08-07T23:59:59.999+09:00').toISOString())
  })

  it('returns the month grid as wire cells, the month itself flagged inMonth', async () => {
    crossStore(null)
    const cells = await getMonthCells('2026-07')
    // 2026-07-01 is a Wednesday → 2 leading days; 31 days; 5 rows of 7.
    expect(cells).toHaveLength(35)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31)
    expect(cells[0].id).toBe('2026-06-29')
    expect(cells[0].inMonth).toBe(false)
    expect(typeof cells[0].dateIso).toBe('string')
  })

  it('a failed read THROWS — it must never come back as a month of empty days', async () => {
    // The lie this prevents: getAppointmentsInRange's catch→[] would render
    // "next month is completely free" for an outage. The panel needs the
    // rejection to show its 取得できませんでした line.
    crossStore(null)
    const { list } = await appointmentsMock()
    list.mockRejectedValueOnce(new Error('core down'))
    await expect(getMonthCells('2026-07')).rejects.toThrow('core down')
  })

  it('rejects a key that is not a real YYYY-MM before reading anything', async () => {
    crossStore(null)
    await expect(getMonthCells('2026-13')).rejects.toThrow('YYYY-MM')
    await expect(getMonthCells('2026-07-01')).rejects.toThrow('YYYY-MM')
    const { list } = await appointmentsMock()
    expect(list).not.toHaveBeenCalled()
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

describe('getAppointmentById — recording-target guard', () => {
  it('a NO_SHOW appointment resolves to null — never a recording target', async () => {
    crossStore(null)
    const { get } = await appointmentsMock()
    get.mockResolvedValueOnce({ ...makeSynqedAppointment(null), status: 'NO_SHOW' })
    expect(await getAppointmentById('appt-x')).toBeNull()
  })
})

describe('createAppointment — active-store cookie clamp (write-side isolation)', () => {
  const bookingInput = {
    staffProfileId: 'staff-1',
    clientId: 'cust-1',
    startTime: new Date('2026-07-06T02:00:00.000Z').toISOString(),
    durationMinutes: 60,
    tzOffsetMinutes: -540,
  }

  async function createMock() {
    const client = await (getSynqedClient as jest.Mock)()
    return client.appointments.create as jest.Mock
  }

  it('branch-restricted staff + cookie for a NOT-allowed store: books via defaultBookingStore, never the cookie', async () => {
    clampedToGinza()
    ;(getActiveStoreId as jest.Mock).mockResolvedValueOnce(DAIKANYAMA)
    const create = await createMock()

    await createAppointment(bookingInput)

    // The 代官山 cookie is out of scope → dropped → defaultBookingStore stamps
    // their own 銀座 store, NOT the cookie's 代官山.
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
  })

  it('cross-store viewer + cookie: the cookie is honored', async () => {
    crossStore(DAIKANYAMA)
    ;(getActiveStoreId as jest.Mock).mockResolvedValueOnce(DAIKANYAMA)
    const create = await createMock()

    await createAppointment(bookingInput)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: DAIKANYAMA }))
  })

  it('branch-restricted staff + unset cookie: unchanged — books via defaultBookingStore, scope not consulted', async () => {
    clampedToGinza()
    // getActiveStoreId default mock → null (no cookie)
    const create = await createMock()

    await createAppointment(bookingInput)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
    // No cookie to clamp → the scope lookup never runs (unset-cookie behavior
    // is untouched — defaultBookingStore, not resolveStoreScope().storeId).
    expect(scopeMock).not.toHaveBeenCalled()
  })
})
