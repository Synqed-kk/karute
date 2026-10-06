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
 *        (i) core refuses a QR store already linked → 409 with core's code
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
const auditWeb = jest.fn()
jest.mock('@/lib/audit-web', () => ({ auditWeb: (...a: unknown[]) => auditWeb(...(a as [])) }))
const VIEW_ALL = new Set(['sync.view', 'stores.viewAll'])
const capabilities = { current: VIEW_ALL }
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

// The store the form shows (sent by SyncSection). The cookie names 銀座 all
// along and must never be what a request acts on.
const actorStore = { current: 'ea093d52-2f54-4f01-8b08-c19e3d131894' as string | null }
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => '2c1bb80d-a0e8-4821-876c-fc3e74480b26') }))
const storesGet = jest.fn()
const storesList = jest.fn()
const staffStoresGet = jest.fn()
const storeReads = { stores: { get: storesGet, list: storesList }, staffStores: { get: staffStoresGet } }

import { GET, POST } from '@/app/api/sync/quickreserve/config/route'

const client = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }

const DAIKANYAMA_ROW = {
  karute_store_id: 'ea093d52-2f54-4f01-8b08-c19e3d131894',
  store_slug: 'la-estro',
  store_id: 222,
  username: 'owner',
  enabled: true,
  last_run_status: 'OK',
  last_run_error: null,
  last_run_at: '2026-10-06T04:48:45.936Z',
}
const GINZA_ROW = { ...DAIKANYAMA_ROW, karute_store_id: '2c1bb80d-a0e8-4821-876c-fc3e74480b26', store_id: 250 }

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
  actorStore.current = 'ea093d52-2f54-4f01-8b08-c19e3d131894'
  capabilities.current = VIEW_ALL
  storesGet.mockImplementation(async (id: string) => ({ id }))
  storesList.mockResolvedValue({ stores: [{ id: 'ea093d52-2f54-4f01-8b08-c19e3d131894', is_primary: true }, { id: '2c1bb80d-a0e8-4821-876c-fc3e74480b26' }] })
  staffStoresGet.mockResolvedValue({ store_ids: ['ea093d52-2f54-4f01-8b08-c19e3d131894', '2c1bb80d-a0e8-4821-876c-fc3e74480b26'] })
})

