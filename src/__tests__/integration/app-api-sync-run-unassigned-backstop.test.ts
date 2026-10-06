// Sonnet cold read nit 4 (fix round 2): the phone 今すぐ同期's OWN
// store_unassigned branch (src/app/api/app/v1/sync/run/route.ts), driven at
// the route with the facade front gate held OFF — identity handed to
// facadeHandler with unassigned:false, as unassigned-backstops-routes.test.ts
// does — so the route's backstop, not the front gate, is what answers.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

const identity = {
  current: {
    authUserId: 'staff-1',
    businessId: 'business-1',
    capabilities: new Set(['sync.view']),
    unassigned: false, // the front gate is OFF
    via: 'bearer' as const,
    email: null,
  },
}
jest.mock('@/lib/app-api/identity', () => ({
  resolveBearerIdentity: jest.fn(async () => identity.current),
}))

const audit = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

const runNow = jest.fn()
const storesGet = jest.fn()
const storesList = jest.fn()
const staffStoresGet = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({
    sync: { runNow },
    stores: { get: storesGet, list: storesList },
    staffStores: { get: staffStoresGet },
  }),
}))

import { POST } from '@/app/api/app/v1/sync/run/route'

const noRoute = { params: Promise.resolve({}) }
const post = (store?: string) =>
  new Request('https://s/api/app/v1/sync/run', {
    method: 'POST',
    headers: { authorization: 'Bearer t', ...(store ? { 'store-id': store } : {}) },
  })

beforeEach(() => {
  jest.clearAllMocks()
  storesGet.mockResolvedValue({ id: 'x' })
  // A 2-store business; this caller is assigned to neither.
  storesList.mockResolvedValue({ stores: [{ id: 'store-a', is_primary: true }, { id: 'store-b' }] })
  staffStoresGet.mockResolvedValue({ store_ids: [] })
})

describe('phone run — the route itself refuses a caller who reaches no store', () => {
  it.each([
    ['no store-id header', undefined],
    ['a store-id header naming a real store', 'store-a'],
  ])('%s → 403 store_unassigned, nothing runs, nothing audited', async (_case, header) => {
    const res = await POST(post(header), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_unassigned')
    expect(staffStoresGet).toHaveBeenCalledWith('staff-1') // the helper ran: the gate did not answer
    expect(runNow).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
})
