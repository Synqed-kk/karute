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

import { GET } from '@/app/api/export/route'
import { can as canImport } from '@/lib/auth/require-permission'
import { listCustomers as listCustomersImport } from '@/lib/customers/queries'

const can = canImport as jest.Mock
const listCustomers = listCustomersImport as jest.Mock

function req(qs = 'scope=customers&format=json&columns=customer_id,name') {
  return new Request(`http://localhost/api/export?${qs}`)
}

beforeEach(() => {
  jest.clearAllMocks()
  can.mockImplementation(async () => true)
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
