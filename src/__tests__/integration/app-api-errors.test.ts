// Error contract (packet 03 point 5). The load-bearing row is
// jwks_unavailable → 503 (an upstream outage is NOT a 401 about the token).
import { AppApiError, toAppApiError, errorBody } from '@/lib/app-api/errors'
import { BearerVerifyError } from '@/lib/auth/verify-bearer'
import { RevocationError } from '@/lib/auth/revocation'

describe('facade error contract', () => {
  it('maps jwks_unavailable → 503, never 401', () => {
    const err = toAppApiError(new BearerVerifyError('jwks_unavailable', 'JWKS down'))
    expect(err.code).toBe('jwks_unavailable')
    expect(err.status).toBe(503)
  })

  it('maps token-statement verifier failures → 401', () => {
    for (const code of ['expired', 'signature', 'issuer', 'audience', 'malformed', 'unsupported_alg'] as const) {
      const err = toAppApiError(new BearerVerifyError(code, code))
      expect(err.status).toBe(401)
      expect(err.code).toBe('unauthenticated')
    }
  })

  it('maps a revoked token → 401 revoked', () => {
    const err = toAppApiError(new RevocationError('revoked'))
    expect(err.code).toBe('revoked')
    expect(err.status).toBe(401)
  })

  it('maps verifier config error → 500 config', () => {
    expect(toAppApiError(new BearerVerifyError('config', 'no url')).status).toBe(500)
  })

  it('never leaks an unknown throw — internal 500, generic message', () => {
    const err = toAppApiError(new Error('secret stack frame /etc/passwd'))
    expect(err.code).toBe('internal')
    expect(err.status).toBe(500)
    expect(err.message).toBe('Internal error')
  })

  it('status table covers every classified code', () => {
    const cases: [AppApiError['code'], number][] = [
      ['validation', 400], ['unauthenticated', 401], ['revoked', 401], ['forbidden', 403],
      ['tenant_forbidden', 403], ['store_forbidden', 403], ['membership_inactive', 403],
      ['not_found', 404], ['conflict', 409], ['rate_limited', 429], ['jwks_unavailable', 503],
      ['upstream_unavailable', 502], ['config', 500], ['internal', 500],
    ]
    for (const [code, status] of cases) {
      expect(new AppApiError(code, 'x').status).toBe(status)
    }
  })

  it('error body is a stable {error:{code,message}} shape', () => {
    const body = errorBody(new AppApiError('conflict', 'stale', { currentVersion: 'v2' }))
    expect(body).toEqual({ error: { code: 'conflict', message: 'stale', currentVersion: 'v2' } })
  })
})
