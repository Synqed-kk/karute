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
  getStaffStores: jest.fn(),
}))

import {
  filterStaffIdsToStore,
  rosterForStore,
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

/**
 * ⚖ R1-5 — the DIVISOR's roster, which is NOT the picker's.
 *
 * The picker keeps an unlinkable member in every store's set, on purpose. The
 * capacity divisor cannot: an unplaceable person counted as a full lane at
 * every branch at once, and a two-store business whose 担当 rows were never
 * written for the other branch divided 銀座's minutes by EIGHT lanes instead
 * of four.
 */
describe('rosterForStore — the divisor fails CLOSED where the picker fails open', () => {
  it('keeps assigned-here + both-stores + explicitly floating, exactly like the picker', () => {
    const roster = [
      { id: 'profile-ginza' },
      { id: 'profile-dkny' },
      { id: 'profile-both' },
      { id: 'profile-float' },
    ]
    expect(rosterForStore(roster, assignments, GINZA)).toEqual(
      new Set(['profile-ginza', 'profile-both', 'profile-float']),
    )
  })

  it('MUTANT m5 — a member NO assignment row can place is never a lane', () => {
    const mystery = [{ id: 'profile-mystery', email: 'mystery@x.jp' }]
    // The picker keeps her (a list may be generous)…
    expect(filterStaffIdsToStore(mystery, assignments, GINZA)).toEqual(
      new Set(['profile-mystery']),
    )
    // …and she is in EVERY store's picker, which is the arm that inflated the
    // divisor at every branch simultaneously.
    expect(filterStaffIdsToStore(mystery, assignments, DAIKANYAMA)).toEqual(
      new Set(['profile-mystery']),
    )
    // The divisor takes neither.
    expect(rosterForStore(mystery, assignments, GINZA).size).toBe(0)
    expect(rosterForStore(mystery, assignments, DAIKANYAMA).size).toBe(0)
  })

  it('銀座 is four lanes, never eight, when the other branch has no assignment rows', () => {
    // Four people carry 銀座 rows; the other four were never written — core's
    // staffStores rows missing for owner-created teammates, or a broken
    // profile/email link.
    const ginzaRows: StaffStoreAssignment[] = [1, 2, 3, 4].map((n) => ({
      id: `sq-g${n}`,
      user_id: `profile-g${n}`,
      email: `g${n}@x.jp`,
      store_ids: [GINZA],
    }))
    const roster = [
      ...[1, 2, 3, 4].map((n) => ({ id: `profile-g${n}` })),
      ...[1, 2, 3, 4].map((n) => ({ id: `profile-d${n}` })), // no rows at all
    ]
    expect(filterStaffIdsToStore(roster, ginzaRows, GINZA).size).toBe(8)
    expect(rosterForStore(roster, ginzaRows, GINZA).size).toBe(4)
  })

  it('an EMPTY store_ids is a declaration, not an absence — floating staff still count', () => {
    // The two cases the picker conflates: a row saying "every store" is the
    // documented convention and IS a lane here; no row at all is not.
    expect(
      rosterForStore([{ id: 'profile-float' }], assignments, DAIKANYAMA),
    ).toEqual(new Set(['profile-float']))
  })

  it('links the same three ways the picker does — synqed id, user_id, then email', () => {
    expect(rosterForStore([{ id: 'sq-4' }], assignments, GINZA)).toEqual(new Set(['sq-4']))
    expect(
      rosterForStore([{ id: 'x', email: 'NoLink@X.jp' }], assignments, DAIKANYAMA),
    ).toEqual(new Set(['x']))
    expect(rosterForStore([{ id: 'x', email: 'NoLink@X.jp' }], assignments, GINZA).size).toBe(0)
  })
})
