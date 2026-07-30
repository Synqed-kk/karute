/**
 * Server-side RBAC on the bulk customer export route (audit gap #4).
 *
 * GET /api/export streams the whole customer book (PII). The /data-export page +
 * nav link are NOT capability-gated in the UI, so the route itself is the
 * enforcement point. It now demands data.export — the capability the presets
 * grant owner / manager / senior only. Denials are HTTP responses (401 no auth,
 * 403 no capability), never a thrown error, because this is a route handler.
 */

const authUser: { id: string } | null = { id: 'user-1' }
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: authUser } })) },
  })),
}))

// Define the spies INSIDE the factories (no outer-variable TDZ), then pull the
// references back out via the mocked modules after import.
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => new Set(['data.export'])),
}))
jest.mock('@/lib/customers/queries', () => ({
  fetchCustomers: jest.fn(async () => ({ customers: [], totalPages: 1 })),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({
    storeId: 'store-primary',
    viewAll: true,
    allowedStoreIds: null,
  })),
}))
// Identity seam for the audit writer (actor comes from the route's own auth;
// business resolves through here).
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'user-1'),
}))

import { GET } from '@/app/api/export/route'
import { auditLines } from './helpers/audit-lines'
import { getMyCapabilities as getMyCapabilitiesImport } from '@/lib/auth/require-permission'
import { fetchCustomers as fetchCustomersImport } from '@/lib/customers/queries'
import { resolveStoreScope as resolveStoreScopeImport } from '@/lib/auth/store-scope'

const getMyCapabilities = getMyCapabilitiesImport as jest.Mock
const fetchCustomers = fetchCustomersImport as jest.Mock
const resolveStoreScope = resolveStoreScopeImport as jest.Mock

function req(qs = 'scope=customers&format=json&columns=customer_id,name') {
  return new Request(`http://localhost/api/export?${qs}`)
}

beforeEach(() => {
  jest.clearAllMocks()
  getMyCapabilities.mockImplementation(async () => new Set(['data.export']))
  resolveStoreScope.mockImplementation(async () => ({
    storeId: 'store-primary',
    viewAll: true,
    allowedStoreIds: null,
  }))
})

describe('GET /api/export — data.export enforcement', () => {
  it('403s and never reads customers when the caller lacks data.export', async () => {
    getMyCapabilities.mockImplementation(async () => new Set(['customers.view']))
    const res = await GET(req())
    expect(getMyCapabilities).toHaveBeenCalled()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'You do not have permission to export data.',
    })
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('allows the export when the caller holds data.export', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalled()
  })

  it('a failed permission LOOKUP is a 500, not a 403 — never tell a holder they lack it', async () => {
    getMyCapabilities.mockImplementation(async () => {
      throw new Error('capability resolution failed')
    })
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Could not verify your permissions.' })
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('a degraded (failure-clamped) store scope refuses the export outright', async () => {
    // The clamp keeps pages readable through a lookup blip, but its lens is
    // unverified (a stale or unpinned cookie falls back to the primary
    // store) — a bulk-PII export must never run on it, even with a storeId.
    resolveStoreScope.mockImplementation(async () => ({
      storeId: 'store-primary',
      viewAll: false,
      allowedStoreIds: ['store-primary'],
      degraded: true,
    }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Could not resolve your store scope.' })
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('the capability check runs only after auth (401 with no user)', async () => {
    // Flip the mocked user to null for this test.
    const mod = jest.requireMock('@/lib/supabase/server') as {
      createClient: jest.Mock
    }
    mod.createClient.mockResolvedValueOnce({
      auth: { getUser: jest.fn(async () => ({ data: { user: null } })) },
    })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(getMyCapabilities).not.toHaveBeenCalled()
  })
})

describe('GET /api/export — store clamp (#465 family)', () => {
  it('clamps a branch-restricted staff to their store lens', async () => {
    resolveStoreScope.mockImplementation(async () => ({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    }))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ storeId: 'store-ginza' }),
    )
  })

  it('keeps the business-wide export for viewAll staff', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ storeId: undefined }),
    )
  })

  it('clamps floating staff (no store assignment) to their resolved lens — a swallowed staff-store lookup failure must not widen a bulk-PII export', async () => {
    resolveStoreScope.mockImplementation(async () => ({
      storeId: 'store-primary',
      viewAll: false,
      allowedStoreIds: null,
    }))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(fetchCustomers).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ storeId: 'store-primary' }),
    )
  })

  it('fails CLOSED when a non-viewAll scope has no resolvable store lens (double lookup failure) — 403, no rows read', async () => {
    resolveStoreScope.mockImplementation(async () => ({
      storeId: null,
      viewAll: false,
      allowedStoreIds: null,
    }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(fetchCustomers).not.toHaveBeenCalled()
  })

  it('fails CLOSED when scope resolution throws — 403, no rows read', async () => {
    resolveStoreScope.mockImplementation(async () => {
      throw new Error('scope lookup failed')
    })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(fetchCustomers).not.toHaveBeenCalled()
  })
})

describe('GET /api/export — audit trail (AUDIT-LOG-DESIGN §7)', () => {
  it('a completed export emits privacy.customer_export with the query scope persisted', async () => {
    const lines = await auditLines(async () => {
      const res = await GET(req())
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'privacy',
      action: 'privacy.customer_export',
      actor_id: 'user-1',
      business_id: 'biz-1',
      severity: 'notice',
      source: 'web',
      // store_id null = business-wide (viewAll) — the scope §7's subject-access
      // answer re-derives export membership from.
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
    resolveStoreScope.mockImplementation(async () => ({
      storeId: 'store-ginza',
      viewAll: false,
      allowedStoreIds: ['store-ginza'],
    }))
    const lines = await auditLines(async () => {
      await GET(req())
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      detail: expect.objectContaining({ store_id: 'store-ginza' }),
    })
  })

  it('a DENIED export emits nothing — errors are not actions', async () => {
    getMyCapabilities.mockImplementation(async () => new Set())
    const lines = await auditLines(async () => {
      const res = await GET(req())
      expect(res.status).toBe(403)
    })
    expect(lines).toHaveLength(0)
  })
})
