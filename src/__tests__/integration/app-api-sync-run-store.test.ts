// Greptile #1135 F2/F3/F4 — the phone 今すぐ同期 resolves its store exactly as
// the web run (src/app/api/sync/quickreserve/route.ts → resolveStoreScope):
//   store-id header · else a clamped caller's FIRST assigned store (web:
//   `allowed[0]`) · else the business's PRIMARY store (web: getPrimaryStoreId);
// a store read that THROWS is a 502 on both transports, never a store denial
// (F3, fix round 1: both routes resolve through src/lib/sync/resolve-run-store.ts);
// the audit row names the store that ran (F4). The REAL helper runs here; only
// the network edges are faked.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

import { createHmac } from 'node:crypto'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } }),
}))
jest.mock('@/lib/staff', () => ({ businessIdForUser: jest.fn(async () => 'business-1') }))

const capabilities = { current: new Set<string>(['sync.view']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const runNow = jest.fn()
const storesGet = jest.fn()
const storesList = jest.fn()
const staffStoresGet = jest.fn()
const fakeClient = {
  sync: { runNow },
  stores: { get: storesGet, list: storesList },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient }))

const audit = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => audit(...(a as [])),
}))

import { POST } from '@/app/api/app/v1/sync/run/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const noRoute = { params: Promise.resolve({}) }
const post = (store?: string) =>
  new Request('https://s/api/app/v1/sync/run', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer()}`, ...(store ? { 'store-id': store } : {}) },
  })

const RESULT = { created: 1, updated: 0, cancelled: 0, skipped_no_staff: 0, skipped_deleted: 0, duration_ms: 5 }

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['sync.view'])
  runNow.mockResolvedValue(RESULT)
  storesGet.mockResolvedValue({ id: 'x' })
  storesList.mockResolvedValue({
    stores: [
      { id: 'store-a', is_primary: false },
      { id: 'store-primary', is_primary: true },
    ],
  })
  staffStoresGet.mockResolvedValue({ store_ids: ['store-a', 'store-b'] })
})

describe('F2 — headerless phone run resolves the store the web run would', () => {
  it('cross-store viewer, no header → the PRIMARY store explicitly (web: getPrimaryStoreId), never undefined', async () => {
    capabilities.current = new Set(['sync.view', 'stores.viewAll'])
    expect((await POST(post(), noRoute)).status).toBe(200)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: 'store-primary' })
  })

  it('clamped caller on two stores, no header → their first assigned store (web: allowed[0])', async () => {
    expect((await POST(post(), noRoute)).status).toBe(200)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: 'store-a' })
  })

  it('stress: first assignment has no config row → the not-configured answer names the web row, not another', async () => {
    runNow.mockImplementation(async (_p: string, o: { karute_store_id: string }) => {
      if (o.karute_store_id === 'store-a') throw new Error('config not found')
      return RESULT
    })
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe('not_configured')
    expect(runNow).toHaveBeenCalledTimes(1)
    expect(runNow).toHaveBeenCalledWith('QUICKRESERVE', { karute_store_id: 'store-a' })
    // …and with the header the app sends for its selected store, that store runs.
    expect((await POST(post('store-b'), noRoute)).status).toBe(200)
    expect(runNow).toHaveBeenLastCalledWith('QUICKRESERVE', { karute_store_id: 'store-b' })
  })

  it('a caller who reaches no store is refused (store_unassigned), never handed the primary store', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_unassigned')
    expect(runNow).not.toHaveBeenCalled()
  })
})

describe('F3 — scope failures answer like the web run', () => {
  it('assignment lookup throws → 502 upstream_unavailable (a dependency failure, as a resolveStoreScope throw is on the web), not 403', async () => {
    staffStoresGet.mockRejectedValue(new Error('core down'))
    const res = await POST(post(), noRoute)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
    expect(runNow).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('header store cannot be verified (core 503) → 502', async () => {
    storesGet.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }))
    expect((await POST(post('store-b'), noRoute)).status).toBe(502)
  })

  it('primary store cannot be resolved → 502', async () => {
    capabilities.current = new Set(['sync.view', 'stores.viewAll'])
    storesList.mockRejectedValue(new Error('core down'))
    expect((await POST(post(), noRoute)).status).toBe(502)
    expect(runNow).not.toHaveBeenCalled()
  })

  it('a genuine verdict stays 403 store_forbidden with its store_header marker', async () => {
    const res = await POST(post('store-elsewhere'), noRoute)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('store_forbidden')
    expect(JSON.stringify(body)).toContain('store_header')
    expect(runNow).not.toHaveBeenCalled()
  })
})

describe('F4 — the phone run audit row carries the store', () => {
  it('success → one settings.sync_run_now row with storeId + detail.karute_store_id', async () => {
    expect((await POST(post('store-b'), noRoute)).status).toBe(200)
    expect(audit).toHaveBeenCalledTimes(1)
    const row = audit.mock.calls[0][0]
    expect(row).toMatchObject({ action: 'settings.sync_run_now', storeId: 'store-b' })
    expect(row.detail).toMatchObject({ karute_store_id: 'store-b' })
  })

  it('not configured (a 2xx) → the audit row still carries the store (fix round 2)', async () => {
    runNow.mockRejectedValue(new Error('config not found'))
    const res = await POST(post('store-b'), noRoute)
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe('not_configured')
    expect(audit).toHaveBeenCalledTimes(1)
    const row = audit.mock.calls[0][0]
    expect(row).toMatchObject({ action: 'settings.sync_run_now', storeId: 'store-b' })
    expect(row.detail).toMatchObject({ karute_store_id: 'store-b' })
  })
})

// Every row of the mapping table at the top of src/lib/sync/resolve-run-store.ts,
// phone column. The web column is pinned row for row in web-sync-quickreserve.test.ts.
describe('mapping table — phone column (resolve-run-store.ts)', () => {
  const down = () => Promise.reject(new Error('core down'))
  const VIEW_ALL = new Set(['sync.view', 'stores.viewAll'])
  const rows: [string, () => void, string | undefined, number, string, boolean][] = [
    ['requested store is not this business (404)', () => {
      storesGet.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }))
    }, 'store-elsewhere', 403, 'store_forbidden', true],
    ['requested store outside the clamped assignment', () => {}, 'store-elsewhere', 403, 'store_forbidden', true],
    ['caller reaches no store (unassigned, 2-store business)', () => {
      staffStoresGet.mockResolvedValue({ store_ids: [] })
    }, undefined, 403, 'store_unassigned', false],
    ['caller reaches no store (business has no store)', () => {
      capabilities.current = VIEW_ALL
      storesList.mockResolvedValue({ stores: [] })
    }, undefined, 403, 'store_unassigned', false],
    ['requested-store verify throws (503)', () => {
      storesGet.mockRejectedValue(Object.assign(new Error('core down'), { status: 503 }))
    }, 'store-b', 502, 'upstream_unavailable', false],
    ['staff-store read throws', () => {
      staffStoresGet.mockImplementation(down)
    }, undefined, 502, 'upstream_unavailable', false],
    ['store-list read throws (primary store)', () => {
      capabilities.current = VIEW_ALL
      storesList.mockImplementation(down)
    }, undefined, 502, 'upstream_unavailable', false],
    ['store-list read throws (store count)', () => {
      staffStoresGet.mockResolvedValue({ store_ids: [] })
      storesList.mockImplementation(down)
    }, undefined, 502, 'upstream_unavailable', false],
  ]
  it.each(rows)('%s', async (_case, arrange, header, status, code, marker) => {
    arrange()
    const res = await POST(post(header), noRoute)
    expect(res.status).toBe(status)
    const body = await res.json()
    expect(body.error.code).toBe(code)
    expect(JSON.stringify(body).includes('store_header')).toBe(marker)
    expect(runNow).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
})