describe('GET — the active store reads its own row', () => {
  it('(a) 代官山 reads its own row', async () => {
    mockClient([DAIKANYAMA_ROW])
    const body = await (await GET(getReq())).json()
    expect(body).toMatchObject({ username: 'owner', enabled: true, configured: true, lastStatus: 'OK' })
  })

  it('(b) 銀座 with no row yet reads unconfigured, slug pre-filled from 代官山', async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
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
        karute_store_id: 'ea093d52-2f54-4f01-8b08-c19e3d131894',
      },
    ])
  })

  it("(d) 銀座's first save without its QR store → 400 qr_store_required, nothing written", async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(req({ username: 'owner', password: 'pw', enabled: true }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'qr_store_required' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("(e) 銀座's first save without a password → 400, nothing written", async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: 'owner', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '250' }),
    )
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("(e2) 銀座's first save without a login ID → 400, nothing written", async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: '  ', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '250' }),
    )
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("(f) 銀座's first save with its QR store writes ONLY 銀座's row", async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
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
        karute_store_id: '2c1bb80d-a0e8-4821-876c-fc3e74480b26',
      },
    ])
  })

  it('(g) an existing row keeps its own QR store, whatever the body says', async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    const upsert = mockClient([DAIKANYAMA_ROW, GINZA_ROW])
    const res = await POST(
      req({ username: 'owner', enabled: false, qrStoreSlug: 'la-estro', qrStoreId: '222' }),
    )
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ store_id: 250, karute_store_id: '2c1bb80d-a0e8-4821-876c-fc3e74480b26' })
  })

  it('(h) no resolvable store → 409 qr_store_not_ready, nothing written', async () => {
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockResolvedValue({ store_ids: [] }) // unassigned in a 2-store business
    const upsert = mockClient([DAIKANYAMA_ROW])
    // An explicit store, so the save passes the no-store guard and reaches the
    // helper's Unassigned branch (fix round 4, Sonnet SF2).
    const res = await POST(
      req({ storeId: 'ea093d52-2f54-4f01-8b08-c19e3d131894', username: 'owner', password: 'pw', enabled: true }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'qr_store_not_ready' })
    expect(staffStoresGet).toHaveBeenCalledWith('staff-1')
    expect(upsert).not.toHaveBeenCalled()
  })

  it("(i) core refuses a QR store already linked → 409 carrying the code (core's REAL shape, fix round 4 Opus N1)", async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    // Core's PUT answers 400 { error: 'qr_store_already_linked' }; the SDK's
    // responseError makes that message = the code string, code = undefined.
    mockClient([DAIKANYAMA_ROW], async () => {
      throw Object.assign(new Error('qr_store_already_linked'), {
        status: 400, code: undefined, body: { error: 'qr_store_already_linked' },
      })
    })
    // 333 is linked nowhere Karute can see (fix round 2's local check passes),
    // so core is the one refusing here.
    const res = await POST(
      req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '333' }),
    )
    expect(res.status).toBe(409)
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
    actorStore.current = '5b30aeb1-286c-4371-836d-a2ec7c2288ab'
    storesGet.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    const upsert = mockClient([DAIKANYAMA_ROW])
    const get = await GET(getReq())
    expect(get.status).toBe(409)
    expect(await get.json()).toEqual({ error: 'qr_store_unavailable' })
    const res = await POST(req({ username: 'owner', password: 'pw', enabled: true }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_unavailable' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('(l) a save naming 代官山 while the cookie names 銀座 writes 代官山', async () => {
    const upsert = mockClient([DAIKANYAMA_ROW, GINZA_ROW])
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ karute_store_id: 'ea093d52-2f54-4f01-8b08-c19e3d131894', store_id: 222 })
  })

  it("(m) clamped caller, stale cookie: the shown store (the page's allowed[0]) reads and saves", async () => {
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockResolvedValue({ store_ids: ['2c1bb80d-a0e8-4821-876c-fc3e74480b26'] })
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    const upsert = mockClient([DAIKANYAMA_ROW, GINZA_ROW])
    expect(await (await GET(getReq())).json()).toMatchObject({ configured: true, username: 'owner' })
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ karute_store_id: '2c1bb80d-a0e8-4821-876c-fc3e74480b26' })
  })

  it('(m2) clamped caller naming a store outside the assignment → 409, nothing written', async () => {
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockResolvedValue({ store_ids: ['2c1bb80d-a0e8-4821-876c-fc3e74480b26'] })
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
    expect(upsert.mock.calls[0][1]).toMatchObject({ username: 'owner', karute_store_id: 'ea093d52-2f54-4f01-8b08-c19e3d131894' })
    expect(upsert.mock.calls[0][1]).not.toHaveProperty('password')
  })
})

describe('fix round 2 — one Quick Reserve store, one of our stores', () => {
  it("(p) 銀座's first save naming 代官山's QR store (222) → 409 qr_store_already_linked, nothing written", async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'LA-ESTRO ', qrStoreId: '222' }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_already_linked' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('(p2) a clamped caller gets the same refusal, and the body never names the other store', async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    capabilities.current = new Set(['sync.view'])
    staffStoresGet.mockResolvedValue({ store_ids: ['2c1bb80d-a0e8-4821-876c-fc3e74480b26'] })
    mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '222' }),
    )
    expect(res.status).toBe(409)
    expect(JSON.stringify(await res.json())).not.toContain('ea093d52-2f54-4f01-8b08-c19e3d131894')
  })

  it('(p3) the same slug with a different QR store id is allowed (one owner login, several stores)', async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(
      req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '250' }),
    )
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it("(q) core's object error carrying the code → 409 with the code (the screen localizes it)", async () => {
    actorStore.current = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
    mockClient([DAIKANYAMA_ROW], async () => {
      throw Object.assign(new Error('This Quick Reserve store is already linked'), { code: 'qr_store_already_linked' })
    })
    const res = await POST(
      req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId: '333' }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_already_linked' })
  })
})

