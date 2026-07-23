// /data-export screen facade GET (design-parity packet 23). Store clamp runs
// REAL (only the synqed SDK client is faked), same class as
// app-api-screens-customers.test.ts. Pins:
//   401 no Bearer, no reads · 403 missing customers.view floor, no reads ·
//   happy path → 3 totals + recipientEmail from the Bearer claim · a failed
//   store-scope resolution renders ZERO totals (200, page-parity — NOT the
//   ask-ai screen's 502-on-failure posture) · an individual list failure
//   degrades to zero for THAT scope only (page-parity .catch(() => zero)) ·
//   a clamped staff member's counts thread store_id · no email claim falls
//   back to 'owner@example.com' (web's own fallback).
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))

const mockCapabilities = jest.fn(async () => new Set(['customers.view', 'stores.viewAll']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const customersList = jest.fn(async () => ({ total: 42 }))
const appointmentsList = jest.fn(async () => ({ total: 7 }))
const karuteRecordsList = jest.fn(async () => ({ total: 13 }))
const storesGet = jest.fn(async (id: string) => {
  if (id !== 'store-1' && id !== 'store-2') throw new Error('404 not this tenant')
  return { id }
})
const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const fakeClient = {
  customers: { list: customersList },
  appointments: { list: appointmentsList },
  karuteRecords: { list: karuteRecordsList },
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn(() => fakeClient),
}))

import { GET, OPTIONS } from '@/app/api/app/v1/screens/data-export/route'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: 'auth-user-1',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    email: 'owner@la-estro.jp',
    ...overrides,
  })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const route = { params: Promise.resolve({}) }
function req(headers: Record<string, string> = {}, token = bearer()) {
  return new Request('https://s/api/app/v1/screens/data-export', {
    headers: { authorization: `Bearer ${token}`, ...headers },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  customersList.mockResolvedValue({ total: 42 })
  appointmentsList.mockResolvedValue({ total: 7 })
  karuteRecordsList.mockResolvedValue({ total: 13 })
})

describe('GET /api/app/v1/screens/data-export — auth / floor', () => {
  it('missing Bearer → 401, no reads', async () => {
    const res = await GET(new Request('https://s/api/app/v1/screens/data-export'), route)
    expect(res.status).toBe(401)
    expect(customersList).not.toHaveBeenCalled()
  })

  it('missing customers.view floor → 403, no reads', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(storesGet).not.toHaveBeenCalled()
    expect(customersList).not.toHaveBeenCalled()
  })
})

describe('GET /api/app/v1/screens/data-export — happy path DTO shape', () => {
  it('maps the 3 scope totals + recipientEmail from the Bearer claim', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto).toEqual({
      totals: { customers: 42, bookings: 7, karute: 13 },
      recipientEmail: 'owner@la-estro.jp',
    })
  })

  it('no email claim falls back to owner@example.com (web page parity)', async () => {
    const res = await GET(req({}, bearer({ email: undefined })), route)
    const dto = await res.json()
    expect(dto.recipientEmail).toBe('owner@example.com')
  })
})

describe('GET /api/app/v1/screens/data-export — fail-closed zeros (page parity, NOT the ask-ai 502 posture)', () => {
  it('a failed store-scope resolution renders zero totals, 200 — not an error', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view'])) // forces the assignment-lookup path
    staffStoresGet.mockRejectedValueOnce(new Error('boom'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.totals).toEqual({ customers: 0, bookings: 0, karute: 0 })
    expect(customersList).not.toHaveBeenCalled()
  })

  it('a single failed count (e.g. appointments) degrades to zero for THAT scope only', async () => {
    appointmentsList.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.totals).toEqual({ customers: 42, bookings: 0, karute: 13 })
  })
})

describe('GET /api/app/v1/screens/data-export — store clamp threads store_id', () => {
  it('a branch-restricted staff member gets store-clamped counts', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    staffStoresGet.mockResolvedValue({ store_ids: ['store-1'] })
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1' }))
    expect(appointmentsList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1' }))
    expect(karuteRecordsList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-1' }))
  })

  it('a cross-store viewer stays business-wide (store_id undefined)', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })
})

describe('OPTIONS preflight', () => {
  it('returns 204 with CORS for a shell origin, no auth required', async () => {
    const res = await OPTIONS(
      new Request('https://s/api/app/v1/screens/data-export', {
        method: 'OPTIONS',
        headers: { origin: 'capacitor://localhost' },
      }),
      route,
    )
    expect(res.status).toBe(204)
  })
})
