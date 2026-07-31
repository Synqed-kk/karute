// Profile screen facade GET (design-parity packet 12 §B-2). Pins: missing
// Bearer → 401, no reads · missing capability → 403, no reads · store-id
// outside a clamped staff's assignment → 403 store_forbidden · self-row
// selection is keyed by the CONFIRMED authUserId (never the first roster
// row) · role derives from the self row's display_role · email flows from
// the Bearer claim when present, falls back to the '—' placeholder when
// absent (web parity: page.tsx does `user?.email ?? '—'`) · a failed
// load-bearing read (staff roster / org settings) → 502.
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

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'STYLIST' },
  { id: 'staff-2', full_name: 'Someone Else', display_role: 'STYLIST' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const orgSettingsWithClient = jest.fn(async (..._a: unknown[]) => ({ salon_name: 'テストサロン' }))
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: (...a: unknown[]) => orgSettingsWithClient(...a),
}))

const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const storesGet = jest.fn(async () => ({}))
const fakeClient = {
  stores: { get: storesGet },
  staffStores: { get: staffStoresGet },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET } from '@/app/api/app/v1/screens/profile/route'
import { ProfileScreenDTO } from '@/lib/app-api/profile-screen-dto'

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
  new Request('https://s/api/app/v1/screens/profile', {
    headers: { authorization: `Bearer ${token}`, ...headers },
  })

async function dtoOf(res: Response) {
  const body = await res.json()
  return ProfileScreenDTO.parse(body.data ?? body)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'STYLIST' },
    { id: 'staff-2', full_name: 'Someone Else', display_role: 'STYLIST' },
  ])
  orgSettingsWithClient.mockResolvedValue({ salon_name: 'テストサロン' })
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  storesGet.mockResolvedValue({})
})

describe('GET /api/app/v1/screens/profile', () => {
  it('missing Bearer → 401, no reads', async () => {
    const res = await GET(new Request('https://s/api/app/v1/screens/profile'), route)
    expect(res.status).toBe(401)
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no reads', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(newSynqedClient).not.toHaveBeenCalled()
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
  })

  it('store-id outside a clamped assignment → 403 store_forbidden, no reads', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await GET(req({ 'store-id': 'store-B' }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
  })

  it('happy path → 200, self row selected by authUserId (not the first roster row)', async () => {
    // auth-user-1 is SECOND in the roster — proves the lookup is keyed by id,
    // not list order.
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'staff-2', full_name: 'Someone Else', display_role: 'STYLIST' },
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'STYLIST' },
    ])
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.name).toBe('Mika Tanaka')
    expect(dto.initials).toBe('MT')
    expect(dto.role).toBe('staff')
    expect(dto.roleLabel).toEqual({ ja: 'スタッフ', en: 'Stylist' })
    expect(dto.storeName).toEqual({ ja: 'テストサロン', en: 'テストサロン' })
  })

  it('owner role + label derive from the self row display_role', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'OWNER' },
    ])
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.role).toBe('owner')
    expect(dto.roleLabel).toEqual({ ja: 'オーナー', en: 'Owner' })
  })

  it('email present on the Bearer claim flows to the DTO', async () => {
    const res = await GET(req({}, bearer({ email: 'mika@example.com' })), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.email).toBe('mika@example.com')
  })

  it('email absent on the Bearer claim falls back to the "—" placeholder (web parity)', async () => {
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.email).toBe('—')
  })

  it('no roster row for the caller: name falls back to the email local-part, role is staff', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'staff-2', full_name: 'Someone Else', display_role: 'STYLIST' },
    ])
    const res = await GET(req({}, bearer({ email: 'orphan@example.com' })), route)
    const dto = await dtoOf(res)
    expect(dto.name).toBe('orphan')
    expect(dto.role).toBe('staff')
  })

  it('a failed load-bearing read (staff roster) → 502', async () => {
    staffListByBusinessOrThrow.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('a failed load-bearing read (org settings) → 502', async () => {
    orgSettingsWithClient.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })
})
