/**
 * Quick Reserve config — one row per Karute store (CORE-43, 2026-10-06).
 *
 * Core keeps one Quick Reserve config per (business, provider, karute store).
 * The settings route reads, saves and labels ONLY the active store's own row,
 * so a 銀座 save can never rebind 代官山's live crawl (the PKT-P0 bug the old
 * save guard refused). Pinned:
 *   GET  (a) 代官山 reads its own row
 *        (b) 銀座 with no row yet reads unconfigured, slug pre-filled from 代官山
 *   POST (c) 代官山 resaves its row: own store, its own QR store carried forward
 *        (d) 銀座's first save without its QR store → 400, nothing written
 *        (e) 銀座's first save without a password → 400, nothing written
 *        (f) 銀座's first save with its QR store → writes ONLY 銀座's row (250)
 *        (g) an existing row keeps its own QR store, whatever the body says
 *        (h) no resolvable store → 409 qr_store_not_ready, nothing written
 *        (i) core refuses a QR store already linked → 502 with core's code
 *        (j) listConfigs / the store lookup throws → 502, nothing written
 * Fix round 2 (one rule): the store is the one the form SHOWS, sent by the
 * client (?storeId= / body storeId) and resolved ONLY through
 * resolveSyncRunStore — the REAL helper runs here, only network edges are
 * faked; the active-store cookie is never read (it names another store).
 */

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn().mockResolvedValue('biz-A'),
  resolveUserId: jest.fn().mockResolvedValue('user-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))
const VIEW_ALL = new Set(['sync.view', 'stores.viewAll'])
const capabilities = { current: VIEW_ALL }
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// The store the form shows (sent by SyncSection). The cookie names 銀座 all
// along and must never be what a request acts on.
const actorStore = { current: 'daikanyama' as string | null }
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => 'ginza') }))
const storesGet = jest.fn()
const storesList = jest.fn()
const staffStoresGet = jest.fn()
const storeReads = { stores: { get: storesGet, list: storesList }, staffStores: { get: staffStoresGet } }

import { GET, POST } from '@/app/api/sync/quickreserve/config/route'

const client = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }

const DAIKANYAMA_ROW = {
  karute_store_id: 'daikanyama',
  store_slug: 'la-estro',
  store_id: 222,
  username: 'owner',
  enabled: true,
  last_run_status: 'OK',
  last_run_error: null,
  last_run_at: '2026-10-06T04:48:45.936Z',
}
const GINZA_ROW = { ...DAIKANYAMA_ROW, karute_store_id: 'ginza', store_id: 250 }

function mockClient(rows: Record<string, unknown>[], upsert: () => Promise<unknown> = async () => ({})) {
  const upsertConfig = jest.fn((..._args: unknown[]) => upsert())
  client.getSynqedClient.mockResolvedValue({
    sync: { listConfigs: jest.fn().mockResolvedValue(rows), upsertConfig },
    ...storeReads,
  })
  return upsertConfig
}

function req(body: Record<string, unknown>) {
  return new Request('https://app.test/api/sync/quickreserve/config', {
    method: 'POST',
    body: JSON.stringify({ ...(actorStore.current ? { storeId: actorStore.current } : {}), ...body }),
  })
}
const getReq = () =>
  new Request(
    `https://app.test/api/sync/quickreserve/config${actorStore.current ? `?storeId=${actorStore.current}` : ''}`,
  )

beforeEach(() => {
  jest.clearAllMocks()
  actorStore.current = 'daikanyama'
  capabilities.current = VIEW_ALL
  storesGet.mockResolvedValue({ id: 'x' })
  storesList.mockResolvedValue({ stores: [{ id: 'daikanyama', is_primary: true }, { id: 'ginza' }] })
  staffStoresGet.mockResolvedValue({ store_ids: ['daikanyama', 'ginza'] })
})

describe('GET — the active store reads its own row', () => {
  it('(a) 代官山 reads its own row', async () => {
    mockClient([DAIKANYAMA_ROW])
    const body = await (await GET(getReq())).json()
    expect(body).toMatchObject({ username: 'owner', enabled: true, configured: true, lastStatus: 'OK' })
  })

  it('(b) 銀座 with no row yet reads unconfigured, slug pre-filled from 代官山', async () => {
    actorStore.current = 'ginza'
    mockClient([DAIKANYAMA_ROW])
    const body = await (await GET(getReq())).json()
    expect(body).toEqual({
      username: '',
      enabled: false,
      lastStatus: null,
      configured: false,
      qrStoreSlug: 'la-estro',
    })
  })
})

