/**
 * Coverage for filterStaffIdsToStore (src/lib/auth/store-scope.ts) — the 担当
 * picker clamp. The business-wide roster was leaking every branch's staff
 * names into every store's dropdowns (予約 / 顧客 / カルテ); this keeps only
 * staff assigned to the active store, floating staff (empty assignment =
 * works everywhere), and unlinkable roster members (picker filter fails open;
 * the data-side clamps stay authoritative).
 */
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(),
  getCurrentUserStaffId: jest.fn(),
}))
jest.mock('@/actions/stores', () => ({
  getActiveStoreId: jest.fn(),
  getPrimaryStoreId: jest.fn(),
  getStaffStoresStrict: jest.fn(),
}))

import {
  filterStaffIdsToStore,
  type StaffStoreAssignment,
} from '@/lib/auth/store-scope'

const GINZA = 'store-ginza'
const DAIKANYAMA = 'store-daikanyama'

// synqed-core assignments: ids are synqed staff ids; user_id links a signed-up
// staff's Supabase profile id; email is the fallback link.
const assignments: StaffStoreAssignment[] = [
  { id: 'sq-1', user_id: 'profile-ginza', email: 'ginza@x.jp', store_ids: [GINZA] },
  { id: 'sq-2', user_id: 'profile-dkny', email: 'dkny@x.jp', store_ids: [DAIKANYAMA] },
  { id: 'sq-3', user_id: 'profile-both', email: 'both@x.jp', store_ids: [GINZA, DAIKANYAMA] },
  { id: 'sq-4', user_id: 'profile-float', email: 'float@x.jp', store_ids: [] },
  { id: 'sq-5', user_id: null, email: 'nolink@x.jp', store_ids: [DAIKANYAMA] },
]

describe('filterStaffIdsToStore', () => {
  it('keeps assigned-here + both-stores + floating; drops other-store staff', () => {
    const roster = [
      { id: 'profile-ginza' },
      { id: 'profile-dkny' },
      { id: 'profile-both' },
      { id: 'profile-float' },
    ]
    const kept = filterStaffIdsToStore(roster, assignments, GINZA)
    expect(kept).toEqual(new Set(['profile-ginza', 'profile-both', 'profile-float']))
  })

  it('links profile-less roster members by their synqed id directly', () => {
    // Roster entries for owner-created teammates carry the synqed staff id
    // (see staffListByBusiness) — sq-2 is Daikanyama-only, sq-4 floats.
    const kept = filterStaffIdsToStore(
      [{ id: 'sq-2' }, { id: 'sq-4' }],
      assignments,
      GINZA,
    )
    expect(kept).toEqual(new Set(['sq-4']))
  })

  it('falls back to a case-insensitive email link when ids do not match', () => {
    const kept = filterStaffIdsToStore(
      [{ id: 'profile-unlinked', email: 'NoLink@X.jp' }],
      assignments,
      GINZA,
    )
    // Email links to sq-5 (Daikanyama-only) → dropped from the Ginza picker.
    expect(kept.size).toBe(0)
  })

  it('fails open for roster members with no synqed record at all', () => {
    const kept = filterStaffIdsToStore(
      [{ id: 'profile-mystery', email: 'mystery@x.jp' }],
      assignments,
      GINZA,
    )
    expect(kept).toEqual(new Set(['profile-mystery']))
  })
})
