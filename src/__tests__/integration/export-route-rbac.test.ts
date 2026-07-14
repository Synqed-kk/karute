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
jest.mock('@/lib/auth/require-permission', () => ({ can: jest.fn(async () => true) }))
jest.mock('@/lib/customers/queries', () => ({
  listCustomers: jest.fn(async () => ({ customers: [], totalPages: 1 })),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({
    storeId: 'store-primary',
    viewAll: true,
    allowedStoreIds: null,
  })),
}))

import { GET } from '@/app/api/export/route'
import { can as canImport } from '@/lib/auth/require-permission'
import { listCustomers as listCustomersImport } from '@/lib/customers/queries'
import { resolveStoreScope as resolveStoreScopeImport } from '@/lib/auth/store-scope'

const can = canImport as jest.Mock
const listCustomers = listCustomersImport as jest.Mock
const resolveStoreScope = resolveStoreScopeImport as jest.Mock

function req(qs = 'scope=customers&format=json&columns=customer_id,name') {
  return new Request(`http://localhost/api/export?${qs}`)
}

beforeEach(() => {
  jest.clearAllMocks()
  can.mockImplementation(async () => true)
  resolveStoreScope.mockImplementation(async () => ({
    storeId: 'store-primary',
    viewAll: true,
    allowedStoreIds: null,
  }))
})

describe('GET /api/export — data.export enforcement', () => {
  it('403s and never reads customers when the caller lacks data.export', async () => {
    can.mockImplementation(async (cap: string) => cap !== 'data.export')
    const res = await GET(req())
    expect(can).toHaveBeenCalledWith('data.export')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'You do not have permission to export data.',
    })
    expect(listCustomers).not.toHaveBeenCalled()
  })

  it('allows the export when the caller holds data.export', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(listCustomers).toHaveBeenCalled()
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
    expect(can).not.toHaveBeenCalled()
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
    expect(listCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-ginza' }),
    )
  })

  it('keeps the business-wide export for viewAll staff', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(listCustomers).toHaveBeenCalledWith(
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
    expect(listCustomers).toHaveBeenCalledWith(
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
    expect(listCustomers).not.toHaveBeenCalled()
  })

  it('fails CLOSED when scope resolution throws — 403, no rows read', async () => {
    resolveStoreScope.mockImplementation(async () => {
      throw new Error('scope lookup failed')
    })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(listCustomers).not.toHaveBeenCalled()
  })
})
