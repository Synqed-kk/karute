/**
 * Revocation-lag bound (PLAN §4, packet-01 point 5). Security-sensitive facade
 * endpoints must NOT trust the local fast-path: they round-trip getUser() so a
 * terminated staffer / lost device stops working before the token's natural exp.
 * Non-sensitive reads keep the local fast-path.
 */
import { createHmac } from 'node:crypto'
import {
  resolveFacadeIdentity,
  requiresRevocationCheck,
  REVOCATION_SENSITIVE_ENDPOINTS,
  RevocationError,
} from '@/lib/auth/revocation'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'

const SECRET = 'test-jwt-secret-do-not-use-in-prod'
const ISSUER = 'https://testproj.supabase.co/auth/v1'
const AUD = 'authenticated'
const CONFIG: VerifierConfig = {
  issuer: ISSUER,
  audience: AUD,
  hs256Secret: SECRET,
  algorithms: ['HS256'],
}

const now = () => Math.floor(Date.now() / 1000)
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function token(sub = 'user-uuid-123') {
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: AUD, exp: now() + 3600, iat: now() })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

describe('endpoint classification', () => {
  it('staff CRUD / PIN / permissions / export are sensitive', () => {
    for (const ep of ['staff.update', 'staff.delete', 'staff.setPin', 'permissions.update', 'export']) {
      expect(requiresRevocationCheck(ep)).toBe(true)
    }
  })
  it('an unlisted read is NOT sensitive', () => {
    expect(requiresRevocationCheck('customers.list')).toBe(false)
    expect(requiresRevocationCheck('dashboard.view')).toBe(false)
  })
  it('a facade WRITE (customer.update) is sensitive; the paired READ is not', () => {
    // Fail-closed: a just-terminated staffer must not edit customer PII on the
    // local fast-path. The coarse GET (customer.read) keeps the fast-path.
    expect(requiresRevocationCheck('customer.update')).toBe(true)
    expect(requiresRevocationCheck('customer.read')).toBe(false)
  })
  it('the constant is the single source of truth', () => {
    expect(REVOCATION_SENSITIVE_ENDPOINTS.has('export')).toBe(true)
  })
})

describe('resolveFacadeIdentity', () => {
  it('non-sensitive read → local fast-path, getUser NOT called', async () => {
    const getUser = jest.fn()
    const id = await resolveFacadeIdentity({
      token: token(), endpoint: 'customers.list', config: CONFIG, getUser,
    })
    expect(id.via).toBe('local')
    expect(id.userId).toBe('user-uuid-123')
    expect(getUser).not.toHaveBeenCalled()
  })

  it('sensitive endpoint, valid live user → server round-trip confirms', async () => {
    const getUser = jest.fn(async () => ({ id: 'user-uuid-123' }))
    const id = await resolveFacadeIdentity({
      token: token(), endpoint: 'staff.update', config: CONFIG, getUser,
    })
    expect(id.via).toBe('server')
    expect(id.userId).toBe('user-uuid-123')
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('sensitive endpoint, REVOKED user (getUser → null) → rejected', async () => {
    const getUser = jest.fn(async () => null)
    await expect(
      resolveFacadeIdentity({ token: token(), endpoint: 'staff.delete', config: CONFIG, getUser }),
    ).rejects.toBeInstanceOf(RevocationError)
  })

  it('sensitive endpoint, getUser throws (auth error) → rejected, never falls open', async () => {
    const getUser = jest.fn(async () => { throw new Error('401 from GoTrue') })
    await expect(
      resolveFacadeIdentity({ token: token(), endpoint: 'staff.setPin', config: CONFIG, getUser }),
    ).rejects.toBeInstanceOf(RevocationError)
  })

  it('getUser id disagreeing with token sub → rejected', async () => {
    const getUser = jest.fn(async () => ({ id: 'someone-else' }))
    await expect(
      resolveFacadeIdentity({ token: token('user-uuid-123'), endpoint: 'export', config: CONFIG, getUser }),
    ).rejects.toBeInstanceOf(RevocationError)
  })

  it('a bad token is rejected before any network round-trip', async () => {
    const getUser = jest.fn(async () => ({ id: 'x' }))
    await expect(
      resolveFacadeIdentity({ token: 'garbage.token', endpoint: 'staff.update', config: CONFIG, getUser }),
    ).rejects.toMatchObject({ name: 'BearerVerifyError' })
    expect(getUser).not.toHaveBeenCalled()
  })
})
