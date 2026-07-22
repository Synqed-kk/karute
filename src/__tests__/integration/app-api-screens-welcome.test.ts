// Welcome screen facade GET (design-parity packet 21). Pins: missing Bearer
// → 401, no reads · missing capability → 403, no reads · configured salon →
// 3 fields verbatim (mirrors page.tsx's derivation byte-for-byte) · null
// settings (legitimately-unconfigured salon) → {'','',null} · a failed
// upstream read → classified 502.
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

const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

type FakeOrgSettings = {
  salon_name: string
  business_type: string
  recording_disclosure_mode: 'A' | 'B' | 'C' | null
} | null
const orgSettingsWithClient = jest.fn(
  async (..._a: unknown[]): Promise<FakeOrgSettings> => ({
    salon_name: 'テストサロン',
    business_type: 'hair_salon',
    recording_disclosure_mode: 'B',
  }),
)
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: (...a: unknown[]) => orgSettingsWithClient(...a),
}))

const newSynqedClient = jest.fn((_businessId: string) => ({}))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET } from '@/app/api/app/v1/screens/welcome/route'
import { WelcomeScreenDTO } from '@/lib/app-api/welcome-screen-dto'

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
    ...overrides,
  })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const route = { params: Promise.resolve({}) }
const req = (headers: Record<string, string> = {}, token = bearer()) =>
  new Request('https://s/api/app/v1/screens/welcome', {
    headers: { authorization: `Bearer ${token}`, ...headers },
  })

async function dtoOf(res: Response) {
  const body = await res.json()
  return WelcomeScreenDTO.parse(body.data ?? body)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  orgSettingsWithClient.mockResolvedValue({
    salon_name: 'テストサロン',
    business_type: 'hair_salon',
    recording_disclosure_mode: 'B',
  })
})

describe('GET /api/app/v1/screens/welcome', () => {
  it('missing Bearer → 401, no reads', async () => {
    const res = await GET(new Request('https://s/api/app/v1/screens/welcome'), route)
    expect(res.status).toBe(401)
    expect(orgSettingsWithClient).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no reads', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(newSynqedClient).not.toHaveBeenCalled()
    expect(orgSettingsWithClient).not.toHaveBeenCalled()
  })

  it('settings.manage WITHOUT customers.view → 200 (whoever can complete onboarding can open the wizard)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['settings.manage']))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
  })

  it('happy path → 200, configured salon maps 3 fields verbatim', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto).toEqual({
      salon_name: 'テストサロン',
      business_type: 'hair_salon',
      recording_disclosure_mode: 'B',
    })
  })

  it('null settings (legitimately-unconfigured salon) → {"","",null}', async () => {
    orgSettingsWithClient.mockResolvedValue(null)
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto).toEqual({
      salon_name: '',
      business_type: '',
      recording_disclosure_mode: null,
    })
  })

  it('a failed upstream read → 502', async () => {
    orgSettingsWithClient.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })
})
