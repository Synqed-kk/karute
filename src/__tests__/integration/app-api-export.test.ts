// Facade bulk-customer-export twin (design-parity packet 23 + fix round). The
// store clamp runs REAL (only the synqed SDK client + fetchCustomers are
// faked), so these tests exercise the actual resolveExportStoreId wiring.
// Fix-round pins on top of the originals: the BEARER businessId reaches the
// read explicitly · the cookie client is NEVER touched (throwing mock) ·
// floating staff clamp to header-store ?? primary, fail-closed. Pins:
//   401 no Bearer, no reads · 403 no data.export capability, no reads ·
//   403 store-clamp fail-closed (wrong-tenant store-id, errored assignment
//   lookup) · 501 an unwired scope/format combo · params (columns/format/
//   privacy/storeId) pass through to the export core unchanged · a
//   completed export emits privacy.customer_export with the query scope,
//   source:'facade' · a DENIED export emits nothing · envelope matches the
//   facade family's {error:{code,message}}, not web's bare {error:string}.
import { createHmac } from 'node:crypto'
import { auditLines } from './helpers/audit-lines'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
// Overridable getUser (fresh-eyes round 6, recording-job precedent): the
// 'export' endpoint key rides REVOCATION_SENSITIVE_ENDPOINTS, which forces a
// real server round-trip here — a fixed inline mock could never regression-
// test the one property this endpoint's revocation registration exists for.
type GetUserResult = { data: { user: { id: string } | null }; error: { message: string } | null }
const getUser = {
  fn: jest.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'auth-user-1' } }, error: null })),
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))

// COOKIE-INDEPENDENCE PIN (fix round, blind-fleet CRITICAL): the facade export
// path must NEVER touch the cookie-based Supabase server client — the first
// cut of the core re-resolved identity from cookies (listCustomers →
// getBusinessId), silently ignoring the verified Bearer identity. Any call
// into this module from any test below is an instant failure.
jest.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    throw new Error('facade export path must never resolve identity from cookies')
  },
}))

const mockCapabilities = jest.fn(async () => new Set(['customers.view', 'data.export', 'stores.viewAll']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

// The core reads via fetchCustomers(businessId, args) — businessId EXPLICIT
// (the fix-round contract; no ambient identity inside the core).
const fetchCustomers = jest.fn(async () => ({ customers: [], totalPages: 1 }))
jest.mock('@/lib/customers/queries', () => ({
  fetchCustomers: (...a: unknown[]) => fetchCustomers(...(a as [])),
}))

const storesGet = jest.fn(async (id: string) => {
  if (id !== 'store-1' && id !== 'store-2') throw new Error('404 not this tenant')
  return { id }
})
const storesList = jest.fn(async () => ({
  stores: [
    { id: 'store-1', is_primary: true },
    { id: 'store-2', is_primary: false },
  ],
}))
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  stores: { get: storesGet, list: storesList },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { GET, OPTIONS } from '@/app/api/app/v1/export/route'

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
const auth = { authorization: `Bearer ${bearer()}` }
const route = { params: Promise.resolve({}) }
const req = (headers: Record<string, string> = {}, qs = 'scope=customers&format=json&columns=customer_id,name') =>
  new Request(`https://s/api/app/v1/export?${qs}`, { headers })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view', 'data.export', 'stores.viewAll']))
  // ⚖ Liam 2026-09-16 (fold round 2): the front gate now reads the unassigned
  // verdict ITSELF rather than short-circuiting on an empty capability set, so
  // an unassigned caller is refused with `store_unassigned` before any handler
  // runs. This suite is about the export DOOR, so its caller is assigned; the
  // two tests that want the unassigned shape ask for it, and what they now pin
  // is the FRONT GATE beating the door's own backstop. The backstop's own
  // proof lives where it can still be reached alone —
  // unassigned-backstops.test.ts drives resolveExportStoreId directly.
  staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
  fetchCustomers.mockResolvedValue({ customers: [], totalPages: 1 })
})

