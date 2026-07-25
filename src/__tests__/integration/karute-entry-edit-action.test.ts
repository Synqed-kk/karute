// Edit-layer W2 PR-B: the per-entry edit-save CORE (CAS via expected_version)
// + the cookie web wrapper. Pins: params reach updateEntry with
// expected_version/actor_staff_id/action:'EDIT' (category translated); a 409
// maps to a typed conflict result with NO retry.
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

const updateEntry = jest.fn(async () => ({ id: 'e1' }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords: { updateEntry } })),
}))

import {
  updateKaruteDetailEntry,
  updateKaruteDetailEntryWithClient,
} from '@/actions/karute'

beforeEach(() => jest.clearAllMocks())

// Test-only partial client cast — the mock only needs to satisfy updateEntry's
// call shape at runtime, not the full SynqedClient surface.
const fakeClient = { karuteRecords: { updateEntry } } as unknown as Parameters<
  typeof updateKaruteDetailEntryWithClient
>[0]

describe('updateKaruteDetailEntryWithClient — CAS core', () => {
  it('sends expected_version/actor_staff_id/action:EDIT and translates category', async () => {
    const result = await updateKaruteDetailEntryWithClient(fakeClient, 'kar-1', 'e1', {
      content: 'new body',
      category: 'concern',
      expectedVersion: 2,
      actorStaffId: 'staff-1',
    })
    expect(result).toEqual({ ok: true })
    expect(updateEntry).toHaveBeenCalledWith('kar-1', 'e1', {
      content: 'new body',
      category: 'SYMPTOM',
      expected_version: 2,
      actor_staff_id: 'staff-1',
      action: 'EDIT',
    })
  })

  it('a 409 (stale version) maps to a typed conflict — no retry', async () => {
    updateEntry.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }))
    const result = await updateKaruteDetailEntryWithClient(fakeClient, 'kar-1', 'e1', {
      expectedVersion: 1,
      actorStaffId: 'staff-1',
    })
    expect(result).toEqual({ conflict: true })
    expect(updateEntry).toHaveBeenCalledTimes(1)
  })
})

describe('updateKaruteDetailEntry — web wrapper', () => {
  it('resolves actor_staff_id via getCurrentUserStaffId and reaches the core untouched', async () => {
    const result = await updateKaruteDetailEntry('kar-1', 'e1', {
      content: 'edited',
      expectedVersion: 3,
    })
    expect(result).toEqual({ ok: true })
    expect(updateEntry).toHaveBeenCalledWith('kar-1', 'e1', {
      content: 'edited',
      expected_version: 3,
      actor_staff_id: 'staff-1',
      action: 'EDIT',
    })
  })
})