describe('fix round 3 (Opus S1) — a save writes the id core returned', () => {
  it("upsertConfig and the audit row get core's id, not the body string", async () => {
    const canonical = 'ea093d52-2f54-4f01-8b08-c19e3d131894'.toUpperCase()
    storesGet.mockResolvedValue({ id: canonical })
    const upsert = mockClient([{ ...DAIKANYAMA_ROW, karute_store_id: canonical }])
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ karute_store_id: canonical, store_id: 222 })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0].detail).toMatchObject({ karute_store_id: canonical })
  })

  it('a storeId that is not a store id → GET and SAVE 409, no lookup, nothing written', async () => {
    actorStore.current = '../customers'
    const upsert = mockClient([DAIKANYAMA_ROW])
    expect((await GET(getReq())).status).toBe(409)
    expect((await POST(req({ username: 'owner', password: 'pw', enabled: true }))).status).toBe(409)
    expect(storesGet).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('fix round 3 (Opus S2) — a save names its store or nothing is written', () => {
  it.each([
    ['no storeId', undefined],
    ['storeId: []', []],
    ['storeId: 123', 123],
    ["storeId: ''", ''],
  ])('%s → 409 qr_store_not_ready, no lookup, nothing written', async (_case, storeId) => {
    actorStore.current = null
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(req({ storeId, username: 'owner', password: 'pw', enabled: true }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_not_ready' })
    expect(storesGet).not.toHaveBeenCalled()
    expect(storesList).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('the GET with no storeId keeps its default (the primary store reads its row)', async () => {
    actorStore.current = null
    mockClient([DAIKANYAMA_ROW])
    expect(await (await GET(getReq())).json()).toMatchObject({ configured: true, username: 'owner' })
  })
})

describe('fix round 3 (Opus N2) — a malformed save body is a 400, never a platform 500', () => {
  it.each([
    ['malformed JSON', '{"storeId":'],
    ['JSON null', 'null'],
    ['a JSON string', '"x"'],
  ])('%s → 400 invalid_body, no lookup, nothing written', async (_case, raw) => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(new Request('https://app.test/api/sync/quickreserve/config', { method: 'POST', body: raw }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect(storesGet).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('fix round 4 (Opus S3) — the config save audit row fills the store column', () => {
  it('auditWeb gets storeId = the saved store (the canonical id)', async () => {
    mockClient([DAIKANYAMA_ROW])
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(200)
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0]).toMatchObject({
      action: 'settings.sync_config_update',
      storeId: 'ea093d52-2f54-4f01-8b08-c19e3d131894',
    })
  })
})

describe('fix round 4 (Opus N1) — core\'s refusal codes arrive as the SDK message', () => {
  it("core's 400 { error: 'store_not_in_business' } → 409 with the code, never a 502", async () => {
    mockClient([DAIKANYAMA_ROW], async () => {
      throw Object.assign(new Error('store_not_in_business'), {
        status: 400, code: undefined, body: { error: 'store_not_in_business' },
      })
    })
    const res = await POST(req({ username: 'owner', enabled: true }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'store_not_in_business' })
  })

  it('any other core message stays a 502', async () => {
    mockClient([DAIKANYAMA_ROW], async () => {
      throw Object.assign(new Error('Password too long'), { status: 400, code: undefined })
    })
    expect((await POST(req({ username: 'owner', enabled: true }))).status).toBe(502)
  })
})

describe('fix round 4 (Opus N5 + N6) — input bounds', () => {
  const GINZA = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
  const firstSave = (qrStoreId: string) =>
    req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId })

  it('a QR store number of 2^31 → 400 qr_store_required, nothing written', async () => {
    actorStore.current = GINZA
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(firstSave(String(2 ** 31)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('qr_store_required')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('2^31 - 1 is still a QR store number', async () => {
    actorStore.current = GINZA
    const upsert = mockClient([DAIKANYAMA_ROW])
    expect((await POST(firstSave(String(2 ** 31 - 1)))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ store_id: 2147483647 })
  })

  it.each([
    ['a numeric password', { password: 123 }],
    ['a numeric login', { username: 7 }],
    ['an object QR account name', { qrStoreSlug: {} }],
    ['a string enabled', { enabled: 'yes' }],
  ])('%s → 400 invalid_body, no lookup, nothing written', async (_case, extra) => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(req({ username: 'owner', enabled: true, ...extra }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect(storesGet).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('fix round 4 (Opus C3 app side) — a changed login needs its password', () => {
  it('existing row, new login, no password → 409 qr_password_required, nothing written', async () => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(req({ username: 'new-login', enabled: true }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_password_required' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('the same change WITH the password saves', async () => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    expect((await POST(req({ username: 'new-login', password: 'pw', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ username: 'new-login', password: 'pw' })
  })
})

describe('fix round 5 (N-c) — a login that only differs by whitespace is not a login change', () => {
  it("stored 'owner ' + typed 'owner' + no password → saves (no 409), the trimmed login written", async () => {
    const upsert = mockClient([{ ...DAIKANYAMA_ROW, username: 'owner ' }])
    const res = await POST(req({ username: 'owner', enabled: true }))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][1]).toMatchObject({ username: 'owner' })
    expect(upsert.mock.calls[0][1]).not.toHaveProperty('password')
  })

  it("a typed '  new-login  ' with its password writes 'new-login', never the raw text", async () => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    expect((await POST(req({ username: '  new-login  ', password: 'pw', enabled: true }))).status).toBe(200)
    expect(upsert.mock.calls[0][1]).toMatchObject({ username: 'new-login', password: 'pw' })
  })
})

describe('fix round 4 (NIT1) — a JSON array save body', () => {
  it("'[]' names no store → 409 qr_store_not_ready, no lookup, nothing written", async () => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(new Request('https://app.test/api/sync/quickreserve/config', { method: 'POST', body: '[]' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'qr_store_not_ready' })
    expect(storesGet).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe("fix round 6 (Greptile P1) — the no-row slug pre-fill never names a store outside the caller's assignment", () => {
  const STORE_A = '2c1bb80d-a0e8-4821-876c-fc3e74480b26' // shown, no row yet
  const STORE_B = 'ea093d52-2f54-4f01-8b08-c19e3d131894' // sibling, configured
  const STORE_C = '7d0f3b1e-5c2a-4e8b-9a61-3f2d8c4b5a10' // second assigned store
  const B_ROW = { ...DAIKANYAMA_ROW, karute_store_id: STORE_B, store_slug: 'b-salon', username: 'b-owner', store_id: 301 }
  const C_ROW = { ...DAIKANYAMA_ROW, karute_store_id: STORE_C, store_slug: 'c-salon', username: 'c-owner', store_id: 302 }
  const CLAMPED = new Set(['sync.view'])

  beforeEach(() => {
    actorStore.current = STORE_A
  })

  it('(r6-a) a clamped caller at A only, sibling B configured → the body carries neither B slug nor B login', async () => {
    capabilities.current = CLAMPED as never
    staffStoresGet.mockResolvedValue({ store_ids: [STORE_A] })
    mockClient([B_ROW])
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('b-salon')
    expect(text).not.toContain('b-owner')
    expect(JSON.parse(text)).toMatchObject({ configured: false, qrStoreSlug: '' })
  })

  it('(r6-b) a viewAll caller, same data → the sibling slug still pre-fills', async () => {
    mockClient([B_ROW])
    const body = await (await GET(getReq())).json()
    expect(body).toMatchObject({ configured: false, qrStoreSlug: 'b-salon', username: '' })
  })

  it("(r6-c) a clamped caller at A and C, A has no row, C configured → C's slug pre-fills, never B's", async () => {
    capabilities.current = CLAMPED as never
    staffStoresGet.mockResolvedValue({ store_ids: [STORE_A, STORE_C] })
    mockClient([B_ROW, C_ROW])
    const body = await (await GET(getReq())).json()
    expect(body).toMatchObject({ configured: false, qrStoreSlug: 'c-salon' })
    expect(JSON.stringify(body)).not.toContain('b-salon')
  })
})

describe('fix round 6 (Greptile P2) — the store number is accepted only as a number or digits', () => {
  const GINZA = '2c1bb80d-a0e8-4821-876c-fc3e74480b26'
  const firstSave = (qrStoreId: unknown) =>
    req({ username: 'owner', password: 'pw', enabled: true, qrStoreSlug: 'la-estro', qrStoreId })

  beforeEach(() => {
    actorStore.current = GINZA
  })

  it.each([
    ['true', true],
    ['[250]', [250]],
    ["'250.5'", '250.5'],
    ['250.5', 250.5],
    ['{}', {}],
    ['null', null],
  ])('qrStoreId %s → 400 invalid_body before any lookup, nothing written', async (_label, qrStoreId) => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(firstSave(qrStoreId))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
    expect(client.getSynqedClient).not.toHaveBeenCalled()
    expect(storesGet).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['250', 250],
    ["'250'", '250'],
  ])('qrStoreId %s → saved as 250', async (_label, qrStoreId) => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(firstSave(qrStoreId))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][1]).toMatchObject({ store_slug: 'la-estro', store_id: 250, karute_store_id: GINZA })
  })

  // Fix round 7: the form posts '' when the field is empty — that is a
  // MISSING store number (the localized qr_store_required line), never a
  // wrong type (the generic invalid_body line).
  it.each([
    ["''", ''],
    ["'   '", '   '],
  ])('(r7) qrStoreId %s on a first save → 400 qr_store_required, nothing written', async (_label, qrStoreId) => {
    const upsert = mockClient([DAIKANYAMA_ROW])
    const res = await POST(firstSave(qrStoreId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('qr_store_required')
    expect(upsert).not.toHaveBeenCalled()
  })
})
