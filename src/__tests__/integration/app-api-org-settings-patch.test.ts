// org-settings facade write (design-parity packet 12 §S1). Pins: missing
// Bearer → 401, no write · missing settings.manage → 403 (standard facade
// authz throw, NOT upsertOrgSettings's own soft { error } return) · a
// malformed body → 400 validation · a wrong-typed field → 400 validation
// (zod rejection) · a valid patch rides writeOrgSettingsBlobWithClient's OWN
// result shape verbatim on 2xx — both the { success: true } happy path and a
// business-level { error } (e.g. operating_hours validation) pass through
// unmapped.
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

type WriteResult = { success: true } | { error: string }
const writeOrgSettingsBlobWithClient = jest.fn(
  async (..._a: unknown[]): Promise<WriteResult> => ({ success: true }),
)
jest.mock('@/actions/org-settings', () => ({
  writeOrgSettingsBlobWithClient: (...a: unknown[]) => writeOrgSettingsBlobWithClient(...a),
}))

const fakeClient = { orgSettings: {} }
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { PATCH } from '@/app/api/app/v1/org-settings/route'

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
function patchReq(body: unknown, rawBody = false) {
  return new Request('https://s/api/app/v1/org-settings', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' },
    body: rawBody ? (body as string) : JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['settings.manage']))
  writeOrgSettingsBlobWithClient.mockResolvedValue({ success: true })
})

describe('PATCH /api/app/v1/org-settings', () => {
  it('missing Bearer → 401, no write', async () => {
    const res = await PATCH(
      new Request('https://s/api/app/v1/org-settings', {
        method: 'PATCH',
        body: JSON.stringify({ salon_name: 'x' }),
      }),
      route,
    )
    expect(res.status).toBe(401)
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('missing settings.manage → 403 (standard facade throw, not a soft { error } 200)', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await PATCH(patchReq({ salon_name: 'New name' }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('malformed JSON body → 400 validation, no write', async () => {
    const res = await PATCH(patchReq('{not json', true), route)
    expect(res.status).toBe(400)
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('a wrong-typed field → 400 validation (zod rejection), no write', async () => {
    const res = await PATCH(patchReq({ confidence_threshold: 'high' }), route)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('validation')
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('a valid patch → 200, writer called with the business-scoped client + parsed body', async () => {
    const res = await PATCH(patchReq({ salon_name: 'New name' }), route)
    expect(res.status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(writeOrgSettingsBlobWithClient).toHaveBeenCalledWith(fakeClient, { salon_name: 'New name' })
    expect(await res.json()).toEqual({ success: true })
  })

  it('the writer\'s business-level { error } rides the 2xx body verbatim (RPC passthrough)', async () => {
    writeOrgSettingsBlobWithClient.mockResolvedValueOnce({ error: 'Open and close times must be valid times.' })
    const res = await PATCH(patchReq({ auto_stop_minutes: 30 }), route)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'Open and close times must be valid times.' })
  })

  it('unknown top-level keys are silently dropped by zod, not forwarded to the writer', async () => {
    await PATCH(patchReq({ salon_name: 'New name', not_a_real_field: 'x' }), route)
    expect(writeOrgSettingsBlobWithClient).toHaveBeenCalledWith(fakeClient, { salon_name: 'New name' })
  })
})
