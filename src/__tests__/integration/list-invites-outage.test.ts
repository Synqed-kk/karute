/**
 * listInvites never answers an OUTAGE with [] (Round 3 leg 3, D-S16-4,
 * discussed, default). `null` = could not load; `[]` = a denied viewer (the
 * old contract, unchanged); rows = success. The dialog half is pinned in
 * list-invites-outage-ui.test.tsx.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))

const can = jest.fn<Promise<boolean>, [string]>(async () => true)
jest.mock('@/lib/auth/require-permission', () => ({
  can: (c: string) => can(c),
  requireCapability: jest.fn(async () => {}),
  getMyCapabilities: jest.fn(async () => new Set()),
}))

const staffWriteInScope = jest.fn<Promise<boolean>, [unknown]>(async () => true)
jest.mock('@/lib/auth/store-scope', () => ({
  staffWriteInScope: (a: unknown) => staffWriteInScope(a),
  resolveStoreScope: jest.fn(async () => ({ viewAll: false })),
}))

const getBusinessId = jest.fn(async () => 'biz-1')
jest.mock('@/lib/staff', () => ({
  getBusinessId: () => getBusinessId(),
  resolveUserId: jest.fn(async () => 'actor-1'),
  getCurrentUserStaffId: jest.fn(async () => 'actor-1'),
}))

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/invites/member-emails', () => ({
  memberEmailsForBusiness: jest.fn(async () => new Set<string>()),
}))
// The REAL core reads through this client (P4, P6): no `staff` port, so the
// best-effort 接続済み roster read is skipped.
const invitesList = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ invites: { list: () => invitesList() } })),
  newSynqedClient: jest.fn(() => ({})),
}))

// A spy that runs the REAL core unless a test overrides it (P5).
const realCore = jest.requireActual('@/lib/invites/invites.core')
const listInvitesWithClient = jest.fn()
jest.mock('@/lib/invites/invites.core', () => ({
  ...jest.requireActual('@/lib/invites/invites.core'),
  listInvitesWithClient: (...a: unknown[]) => listInvitesWithClient(...a),
}))

import { listInvites } from '@/actions/invites'

const ROWS = [
  {
    id: 'inv-1',
    email: 'a@test.com',
    role: 'STYLIST',
    status: 'pending',
    created_at: '2026-01-01',
    expires_at: '2026-01-08',
    linked: false,
  },
]

beforeEach(() => {
  can.mockReset().mockResolvedValue(true)
  getBusinessId.mockReset().mockResolvedValue('biz-1')
  listInvitesWithClient.mockReset().mockImplementation(realCore.listInvitesWithClient)
  invitesList.mockReset().mockResolvedValue({ invites: [] })
  staffWriteInScope.mockReset().mockResolvedValue(true)
})

const CORE_REINVITE = {
  id: 'inv-re',
  email: 'b@test.com',
  role: 'STYLIST',
  status: 'pending',
  created_at: '2026-01-01',
  expires_at: '2026-01-08',
  invited_by: 'someone-else',
  invited_staff_id: 'card-b',
}

describe('listInvites — an outage is null, a denial is [], success is the rows', () => {
  it('P1 the permission read fails → null, the list is never read', async () => {
    can.mockRejectedValueOnce(new Error('Permission lookup failed'))
    await expect(listInvites()).resolves.toBeNull()
    expect(listInvitesWithClient).not.toHaveBeenCalled()
  })

  it('P2 a denied viewer → [] (unchanged contract), the list is never read', async () => {
    can.mockResolvedValueOnce(false)
    await expect(listInvites()).resolves.toEqual([])
    expect(listInvitesWithClient).not.toHaveBeenCalled()
  })

  it('P3 the business id read fails → null, the list is never read', async () => {
    getBusinessId.mockRejectedValueOnce(new Error('Business membership lookup failed'))
    await expect(listInvites()).resolves.toBeNull()
    expect(listInvitesWithClient).not.toHaveBeenCalled()
  })

  it('P4 the core list read rejects (real core) → null', async () => {
    invitesList.mockRejectedValueOnce(new Error('core down'))
    await expect(listInvites()).resolves.toBeNull()
    expect(invitesList).toHaveBeenCalledTimes(1)
  })

  it('P6 the store lens THROWS on a re-invite row (real core) → null', async () => {
    invitesList.mockResolvedValueOnce({ invites: [CORE_REINVITE] })
    staffWriteInScope.mockRejectedValueOnce(new Error('store scope unreadable'))
    await expect(listInvites()).resolves.toBeNull()
    expect(staffWriteInScope).toHaveBeenCalledWith({ targetStaffId: 'card-b', actorId: 'actor-1' })
  })

  it('P5 success → the rows verbatim', async () => {
    listInvitesWithClient.mockResolvedValueOnce(ROWS)
    await expect(listInvites()).resolves.toEqual(ROWS)
    expect(can).toHaveBeenCalledWith('staff.invite')
  })
})

describe('listInvitesWithClient — the shared core throws, never a false []', () => {
  it('C1 invites.list rejects → the core rejects', async () => {
    const synqed = { invites: { list: async () => { throw new Error('core down') } } }
    await expect(realCore.listInvitesWithClient(synqed as never)).rejects.toThrow('core down')
  })
})