describe('POST — each store saves only its own row', () => {
  it('(c) 代官山 resaves its row with its own QR store carried forward', async () => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(req({ username: 'owner', password: 'pw', enabled: true }))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]).toEqual([
      'QUICKRESERVE',
      {
        username: 'owner',
        password: 'pw',
        enabled: true,
        store_slug: 'la-estro',
        store_id: 222,
        karute_store_id: 'daikanyama',
      },
    ])
  })

  it("(d) 銀座's first save without its QR store → 400 qr_store_required, nothing written", async () => {
    actorStore.current = 'ginza'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(req({ username: 'owner', password: 'pw', enabled: true }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'qr_store_required' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("(e) 銀座's first save without a password → 400, nothing written", async () => {
    actorStore.current = 'ginza'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: 'owner', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '250' }),
    )
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("(e2) 銀座's first save without a login ID → 400, nothing written", async () => {
    actorStore.current = 'ginza'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: '  ', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '250' }),
    )
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("(f) 銀座's first save with its QR store writes ONLY 銀座's row", async () => {
    actorStore.current = 'ginza'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: ' la-estro ', qrStoreId: '250' }),
    )
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0]).toEqual([
      'QUICKRESERVE',
      {
        username: 'owner',
        password: 'pw',
        enabled: true,
        store_slug: 'la-estro',
        store_id: 250,
        karute_store_id: 'ginza',
      },
    ])
  })

  it('(g) an existing row keeps its own QR store, whatever the body says', async () => {
    actorStore.current = 'ginza'
    const upsert = mockClient([DAIKANYAMA_ROW, GINZA_ROW])
    const res = await POST(
      req({ username: 'owner', enabled: false, qrStoreSlug: 'la-estro', qrStoreId: '222' }),
    )
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ store_id: 250, karute_store_id: 'ginza' })
  })

  it('(h) no resolvable store → 409 qr_store_not_ready, nothing written', async () => {
    actorStore.current = null
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockResolvedValue({ store_ids: [] }) // unassigned in a 2-store business
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(req({ username: 'owner', password: 'pw', enabled: true }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'qr_store_not_ready' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('(i) core refuses a QR store already linked → 502 carrying the code', async () => {
    actorStore.current = 'ginza'
    mockClient([DAIKANYAMA_ROW], async () => {
      throw new Error('qr_store_already_linked')
    })
    const res = await POST(
      req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '222' }),
    )
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'qr_store_already_linked' })
  })

  it('(j) a failed read → 502, nothing written', async () => {
    const upsertConfig = jest.fn()
    client.getSynqedClient.mockResolvedValue({
      sync: { listConfigs: jest.fn().mockRejectedValue(new Error('core down')), upsertConfig },
      ...storeReads,
    })
    expect((await POST(req({ username: 'owner', password: 'pw', enabled: true }))).status).toBe(502)

    storesGet.mockRejectedValueOnce(Object.assign(new Error('store lookup down'), { status: 503 }))
    expect((await POST(req({ username: 'owner', password: 'pw', enabled: true }))).status).toBe(502)
    expect(upsertConfig).not.toHaveBeenCalled()
  })
})

describe('fix round 2 — the store is the one the form shows, resolved only by the helper', () => {
  it("(k) viewAll caller naming another business's store → GET and SAVE 409, nothing written", async () => {
    actorStore.current = 'store-foreign'
    storesGet.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    const upsert = mockClient([DAIKANYAMA_ROW])
    const get = await GET(getReq())
    expect(get.status).toBe(409)
    expect(await get.json()).toEqual({ error: 'qr_store_not_ready' })
    const res = await POST(req({ username: 'owner', password: 'pw', enabled: true }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_not_ready' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('(l) a save naming 代官山 while the cookie names 銀座 writes 代官山', async () => {
    const upsert = mockClient([DAIKANYAMA_ROW, GINZA_ROW])
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ karute_store_id: 'daikanyama', store_id: 222 })
  })

  it("(m) clamped caller, stale cookie: the shown store (the page's allowed[0]) reads and saves", async () => {
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockResolvedValue({ store_ids: ['ginza'] })
    actorStore.current = 'ginza'
    const upsert = mockClient([DAIKANYAMA_ROW, GINZA_ROW])
    expect(await (await GET(getReq())).json()).toMatchObject({ configured: true, username: 'owner' })
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ karute_store_id: 'ginza' })
  })

  it('(m2) clamped caller naming a store outside the assignment → 409, nothing written', async () => {
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockResolvedValue({ store_ids: ['ginza'] })
    const upsert = mockClient([DAIKANYAMA_ROW, GINZA_ROW])
    expect((await GET(getReq())).status).toBe(409)
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(409)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('(n) the staff-store read throws → GET and SAVE 502, never "unconfigured" or "not ready"', async () => {
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockRejectedValue(new Error('core down'))
    const upsert = mockClient([DAIKANYAMA_ROW])
    const get = await GET(getReq())
    expect(get.status).toBe(502)
    expect((await get.json()).configured).toBeUndefined()
    expect((await POST(req({ username: 'owner', password: 'pw', enabled: true }))).status).toBe(502)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('fix round 2 — a blank form never blanks a live row', () => {
  it("(o) an existing row saved with a blank login keeps its stored login", async () => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    expect((await POST(req({ username: '', password: '', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ username: 'owner', karute_store_id: 'daikanyama' })
    expect(upsert.mock.calls[0][1]).not.toHaveProperty('password')
  })
})
