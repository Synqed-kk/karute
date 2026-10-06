// S53 PR-C: GET /api/sync/quickreserve/configs is for stores.viewAll callers
// only (⚖ store isolation law) and never carries a secret; the web run route
// runs a row's named store through PR-A's shared resolver.
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))
const capabilities = { current: new Set<string>() }
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
const listConfigs = jest.fn()
const runNow = jest.fn()
const storesList = jest.fn()
const storesGet = jest.fn()
const staffStoresGet = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    sync: { listConfigs, runNow },
    stores: { list: storesList, get: storesGet },
    staffStores: { get: staffStoresGet },
  })),
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn() }))
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => 'store-daikanyama') }))

import { GET } from '@/app/api/sync/quickreserve/configs/route'
import { POST } from '@/app/api/sync/quickreserve/route'
import { getBusinessId } from '@/lib/staff'

const CONFIG = {
  karute_store_id: 'store-daikanyama', username: 'secret-login-id', store_slug: 'la-estro', store_id: 222,
  enabled: true, interval_minutes: 15, business_hours_start: 8, business_hours_end: 22,
  last_run_at: '2026-10-06T11:50:00Z', last_run_status: 'OK', last_run_error: null, has_credentials: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['sync.view', 'stores.viewAll'])
  storesList.mockResolvedValue({
    stores: [
      { id: 'store-daikanyama', name: '代官山', active: true, is_primary: true },
      { id: 'store-ginza', name: '銀座', active: true },
      { id: 'store-closed', name: '閉店', active: false },
    ],
  })
  listConfigs.mockResolvedValue([CONFIG])
  storesGet.mockResolvedValue({ id: 'x' })
  staffStoresGet.mockResolvedValue({ store_ids: ['store-daikanyama'] })
  runNow.mockResolvedValue({ created: 1, updated: 2, cancelled: 0, skipped_no_staff: 0, skipped_deleted: 0 })
})

describe('GET /api/sync/quickreserve/configs', () => {
  it('401 without a session', async () => {
    ;(getBusinessId as jest.Mock).mockRejectedValueOnce(new Error('Not authenticated'))
    expect((await GET()).status).toBe(401)
  })

  it('403 without stores.viewAll — and reads nothing about other stores', async () => {
    capabilities.current = new Set(['sync.view'])
    const res = await GET()
    expect(res.status).toBe(403)
    expect(storesList).not.toHaveBeenCalled()
    expect(listConfigs).not.toHaveBeenCalled()
    expect(JSON.stringify(await res.json())).not.toContain('銀座')
  })

  it('403 without sync.view', async () => {
    capabilities.current = new Set(['stores.viewAll'])
    expect((await GET()).status).toBe(403)
  })

  it('lists every active store with viewAll; a store without a row reads as not configured', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const { stores } = await res.json()
    expect(stores.map((s: { storeName: string }) => s.storeName)).toEqual(['代官山', '銀座'])
    expect(stores[0]).toMatchObject({ configured: true, qrStoreSlug: 'la-estro', qrStoreId: 222, intervalMinutes: 15, hoursStart: 8, hoursEnd: 22 })
    expect(stores[1]).toMatchObject({ configured: false, enabled: false, lastRunAt: null })
  })

  it('no password and no login id anywhere in the list payload', async () => {
    const body = JSON.stringify(await (await GET()).json())
    expect(body).not.toMatch(/password/i)
    expect(body).not.toMatch(/username/i)
    expect(body).not.toContain('secret-login-id')
    expect(body).not.toContain('has_credentials')
  })

  it('502 when core cannot be read', async () => {
    listConfigs.mockRejectedValueOnce(new Error('core down'))
    expect((await GET()).status).toBe(502)
  })
})

describe('POST /api/sync/quickreserve with a row store', () => {
  const post = (body: unknown) =>
    POST(new Request('http://x/api/sync/quickreserve', { method: 'POST', body: JSON.stringify(body) }))

  it("runs the named store's row, not the active store's", async () => {
    const res = await post({ storeId: 'store-ginza' })
    expect(res.status).toBe(200)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: 'store-ginza' })
  })

  it('a clamped caller naming a store outside their assignment is refused, nothing runs', async () => {
    capabilities.current = new Set(['sync.view'])
    const res = await post({ storeId: 'store-ginza' })
    expect(res.status).toBe(409)
    expect(runNow).not.toHaveBeenCalled()
  })

  it('no body still runs the active store (PR-A behaviour unchanged)', async () => {
    await POST(new Request('http://x/api/sync/quickreserve', { method: 'POST' }))
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: 'store-daikanyama' })
  })
})
