// resolveIdentity single seam (packet 03 point 1). Facade is BEARER-ONLY: a
// cookie is never identity. Tenancy + capabilities resolve from the CONFIRMED
// auth-user, and revocation-sensitive endpoints re-verify via getUser.
import { createHmac } from 'node:crypto'
import { resolveBearerIdentity } from '@/lib/app-api/identity'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(),
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
      via: 'bearer',
    })
    expect(getUser).not.toHaveBeenCalled() // customer.read is not revocation-sensitive
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
    ;(businessIdForUser as jest.Mock).mockRejectedValue(new Error('Business profile not found'))
    await expect(
      resolveBearerIdentity(req({ authorization: `Bearer ${token()}` }), 'customer.read', { config: CONFIG, getUser: okUser }),
    ).rejects.toMatchObject({ code: 'membership_inactive' })
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
