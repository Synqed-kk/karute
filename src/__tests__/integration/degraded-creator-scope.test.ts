/**
 * A DEGRADED CREATOR SCOPE NEVER READS AS "ALL STORES" (⚖ G10 · S2 · S3).
 *
 * `resolveStoreScope().allowedStoreIds` is `null` when the staff_stores lookup
 * FAILED, and `null` means UNCLAMPED to the subset check inside
 * setStaffStoresAtCreationCore. So during a core blip a 銀座-only manager would
 * silently become able to place a new hire in 代官山. Both web doors that mint
 * a card map that unknown to `[]` — refuse every store — and a THROW the same
 * way. A WRITE fails closed on an unknown; only the read plane does not.
 *
 * The CORE's side of this rule is pinned in store-at-creation.test.ts (the F7
 * block, `creatorAllowedStoreIds: []`). What only this file can prove is the
 * WIRING: that each web action performs the degraded → [] mapping at all.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {},
}))
jest.mock('@/lib/auth/require-permission', () => ({
  can: jest.fn(async () => true),
  requireCapability: jest.fn(async () => {}),
  getMyCapabilities: jest.fn(async () => new Set(['staff.manage'])),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ viewAll: false, degraded: false, allowedStoreIds: null })),
  staffWriteInScope: jest.fn(async () => true),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'actor-1'),
  getCurrentUserStaffId: jest.fn(async () => 'actor-1'),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@/lib/audit-web', () => ({
  auditWeb: jest.fn(async () => {}),
  resolveWebActorId: jest.fn(async () => 'actor-1'),
  resolveWebAuditContext: jest.fn(async () => ({ actorId: 'actor-1', businessId: 'biz-1' })),
}))
jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowed: jest.fn(async () => ({ allowed: true })),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'ilike']) chain[m] = () => chain
    ;(chain as { maybeSingle: unknown }).maybeSingle = async () => ({ data: null })
    return { from: () => chain }
  },
}))

// Real UUIDs: staffProfileSchema / inviteSchema validate storeIds as UUIDs,
// so a 'store-ginza' fixture would be refused by the parse long before the
// clamp this file is about.
const GINZA = '11111111-1111-4111-8111-111111111111'
const DAIKANYAMA = '22222222-2222-4222-8222-222222222222'

const staffCreate = jest.fn(async () => ({ id: 'staff-new' }))
const staffDelete = jest.fn(async () => ({}))
const staffStoresSet = jest.fn(async () => ({}))
const invitesCreate = jest.fn(async () => ({ id: 'inv-new' }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    staff: {
      create: staffCreate,
      delete: staffDelete,
      get: jest.fn(async () => ({ id: 'staff-new', email: null, user_id: null })),
      update: jest.fn(async () => ({})),
      list: jest.fn(async () => ({ staff: [], total: 0 })),
    },
    staffStores: { set: staffStoresSet, get: jest.fn(async () => ({ store_ids: [] })) },
    // TWO stores, so the store-at-creation rule is live and a placement really
    // happens — a one-store salon's carve-out would prove nothing here.
    stores: {
      list: jest.fn(async () => ({
        stores: [
          { id: GINZA, is_primary: true },
          { id: DAIKANYAMA },
        ],
      })),
    },
    invites: { create: invitesCreate, list: jest.fn(async () => ({ invites: [] })) },
  })),
  newSynqedClient: jest.fn(() => ({})),
}))

import { createStaff } from '@/actions/staff'
import { createInvite } from '@/actions/invites'
import { resolveStoreScope as resolveStoreScopeImport } from '@/lib/auth/store-scope'

const resolveStoreScope = resolveStoreScopeImport as unknown as jest.Mock

const CARD = { name: '新人', position: '', email: '', phone: '', storeIds: [DAIKANYAMA] }
const INVITE = {
  email: 'new@test.com',
  role: 'STYLIST' as const,
  name: '新人',
  storeIds: [DAIKANYAMA],
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveStoreScope.mockResolvedValue({ viewAll: false, degraded: false, allowedStoreIds: null })
})

describe('createStaff — a degraded scope places nobody (S2)', () => {
  it('a FAILED assignment lookup refuses every store', async () => {
    resolveStoreScope.mockResolvedValue({ viewAll: false, degraded: true, allowedStoreIds: null })
    const res = await createStaff(CARD)
    expect(res).toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(staffStoresSet).not.toHaveBeenCalled()
    expect(staffDelete).toHaveBeenCalledWith('staff-new') // the card is rolled back
  })

  it('a THROWN lookup is the same unknown', async () => {
    resolveStoreScope.mockRejectedValue(new Error('core down'))
    const res = await createStaff(CARD)
    expect(res).toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(staffStoresSet).not.toHaveBeenCalled()
  })

  it('an UNCLAMPED owner still places anywhere — the mapping only fires on unknowns', async () => {
    resolveStoreScope.mockResolvedValue({ viewAll: true, degraded: false, allowedStoreIds: null })
    await createStaff(CARD)
    expect(staffStoresSet).toHaveBeenCalledWith('staff-new', [DAIKANYAMA])
  })
})

describe('createInvite — a degraded scope places nobody (S3)', () => {
  it('a FAILED assignment lookup refuses every store', async () => {
    resolveStoreScope.mockResolvedValue({ viewAll: false, degraded: true, allowedStoreIds: null })
    const res = await createInvite(INVITE)
    expect(res).toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(staffStoresSet).not.toHaveBeenCalled()
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('a THROWN lookup is the same unknown', async () => {
    resolveStoreScope.mockRejectedValue(new Error('core down'))
    const res = await createInvite(INVITE)
    expect(res).toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(invitesCreate).not.toHaveBeenCalled()
  })

  it('an UNCLAMPED owner still places anywhere — the mapping only fires on unknowns', async () => {
    resolveStoreScope.mockResolvedValue({ viewAll: true, degraded: false, allowedStoreIds: null })
    const res = await createInvite(INVITE)
    expect(res).toEqual({ token: expect.any(String) })
    expect(staffStoresSet).toHaveBeenCalledWith('staff-new', [DAIKANYAMA])
  })
})
