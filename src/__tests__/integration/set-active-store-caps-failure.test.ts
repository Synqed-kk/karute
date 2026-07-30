/**
 * setActiveStore under a capability-resolution failure (#652 P1 follow-up).
 * The resolver throws on post-migration query errors; the store-pin action
 * must treat that as NO capabilities — the branch clamp simply applies — and
 * return its house { error } shape, never an unhandled server-action
 * rejection.
 */

jest.mock('@/lib/auth/require-permission', () => ({
  ...jest.requireActual('@/lib/auth/require-permission'),
  getMyCapabilities: jest.fn(async () => {
    throw new Error('capability resolution failed')
  }),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getStaffList: jest.fn(async () => []),
}))
jest.mock('@/lib/synqed/client', () => {
  const client = {
    stores: { get: jest.fn(async () => ({ id: 'store-a' })) },
    staffStores: { get: jest.fn(async () => ({ store_ids: ['store-b'] })) },
  }
  return { getSynqedClient: jest.fn(async () => client), newSynqedClient: jest.fn(() => client) }
})
const mockCookieSet = jest.fn()
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined, set: mockCookieSet, delete: jest.fn() })),
}))
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

import { setActiveStore } from '@/actions/stores'

describe('setActiveStore — capability-resolution failure fails closed', () => {
  it('clamp applies (no viewAll assumed): pinning an unassigned store → house error, no cookie write, no rejection', async () => {
    const res = await setActiveStore('store-a')
    expect(res).toEqual({ error: 'You can only view a store you are assigned to.' })
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it('pinning an ASSIGNED store still works under the failure (degraded, not locked out)', async () => {
    const res = await setActiveStore('store-b')
    expect(res).toEqual({ ok: true })
    expect(mockCookieSet).toHaveBeenCalled()
  })
})
