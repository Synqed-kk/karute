// Web 今すぐ同期 route capability + audit parity with its facade twin
// (src/app/api/app/v1/sync/run/route.ts, see app-api-sync-run.test.ts).
// Before this fix ANY signed-in staff could trigger a business-wide
// QuickReserve sync — no capability check, no audit row. Contract §3.1,
// packet PR-M2.
//
// getBusinessId() stays the FIRST gate (anon → 401, exact current shape);
// sync.view is checked only once a session exists, mirroring the facade's
// gate. auditWeb mocked directly (not the console-line auditLines helper) —
// this suite only needs to assert WHICH calls happen, not the sink shape.

const staffId = { current: 'staff-1' as string | null }
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(),
  getCurrentUserStaffId: jest.fn(async () => staffId.current),
}))

const capabilities = { current: new Set<string>() }
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const runNow = jest.fn()
// The REAL store helper (src/lib/sync/resolve-run-store.ts) runs; only the
// network edges are faked.
const storesGet = jest.fn()
const storesList = jest.fn()
const staffStoresGet = jest.fn()
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    sync: { runNow },
    stores: { get: storesGet, list: storesList },
    staffStores: { get: staffStoresGet },
  })),
}))

const auditWeb = jest.fn()
jest.mock('@/lib/audit-web', () => ({ auditWeb: (...a: unknown[]) => auditWeb(...(a as [])) }))

// CORE-43 + fix round 2: 今すぐ同期 crawls the store the form SHOWS, sent in
// the body (`activeStore` here = that shown store). The active-store cookie is
// never read: it names a stale store throughout this suite.
const activeStore = { current: '90ddfe47-6f7c-4927-8fde-7d9a05383a79' as string | null }
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => '4a3ca459-7251-44f7-8471-da2c36dd3481') }))
const run = () =>
  new Request('https://app.test/api/sync/quickreserve', {
    method: 'POST',
    body: JSON.stringify(activeStore.current ? { storeId: activeStore.current } : {}),
  })

import { POST } from '@/app/api/sync/quickreserve/route'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getMyCapabilities } from '@/lib/auth/require-permission'

const getBusinessIdMock = getBusinessId as jest.Mock
const getMyCapabilitiesMock = getMyCapabilities as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['sync.view'])
  getBusinessIdMock.mockResolvedValue('business-1')
  activeStore.current = '90ddfe47-6f7c-4927-8fde-7d9a05383a79'
  staffId.current = 'staff-1'
  storesGet.mockImplementation(async (id: string) => ({ id }))
  storesList.mockResolvedValue({ stores: [{ id: '90ddfe47-6f7c-4927-8fde-7d9a05383a79', is_primary: true }, { id: 'd5f78368-905a-4eb9-8985-af1924257893' }] })
  staffStoresGet.mockResolvedValue({ store_ids: ['90ddfe47-6f7c-4927-8fde-7d9a05383a79', 'd5f78368-905a-4eb9-8985-af1924257893'] })
  runNow.mockResolvedValue({
    created: 2,
    updated: 3,
    cancelled: 1,
    skipped_no_staff: 1,
    skipped_deleted: 1,
    duration_ms: 1234,
  })
})