describe('GET /api/app/v1/export — auth / capability', () => {
  it('missing Bearer → 401, no reads', async () => {
    const res = await GET(new Request('https://s/api/app/v1/export?scope=customers&format=json'), route)
    expect(res.status).toBe(401)
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('revoked staffer → 401 via the server round-trip, no reads, no audit — the terminated-token property the endpoint key exists for (fresh-eyes round 6)', async () => {
    getUser.fn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'revoked' } })
    const lines = await auditLines(async () => {
      const res = await GET(req(auth), route)
      expect(res.status).toBe(401)
    })
    expect(fetchCustomers).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('missing data.export capability → 403, no reads', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    const res = await GET(req(auth), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(storesGet).not.toHaveBeenCalled()
    expect(fetchCustomers).not.toHaveBeenCalled()
  })
})

describe('GET /api/app/v1/export — store clamp fail-closed (both layers, resolveStoreForRequest)', () => {
  it('wrong-tenant store-id → 403 store_forbidden BEFORE any customer read', async () => {
    const res = await GET(req({ ...auth, 'store-id': 'store-OTHER-TENANT' }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('errored assignment lookup → fails CLOSED (403), never a widened business-wide export', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'data.export']))
    // ⚖ 2026-09-16 fold round 2: `...Once` no longer reaches the clamp — the
    // front gate reads the caller's assignment first, so the single rejection
    // was consumed there. The test means "this lookup keeps failing".
    staffStoresGet.mockRejectedValue(new Error('boom'))
    const res = await GET(req(auth), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('branch-restricted staff: the export is CLAMPED to their store', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'data.export']))
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req(auth), route)
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalledWith('business-1', expect.objectContaining({ storeId: 'store-1' }))
  })

  it('cross-store viewer (stores.viewAll) stays business-wide even with an explicit store-id header — mirrors web, never lets viewAll narrow the export', async () => {
    const res = await GET(req({ ...auth, 'store-id': 'store-2' }), route)
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalledWith('business-1', expect.objectContaining({ storeId: undefined }))
  })
})

