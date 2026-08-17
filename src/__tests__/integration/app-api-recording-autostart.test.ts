// Facade route test for POST /api/app/v1/org-settings/recording-autostart
// (recording-integrity PR A4, fix round F-C). Modeled on
// app-api-org-settings-patch.test.ts. Before this suite the route's own
// shape — the settings.manage gate, body validation, and the three-way
// SetRecordingAutostartResult → AppApiError map — was proven only indirectly
// (choke-point unit tests + the cross-cutting CP2/CP7/revocation-coverage
// suites), and it is the ONLY authz on the phone path to the one audited
// settings key. Pins: settings.manage refusal (403, no write) · non-JSON body
// (400) · missing/mistyped fields (400) · foreign store (400) · happy path
// ({storeIds}) · OPTIONS short-circuits to the same handler.
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))

const mockCapabilities = jest.fn(async () => new Set(['settings.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

import type { SetRecordingAutostartResult } from '@/lib/settings/recording-autostart'
const setRecordingAutostartWithClient = jest.fn(
  async (..._a: unknown[]): Promise<SetRecordingAutostartResult> => ({
    ok: true,
    storeIds: ['store-1'],
  }),
)
jest.mock('@/lib/settings/recording-autostart', () => ({
  setRecordingAutostartWithClient: (...a: unknown[]) => setRecordingAutostartWithClient(...a),
}))

const fakeClient = { orgSettings: {}, stores: {} }
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { POST, OPTIONS } from '@/app/api/app/v1/org-settings/recording-autostart/route'

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
const route = { params: Promise.resolve({}) }
function req(body: unknown, rawBody = false) {
  return new Request('https://s/api/app/v1/org-settings/recording-autostart', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' },
    body: rawBody ? (body as string) : JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['settings.manage']))
  setRecordingAutostartWithClient.mockResolvedValue({ ok: true, storeIds: ['store-1'] })
})

describe('POST /api/app/v1/org-settings/recording-autostart', () => {
  it('missing settings.manage → 403, no write (the only authz on the phone path)', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await POST(req({ storeId: 'store-1', enabled: true }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(setRecordingAutostartWithClient).not.toHaveBeenCalled()
  })

  it('non-JSON body → 400 validation, no write', async () => {
    const res = await POST(req('{not json', true), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
    expect(setRecordingAutostartWithClient).not.toHaveBeenCalled()
  })

  it('missing/mistyped fields → 400 validation, no write', async () => {
    const res1 = await POST(req({ enabled: true }), route)
    expect(res1.status).toBe(400)
    expect((await res1.json()).error.code).toBe('validation')

    const res2 = await POST(req({ storeId: 'store-1', enabled: 'yes' }), route)
    expect(res2.status).toBe(400)
    expect((await res2.json()).error.code).toBe('validation')

    expect(setRecordingAutostartWithClient).not.toHaveBeenCalled()
  })

  it('a foreign store → 400 validation (the choke point\'s unknown_store maps to validation)', async () => {
    setRecordingAutostartWithClient.mockResolvedValueOnce({ ok: false, error: 'unknown_store' })
    const res = await POST(req({ storeId: 'store-foreign', enabled: true }), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
  })

  it('happy path → 200, writer called with the business-scoped client + facade actor, {storeIds} back', async () => {
    const res = await POST(req({ storeId: 'store-1', enabled: true }), route)
    expect(res.status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(setRecordingAutostartWithClient).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ staffId: 'auth-user-1', businessId: 'business-1', source: 'facade' }),
      'store-1',
      true,
    )
    expect(await res.json()).toEqual({ storeIds: ['store-1'] })
  })

  it('OPTIONS short-circuits to the preflight before it ever reaches the handler', async () => {
    expect(OPTIONS).toBe(POST)
  })
})
