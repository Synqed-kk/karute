/**
 * Coverage for canViewTranscript (src/lib/auth/recording-acl.ts) — the per-staff
 * recording-privacy boundary (#4). The raw transcript is private to the staff who
 * recorded it; the AI summary stays shared (not modeled here — it's never gated).
 */
import { canViewAllInStore, canViewTranscript } from '@/lib/auth/recording-acl'

describe('canViewTranscript', () => {
  it('the recording staff sees their own transcript', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: 's1', canViewAll: false }),
    ).toBe(true)
  })

  it('a different staff is denied (the core privacy rule)', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: 's2', canViewAll: false }),
    ).toBe(false)
  })

  it('a recordings.viewAll role (owner/manager) sees everyone’s', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: 's2', canViewAll: true }),
    ).toBe(true)
  })

  it('an ownerless record (legacy/manual) is shared', () => {
    expect(
      canViewTranscript({ ownerStaffId: null, viewerStaffId: 's2', canViewAll: false }),
    ).toBe(true)
  })

  it('a viewer with no staff identity is denied an owned transcript', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: null, canViewAll: false }),
    ).toBe(false)
  })
})

/**
 * ⚖ THE GRANT WIDENS WHOSE RECORDINGS, NEVER WHICH STORES (Liam's store-
 * isolation law 8/17; Greptile #848 point 2). Before the named grant every
 * `recordings.viewAll` holder was an owner, and the owner preset carries
 * `stores.viewAll` — so a holder without store reach could not exist. The first
 * named grantee is that person, and this narrows the viewAll branch above for her.
 */
describe('canViewAllInStore', () => {
  const A = ['store-a']

  it('no grant → false, whatever the stores say', () => {
    expect(
      canViewAllInStore({ canViewAll: false, allowedStoreIds: null, recordStoreId: null }),
    ).toBe(false)
  })

  it('unrestricted scope (stores.viewAll / floating staff) hears any store', () => {
    expect(
      canViewAllInStore({ canViewAll: true, allowedStoreIds: null, recordStoreId: 'store-b' }),
    ).toBe(true)
  })

  it('a record with no store (全店舗 / legacy) is heard — there is no boundary to cross', () => {
    expect(canViewAllInStore({ canViewAll: true, allowedStoreIds: A, recordStoreId: null })).toBe(true)
    expect(
      canViewAllInStore({ canViewAll: true, allowedStoreIds: A, recordStoreId: undefined }),
    ).toBe(true)
  })

  it('a grantee assigned to store A hears store A', () => {
    expect(canViewAllInStore({ canViewAll: true, allowedStoreIds: A, recordStoreId: 'store-a' })).toBe(true)
  })

  it('…and NOT store B — the grant never crosses an assignment', () => {
    expect(canViewAllInStore({ canViewAll: true, allowedStoreIds: A, recordStoreId: 'store-b' })).toBe(false)
  })

  it('a DEGRADED scope lookup ([]) fails closed — never widened into every store', () => {
    expect(canViewAllInStore({ canViewAll: true, allowedStoreIds: [], recordStoreId: 'store-a' })).toBe(false)
  })
})