describe('GET /api/app/v1/export — export-hardened floating clamp (fix round, blind-fleet HIGH)', () => {
  // Floating staff = data.export granted, NO stores.viewAll, empty assignment.
  // Web's /api/export deliberately clamps them to a store lens (its own
  // Greptile-P1 history); the facade must never widen them business-wide.
  //
  // ⚖ Liam 2026-09-16 SPLIT THIS SHAPE IN TWO. An empty assignment still means
  // "floating" in a ONE-store business (nothing to isolate from), and those
  // cases keep every rule below. In a MULTI-store business it now means
  // UNASSIGNED — a staff member nobody has placed — and this door, the bulk PII
  // export, is the census's highest-severity finding: it used to answer
  // `null ?? undefined` = the WHOLE BUSINESS's customer book while its web twin
  // already refused the identical case.
  const floatingCaps = new Set(['customers.view', 'data.export'])
  // mockResolvedValue survives jest.clearAllMocks(), so each test states the
  // store list it means rather than inheriting the previous one's.
  const oneStore = () =>
    storesList.mockResolvedValue({ stores: [{ id: 'store-1', is_primary: true }] })
  const twoStores = () =>
    storesList.mockResolvedValue({
      stores: [
        { id: 'store-1', is_primary: true },
        { id: 'store-2', is_primary: false },
      ],
    })

  it('UNASSIGNED staff (empty assignment, multi-store business) are REFUSED — never the business-wide book', async () => {
    mockCapabilities.mockResolvedValue(floatingCaps)
    twoStores()
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await GET(req(auth), route)
    expect(res.status).toBe(403)
    // The FRONT GATE answers first now, with its own code — the export lens's
    // `store_forbidden` sits underneath it and is proved alone in
    // unassigned-backstops.test.ts.
    expect((await res.json()).error.code).toBe('store_unassigned')
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('UNASSIGNED staff are refused even WITH a tenant-valid store-id header', async () => {
    // The header proves the store belongs to the tenant, never that it belongs
    // to this caller — an unplaced staff member may name no store at all.
    mockCapabilities.mockResolvedValue(floatingCaps)
    twoStores()
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await GET(req({ ...auth, 'store-id': 'store-2' }), route)
    expect(res.status).toBe(403)
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('floating staff in a ONE-store business clamp to the primary store — never business-wide', async () => {
    mockCapabilities.mockResolvedValue(floatingCaps)
    oneStore()
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await GET(req(auth), route)
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalledWith('business-1', expect.objectContaining({ storeId: 'store-1' }))
  })

  it('floating staff in a ONE-store business with a tenant-valid store-id header clamp to THAT store', async () => {
    mockCapabilities.mockResolvedValue(floatingCaps)
    oneStore()
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    const res = await GET(req({ ...auth, 'store-id': 'store-1' }), route)
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalledWith('business-1', expect.objectContaining({ storeId: 'store-1' }))
  })

  it('floating staff whose store lens cannot be resolved → 403 fail-closed, no reads', async () => {
    // Every stores.list fails: the gate reads that as UNKNOWN (never "≥2", so
    // never a blanket lockout during an outage) and the caller stays floating —
    // then the export's own primary-store lens cannot resolve either, and THAT
    // is the refusal.
    mockCapabilities.mockResolvedValue(floatingCaps)
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockRejectedValue(new Error('boom'))
    const res = await GET(req(auth), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(fetchCustomers).not.toHaveBeenCalled()
  })
})

describe('GET /api/app/v1/export — params passthrough + wired combos', () => {
  it('501 not_implemented for an unwired scope/format combo', async () => {
    const res = await GET(req(auth, 'scope=customers&format=xlsx'), route)
    expect(res.status).toBe(501)
    expect((await res.json()).error.code).toBe('not_implemented')
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('400 validation for an unknown scope', async () => {
    const res = await GET(req(auth, 'scope=bogus&format=csv'), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
  })

  it('columns/format/privacy pass through to the export core; headers match the format', async () => {
    const res = await GET(
      req(auth, 'scope=customers&format=json&privacy=1&columns=customer_id,name'),
      route,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.headers.get('Content-Disposition')).toContain('customers_export.json')
    expect(fetchCustomers).toHaveBeenCalledWith(
      'business-1',
      expect.objectContaining({ page: 1, pageSize: 500, sortBy: 'updated_at', sortOrder: 'desc' }),
    )
  })

  it('CSV is the default format', async () => {
    const res = await GET(req(auth, 'scope=customers&columns=customer_id'), route)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('customers_export.csv')
  })
})

describe('GET /api/app/v1/export — audit trail (AUDIT-LOG-DESIGN §7, facade source)', () => {
  it('a completed export emits privacy.customer_export with the query scope, source:facade', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(req(auth), route)
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'privacy',
      action: 'privacy.customer_export',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      severity: 'notice',
      source: 'facade',
      detail: {
        scope: 'customers',
        format: 'json',
        privacy: false,
        columns: 'customer_id,name',
        store_id: null,
      },
    })
  })

  it('a clamped export persists the clamped store lens in the event', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'data.export']))
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const lines = await auditLines(async () => {
      await GET(req(auth), route)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ detail: expect.objectContaining({ store_id: 'store-1' }) })
  })

  it('a DENIED export (no capability) emits nothing — errors are not actions', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    const lines = await auditLines(async () => {
      const res = await GET(req(auth), route)
      expect(res.status).toBe(403)
    })
    expect(lines).toHaveLength(0)
  })

  it('the generic FACADE_AUDIT_MAP hook stays silent for this endpoint (deny-default) — no double-log', async () => {
    // 'export' is deliberately absent from FACADE_AUDIT_MAP (see route header
    // comment) — this pins exactly ONE audit line per completed export, not two.
    const lines = await auditLines(async () => {
      await GET(req(auth), route)
    })
    expect(lines).toHaveLength(1)
  })
})

describe('GET /api/app/v1/export — upstream outage class (fresh-eyes round 2)', () => {
  it('a core failure during the read → 502 upstream_unavailable (the retryable class every sibling uses), never a 500 — and NO audit line', async () => {
    fetchCustomers.mockRejectedValueOnce(Object.assign(new Error('core 503'), { status: 503 }))
    const lines = await auditLines(async () => {
      const res = await GET(req(auth), route)
      expect(res.status).toBe(502)
      expect((await res.json()).error.code).toBe('upstream_unavailable')
    })
    expect(lines).toHaveLength(0)
  })
})

describe('GET /api/app/v1/export — error envelope matches the facade family', () => {
  it('{error:{code,message}} — not web bare-route\'s {error:string}', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(auth), route)
    const body = await res.json()
    expect(body.error).toEqual(
      expect.objectContaining({ code: 'forbidden', message: expect.any(String) }),
    )
    expect(typeof body.error).toBe('object')
  })
})

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS for a shell origin, no auth required', async () => {
    const res = await OPTIONS(
      new Request('https://s/api/app/v1/export', {
        method: 'OPTIONS',
        headers: { origin: 'capacitor://localhost' },
      }),
      route,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })
})
