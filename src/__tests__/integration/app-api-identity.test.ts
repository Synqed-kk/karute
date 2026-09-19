// resolveIdentity single seam (packet 03 point 1). Facade is BEARER-ONLY: a
// cookie is never identity. Tenancy + capabilities resolve from the CONFIRMED
// auth-user, and revocation-sensitive endpoints re-verify via getUser.
import { createHmac } from 'node:crypto'
import { resolveBearerIdentity } from '@/lib/app-api/identity'
import { AppApiError } from '@/lib/app-api/errors'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(),
}))
// ⚖ Liam 2026-09-16: the identity carries the unassigned verdict, and the
// SHIPPED code resolves it through actorIsUnassigned — which lazily reaches the
// SDK. Driven here for real (not stubbed) so the front gate's own wiring is
// under test, not a model of it (fresh-eyes F5).
const assignment = { current: [] as string[] }
const storeIds = { current: ['store-ginza', 'store-daikanyama'] }
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({
    staffStores: { get: async () => ({ store_ids: assignment.current }) },
    stores: {
      list: async () => ({ stores: storeIds.current.map((id) => ({ id, active: true })) }),
    },
  }),
  getSynqedClient: async () => {
    throw new Error('the Bearer path must never resolve a cookie client')
  },
}))

import { businessIdForUser } from '@/lib/staff'
import { capabilitiesForUser } from '@/lib/auth/require-permission'

const SECRET = 'test-jwt-secret-do-not-use-in-prod'
const ISSUER = 'https://testproj.supabase.co/auth/v1'
const CONFIG: VerifierConfig = { issuer: ISSUER, audience: 'authenticated', hs256Secret: SECRET, algorithms: ['HS256'] }
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

function token(sub = 'auth-user-1', over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now, ...over })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) })
const okUser = () => Promise.resolve({ id: 'auth-user-1' })

beforeEach(() => {
  jest.clearAllMocks()
  ;(businessIdForUser as jest.Mock).mockResolvedValue('business-1')
  ;(capabilitiesForUser as jest.Mock).mockResolvedValue(new Set(['customers.view']))
  // Default caller is ASSIGNED — the unassigned tests ask for that shape.
  assignment.current = ['store-ginza']
  storeIds.current = ['store-ginza', 'store-daikanyama']
})

describe('resolveBearerIdentity', () => {
  it('rejects a request with NO Authorization header (cookie is not identity)', async () => {
    await expect(
      resolveBearerIdentity(req({ cookie: 'sb-access-token=whatever' }), 'customer.read', { config: CONFIG }),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('resolves tenancy + capabilities from the verified token (non-sensitive: no getUser)', async () => {
    const getUser = jest.fn(okUser)
    const id = await resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', {
      config: CONFIG,
      getUser,
    })
    expect(id).toEqual({
      authUserId: 'auth-user-1',
      businessId: 'business-1',
      capabilities: new Set(['customers.view']),
      // ⚖ Liam 2026-09-16, additive: the unassigned gate's verdict rides the
      // identity so facadeHandler can refuse with `store_unassigned` before
      // any handler runs. A caller holding a capability can never be
      // unassigned (the gate empties the set), so this costs no lookup.
      unassigned: false,
      via: 'bearer',
      email: null, // no email claim on this token (additive field, packet 12 §B-2)
    })
    expect(getUser).not.toHaveBeenCalled() // customer.read is not revocation-sensitive
  })

  // ── the unassigned verdict, through the SHIPPED resolver ─────────────────
  it('an UNPLACED caller resolves unassigned: true — the real actorIsUnassigned, not a stub', async () => {
    assignment.current = []
    storeIds.current = ['store-ginza', 'store-daikanyama']
    const id = await resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', {
      config: CONFIG,
      getUser: jest.fn(okUser),
    })
    expect(id.unassigned).toBe(true)
  })

  it('…and it does NOT depend on the capability set being empty (fresh-eyes F4)', async () => {
    // Layer 1 is mocked here and hands back a NON-empty set — i.e. exactly the
    // mutant that used to leave the front gate silently open. The gate reads
    // the verdict itself, so it still fires.
    assignment.current = []
    storeIds.current = ['store-ginza', 'store-daikanyama']
    ;(capabilitiesForUser as jest.Mock).mockResolvedValue(new Set(['customers.view']))
    const id = await resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', {
      config: CONFIG,
      getUser: jest.fn(okUser),
    })
    expect(id.capabilities.size).toBeGreaterThan(0)
    expect(id.unassigned).toBe(true)
  })

  it('an ASSIGNED caller resolves unassigned: false', async () => {
    assignment.current = ['store-ginza']
    const id = await resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', {
      config: CONFIG,
      getUser: jest.fn(okUser),
    })
    expect(id.unassigned).toBe(false)
  })

  it('a ONE-store salon keeps the carve-out — an empty assignment is not unassigned', async () => {
    assignment.current = []
    storeIds.current = ['store-ginza']
    const id = await resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', {
      config: CONFIG,
      getUser: jest.fn(okUser),
    })
    expect(id.unassigned).toBe(false)
  })

  it('captures the Bearer token email claim in identity.email when present (additive, packet 12 §B-2)', async () => {
    const withEmail = token('auth-user-1', { email: 'mika@example.com' })
    const id = await resolveBearerIdentity(req({ authorization: `Bearer ${withEmail}` }), 'customer.read', {
      config: CONFIG,
      getUser: okUser,
    })
    expect(id.email).toBe('mika@example.com')
  })

  it('re-verifies revocation on a sensitive endpoint → revoked when getUser is null', async () => {
    await expect(
      resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'staff.update', {
        config: CONFIG,
        getUser: () => Promise.resolve(null), // token revoked server-side
      }),
    ).rejects.toMatchObject({ code: 'revoked' })
  })

  it('maps a missing business membership → 403 membership_inactive (fail-closed)', async () => {
    ;(businessIdForUser as jest.Mock).mockRejectedValue(
      new AppApiError('membership_inactive', 'No active business membership for this user'),
    )
    await expect(
      resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', { config: CONFIG, getUser: okUser }),
    ).rejects.toMatchObject({ code: 'membership_inactive' })
  })

  it('preserves a transient lookup failure → 502 upstream_unavailable (NOT a false 403)', async () => {
    ;(businessIdForUser as jest.Mock).mockRejectedValue(
      new AppApiError('upstream_unavailable', 'Business membership lookup failed'),
    )
    await expect(
      resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', { config: CONFIG, getUser: okUser }),
    ).rejects.toMatchObject({ code: 'upstream_unavailable' })
  })

  it('maps an UNEXPECTED membership throw (raw reject) → 500 internal, never membership_inactive', async () => {
    ;(businessIdForUser as jest.Mock).mockRejectedValue(new Error('socket hang up'))
    await expect(
      resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', { config: CONFIG, getUser: okUser }),
    ).rejects.toMatchObject({ code: 'internal' })
  })

  it('surfaces an expired token as the verifier error (handler maps it to 401)', async () => {
    const expired = token('auth-user-1', { exp: Math.floor(Date.now() / 1000) - 10 })
    // resolveBearerIdentity re-throws the classified BearerVerifyError; the
    // facade handler's toAppApiError turns `expired` into 401 (see handler test).
    await expect(
      resolveBearerIdentity(req({ authorization: `Bearer ${expired}` }), 'customer.read', { config: CONFIG, getUser: okUser }),
    ).rejects.toMatchObject({ name: 'BearerVerifyError', code: 'expired' })
  })
})
