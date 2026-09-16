/**
 * ⚖ R1-7 (E33, "the 201st") — the ROSTER reads page to exhaustion.
 *
 * Both roster reads asked core for ONE page of 200 and stopped. Core 400s a
 * larger page_size and does not clamp, so a business past 200 staff silently
 * lost the rest. That was tolerable while the roster only fed a list; it is
 * not, now that its SIZE is the capacity divisor — a 250-staff business
 * divided every store's booked minutes by at most 200 lanes, understating
 * capacity and overstating 稼働% with nothing on the wire to say the read was
 * short. Worse at the assignment read: staff 201+ came back with no assignment
 * row at all, and the picker's fail-open arm then kept every one of them in
 * EVERY store.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-key'

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(),
}))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(),
  getPrimaryStoreId: jest.fn(),
  getStaffStoresStrict: jest.fn(),
}))

const GINZA = 'store-ginza'
/** 250 core staff rows — the 201st is the point. */
const CORE_STAFF = Array.from({ length: 250 }, (_, i) => ({
  id: `sq-${i + 1}`,
  user_id: `profile-${i + 1}`,
  email: `s${i + 1}@x.jp`,
  name: `staff ${i + 1}`,
  is_active: true,
  role: 'STYLIST',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
}))

const staffList = jest.fn(async ({ page, page_size }: { page: number; page_size: number }) => ({
  staff: CORE_STAFF.slice((page - 1) * page_size, page * page_size),
  total: CORE_STAFF.length,
}))
const staffStoresGet = jest.fn(async () => ({ store_ids: [GINZA] }))

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({
    staff: { list: (o: { page: number; page_size: number }) => staffList(o) },
    staffStores: { get: () => staffStoresGet() },
  })),
}))

import { listAllCoreStaff } from '@/lib/synqed/staff-pager'
import {
  rosterForStore,
  storeDivisorRosterForBusiness,
  storeStaffIdSetForBusiness,
} from '@/lib/auth/store-scope'

const roster = CORE_STAFF.map((s) => ({ id: s.id, email: s.email }))

beforeEach(() => {
  staffList.mockClear()
  staffStoresGet.mockClear()
})

describe('listAllCoreStaff', () => {
  it('MUTANT m7 — walks every page, so the 201st staff row exists', () => {
    return listAllCoreStaff({ list: staffList }).then((rows) => {
      expect(rows).toHaveLength(250) // 200 with the loop removed
      expect(staffList).toHaveBeenCalledTimes(2)
      expect(rows[200].id).toBe('sq-201')
    })
  })

  it('a page-size-200 fixture with no `total` still terminates after one call', async () => {
    const single = jest.fn(async () => ({ staff: [{ id: 'sq-1' }] }))
    await expect(listAllCoreStaff({ list: single })).resolves.toHaveLength(1)
    expect(single).toHaveBeenCalledTimes(1)
  })

  it('stops on an empty page rather than walking the cap', async () => {
    const empty = jest.fn(async () => ({ staff: [], total: 9999 }))
    await expect(listAllCoreStaff({ list: empty })).resolves.toHaveLength(0)
    expect(empty).toHaveBeenCalledTimes(1)
  })
})

describe('the divisor of a 250-staff business', () => {
  it('counts 250 lanes, not 200 — the assignment read pages too', async () => {
    const divisor = await storeDivisorRosterForBusiness(roster, GINZA, 'business-1')
    expect(divisor).not.toBeNull()
    expect(divisor!.size).toBe(250)
    expect(staffList).toHaveBeenCalledTimes(2)
  })

  it('and the picker lens sees the same 250, so 201+ are no longer unplaceable', async () => {
    const lens = await storeStaffIdSetForBusiness(roster, GINZA, 'business-1')
    expect(lens!.size).toBe(250)
  })

  it('the strict roster is what the count comes from — an unplaceable 251st is not a lane', async () => {
    const assignments = CORE_STAFF.map((s) => ({
      id: s.id,
      user_id: s.user_id,
      email: s.email,
      store_ids: [GINZA],
    }))
    const withStranger = [...roster, { id: 'profile-stranger', email: 'stranger@x.jp' }]
    expect(rosterForStore(withStranger, assignments, GINZA).size).toBe(250)
  })
})