describe('POST /api/sync/quickreserve — capability gate + audit parity', () => {
  it("CORE-43: runs the active store's own row, never another store's", async () => {
    activeStore.current = '90ddfe47-6f7c-4927-8fde-7d9a05383a79'
    expect((await POST(run())).status).toBe(200)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: '90ddfe47-6f7c-4927-8fde-7d9a05383a79' })
  })

  it("CORE-43: no resolvable store → 409 qr_store_not_ready, never another store's crawl", async () => {
    activeStore.current = null
    staffStoresGet.mockResolvedValue({ store_ids: [] }) // unassigned in a 2-store business
    const res = await POST(run())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_not_ready' })
    expect(runNow).not.toHaveBeenCalled()
    activeStore.current = '90ddfe47-6f7c-4927-8fde-7d9a05383a79'
  })

  it('no sync.view grant → 403 {error:{code:"forbidden"}}, runNow never called, no audit emit', async () => {
    capabilities.current = new Set(['customers.view'])
    const res = await POST(run())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ error: { code: 'forbidden' } })
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('granted, sync succeeds → 200 success spread + folded skipped, exactly one audit row', async () => {
    const res = await POST(run())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      created: 2,
      updated: 3,
      cancelled: 1,
      skipped: 2, // skipped_no_staff (1) + skipped_deleted (1)
      duration_ms: 1234,
    })
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: '90ddfe47-6f7c-4927-8fde-7d9a05383a79' })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith({
      category: 'settings',
      action: 'settings.sync_run_now',
      targetType: 'business',
      // PR-M5: one server-minted id per request rides every emit.
      requestId: expect.any(String),
      // CORE-43: which store's crawl ran.
      detail: { karute_store_id: '90ddfe47-6f7c-4927-8fde-7d9a05383a79' },
    })
  })

  it('not-configured upstream error → friendly 200, audit row still emits (facade 2xx parity)', async () => {
    runNow.mockRejectedValueOnce(new Error('config not found for business'))
    const res = await POST(run())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/QR sync not configured/)
    expect(auditWeb).toHaveBeenCalledTimes(1)
  })

  it('store scope lookup throws → 502, never a store denial (the phone twin matches: Greptile #1135 F3)', async () => {
    ;(getCurrentUserStaffId as jest.Mock).mockRejectedValueOnce(new Error('core down'))
    const res = await POST(run())
    expect(res.status).toBe(502)
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('staff-store read throws → 502 (was 409: a dependency failure is no longer reported as not-ready)', async () => {
    staffStoresGet.mockRejectedValue(new Error('core down'))
    const res = await POST(run())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/core down/)
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('other upstream failure → 502, no audit emit', async () => {
    runNow.mockRejectedValueOnce(new Error('QuickReserve login expired'))
    const res = await POST(run())
    expect(res.status).toBe(502)
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('anon (getBusinessId throws) → 401, no capability check reached, no audit', async () => {
    getBusinessIdMock.mockRejectedValueOnce(new Error('no session'))
    const res = await POST(run())
    expect(res.status).toBe(401)
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('401 body is the flat legacy shape, byte-exact', async () => {
    getBusinessIdMock.mockRejectedValueOnce(new Error('no session'))
    const res = await POST(run())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('order pin: anon AND capability-denied together still resolve as 401 with getMyCapabilities never called — kills the order-swap mutant', async () => {
    getBusinessIdMock.mockRejectedValueOnce(new Error('no session'))
    capabilities.current = new Set()
    const res = await POST(run())
    expect(res.status).toBe(401)
    expect(getMyCapabilitiesMock).not.toHaveBeenCalled()
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('infra failure resolving capabilities → 500 {error:{code:"internal"}}, never 403; runNow/audit untouched', async () => {
    getMyCapabilitiesMock.mockRejectedValueOnce(new Error('capability service unreachable'))
    const res = await POST(run())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ error: { code: 'internal' } })
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

// Every row of the mapping table at the top of src/lib/sync/resolve-run-store.ts,
// web column. The phone column is pinned row for row in app-api-sync-run-store.test.ts.
describe('mapping table — web column (resolve-run-store.ts)', () => {
  const down = () => Promise.reject(new Error('core down'))
  const rows: [string, () => void, number, unknown][] = [
    ['requested store is not this business (404)', () => {
      activeStore.current = '90765121-c851-4786-8fa5-46ce4ed39fb9'
      storesGet.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    }, 409, { error: 'qr_store_not_ready' }],
    ['requested store outside the clamped assignment', () => {
      activeStore.current = '90765121-c851-4786-8fa5-46ce4ed39fb9'
    }, 409, { error: 'qr_store_not_ready' }],
    ['caller reaches no store (unassigned, 2-store business)', () => {
      staffStoresGet.mockResolvedValue({ store_ids: [] })
    }, 409, { error: 'qr_store_not_ready' }],
    ['caller reaches no store (business has no store)', () => {
      activeStore.current = null
      capabilities.current = new Set(['sync.view', 'stores.viewAll'])
      storesList.mockResolvedValue({ stores: [] })
    }, 409, { error: 'qr_store_not_ready' }],
    ['caller reaches no store (web only: the roster cannot place them)', () => {
      staffId.current = null
    }, 409, { error: 'qr_store_not_ready' }],
    ['requested-store verify throws (503)', () => {
      storesGet.mockRejectedValue(Object.assign(new Error('core down'), { status: 503 }))
    }, 502, { error: expect.stringMatching(/core down/) }],
    ['staff-store read throws', () => {
      staffStoresGet.mockImplementation(down)
    }, 502, { error: expect.stringMatching(/core down/) }],
    ['store-list read throws (primary store)', () => {
      activeStore.current = null
      capabilities.current = new Set(['sync.view', 'stores.viewAll'])
      storesList.mockImplementation(down)
    }, 502, { error: expect.stringMatching(/core down/) }],
    ['store-list read throws (store count)', () => {
      staffStoresGet.mockResolvedValue({ store_ids: [] })
      storesList.mockImplementation(down)
    }, 502, { error: expect.stringMatching(/core down/) }],
  ]
  it.each(rows)('%s', async (_case, arrange, status, body) => {
    arrange()
    const res = await POST(run())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(body)
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

describe('fix round 2 — the store is the one the form shows, never the cookie', () => {
  it("clamped caller, stale cookie: the shown store (the page's allowed[0]) runs — 今すぐ同期 works", async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['90ddfe47-6f7c-4927-8fde-7d9a05383a79'] })
    activeStore.current = '90ddfe47-6f7c-4927-8fde-7d9a05383a79'
    expect((await POST(run())).status).toBe(200)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: '90ddfe47-6f7c-4927-8fde-7d9a05383a79' })
  })

  it('the body names 代官山 while the cookie names another store → 代官山 runs', async () => {
    activeStore.current = 'd5f78368-905a-4eb9-8985-af1924257893'
    expect((await POST(run())).status).toBe(200)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: 'd5f78368-905a-4eb9-8985-af1924257893' })
  })

  it("viewAll caller naming another business's store → 409, nothing runs", async () => {
    capabilities.current = new Set(['sync.view', 'stores.viewAll'])
    activeStore.current = '5b30aeb1-286c-4371-836d-a2ec7c2288ab'
    storesGet.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    const res = await POST(run())
    expect(res.status).toBe(409)
    expect(runNow).not.toHaveBeenCalled()
  })
})

describe('fix round 2 — every web run audit row carries the store', () => {
  it('not configured (a 2xx) → the audit row names the store', async () => {
    runNow.mockRejectedValue(new Error('config not found'))
    activeStore.current = 'd5f78368-905a-4eb9-8985-af1924257893'
    expect((await POST(run())).status).toBe(200)
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0]).toMatchObject({
      action: 'settings.sync_run_now',
      detail: { karute_store_id: 'd5f78368-905a-4eb9-8985-af1924257893' },
    })
  })
})

describe('fix round 3 (Opus S1) — the web run carries the id core returned', () => {
  it("runNow and the audit row get core's id, not the body string", async () => {
    capabilities.current = new Set(['sync.view', 'stores.viewAll'])
    const canonical = '90ddfe47-6f7c-4927-8fde-7d9a05383a79'.toUpperCase()
    storesGet.mockResolvedValue({ id: canonical })
    expect((await POST(run())).status).toBe(200)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: canonical })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0].detail).toEqual({ karute_store_id: canonical })
  })

  it('a body storeId that is not a store id → 409 qr_store_not_ready, no lookup, nothing runs', async () => {
    activeStore.current = '../customers'
    const res = await POST(run())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_not_ready' })
    expect(storesGet).not.toHaveBeenCalled()
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

describe('fix round 4 (Sonnet SF1) — a store answer without an id never runs the default store', () => {
  it('stores.get answers {} → 502, nothing runs, no audit row', async () => {
    storesGet.mockResolvedValue({})
    const res = await POST(run())
    expect(res.status).toBe(502)
    expect(runNow).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})
